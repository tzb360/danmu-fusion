# 剧集级弹幕聚合服务架构

> 目标：将 danmu_API 从「单次清洗工具」升级为 **服务端弹幕聚合服务**（Emby / Forward 等播放器后端）。

## 1. 现状分析

### 1.1 已有能力

| 能力 | 位置 | 说明 |
|------|------|------|
| 影视搜索/匹配 | `apis/dandan-api.js` | search / match / bangumi / comment |
| 搜索时多源配对 | `utils/merge-util.js` `applyMergeLogic` | 依赖 `MERGE_SOURCE_PAIRS`，生成 `$$$` 复合 URL |
| 复合 URL 并行取弹 | `fetchMergedComments` | 仅当 URL 含 `$$$` |
| 列表拼接 | `mergeDanmakuList` | 按时间排序，**无语义去重** |
| 智能清洗 | `aggregation/processor.js` | 去重/广告/时间提示/质量分 |
| 实时清洗挂钩 | `live-pipeline.js` → `convertToDanmakuJson` | 对**已取到的**弹幕做清洗 |
| 离线 merge API | `POST /api/danmaku/merge` | **客户端自带 sources**，不识别剧集 |
| 短时 comment 缓存 | `commentCache` 按 **URL** 键 | TTL 默认约 3 分钟，非剧集级 |

### 1.2 关键缺口

```
目标：识别剧集 → 找全部来源 → 抓取 → 标准化 → 合并 → 时间轴 → 清洗 → 剧集缓存 → 播放器
现状：搜索配对(可选) → 单 commentId → 取 1 个 URL(或 $$$) → 拼接 → 清洗 → URL 短缓存
```

1. **无剧集级身份**：`commentId` 是进程内自增，不是 TMDB/剧名+季+集 稳定键。  
2. **无「自动发现该集全部来源」**：必须靠搜索时 `MERGE_SOURCE_PAIRS` 或手工复合 URL。  
3. **合并层过弱**：comment 层主要是拼接；真正语义去重在清洗层。  
4. **无剧集级持久缓存**：`episode_cache` / 重聚合管理缺失。  
5. **无 Forward 专用聚合接口**：播放器需自行走 dandan 全链路。  
6. **Web 无「聚合任务/缓存」管理**：仅有规则面板。

---

## 2. 目标架构（接入原链路，非人工预聚合）

**Forward 真实调用链（原有，保留）：**

```
Forward searchDanmu  → GET /api/v2/search/anime
Forward getDetail    → GET /api/v2/bangumi/:id
Forward getComments  → GET /api/v2/comment/:commentId   ← 插入聚合清洗
```

**comment 请求内部（增强后）：**

```
resolve url (含 MERGE $$$ 多源)
  → 多源并行抓取 fetchMergedComments / 单源 getComments
  → 【新增】request-pipeline: 聚合 + 清洗
  → 【新增】播放器纯净输出（无【来源】）
  → 【新增】自动写入剧集缓存
  → 返回 Forward
```

**直连入口（可选）：** `GET /api/forward/danmaku?title=&season=&episode=`  
内部仍走 search → commentId → getComment，不要求后台预生成。

**Web 后台：** 仅「缓存管理」（查看/刷新/删除），不是主流程。

### 2.1 数据流（剧集级）

```
影视识别 (title / tmdb_id + season + episode)
        ↓
定位候选 (searchCache / searchAnime / 已有 animes)
        ↓
收集该集所有可用来源链接 + 来源权重 (SOURCE_ORDER)
        ↓
并行抓取 → 标准化
        ↓
多来源合并 (时间轴 + 精确/相似去重 + 权重保留)
        ↓
清洗过滤 (广告/时间提示/低质量/刷屏…)  ← 保留现有规则引擎
        ↓
写入 episode cache
        ↓
播放器读取缓存结果
```

### 2.2 与现有清洗系统关系

- **保留** `aggregation/rules` + `processor` 作为流水线**最后一步**。  
- **保留** `POST /api/danmaku/merge` 作为「上传文件试洗」工具。  
- **新增** 剧集编排层负责「找谁、抓谁、存哪」，不再要求客户端传 sources。

---

## 3. 新增模块清单

| 模块 | 路径 | 职责 |
|------|------|------|
| 身份与缓存键 | `aggregation/episode-identity.js` | 生成稳定 `episodeKey` |
| 剧集缓存 | `aggregation/episode-cache.js` | 内存 + `.cache/episodes/*.json` |
| 编排服务 | `aggregation/episode-service.js` | 发现来源 / 抓取 / 合并 / 缓存 |
| HTTP API | `apis/episode-aggregate-api.js` | aggregate / forward / cache 管理 |
| Web 面板 | `ui/js/episodeaggregate.js` | 聚合管理 UI |
| 架构文档 | `ARCHITECTURE_AGGREGATION.md` | 本文件 |
| 测试 | `episode-aggregate.test.js` | 身份/缓存/编排单测 |

### 3.1 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/episode/aggregate` | 剧集聚合（可 force 重建） |
| `GET` | `/api/forward/danmaku` | Forward/播放器：`title|tmdb_id + season + episode` |
| `GET` | `/api/episode/cache` | 列表缓存任务 |
| `GET` | `/api/episode/cache/:key` | 详情（来源/统计） |
| `DELETE` | `/api/episode/cache` | 清空或按 key 删除 |
| `POST` | `/api/episode/reaggregate` | 强制重聚合 |

### 3.2 请求示例

```http
GET /api/forward/danmaku?title=生万物&season=1&episode=1&format=json
GET /api/forward/danmaku?tmdb_id=12345&season=1&episode=3
POST /api/episode/aggregate
{
  "title": "生万物",
  "season": 1,
  "episode": 1,
  "force": false
}
```

### 3.3 缓存结构

```json
{
  "key": "title:生万物:s1:e1",
  "identity": { "title": "生万物", "season": 1, "episode": 1, "tmdb_id": null },
  "created_at": "ISO",
  "updated_at": "ISO",
  "sources": [
    { "source": "bilibili", "url": "...", "count_raw": 10000, "weight": 10 }
  ],
  "stats": {
    "total_before": 23000,
    "total_after": 18000,
    "removed_by_reason": { "duplicate_exact": 3000, "advertisement": 200 }
  },
  "comments": [ { "p": "...", "m": "...", "cid": 1 } ]
}
```

路径：`.cache/episodes/<safeKey>.json`（Docker 挂载 `.cache` 持久化）。

---

## 4. 来源权重策略

- 默认按 `SOURCE_ORDER` 顺序：越靠前权重越高。  
- 合并/去重时**优先保留高权重来源**的弹幕（同时间窗同文）。  
- 可在请求中覆盖：`source_weights: { bilibili: 10, tencent: 8 }`。

---

## 5. Web「弹幕聚合管理」

- 剧集列表（缓存索引）  
- 来源数量 / 原始条数 / 清洗后条数  
- 缓存状态、更新时间  
- 操作：重新聚合、清除缓存、查看来源明细  

与「弹幕处理」分工：

- **弹幕处理**：规则引擎配置 + 在线试洗  
- **弹幕聚合管理**：剧集任务与缓存  

---

## 6. 实施原则

1. **不推翻** 现有 dandan 兼容接口与清洗规则。  
2. **新增编排层**，复用 `sources/*` 与 `processDanmakuMerge`。  
3. **可选接入** 原 `getComment`：复合 URL 或环境开关后可走剧集缓存。  
4. **部署**：完成本架构与实现后再更新线上实例。  

---

## 7. Forward 适配（播放器纯净输出）

模块：`danmu_api/forward_adapter/`（**参考** ForwardWidgets 规范，不复制其代码）

| 输出 | 是否含来源标签 |
|------|----------------|
| `/api/forward/danmaku` JSON/XML/ASS | **否**（统一弹幕库） |
| 后台 `/api/episode/cache` sources 统计 | **是**（仅管理） |
| 内部缓存 comments.p 中的 [source] | 可保留，出站前剥离 |

播放器标题净化：去掉 `【renren】` / `[bilibili]` / `from migu` 等装饰。

## 8. 分阶段落地

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 架构文档 + episode identity/cache/service + API | 完成 |
| P1 | Forward 接口 + Web 聚合管理 | 完成 |
| P1.1 | 播放器剥离来源标签 | 完成 |
| P2 | 与 getComment 深度打通、TMDB 解析增强 | 后续 |
| P3 | Redis 持久化剧集缓存、来源权重 UI | 后续 |

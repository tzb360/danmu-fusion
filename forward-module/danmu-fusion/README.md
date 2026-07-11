# Danmu Fusion · 弹幕融合

**模块名称：** Danmu Fusion（弹幕融合）  
**模块 ID：** `tzb360.danmu.fusion`  
**版本：** 1.0.0  
**作者：** tzb360（仅 `author` 字段）  
**网站：** [https://github.com/tzb360/danmu_api](https://github.com/tzb360/danmu_api)

---

## 项目依赖

**Danmu Fusion 需要配套使用 Danmu API。**

| 项目 | 说明 |
|------|------|
| 本模块 | Forward 播放端 Widget |
| Danmu API | 弹幕聚合后端服务 |

**API 项目地址：**

https://github.com/tzb360/danmu_api

请先部署 Danmu API，然后在本模块中配置 Forward API 地址。

未部署或未连接 Danmu API 时，本模块无法获取弹幕。

---

## 架构说明

```
用户播放端（Emby / Jellyfin + Forward）
        │
        ▼
   Danmu Fusion（本模块）
        │
        │  GET /api/forward/danmaku
        ▼
   Forward 专属 API
        │
        ▼
   Danmu API 服务
        │
        ▼
   多来源弹幕聚合 / 版本匹配 / 清洗 / 缓存
```

---

## 简介

Danmu Fusion 是一个弹幕聚合播放模块，需要配套使用 Danmu API 服务。

本模块通过专属 Forward API 获取经过聚合、版本匹配和处理后的弹幕数据，为 Emby/Jellyfin 提供稳定的弹幕播放体验。

---

## 安装

1. 部署 [Danmu API](https://github.com/tzb360/danmu_api)
2. 在 Forward 中导入本模块：`danmu-fusion.js`
3. 配置 **Danmu API 地址**（只需一个 URL，Token 写在路径中）：

```text
http://你的服务器:9321/YOUR_TOKEN/api/forward/danmaku
```

也可在 Danmu API Web 管理面板「聚合缓存管理」中一键复制完整 Forward API 地址。

---

## 配置项

| 参数 | 说明 | 默认 |
|------|------|------|
| `danmu_api_url` | Danmu API / Forward API 完整地址 | 必填 |
| `timeout` | 超时（毫秒） | 60000 |
| `retry` | 重试次数 | 2 |
| `cache` | 模块侧短期缓存 | 1 |
| `color_to_white` | 彩色弹幕转白（服务端） | 1 |
| `force_scroll` | 统一滚动弹幕（服务端） | 1 |
| `debug` | 调试日志（不污染播放器 UI） | 0 |

---

## 功能说明

- 专属 Forward API，强制聚合与版本匹配
- 电影单集 / 剧集当前集正确识别
- 地区、年份、季集展示（如：无耻之徒 (美版 2011) S04）
- 排除同名综艺、赏析、幕后等干扰内容
- 播放器输出纯净弹幕（无来源标签）

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `danmu-fusion.js` | Forward 导入的主模块 |
| `danmu-fusion.fwd` | Widget 索引（可选） |
| `test-danmu-fusion.mjs` | 本地联调脚本 |

---

## 开源说明

配套 API 为基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 的二次开发版本，详见 API 仓库 README。

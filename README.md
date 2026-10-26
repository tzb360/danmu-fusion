# Danmu Fusion · 弹幕融合

[![Version](https://img.shields.io/badge/version-1.5.1-blue)](https://github.com/tzb360/danmu-fusion/releases/tag/v1.5.1)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](./LICENSE)
[![telegram](https://img.shields.io/badge/telegram-telegram__channel-0088cc?style=plastic)](https://t.me/mkfx360)

为 Rex / Forward 兼容播放器提供的开源弹幕接入模块，支持同时配置 **1～3 个弹弹 Play 兼容 API**，完成搜索、选集和弹幕加载。

**Danmu Fusion 是播放器模块，不是 danmu_api 服务端。** 模块需要连接另行部署的兼容 API，不附带公共接口、账号或密钥。仓库公开完整维护源码、独立构建脚本和测试，并保留基于 [danmu_api](https://github.com/huangxd-/danmu_api) 的历史后端源码与许可。

Telegram 频道：[@mkfx360](https://t.me/mkfx360)

## 在线安装

复制下面的 Raw 直链，在播放器的模块管理中选择「通过链接添加」或「通过 URL 导入」，粘贴后确认：

```text
https://raw.githubusercontent.com/tzb360/danmu-fusion/main/forward-module/danmu-fusion/danmu-fusion.js
```

- [安装索引 widget.fwd](https://raw.githubusercontent.com/tzb360/danmu-fusion/main/forward-module/danmu-fusion/widget.fwd)
- [1.5.1 固定版本直链](https://raw.githubusercontent.com/tzb360/danmu-fusion/v1.5.1/forward-module/danmu-fusion/danmu-fusion.js)
- [发布页与完整源码包](https://github.com/tzb360/danmu-fusion/releases/tag/v1.5.1)

安装后填写「弹幕 API 1（主要接口）」。需要时再填写 API 2、API 3；每框一个地址，可留空，不要用换行输入多个地址。

```text
https://example.com/your-token
https://example.com/proxy/your-token/api/v2/
https://example.com/proxy/api/v2?token=your%2Fencoded%2Btoken
```

模块 ID 保持 `tzb360.danmu.fusion`。API 1 沿用 `danmu_api_url`，API 2/3 分别使用 `danmu_api_url_2`、`danmu_api_url_3`。从旧版升级时原 API 1 配置继续有效。

## 1.5.1 更新

- **记住常用来源**：为某部剧选好来源并成功加载后，同作品后续集数优先推荐该 API；电影同样支持。换季、年份、版本、身份或接口凭据变化后重新验证。
- **看懂加载问题**：地址错误、认证失败、接口不存在、服务器故障、网络与超时等分别给出简体中文诊断，反馈时无需附带私人地址或 Token。
- **有证据才切换备用**：当前来源不可用时，只尝试已验证同作品、同集、同片长和同视频版本的备用来源，并保留原始错误；缺少证据仍可独立选源。
- **减少加载与拖动开销**：合并重复加载和解析，为可缓存轨道建立分钟索引；超大轨道跳过缓存，完整条数、原始内容和时间轴保持不变。

兼容功能继续保留：

- **多 API 独立选源**：最多三个接口独立规范化、去重和并发搜索。单个接口失败不清空健康来源的结果。
- **优先展示有效结果**：首次搜索不等待仍在冷查询的慢接口；稍后完成的数据可在后续搜索中补充。播放器自身的列表缓存可能影响刷新。
- **可靠来源绑定**：选择 ID 绑定来源指纹与真实协议 ID，防止不同接口的相同编号串线；支持来源重排、新运行时和仅传 commentId 的播放请求。
- **保守匹配**：核对电影或剧集的片名、年份、类型和季集，保留标准 match 年份辅助复核及失败回退。
- **有依据的安全聚合**：同作品选源入口保留每个来源。只有同版本、同季集、相同明确片长及相同内容指纹或官方视频资源证据时，才提供跨 API 聚合选项。
- **保留原生效果**：继续使用服务端 `withRelated=true` 聚合，保留时间、颜色、滚动、顶部和底部样式，不重复施加偏移。
- **单文件导入**：完整 JS 可独立运行，运行时无需其他源码文件、Node.js 或浏览器计时器。

所有接口都缺少片长或视频指纹时，仍可独立搜索、选集和播放，不会盲目拼接不同服务器的弹幕。只有真实取得的评论来源才计为成功来源。

## 更新与兼容

通过相同 Raw 地址更新即可。主分支直链始终提供当前正式版本；需要固定版本时使用带版本标签的直链。

仅配置 API 1 时继续使用原来的真实 ID。启用多个 API 后，旧版未绑定来源的选择需要重新搜索；修改或删除地址、Token 后，失效的历史选择也会要求重新选择，不猜测新的来源。

缓存保持有界，较大的合法轨道跳过缓存。整轨上限为 50 万条、6400 万字符 JSON；跨 API 聚合超过容量时保留一条完整健康来源，其余来源仍能独立选择。进度与分片沿用标准协议，不截断伪装完整轨道。

原生请求的硬性超时由播放器宿主提供。冷搜索延迟、播放器缓存、Forward 原版和 iOS 等环境仍需对应设备验收。功能边界见 [模块文档](./forward-module/danmu-fusion/README.md)，更新记录见 [CHANGELOG](./forward-module/danmu-fusion/CHANGELOG.md)。

## 开发

需要 Node.js 20 或更新版本。

```sh
git clone https://github.com/tzb360/danmu-fusion.git
cd danmu-fusion
git checkout v1.5.1
npm ci
npm run build:forward-fusion
node scripts/build-danmu-fusion.mjs --check
npm run test:all
```

`--check` 检查维护源码与单文件产物一致，不改写产物。

| 路径 | 内容 |
| --- | --- |
| `forward-module/danmu-fusion/danmu-fusion.js` | 可导入成品，含身份解析入口及生成区块 |
| `forward-module/danmu-fusion/adapter.js` | 标准协议、搜索、年份复核、详情和评论 |
| `forward-module/danmu-fusion/preferences.js` | 有界、按作品隔离的来源推荐记忆 |
| `forward-module/danmu-fusion/multi-api.js` | 多 API 管理、来源路由及安全聚合 |
| `forward-module/danmu-fusion/transport.js` | 保留引擎的 HTTP、缓存和分片逻辑 |
| `danmu_api/aggregation/forward-core.js` | 身份匹配和去重核心 |
| `danmu_api/utils/zh-util.js` | 上游中文简繁转换工具 |
| `scripts/build-danmu-fusion.mjs` | 独立构建及一致性检查 |
| `forward-module/danmu-fusion/*.test.mjs` | 模块测试，含 34 项多 API 和 18 项 1.5.1 回归 |
| `forward-module/danmu-fusion/fixtures/` | 基准实验使用的 1.4.5 / 1.5.0 公开构建 |

1.5.1 对照 1.5.0 的可重复性能实验：`npm run benchmark:forward`，含耗时、请求次数及资源采样；结果和局限见 [测试报告](./forward-module/danmu-fusion/TEST_REPORT_1.5.1.md)。

可单独执行 `npm run test:forward-native`、`npm run test:forward-multi`。性能比较脚本为 `node forward-module/danmu-fusion/benchmark-multi.mjs`，使用 Mock 延迟，不代表公网或设备性能。

真实接口测试使用 `DANMU_API_URL`、`DANMU_API_URL_2`、`DANMU_API_URL_3` 环境变量，再运行 `npm run test:forward-multi-live`。不要将实际地址、Token、Cookie 或个人播放记录提交到仓库。第三方参考模块不随项目分发，可通过 `DANMU_REFERENCE_REX`、`DANMU_REFERENCE_MAKKA`、`DANMU_REFERENCE_UNIVERSAL` 指定本地文件作可选对照。

验证范围与复现方式见 [1.5.1 测试说明](./forward-module/danmu-fusion/TEST_REPORT_1.5.1.md)。后端历史接口与自建部署见 [服务端参考](./README-upstream.md)、[DEPLOYMENT](./DEPLOYMENT.md) 和 [严格原生聚合配置](./forward-module/danmu-fusion/SERVER_NATIVE_MERGE.md)。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/tzb360/danmu-fusion/issues) 或 Pull Request 反馈问题与改进。请提供模块版本、播放器和系统版本、作品类型与季集、预期行为及脱敏诊断，不要附带私人接口或凭据。

修改维护源码后请重新构建并运行完整测试。来源匹配和聚合规则应包含错误年份、跨季、不同剪辑、接口失败及历史选择路由的回归。

### 贡献者

- [tzb360](https://github.com/tzb360)：项目维护与开发。
- Codex：AI 开发协作。

## 许可与致谢

作者：[tzb360](https://github.com/tzb360)。

项目以 **AGPL-3.0-only** 开源，许可全文见 [LICENSE](./LICENSE)。本仓库基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 增量开发，保留上游许可与署名。

由 [tzb360](https://github.com/tzb360) 维护。感谢 [danmu_api](https://github.com/huangxd-/danmu_api)、[ForwardWidgets](https://github.com/InchStudio/ForwardWidgets) 和 [弹弹play](https://www.dandanplay.com/) 的开源实现、协议与文档。

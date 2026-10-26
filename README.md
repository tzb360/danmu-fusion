# Danmu Fusion · 弹幕融合

[![Version](https://img.shields.io/badge/version-1.5.3-blue)](https://github.com/tzb360/danmu-fusion/releases/tag/v1.5.3)
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
- [1.5.3 固定版本直链](https://raw.githubusercontent.com/tzb360/danmu-fusion/v1.5.3/forward-module/danmu-fusion/danmu-fusion.js)
- [发布页与完整源码包](https://github.com/tzb360/danmu-fusion/releases/tag/v1.5.3)

安装后填写「弹幕 API 1（主要接口）」。需要时再填写 API 2、API 3；每框一个地址，可留空，不要用换行输入多个地址。

```text
https://example.com/your-token
https://example.com/proxy/your-token/api/v2/
https://example.com/proxy/api/v2?token=your%2Fencoded%2Btoken
```

模块 ID 保持 `tzb360.danmu.fusion`。API 1 沿用 `danmu_api_url`，API 2/3 分别使用 `danmu_api_url_2`、`danmu_api_url_3`。从旧版升级时原 API 1 配置继续有效。

## 1.5.3 更新

- **只展示聚合选项**：新搜索结果不再列出每个平台的独立选源项，聚合项优先显示当前平台组合，例如「腾讯&爱奇艺&优酷」。
- **每一集重新确定平台**：当前集有哪些可验证资源，就使用这些资源。上一集的平台下一集缺失时，继续聚合其余有效平台；不把主平台或固定平台名单当作必备条件。
- **电影同样动态发现**：平台来自服务器当前启用的来源及实际资源，没有固定为示例中的三个平台。已知当前季集时，会预先加载并核对实际返回的平台标签，避免把失败来源算作已成功参与。
- **严格按集号匹配**：自建服务端的严格保护层改用明确集号的并集，补齐原主平台缺集时的其他有效来源，不按数组位置、相似名称或上一集平台名单推断。
- **清理失效文件**：删除本仓库不会运行的两个旧工作流，修正 EdgeOne 路由文件名和请求转发，移除该适配器的私人请求日志。

[完整更新公告](./forward-module/danmu-fusion/RELEASE_NOTES_1.5.3.md) · [文件核查记录](./REPOSITORY_AUDIT_1.5.3.md) · [更新记录](./forward-module/danmu-fusion/CHANGELOG.md)

## 怎么选择聚合弹幕

1. 更新同 ID 模块，重新搜索当前作品，选择「【聚合】平台A&平台B&…」及对应集数或电影正片。
2. 平台组合按当前集显示，不代表整季每集都具备相同平台。只剩一个可用平台时，聚合流程会明确注明「本集仅1个平台」，不另列一串单平台选项。
3. 若播放器保留旧列表，可重新进入播放会话；macOS Rex 本次使用其「空间占用 → 数据请求缓存」入口刷新请求缓存后确认仅有聚合项。其他播放器的操作以实际支持的入口为准。

**一个 API 也可以聚合多个平台。** 模块使用服务器的真实资源及 `withRelated=true`；跨 API 仍必须证明同作品、同季集、同片长、同视频版本，证据不足时不强行拼接，也不再提供单平台选择列表。

已知当前集时，预核对会增加首次搜索的等待；新建跨 API 聚合会等待成员请求实际完成或由宿主报错后再合并，不用抢先返回的一条轨道冒充完整结果。宿主没有原生超时能力时，模块不能自行伪造超时。当前集平台摘要最多 32 条、3 分钟、48000 字符，不保存整轨；超大轨道仍不缓存，预核对后播放可能再次下载。

## 已有功能

- **记住常用来源**：为某部剧选好来源并成功加载后，同作品后续集数优先推荐该 API；电影同样支持。换季、年份、版本、身份或接口凭据变化后重新验证。
- **看懂加载问题**：地址错误、认证失败、接口不存在、服务器故障、网络与超时等分别给出简体中文诊断，反馈时无需附带私人地址或 Token。
- **有证据才切换备用**：当前来源不可用时，只尝试已验证同作品、同集、同片长和同视频版本的备用来源，并保留原始错误；缺少证据时说明无法安全切换。
- **减少加载与拖动开销**：合并重复加载和解析，为可缓存轨道建立分钟索引；超大轨道跳过缓存，完整条数、原始内容和时间轴保持不变。

兼容功能继续保留：

- **多 API 接入**：最多三个接口独立规范化、去重和并发搜索，当前界面只提供聚合结果；旧版已保存的真实 ID 及绑定路由继续兼容。
- **聚合前验证**：优先等待可用的原生聚合候选；较快的单平台结果不抢占聚合入口。播放器自身缓存仍可能保留旧名称。
- **可靠来源绑定**：选择 ID 绑定来源指纹与真实协议 ID，防止不同接口的相同编号串线；支持来源重排、新运行时和仅传 commentId 的播放请求。
- **保守匹配**：核对电影或剧集的片名、年份、类型和季集，保留标准 match 年份辅助复核及失败回退。
- **有依据的安全聚合**：只有同版本、同季集、相同明确片长及相同内容指纹或官方视频资源证据时，才提供跨 API 聚合选项。
- **保留原生效果**：继续使用服务端 `withRelated=true` 聚合，保留时间、颜色、滚动、顶部和底部样式，不重复施加偏移。
- **单文件导入**：完整 JS 可独立运行，运行时无需其他源码文件、Node.js 或浏览器计时器。

服务端原生聚合与跨 API 聚合分别验证。普通接口没有可验证聚合资源时，会返回中文说明；不会把单平台选源列表重新包装成已完成的多平台聚合。只有真实取得的评论来源才计为成功来源。

## 更新与兼容

通过相同 Raw 地址更新同 ID 模块即可，原有 API 1～3 地址继续使用，无需重新填写。升级到 1.5.3 后重新搜索并选择带「【聚合】」的资源。主分支直链提供当前正式构建；需要固定版本时使用带版本标签的直链，或从 Release 下载独立 JS。

仅配置 API 1 时继续使用原来的真实 ID。启用多个 API 后，旧版未绑定来源的选择需要重新搜索；修改或删除地址、Token 后，失效的历史选择也会要求重新选择，不猜测新的来源。

缓存保持有界，较大的合法轨道跳过缓存。整轨上限为 50 万条、6400 万字符 JSON；跨 API 聚合超过容量时保留一条完整健康来源，并说明容量降级。进度与分片沿用标准协议，不截断伪装完整轨道。

原生请求的硬性超时由播放器宿主提供。冷搜索延迟、播放器缓存、Forward 原版和 iOS 等环境仍需对应设备验收。功能边界见 [模块文档](./forward-module/danmu-fusion/README.md)，更新记录见 [CHANGELOG](./forward-module/danmu-fusion/CHANGELOG.md)。

## 1.5.3 验证情况

2026-10-26 完整自动回归 **268/268**，另两份身份脚本通过。覆盖按集增减平台、原主平台缺集、任意新平台代码、电影正片、失败来源排除、摘要失效及缓存边界；既有协议、路由和匹配回归仍保留。

- **macOS Rex 1.0.2**：已安装 1.5.3，在第8集的实际弹幕界面确认只显示聚合项及平台组合。
- **API1 / AWS**：已获授权备份并更新严格聚合保护层，重启后真实接口搜索、加载和进度窗口验证通过。真实上游缺失主平台的案例未穷举；该情形通过确定性测试验证。
- **原版 Forward、iOS/iPhone/iPad 真机**：本次未验证。macOS 测试不代表手机验收。
- **真实跨 API 时间轴合并与故障切换**：本次未实机验收；确定性正反例回归通过。

详细结果、资源开销和未验证范围见 [1.5.3 测试报告](./forward-module/danmu-fusion/TEST_REPORT_1.5.3.md)。

## 开发

需要 Node.js 20 或更新版本。

```sh
git clone https://github.com/tzb360/danmu-fusion.git
cd danmu-fusion
git checkout v1.5.3
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
| `forward-module/danmu-fusion/aggregate-ui.js` | 聚合专用界面、当前集平台核对及有界摘要 |
| `forward-module/danmu-fusion/transport.js` | 保留引擎的 HTTP、缓存和分片逻辑 |
| `danmu_api/aggregation/forward-core.js` | 身份匹配和去重核心 |
| `danmu_api/utils/zh-util.js` | 上游中文简繁转换工具 |
| `scripts/build-danmu-fusion.mjs` | 独立构建及一致性检查 |
| `forward-module/danmu-fusion/*.test.mjs` | 模块测试，含兼容协议回归及 16 项当前公开聚合入口回归 |
| `forward-module/danmu-fusion/fixtures/` | 基准实验使用的 1.4.5 / 1.5.0 公开构建 |

当前构建对照 1.5.0 的可重复性能实验：`npm run benchmark:forward`，含耗时、请求次数及资源采样；1.5.3 结果和局限见 [测试报告](./forward-module/danmu-fusion/TEST_REPORT_1.5.3.md) 与 [原始基准数据](./forward-module/danmu-fusion/benchmarks/1.5.3-vs-1.5.0.json)。基准使用固定 Mock 数据和 Node/Widget VM，不是 iPhone 性能数据。

当前聚合流程的预核对、播放和进度跳转成本可执行 `npm run benchmark:aggregate`；它也使用 Mock 数据，超大轨道的额外预核对请求会单独计入。

可单独执行 `npm run test:forward-native`、`npm run test:forward-multi`。性能比较脚本为 `node forward-module/danmu-fusion/benchmark-multi.mjs`，使用 Mock 延迟，不代表公网或设备性能。

真实接口测试使用 `DANMU_API_URL`、`DANMU_API_URL_2`、`DANMU_API_URL_3` 环境变量，再运行 `npm run test:forward-multi-live`。不要将实际地址、Token、Cookie 或个人播放记录提交到仓库。第三方参考模块不随项目分发，可通过 `DANMU_REFERENCE_REX`、`DANMU_REFERENCE_MAKKA`、`DANMU_REFERENCE_UNIVERSAL` 指定本地文件作可选对照。

真实原生聚合复现可使用 `DANMU_API_URL` 环境变量运行 `npm run test:forward-native-merge`；样本及限制见 [1.5.3 测试说明](./forward-module/danmu-fusion/TEST_REPORT_1.5.3.md)，历史版本见 [1.5.1 测试报告](./forward-module/danmu-fusion/TEST_REPORT_1.5.1.md)。后端历史接口与自建部署见 [服务端参考](./README-upstream.md)、[DEPLOYMENT](./DEPLOYMENT.md) 和 [严格原生聚合配置](./forward-module/danmu-fusion/SERVER_NATIVE_MERGE.md)。

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

# Danmu Fusion · 弹幕融合

[![Version](https://img.shields.io/badge/version-1.4.5-blue)](https://github.com/tzb360/danmu-fusion/releases/tag/v1.4.5)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](./LICENSE)

为 Forward 兼容播放器提供的开源弹幕模块。填写一个弹幕 API 地址，即可搜索作品、选择真实分集并加载弹幕；兼容支持弹弹 Play 协议的服务，优先使用服务端原生多源聚合。

**Danmu Fusion 是播放器弹幕接入模块，不是 danmu_api 服务端。** 模块需要连接另行部署的兼容 API。仓库公开可导入成品、维护源码、构建脚本和测试，并保留历史上基于 [danmu_api](https://github.com/huangxd-/danmu_api) 的后端源码与许可。

## 安装

复制下面的 Raw 直链，在 Rex / Forward 的 Widget / 模块管理中选择通过 URL 导入，粘贴后确认：

```text
https://raw.githubusercontent.com/tzb360/danmu-fusion/main/forward-module/danmu-fusion/danmu-fusion.js
```

也可以使用以下安装文件：

| 文件 | 1.4.5 固定版本 |
| --- | --- |
| 安装索引 | [widget.fwd](https://raw.githubusercontent.com/tzb360/danmu-fusion/v1.4.5/forward-module/danmu-fusion/widget.fwd) |
| 完整模块 | [danmu-fusion.js](https://raw.githubusercontent.com/tzb360/danmu-fusion/v1.4.5/forward-module/danmu-fusion/danmu-fusion.js) |
| 下载与源码 | [GitHub Release](https://github.com/tzb360/danmu-fusion/releases/tag/v1.4.5) |

1. 导入模块。
2. 在模块设置中填写「弹幕 API 地址」。
3. 保存后搜索作品，选择对应资源和分集。

模块不附带公共 API、账号或密钥。请使用自建或已获授权的兼容服务。

```text
https://example.com
https://example.com/your-token
https://example.com/api/v2
https://example.com/your-token/api/v2/
```

以上地址会自动规范化，保留 Token 和反向代理路径。旧版 `…/api/forward/danmaku` 地址也支持迁移。

模块 ID 为 `tzb360.danmu.fusion`，升级保留原 `danmu_api_url` 配置。**1.4.5 仅支持一个 API 地址，不支持换行填写多个地址。** 同一 API 内的多平台聚合由服务端完成。

## 功能

- **标准接口兼容**：搜索、详情和评论使用真实资源 ID；缺少扩展接口时保留基本播放流程。
- **电影与剧集分开匹配**：核对片名、年份、类型和季集，排除明确冲突及解说、预告等衍生资源。
- **年份辅助复核**：同名不同年份的候选可通过标准 `POST /api/v2/match` 辅助消歧；接口不可用时退回搜索结果。
- **服务端原生聚合**：接收服务端已合并的弹幕，不把候选来源数当作实际取得的来源数。
- **保留弹幕样式与时间**：保留颜色、滚动、顶部、底部及原始时间轴，不重复应用服务端偏移。
- **进度与缓存**：支持官方 GET 分片；标准整集响应支持续播和进度筛选，采用有界短期缓存。
- **独立导入文件**：运行时使用 Widget HTTP / Storage，无需 Node.js、浏览器计时器或额外依赖。

## 更新模块

通过相同 Raw 地址重新导入，或使用播放器提供的模块更新功能。模块 ID 保持不变，原 API 地址无需重填。主分支链接会随正式版本更新，使用前可查看 [更新记录](./forward-module/danmu-fusion/CHANGELOG.md)。

## 1.4.5 更新

新增基于文件名的年份辅助匹配，复核实际片名、年份、类型和资源 ID；后续季缺少可靠年份时跳过额外请求。修复数字电影名的年份识别边界，例如《2001太空漫游》(1968)。完整记录见 [CHANGELOG](./forward-module/danmu-fusion/CHANGELOG.md)。

## 使用说明

多源效果取决于服务端启用的来源、上游可用性和匹配结果。使用普通单来源服务时，模块仍按标准流程工作。不同剪辑版本需要可靠的时间轴依据，模块不进行盲目自动校准。

标准评论首次返回完整轨道；仅在服务返回官方 `barrage_list` 时加载对应 GET 分片。去重只移除 `cid`、`p`、`m` 完全相同的重放记录，保留独立观众的相同发言。

部分冷搜索可能超出播放器的等待时限；原版 Forward、iOS 和所有平台的设备兼容性尚未逐项验收。可复现检查和验证范围见 [兼容性说明](./DANMU_FUSION_COMPATIBILITY_AUDIT.md)。

更多协议、缓存和地址迁移说明见 [模块文档](./forward-module/danmu-fusion/README.md)。自建服务端的严格来源匹配见 [原生聚合配置](./forward-module/danmu-fusion/SERVER_NATIVE_MERGE.md)，后端接口与部署参考见 [服务端文档](./README-upstream.md) 和 [DEPLOYMENT](./DEPLOYMENT.md)。

## 开发

需要 Node.js 20 或更新版本。

```sh
git clone https://github.com/tzb360/danmu-fusion.git
cd danmu-fusion
git checkout v1.4.5
npm ci
npm run build:forward-fusion
node scripts/build-danmu-fusion.mjs --check
npm run test:all
```

`--check` 验证维护源码与可导入文件一致，不改写产物。旧的 `build-forward-widget` 用于另一套后端打包入口，不是本模块的构建命令。

| 路径 | 内容 |
| --- | --- |
| `forward-module/danmu-fusion/danmu-fusion.js` | 可直接导入的完整模块，含身份解析入口及生成区块 |
| `forward-module/danmu-fusion/adapter.js` | 公开协议适配、搜索、年份复核、详情和评论 |
| `forward-module/danmu-fusion/transport.js` | 保留引擎的 HTTP、缓存和分片逻辑 |
| `danmu_api/aggregation/forward-core.js` | 身份匹配和去重核心 |
| `danmu_api/utils/zh-util.js` | 上游中文简繁转换工具 |
| `scripts/build-danmu-fusion.mjs` | 独立模块构建与一致性检查 |
| `forward-module/danmu-fusion/*.test.mjs` | 模块自动化测试 |
| `danmu_api/` | 服务端源码及测试 |

可选真实 API 检查使用 `DANMU_API_URL` 环境变量，测试脚本不会输出该地址：

```sh
npm run test:forward-live
npm run test:forward-match-live
npm run test:forward-native-merge
```

请勿将实际 Token、Cookie、配置文件或个人播放记录提交到仓库。第三方参考模块不随项目分发；可通过 `DANMU_REFERENCE_REX`、`DANMU_REFERENCE_MAKKA`、`DANMU_REFERENCE_UNIVERSAL` 指定本地文件进行可选对照。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/tzb360/danmu-fusion/issues) 提交问题，或通过 Pull Request 改进实现。报告问题时请提供模块版本、播放器及系统版本、作品类型与季集、预期行为和脱敏后的诊断代码。不要附带私人 API 地址或凭据。

修改适配层或核心后请重新构建，并运行完整测试。新增来源匹配规则应包含同名翻拍、跨季、特别篇及失败回退的测试。

## 许可与致谢

项目以 **AGPL-3.0-only** 开源，许可全文见 [LICENSE](./LICENSE)。本仓库基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 开发，保留上游许可与署名；不以 MIT 重新许可上游代码。

Danmu Fusion 由 [tzb360](https://github.com/tzb360) 维护。感谢 [danmu_api](https://github.com/huangxd-/danmu_api)、[ForwardWidgets](https://github.com/InchStudio/ForwardWidgets) 和 [弹弹play](https://www.dandanplay.com/) 的开源实现、协议与文档。第三方名称不表示官方合作或背书。

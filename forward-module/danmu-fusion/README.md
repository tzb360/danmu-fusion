# Danmu Fusion · 弹幕融合 1.5.0

支持同时配置 **1～3 个弹弹 Play 兼容 API** 的 Forward/Rex 弹幕模块。保留 1.4.5 已验证的搜索筛选、年份辅助匹配、标准选集、原生 withRelated 聚合、样式及进度分片流程。

## 安装与升级

1. 导入 [danmu-fusion.js](./danmu-fusion.js)，或使用 [widget.fwd](./widget.fwd) 安装索引。
2. 「弹幕 API 1（主要接口）」沿用 `danmu_api_url`，原地址自动保留。
3. 需要时再填写「弹幕 API 2（可选）」和「弹幕 API 3（可选）」，不需要全部填写。

模块 ID 仍是 `tzb360.danmu.fusion`。界面只有三个地址输入框，没有模式、来源规则、超时或去重等技术设置。Node 部署的安装入口仍为 `https://你的服务器/widgets/danmu-fusion/widget.fwd`。

```text
https://example.com/your-token
https://example.com/proxy/your-token/api/v2/
https://example.com/proxy/api/v2?token=your%2Fencoded%2Btoken
```

每框填写一个地址。空项忽略，错误项单独诊断，不阻断其余地址。规范化末尾 `/api/v2`、旧 `/api/forward/danmaku`、主机大小写及默认端口后，重复地址只请求一次。Token、代理路径大小写、百分号编码和认证查询内容原样保留；旧 Forward 地址仅去掉已知媒体查询参数。不要用换行把多个地址塞进同一框。

## 搜索与选择

每个有效 API 独立执行 1.4.5 的 search/anime → 必要时 search/episodes，并保留片名、影视类型、年份、季数和特别篇/衍生内容筛选；同名跨年份时仍通过标准 match 辅助复核。优先展示服务端原生多来源资源。

多 API 并发搜索，**首个有效结果就可以返回**；其他已完成的合格结果一并返回，不等待慢接口。后完成的成功数据进入有界短缓存，宿主保留运行时的情况下，下次搜索可加入这些结果。首次列表不保证包含仍在冷搜索的 API；某些播放器会额外缓存列表，可能需要重新进入播放会话或重新搜索。全部失败则返回空列表和分阶段诊断。

单独来源标有 `API 1/2/3`。同名、同年、同类型、同季且无身份冲突时，另提供「跨 API 选源」入口；它只是统一选集入口，**不代表时间轴已经通过合并验证**。

## 安全聚合

每条独立来源始终保留。「跨 API 选源」取得真实详情后，只有满足以下条件的分集才增加「安全聚合」选项：

- 影视身份一致，有明确年份、类型及季数；存在 TMDB、剪辑版或语言冲突时拒绝。
- 电视剧必须由原始标题证明同一集，不用数组下标或服务器推算的 episodeNumber 猜集数；排除特别篇、预告、花絮和上下集。
- 电影须为正片/全片或同片名资源，不能把分段电影混成正片。
- 各分集明确提供相同的秒数片长，且有同一内容 Hash，或相同的官方视频资源 URL；泛化页面、目录链接和无命名空间的 timelineId 不算证据。

只同名、只有相同 animeId/commentId、缺少片长或时间轴证据时，继续单独选源。普通标准 API 不提供这些证据时仍可搜索、选集和播放，只是不自动跨 API 混合。每个 API 的请求仍优先采用 `withRelated=true`，客户端不重写已有服务端聚合。

## 来源绑定与历史选择

仅配置 API 1 时继续使用真实 animeId 和 commentId，保留 1.4.5 使用体验。多 API 使用带来源指纹的轻量选择 ID，内部发送的仍是各自真实协议 ID；相同 ID 不会跨 API 串线。

来源指纹是规范化完整地址的 SHA-256，ID、诊断与新缓存键不包含 API 地址或完整 Token。选择 ID 自带路由信息，换一个 Widget 运行时、存储不可用或只传 commentId，也能路由到正确 API；来源顺序变化不改变指纹。

修改/删除来源地址或 Token 后，其旧选择会明确要求重新搜索，不按新槽位猜测路由。1.4.5 的无来源裸 ID 在多 API 模式下也要求重新选择；仅 API 1 模式允许原选择，并用轻量历史指纹检测已经观察到的地址变化。首次升级且没有历史记录时，无法证明裸 ID 原来属于哪台服务器，按原 API 1 契约兼容。清空宿主存储也会丢失这种裸 ID 历史保护。

## 去重、容量和等待

单 API 完全沿用 cid、完整 p、m 相同才去重的原则。跨 API 仅在已经证明能安全聚合之后，再用明确的上游来源和原始记录 ID，连同完整 p、m 做精确重放去重；没有可信来源标识的相同数字 cid、相同短句仍保留。不做模糊文本去重，不改时间、颜色、位置或文字。

聚合记录的 cid 按 API 指纹隔离，首次部分响应和后续进度响应保持一致。合并后只按原时间排序，不做时间轴校准。片长/视频版本显式变化时取消该成员自动合并。

缓存仍为最多 4 条、合计约 2 MiB、3 分钟；大轨道、错误、空数据和下载任务不缓存。整轨上限仍为 50 万条、6400 万字符 JSON；跨 API 合并超过边界时返回一条完整健康来源，其他来源仍可独立选择，不截断伪装完整。超大慢来源可能来不及加入首个部分响应，请直接选择它以取得完整轨道。

每个 API 最多两个并行冷查询，以兼容 Rex 的剧名搜索和保存关键词重试；公开 HTTP 边界最多 12 个不同在途请求，相同请求合并，不建立无限排队或轮询。没有 setTimeout、fetch、URL、AbortController 或 Node 运行依赖。单个慢 API 不拖住已有有效结果；**所有原生请求都不结束时，硬性中断仍取决于宿主的原生超时/取消能力**，模块不会伪造一个宿主不支持的超时参数。单 API 冷搜索本身的 35～66 秒延迟也无法由客户端消除。

标准整集首次返回完整轨道；进度入口筛选 60 秒窗口。仅服务端实际提供 barrage_list 时使用原有 GET 分片，保留标准降级。日志只输出固定阶段、错误码和数量，不记录请求地址、认证头、响应正文或原始异常。

## 开发和验收

```sh
npm run build:forward-fusion
node scripts/build-danmu-fusion.mjs --check
npm run test:all
npm run test:forward-native
npm run test:forward-multi
```

真实远程验证使用已有测试地址：

```sh
DANMU_API_URL=… npm run test:forward-live
DANMU_API_URL=… DANMU_API_URL_2=… DANMU_API_URL_3=… npm run test:forward-multi-live
```

`adapter.js` 保留稳定协议流程；`multi-api.js` 只增加外层来源管理和保守聚合；`transport.js` 中的旧客户端引擎继续保留，不接入公开播放入口。构建产物无运行时依赖。

[1.5.0 多 API 测试报告](./MULTI_API_TEST_REPORT_1.5.0.md) 区分确定性 Mock、真实 HTTP 和实际 Rex 播放器的覆盖范围及限制；[1.4.5 兼容性审计](../../DANMU_FUSION_COMPATIBILITY_AUDIT.md) 和 [服务端原生聚合说明](./SERVER_NATIVE_MERGE.md) 保留为基线证据。

## 署名和许可

基于当前 Danmu Fusion 及 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 增量开发，保留作者 `tzb360` 及 [AGPL-3.0 LICENSE](../../LICENSE)。兼容 [弹弹play](https://www.dandanplay.com/) 开放弹幕网络，Forward 接口遵循 [ForwardWidgets](https://github.com/InchStudio/ForwardWidgets) 文档。

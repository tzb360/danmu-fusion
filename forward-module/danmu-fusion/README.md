# Danmu Fusion 1.4.5

Forward / Rex 兼容播放器的弹幕接入模块。通过一个弹弹 Play 兼容 API，完成标准搜索、真实资源选集和弹幕加载，优先接收服务端已聚合的弹幕。

## 在线安装

在播放器模块管理中选择通过 URL 导入，粘贴：

```text
https://raw.githubusercontent.com/tzb360/danmu-fusion/main/forward-module/danmu-fusion/danmu-fusion.js
```

安装索引：[widget.fwd](https://raw.githubusercontent.com/tzb360/danmu-fusion/main/forward-module/danmu-fusion/widget.fwd)。保存一个「弹幕 API 地址」即可使用。模块不提供公共 API、账号或密钥。

模块 ID 为 `tzb360.danmu.fusion`，旧地址继续使用 `danmu_api_url` 保存；升级无需重填。1.4.5 仅支持一个 API 地址，不能换行填写多个接口。

## 标准接口

- 搜索使用 `search/anime`，空结果或接口不支持时回退到 `search/episodes`。
- 详情使用真实 `animeId`，必要时仅尝试资源明确返回的 `bangumiId`。
- 评论使用真实 `commentId`，保留 `response.data` 的 `comments/count` 模型，支持 `async=1`、`withRelated=true`、`chConvert=1` 及查询参数被拒绝后的降级。
- 同名不同年份时，可使用标准 `POST /api/v2/match` 的 `fileNameOnly` 模式复核。没有独立 `year` 请求字段，不伪造文件 Hash，也不直接信任 `isMatched`。后续季缺少可靠日期时跳过复核。
- 仅在服务返回官方 `barrage_list` 时使用 GET 分片。

标准评论入口仅凭地址和已选中的 `commentId` 即可工作，不要求再次提供完整播放上下文。扩展接口不可用时保留标准播放流程。

## 时间、样式与缓存

保留原始时间、颜色、滚动、顶部、底部和 cid。仅删除 cid、完整 p、m 均相同的重放记录，不对未知来源作模糊去重，不重复应用服务端偏移。服务端原生聚合不触发客户端重复抓取。

标准整集响应首次完整返回，进度入口可筛选 60 秒窗口。轻量缓存最多 4 条，合计约 2 MiB，有效期 3 分钟；大响应跳过缓存，空数据、下载任务和异常不缓存。播放器外层缓存设为 0。合法整集上限为 50 万条、6400 万字符 JSON，超过上限时返回诊断而非抽样。

默认记录固定阶段与安全错误代码，不输出地址、Token、认证头、正文或原始异常。运行时只使用 Widget HTTP / Storage，不依赖浏览器计时器、fetch、URL、Buffer 或 Node API。

## 开发与许可

源码结构、构建命令、测试、反馈方式及许可见 [项目首页](../../README.md)。公开入口为 `adapter.js`；`transport.js` 保留旧实验引擎，未接入公开自动聚合入口。构建将维护源码嵌入单文件，导入时无需其他文件。

[CHANGELOG](./CHANGELOG.md) · [兼容性说明](../../DANMU_FUSION_COMPATIBILITY_AUDIT.md) · [服务端原生聚合](./SERVER_NATIVE_MERGE.md)

本项目遵循 [AGPL-3.0-only](../../LICENSE)，基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 开发，维护者为 [tzb360](https://github.com/tzb360)。

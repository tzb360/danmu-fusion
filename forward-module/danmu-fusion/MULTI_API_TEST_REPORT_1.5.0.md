# Danmu Fusion 1.5.0 测试说明

## 复现

```sh
npm ci
node scripts/build-danmu-fusion.mjs --check
npm run test:all
npm run test:forward-multi
node forward-module/danmu-fusion/benchmark-multi.mjs
```

完整回归包含 67 项服务端、151 项 Forward / 核心测试，合计 218 项，以及两份身份检查脚本。多 API 新增 34 项测试，包含于完整回归。

公开路径通过 WidgetMetadata 注册函数执行；Widget VM 不提供浏览器计时器、fetch、URL、AbortController、Buffer 或 process，Storage 仅接受字符串。网络测试宿主可使用这些功能，不注入模块运行时。

## 覆盖范围

- 单 API、双 API、三 API，空白、非法、重复及不同认证编码地址。
- 来源指纹与真实 ID 路由，跨运行时及仅 commentId 加载，来源重排与配置变化后的明确失效。
- 片名、影视类型、年份、季集、特别篇及衍生内容过滤；标准 match 请求和失败回退。
- 500/401/403、空结果、无效 JSON、原生超时、全部不可用、单个不结束及晚到结果。
- 同一作品的独立来源；同季集、同片长、同视频指纹的安全聚合，不同剪辑、语言或证据不足时拒绝聚合。
- 原生 withRelated 聚合、保守精确去重、颜色及位置、原始时间轴和稳定 cid。
- 字符串存储索引的并发保护、缓存容量、20 万条以上轨道及聚合容量回退。
- 构建一致性、单文件元数据、入口注册与两个安装索引。

基准脚本使用同一 VM 和固定 Mock 网络延迟，对照随源码公开的 1.4.5 构建。它验证调度和来源绑定开销，不是公网延迟或手机性能承诺。

## 真实接口与设备边界

此前 1.5.0 的真实 HTTP 复测覆盖三个已配置地址的搜索、选集和仅 commentId 加载；实际 Rex 验证覆盖 API 3 的来源绑定、评论及进度请求。三个接口缺少足够跨服务器时间轴证据时保留独立来源，没有强行合并。

这些历史验证不等于本次发布重新执行了所有线上样本。原版 Forward、iOS、三个独立后端同时冷启动、真实电影跨 API 时间轴聚合、长时间连续播放及超大聚合轨道仍需对应环境验收。Raw URL 的下载核对与播放器实际在线导入应分别记录。

## 公开内容

维护源码、构建脚本、测试和 1.4.5 基准构建均随仓库公开。生产配置、API 凭据、私人日志和播放截图不随发布上传。模块 ID 保持 tzb360.danmu.fusion，原 danmu_api_url 继续作为 API 1。

本项目保留 AGPL-3.0-only 许可及上游署名。

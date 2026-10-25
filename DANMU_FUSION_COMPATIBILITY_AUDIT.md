[Current 1.5.0 validation](./forward-module/danmu-fusion/MULTI_API_TEST_REPORT_1.5.0.md)

# Danmu Fusion 1.4.5 兼容性与验证

## 可复现检查

```sh
npm ci
node scripts/build-danmu-fusion.mjs --check
npm run test:all
```

测试覆盖 67 项服务端回归、117 项 Forward / 核心回归，以及两份身份检查脚本。公开适配层测试在不提供浏览器计时器、fetch、URL 或 Node API 的 Widget VM 中执行，Storage 仅接收字符串。第三方参考模块为可选输入，不随本仓库分发，不影响基本测试执行。

## 覆盖范围

- 标准搜索、真实资源 ID、详情、评论与错误回退。
- 电影与电视剧身份、年份、季集、翻拍及衍生资源过滤。
- 年份辅助 match 的正确请求、错误年份 / 类型 / ID 拒绝、接口不支持和网络异常回退。
- 单一 API 地址、旧参数兼容、Token / 代理路径规范化。
- 字符串存储、缓存隔离、并发请求、稳定 cid、进度筛选和官方 GET 分片。
- 颜色及顶部 / 底部样式、原始时间轴、22 万条合法评论响应与 20 万条核心去重性能用例。
- 独立模块元数据、函数注册、安装索引和可重复构建。

## 真实接口与设备范围

历史真实 API 复测验证过 1.4.5 的两例年份辅助匹配；macOS Rex 的完整播放及进度跳转证据来自 1.4.4，1.4.5 的设备记录仅覆盖安装升级，不能代替新增年份分支的设备播放验收。原版 Forward、iOS、所有来源平台、长时间连续播放及剪辑版本逐帧同步尚未逐项验证。

Raw URL 在线发布结果由发布流程单独核对。自动化测试或本地文件安装成功，不等于已通过 Raw URL 在线导入。

## 已知边界

1. 1.4.5 只支持一个 API 地址，不支持跨多个 API 聚合。
2. 聚合能力由服务端决定，服务端候选不代表来源实际取得弹幕。
3. 冷搜索可能超过播放器等待时限，宿主行为需单独验证。
4. 后续季缺少可靠日期时不发送年份辅助请求。
5. 普通兼容 API 没有扩展接口时保留标准流程。

## 来源与署名

依据 [ForwardWidgets](https://github.com/InchStudio/ForwardWidgets) 的 Widget 协议、[弹弹play开放接口](https://doc.dandanplay.com/open/) 和 [danmu_api](https://github.com/huangxd-/danmu_api) 的实现进行兼容。模块包含上游中文转换工具，完整源码和 AGPL-3.0 许可随仓库公开。第三方参考模块的代码不打包分发。

# Forward 弹幕模块

[Danmu Fusion · 弹幕融合 1.5.2](./danmu-fusion/README.md) 支持 1～3 个弹幕 API，提供独立选源、保守匹配与有充分时间轴证据的安全聚合。

导入 [完整 JS 模块](./danmu-fusion/danmu-fusion.js) 或 [安装索引](./danmu-fusion/widget.fwd)。保留模块 ID 与旧地址参数，自动处理可靠来源聚合、去重、缓存和分片，正常颜色及弹幕位置不强制转换。

可使用自建或已获授权的弹弹 Play 兼容 API。年份有歧义时使用标准 match 辅助复核，扩展接口缺失时保留基本流程。安装 Raw 直链、开发命令及反馈方式见 [项目首页](../README.md)，验证范围见 [1.5.2 聚合验证](./danmu-fusion/TEST_REPORT_1.5.2.md)。

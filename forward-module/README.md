# Forward 弹幕模块

[Danmu Fusion · 弹幕融合 1.4.5](./danmu-fusion/README.md) 仅需填写一个弹幕 API 地址，优先保证标准搜索、选集与弹幕播放兼容。

导入 [完整 JS 模块](./danmu-fusion/danmu-fusion.js) 或 [安装索引](./danmu-fusion/widget.fwd)。保留模块 ID 与旧地址参数，自动处理可靠来源聚合、去重、缓存和分片，正常颜色及弹幕位置不强制转换。

服务端可使用本项目或其他弹弹 Play 兼容 API；无需设置 API 模式。年份有歧义时可用标准 match 辅助复核；接口缺少 match 或分片扩展时仍保留基本功能。当前联调与实际播放器状态见 [兼容性审计](../DANMU_FUSION_COMPATIBILITY_AUDIT.md)。旧版配置重构记录作为历史资料保留。

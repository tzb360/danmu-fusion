# Forward 模块目录

本目录存放 **Danmu Fusion（弹幕融合）** Forward Widget，与 `ForwardWidgets-master` 解耦，独立创作。

| 子目录 | 模块 | 说明 |
|--------|------|------|
| [`danmu-fusion/`](./danmu-fusion/) | Danmu Fusion · 弹幕融合 | 需配套 [Danmu API](https://github.com/tzb360/danmu_api) |

## 项目依赖

Danmu Fusion **必须**配套使用 Danmu API：

https://github.com/tzb360/danmu_api

请先部署 API，再在 Forward 中导入 `danmu-fusion/danmu-fusion.js` 并配置 API 地址。

## 架构

```
Danmu Fusion  →  Forward API  →  Danmu API  →  多来源弹幕聚合
```

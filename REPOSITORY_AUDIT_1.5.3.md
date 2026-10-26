# 仓库文件核查与清理（1.5.3）

日期：2026-10-26。范围：Git 跟踪文件、包脚本、源码导入、工作流条件、部署路由、README 引用和测试/基准用途。

## 已确认并处理

| 文件 | 依据 | 处理 |
| --- | --- | --- |
| .github/workflows/docker-image.yml | 作业只允许 huangxd-/danmu_api，当前仓库为 tzb360/danmu-fusion，运行条件恒为假 | 删除失效工作流，保留 Dockerfile 和有效部署文件 |
| .github/workflows/sync_fork.yml | 作业仅允许 fork，GitHub 当前仓库 fork=false、无 parent | 删除无效定时同步工作流 |
| node-functions/[[...path]]..js | edgeone.json 引用 [[...path]].js，实际文件名多一个点，路由目标不存在 | 更正文件名，并增加路由存在性回归 |
| node-functions/index.js | 原适配器给 GET/HEAD 构造请求体、错误读取 Headers，并记录完整请求 URL/认证头 | 修复转发，移除敏感调试日志；GET/HEAD/POST 回归通过 |

## 核查后保留

- 历史报告与1.4.5/1.5.0构建：用于稳定基线、性能对照和兼容性审计。
- transport.js 保留引擎、forward/ 和 build-forward-widget.js：仍被测试或包脚本引用。
- README-upstream.md、LICENSE、上游源码与作者信息：用于来源、许可及自建服务参考，保留 AGPL-3.0-only。
- README.hf.md 与 sync_hf.yml：由显式仓库变量启用，是有效的可选部署流程。
- Cloudflare、Vercel、Netlify、EdgeOne、Docker 配置：有实际部署或文档用途。
- .env.example、测试夹具和验证脚本：有部署或复现用途；私人配置及运行日志继续排除在 Git 之外。

本次删除两个确认不会运行的工作流，并修复一个无效路由。没有按“当前没用到”批量删除有效源码、历史证据和部署能力。清理与聚合修改一起运行完整回归、构建一致性和文档链接检查。

## 静态引用复核

检查593处相对导入引用，两个表面缺失分别是测试需要先构建的dist产物，以及覆盖脚本生成给服务器使用的import模板，均有明确生成/执行位置。Markdown检查排除代码块中的正则示例后复核相对文件链接，未把这些内容误判为可删除文件。

# 全来源严格聚合：服务端配置与交付

以下可选配置供自建 danmu_api 服务使用，适用于官方 `logvar/danmu-api:1.21.7` 的严格匹配保护层。安装播放器模块不要求部署本仓库后端，也不会自动启用服务端聚合。

## 原生规则

在服务端 `.env` 中设置：

```dotenv
MERGE_SOURCE_PAIRS=tencent&iqiyi&youku&imgo&bilibili&migu&renren&hanjutv&sohu&leshi&xigua&maiduidui&aiyifan&hongguo&dandan&bahamut&animeko
```

这是当前 1.21.7 原生允许的来源集合；仅有已启用、实际搜索成功且可获取的来源参与，配置 17 个来源不代表 17 个都取得弹幕。继续使用原 `SOURCE_ORDER`；未替用户启用原本关闭或需要额外凭据的提供方。`360` 是多平台目录、`local` 为用户上传，均不在本次原生合并允许集合内，保留独立选择，不虚报它们已并入。

`MERGE_SOURCE_PAIRS`、`CUSTOM_MERGE_RULES`、`GROUP_MINUTE`、`SOURCE_ORDER`、`DANMU_OFFSET` 都是服务端设置，不是客户端查询参数。保留生产原 `GROUP_MINUTE=0`，避免一分钟相同内容全部压成一条；1.21.7 代码在多源时仍做同一精确时间点的合并，单来源不分组。`CUSTOM_MERGE_RULES`、`DANMU_OFFSET` 均为空。模块只消费已经合并的真实 episodeId，不再次抓取同一组，也不二次偏移。

## 必须同时安装严格保护层

原生合并器包含模糊匹配、跨季合集切片和集序推断，因此仅填写上述变量不等于达到本项目的严格标准。

本项目新增：

- `danmu_api/aggregation/strict-source-match.js`：简繁/NFKC/标点规范化后精确同名、同年份、同类型、同季；有 TMDB ID 时不得冲突；排除衍生内容、版本冲突和季合集。
- `scripts/prepare-native-merge-guard.mjs`：对官方 1.21.7 `merge-util.js` 生成受检查的小补丁。无自定义合并规则时，使用严格身份校验后的分集资源并集；有自定义规则时保留受保护的原路径。在选择副源、过滤分集、两个实际合并位置增加保护，禁用推断位置插入。
- 电视剧必须由原始分集标题证明同一集，不用数组位置或自动生成 episodeNumber 作为依据。电影必须先通过片名、年份和类型校验。特别篇、解说、纪录片、赏析、预告、花絮等不参与自动合并。

准备安装文件：

```sh
docker cp danmu-api:/app/danmu_api/utils/merge-util.js official-merge-util.js
node scripts/prepare-native-merge-guard.mjs official-merge-util.js strict-merge-util.js
node --test danmu_api/strict-source-match.test.js
```

将生成的文件和纯匹配助手作为只读文件挂载到容器：

```yaml
services:
  danmu-api:
    volumes:
      # 保留原有 config/cache 数据卷，只追加以下两项
      - /opt/danmu-api-overrides/strict-merge-20261025/merge-util.js:/app/danmu_api/utils/merge-util.js:ro
      - /opt/danmu-api-overrides/strict-merge-20261025/strict-source-match.js:/app/danmu_api/aggregation/strict-source-match.js:ro
```

先备份 `.env` 和 compose，再修改并重建容器。脚本检查固定函数签名和恰好两个实际合并点；上游变化时直接报错，禁止盲目套用。升级镜像前需重新生成并验证保护层。


## 1.5.3 按集资源并集

默认严格路径按每集明确标题重建平台集合。原主平台A只有第1集、B/C有第1～2集时，第2集使用B&C，不依赖A是否存在。新平台从当前 MERGE_SOURCE_PAIRS 及真实资源中发现，没有在模块中固定平台清单。电影接受正片/全片、同片名、「第1集 正片」，以及仅有一条资源时的纯分辨率标签；分段、预告及版本冲突拒绝合并。单来源分集保持原始资源URL，避免人为前缀破坏加载。

已有1.21.7严格保护层需要从原镜像文件重新运行准备脚本，同时更新 strict-source-match.js，备份后重启容器使两个只读挂载重新加载。不要在已打补丁的文件上重复套用。自定义合并规则非空时保留原受保护路径，该场景不宣称已采用新的按集并集流程。

本次API1服务器已获授权更新并验证；其他自建服务器不会随客户端更新自动部署。

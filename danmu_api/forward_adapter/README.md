# Forward 适配模块（自研）

## 可借鉴的 ForwardWidgets 规范（仅参考）

| 规范 | 说明 |
|------|------|
| WidgetMetadata | id / title / modules / globalParams |
| 弹幕模块三件套 | searchDanmu → getDetail → getComments |
| 参数约定 | tmdbId, title, season, episode, commentId, animeId |
| HTTP | Widget.http.get，返回 `{ data }` |
| 弹幕数据 | dandan 兼容 `{ count, comments:[{p,m}] }` |
| UA | ForwardWidgets/x.x.x |

## 本模块重新实现内容

- **不复制** ForwardWidgets 源码  
- 基于 danmu_API 的 `episode-service` + 清洗引擎  
- 输出时**剥离来源标签**，避免播放器显示【renren】等  

## 数据流

```
Forward 请求 /api/forward/danmaku
  → parseForwardQuery (title/tmdb/imdb/movie_id/s/e)
  → aggregateEpisode（多源抓取+清洗+缓存）
  → toPlayerComments（去掉 p 中 [source]）
  → JSON / XML / ASS
```

## 播放器 vs 后台

| 字段 | 播放器 | Web 管理 |
|------|--------|----------|
| 弹幕文本 | ✅ | ✅ |
| p 中来源 | ❌ 剥离 | 内部统计可用 |
| sources 列表 | 默认不返回（debug=1 才有 meta） | ✅ 聚合管理页 |

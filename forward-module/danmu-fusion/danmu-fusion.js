/**
 * Danmu Fusion · 弹幕融合
 * Forward 专用弹幕聚合播放模块
 *
 * 版本：1.0.2
 * 作者：仅通过 WidgetMetadata.author 展示
 *
 * 职责（客户端适配，不做聚合/匹配）：
 *   Forward 参数 → 专属 /api/forward/danmaku（需配套部署 Danmu API）
 *   → 展示版本信息 / debug 来源明细 → 播放器纯净弹幕
 */

WidgetMetadata = {
  id: "tzb360.danmu.fusion",
  title: "Danmu Fusion",
  version: "1.0.2",
  requiredVersion: "0.0.2",
  description:
    "Danmu Fusion 是一个弹幕聚合播放模块，需要配套使用 Danmu API 服务。本模块通过专属 Forward API 获取经过聚合、版本匹配和处理后的弹幕数据，为 Emby/Jellyfin 提供稳定的弹幕播放体验。请先部署或连接 Danmu API 后再配置服务地址。",
  author: "tzb360",
  site: "https://github.com/tzb360/danmu-fusion",
  website: "https://github.com/tzb360/danmu-fusion",
  globalParams: [
    {
      name: "danmu_api_url",
      title: "Danmu API 地址（只需填 URL，Token 写在路径里即可）",
      type: "input",
      placeholders: [
        {
          title: "Web 面板复制的完整 Forward API",
          value: "http://127.0.0.1:9321/YOUR_TOKEN/api/forward/danmaku"
        },
        {
          title: "带 Token 的根地址",
          value: "http://127.0.0.1:9321/YOUR_TOKEN"
        },
        {
          title: "本机示例",
          value: "http://127.0.0.1:9321"
        }
      ]
    },
    {
      name: "timeout",
      title: "请求超时（毫秒）",
      type: "input",
      placeholders: [
        { title: "60s", value: "60000" },
        { title: "120s", value: "120000" }
      ]
    },
    {
      name: "retry",
      title: "失败重试次数",
      type: "input",
      placeholders: [
        { title: "2", value: "2" },
        { title: "0", value: "0" }
      ]
    },
    {
      name: "cache",
      title: "模块侧短期缓存",
      type: "input",
      placeholders: [
        { title: "开", value: "1" },
        { title: "关", value: "0" }
      ]
    },
    {
      name: "color_to_white",
      title: "彩色弹幕转白色（服务端，默认开）",
      type: "input",
      placeholders: [
        { title: "开启", value: "1" },
        { title: "关闭", value: "0" }
      ]
    },
    {
      name: "force_scroll",
      title: "全部转为滚动弹幕（服务端，默认开）",
      type: "input",
      placeholders: [
        { title: "开启", value: "1" },
        { title: "关闭", value: "0" }
      ]
    },
    {
      name: "debug",
      title: "调试日志（打印来源明细，不污染播放器 UI）",
      type: "input",
      placeholders: [
        { title: "关", value: "0" },
        { title: "开", value: "1" }
      ]
    }
  ],
  modules: [
    {
      id: "searchDanmu",
      title: "搜索弹幕",
      functionName: "searchDanmu",
      type: "danmu",
      params: []
    },
    {
      id: "getDetail",
      title: "获取详情",
      functionName: "getDetailById",
      type: "danmu",
      params: []
    },
    {
      id: "getComments",
      title: "获取弹幕",
      functionName: "getCommentsById",
      type: "danmu",
      params: []
    }
  ]
};

// ---------------------------------------------------------------------------
const FUSION_UA = "DanmuFusion/1.0.2 (tzb360; Forward)";
// v3：电视剧 animeId 绑定 season+episode，禁止跨集复用
const CACHE_PREFIX = "tzb360.danmu.fusion.v3:";

function truthy(v, defaultVal) {
  if (v === undefined || v === null || v === "") return defaultVal;
  if (v === true || v === 1) return true;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toInt(v, fb) {
  if (v === undefined || v === null || v === "") return fb;
  // 支持 "E11" / "S04" / "第11集"
  const s = String(v).trim();
  const m =
    s.match(/(?:^|[^\d])(?:E|EP|第)?\s*(\d{1,4})\s*(?:集|话|話)?$/i) ||
    s.match(/(\d{1,4})/);
  const n = m ? parseInt(m[1], 10) : parseInt(s, 10);
  return Number.isFinite(n) ? n : fb;
}

/** 取第一个有意义的字段值 */
function firstPresent(obj, keys) {
  const o = obj || {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (o[k] != null && String(o[k]).trim() !== "") return o[k];
  }
  return null;
}

/**
 * 从合成 episodeId 反解集号。
 * getDetailById 使用：episodeId = baseId + episode（episode 为 1-based）
 */
function decodeEpisodeFromSyntheticId(episodeId, animeIdHint) {
  if (episodeId == null || episodeId === "") return null;
  const idNum = Number(episodeId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  // 优先按已知 animeId 计算 base
  if (animeIdHint != null) {
    const baseId =
      (Number(String(animeIdHint).replace(/\D/g, "").slice(-6) || "1") || 1) *
      1000;
    if (idNum > baseId) {
      const ep = idNum - baseId;
      if (ep >= 1 && ep <= 5000) return ep;
    }
  }

  // 回退：id = N*1000 + ep 形式
  const base = Math.floor(idNum / 1000) * 1000;
  const ep = idNum - base;
  if (ep >= 1 && ep <= 5000) return ep;

  // 小整数直接当集号
  if (idNum >= 1 && idNum <= 2000) return idNum;
  return null;
}

function stripSlash(u) {
  return String(u || "").trim().replace(/\/+$/, "");
}

/**
 * 只填一个 URL：自动识别 Token 路径与 Forward 端点
 * 支持：
 *   http://host:9321
 *   http://host:9321/TOKEN
 *   http://host:9321/TOKEN/api/forward/danmaku
 *   http://host:9321/TOKEN/api/forward/danmaku?title=...
 */
function parseDanmuApiUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) {
    return { requestBase: "http://127.0.0.1:9321", display: "http://127.0.0.1:9321" };
  }
  // 去掉 query
  const qi = raw.indexOf("?");
  if (qi >= 0) raw = raw.slice(0, qi);
  raw = stripSlash(raw);

  // 已是完整 forward 端点
  let m = raw.match(/^(https?:\/\/.+?)(\/api\/(?:v2\/)?forward(?:\/danmaku)?)$/i);
  if (m) {
    return {
      requestBase: stripSlash(m[1]),
      display: stripSlash(m[1]) + "/api/forward/danmaku"
    };
  }

  // 普通根地址或 根/TOKEN
  return {
    requestBase: raw,
    display: raw + "/api/forward/danmaku"
  };
}

function yearFrom(v) {
  if (v == null || v === "") return null;
  const m = String(v).match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

function safeLog(on, tag, payload) {
  if (!on) return;
  try {
    let t =
      payload == null
        ? ""
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload);
    // 脱敏路径中的 token 段（/xxxx/api → /***/api）
    t = t.replace(
      /(https?:\/\/[^/\s]+)\/([^/\s]{4,})(\/api\/)/gi,
      "$1/***$3"
    );
    t = t.replace(
      /(["']?(?:api_token|token|authorization|admin_token)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi,
      "$1***"
    );
    console.log("[DanmuFusion][" + tag + "] " + t);
  } catch (e) {
    console.log("[DanmuFusion][" + tag + "] <log-error>");
  }
}

function resolveConfig(params) {
  const p = params || {};
  const parsed = parseDanmuApiUrl(p.danmu_api_url || p.server || "");
  return {
    // requestBase 已含 path token（若用户写在 URL 里），无需再填 token
    requestBase: parsed.requestBase,
    displayUrl: parsed.display,
    timeoutMs: Math.max(3000, toInt(p.timeout, 60000)),
    retry: Math.max(0, Math.min(5, toInt(p.retry, 2))),
    cacheEnabled: truthy(p.cache, true),
    debug: truthy(p.debug, false),
    colorToWhite: truthy(p.color_to_white, true),
    forceScroll: truthy(p.force_scroll, true)
  };
}

/**
 * 媒体类型：movie | tv | episode
 * 电视剧/分集绝不能走电影「固定匹配」逻辑
 */
function classifyMediaKind(p) {
  const t = String(
    (p && (p.type || p.Type || p.mediaType || p.MediaType)) || ""
  ).toLowerCase();
  if (
    t === "movie" ||
    t === "movies" ||
    t === "film" ||
    t === "电影" ||
    t === "动画电影" ||
    t === "剧场版"
  ) {
    return "movie";
  }
  if (t === "episode" || t === "ep") return "episode";
  if (
    t === "tv" ||
    t === "tvshow" ||
    t === "tvshows" ||
    t === "tvseries" ||
    t === "series" ||
    t === "show" ||
    t === "电视剧" ||
    t === "动漫" ||
    t === "anime" ||
    t === "ova"
  ) {
    return "tv";
  }
  // 有季/集字段 → 电视剧/分集
  const hasSeason = firstPresent(p, [
    "season",
    "seasonNumber",
    "SeasonNumber",
    "ParentIndexNumber",
    "parentIndexNumber"
  ]);
  const hasEpisode = firstPresent(p, [
    "episode",
    "episodeNumber",
    "EpisodeNumber",
    "IndexNumber",
    "indexNumber"
  ]);
  if (hasSeason != null || hasEpisode != null) return "episode";
  // type 缺失且无季集 → 电影
  if (!t || t === "unknown") return "movie";
  return "tv";
}

/** 是否电影：Forward 约定电影时 season/episode 为空 */
function isMovieType(type, season, episode, params) {
  if (params) {
    return classifyMediaKind(params) === "movie";
  }
  const t = String(type || "").toLowerCase();
  if (
    t === "movie" ||
    t === "movies" ||
    t === "film" ||
    t === "电影" ||
    t === "动画电影" ||
    t === "剧场版"
  ) {
    return true;
  }
  if (
    t === "tv" ||
    t === "tvshow" ||
    t === "tvseries" ||
    t === "series" ||
    t === "episode" ||
    t === "电视剧" ||
    t === "动漫"
  ) {
    return false;
  }
  if (!t || t === "unknown") {
    const seasonEmpty = season == null || season === "";
    const episodeEmpty = episode == null || episode === "";
    if (seasonEmpty && episodeEmpty) return true;
  }
  return false;
}

/**
 * 解析模块生成的 animeId
 * 电影: tmdb_{id}_movie
 * 剧集: tmdb_{id}_tv_{season}_{episode}  （必须含 SE，禁止跨集复用）
 * 兼容旧版: tmdb_{id}
 */
function parseAnimeId(animeId) {
  const s = String(animeId || "").trim();
  if (!s) return null;
  let m = s.match(/^tmdb_(\d+)_tv_(\d+)_(\d+)$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: Number(m[2]),
      episode: Number(m[3]),
      isMovie: false,
      kind: "tv",
      legacy: false
    };
  }
  m = s.match(/^tmdb_(\d+)_movie$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: 1,
      episode: 1,
      isMovie: true,
      kind: "movie",
      legacy: false
    };
  }
  // 旧版仅 tmdb_id：无 SE，剧集场景不可靠
  m = s.match(/^tmdb_(\d+)$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: null,
      episode: null,
      isMovie: null,
      kind: "legacy",
      legacy: true
    };
  }
  m = s.match(/^fusion_tv_.+_s(\d+)_e(\d+)$/i);
  if (m) {
    return {
      tmdb_id: null,
      season: Number(m[1]),
      episode: Number(m[2]),
      isMovie: false,
      kind: "tv",
      legacy: false
    };
  }
  return null;
}

/**
 * 从 Forward/Emby 原始 params 解析 season/episode（1-based）。
 * 多字段兜底，避免只读 p.episode 时拿不到或拿到陈旧值。
 *
 * 优先级（集）：
 *   1) episode / episodeNumber / e / ep（Forward 文档约定，1-based）
 *   2) IndexNumber（Emby 分集序号，通常 1-based；若为 0 则映射为 1）
 *   3) 合成 episodeId / commentId 反解
 *   4) 从 episodeTitle「第N集」提取
 *
 * 绝不做「全局 -1 / +1」特例；IndexNumber=0 仅表示首集。
 */
function resolveSeasonEpisode(p, isMovie) {
  if (isMovie) {
    return {
      season: 1,
      episode: 1,
      seasonSource: "movie_fixed",
      episodeSource: "movie_fixed",
      raw: {}
    };
  }

  const rawSnap = {
    season: p.season,
    seasonNumber: p.seasonNumber,
    SeasonNumber: p.SeasonNumber,
    ParentIndexNumber: p.ParentIndexNumber,
    parentIndexNumber: p.parentIndexNumber,
    s: p.s,
    episode: p.episode,
    episodeNumber: p.episodeNumber,
    EpisodeNumber: p.EpisodeNumber,
    IndexNumber: p.IndexNumber,
    indexNumber: p.indexNumber,
    e: p.e,
    ep: p.ep,
    episodeId: p.episodeId,
    commentId: p.commentId,
    episodeTitle: p.episodeTitle,
    animeId: p.animeId
  };

  // 路径/文件名中的 SxxExx 是最可靠的「正在播放哪一集」信号（通用，非单剧特例）
  const pathHint = String(
    firstPresent(p, [
      "Path",
      "path",
      "fileName",
      "FileName",
      "videoUrl",
      "VideoUrl",
      "link",
      "MediaPath"
    ]) || ""
  );
  const pathSE = pathHint.match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
  const titleSE = String(
    firstPresent(p, ["episodeTitle", "EpisodeTitle", "name", "seriesName", "title"]) || ""
  ).match(/[Ss](\d{1,2})[Ee](\d{1,3})/);

  // —— season ——
  let seasonSource = "default";
  let season = toInt(
    firstPresent(p, [
      "season",
      "seasonNumber",
      "SeasonNumber",
      "ParentIndexNumber",
      "parentIndexNumber",
      "s"
    ]),
    null
  );
  if (season != null) {
    seasonSource =
      p.season != null && String(p.season).trim() !== ""
        ? "season"
        : p.ParentIndexNumber != null
          ? "ParentIndexNumber"
          : "season_alt";
  }
  // ParentIndexNumber=0 在 Emby 有时表示 Specials，剧集正片季至少为 1
  if (season === 0) {
    season = 1;
    seasonSource = seasonSource + "+zero_as_1";
  }
  if (pathSE) {
    const ps = parseInt(pathSE[1], 10);
    if (Number.isFinite(ps) && ps >= 1) {
      // 路径与字段冲突时以路径为准（避免 UI 字段滞后）
      if (season == null || season !== ps) {
        season = ps;
        seasonSource = "path_SxxExx";
      }
    }
  } else if (titleSE && (season == null || season < 1)) {
    season = parseInt(titleSE[1], 10);
    seasonSource = "title_SxxExx";
  }
  if (season == null || season < 1) {
    season = 1;
    seasonSource = "default_1";
  }

  // —— episode ——
  let episodeSource = "default";
  let episode = toInt(
    firstPresent(p, [
      "episode",
      "episodeNumber",
      "EpisodeNumber",
      "e",
      "ep"
    ]),
    null
  );
  if (episode != null) {
    episodeSource =
      p.episode != null && String(p.episode).trim() !== ""
        ? "episode"
        : p.episodeNumber != null
          ? "episodeNumber"
          : "episode_alt";
  }

  // IndexNumber：仅在上面没有明确 episode 时使用
  if (episode == null) {
    const idx = toInt(
      firstPresent(p, ["IndexNumber", "indexNumber"]),
      null
    );
    if (idx != null) {
      // Emby IndexNumber 一般为 1-based；0 视为第 1 集
      episode = idx === 0 ? 1 : idx;
      episodeSource = idx === 0 ? "IndexNumber_zero_as_1" : "IndexNumber";
    }
  }

  // 合成 episodeId / commentId 反解（getDetail 下发 baseId+ep）
  if (episode == null || episode < 1) {
    const sid = firstPresent(p, ["episodeId", "commentId", "comment_id"]);
    const decoded = decodeEpisodeFromSyntheticId(sid, p.animeId || p.bangumiId);
    if (decoded != null) {
      episode = decoded;
      episodeSource = "episodeId_decode";
    }
  }

  // 从标题「第11集」提取
  if (episode == null || episode < 1) {
    const et = String(p.episodeTitle || p.name || "");
    const m = et.match(/第\s*(\d{1,4})\s*[集话期話]/);
    if (m) {
      episode = parseInt(m[1], 10);
      episodeSource = "episodeTitle";
    }
  }

  // 路径 SxxExx：与字段冲突时优先路径（播放文件名是事实来源）
  if (pathSE) {
    const pe = parseInt(pathSE[2], 10);
    if (Number.isFinite(pe) && pe >= 1 && pe !== episode) {
      episode = pe;
      episodeSource = "path_SxxExx";
    } else if (episode == null || episode < 1) {
      episode = pe;
      episodeSource = "path_SxxExx";
    }
  } else if (titleSE && (episode == null || episode < 1)) {
    episode = parseInt(titleSE[2], 10);
    episodeSource = "title_SxxExx";
  }

  if (episode == null || episode < 1) {
    episode = 1;
    episodeSource = "default_1";
  }

  // episodeId 反解：仅在 episode 仍为默认时覆盖
  const sid2 = firstPresent(p, ["episodeId", "commentId"]);
  const decoded2 = decodeEpisodeFromSyntheticId(sid2, p.animeId || p.bangumiId);
  if (
    decoded2 != null &&
    decoded2 !== episode &&
    (episodeSource === "default_1" || episodeSource === "default")
  ) {
    episode = decoded2;
    episodeSource = "episodeId_decode_override";
  }

  // IndexNumber 与 episode 差 1 且路径未给出时：若 IndexNumber = episode+1，
  // 更可能是 episode 字段滞后/0-based 误用 → 采用 IndexNumber（1-based 真值）
  const idx2 = toInt(firstPresent(p, ["IndexNumber", "indexNumber"]), null);
  if (
    idx2 != null &&
    idx2 >= 1 &&
    episode >= 1 &&
    idx2 === episode + 1 &&
    episodeSource !== "path_SxxExx" &&
    episodeSource !== "episodeId_decode" &&
    episodeSource !== "episodeId_decode_override"
  ) {
    episode = idx2;
    episodeSource = "IndexNumber_prefer_over_stale_episode";
  }

  return {
    season: Math.max(1, Math.floor(season)),
    episode: Math.max(1, Math.floor(episode)),
    seasonSource: seasonSource,
    episodeSource: episodeSource,
    raw: rawSnap
  };
}

function resolveIdentity(params) {
  const p = params || {};
  const kind = classifyMediaKind(p);
  const movie = kind === "movie";
  const rawType = String(p.type || p.Type || "").toLowerCase();

  // 剧集优先 seriesName（系列名），避免用单集标题当系列名
  const title = String(
    movie
      ? firstPresent(p, ["title", "name", "seriesName", "keyword", "mediaName"]) ||
          ""
      : firstPresent(p, [
          "seriesName",
          "SeriesName",
          "title",
          "name",
          "keyword",
          "mediaName"
        ]) || ""
  ).trim();

  const tmdbIdRaw = firstPresent(p, [
    "tmdbId",
    "tmdb_id",
    "TmdbId",
    "ProviderIds.Tmdb"
  ]);
  const imdbIdRaw = firstPresent(p, ["imdbId", "imdb_id", "ImdbId"]);
  let tmdbId =
    tmdbIdRaw != null && String(tmdbIdRaw).trim() !== ""
      ? String(tmdbIdRaw).trim()
      : null;
  const imdbId =
    imdbIdRaw != null && String(imdbIdRaw).trim() !== ""
      ? String(imdbIdRaw).trim()
      : null;
  const year =
    yearFrom(p.year) ||
    yearFrom(p.ProductionYear) ||
    yearFrom(p.airDate) ||
    yearFrom(p.premiereDate) ||
    yearFrom(p.PremiereDate) ||
    null;

  const se = resolveSeasonEpisode(p, movie);
  let season = se.season;
  let episode = se.episode;
  let seasonSource = se.seasonSource;
  let episodeSource = se.episodeSource;

  // 从 animeId 恢复 SE（getDetail/getComments 可能只带 animeId）
  // 电视剧：params 明确带了 SE 时以当前播放为准；否则用 animeId 内嵌 SE
  const animeIdRaw = p.animeId != null ? p.animeId : p.bangumiId;
  const fromAnime = parseAnimeId(animeIdRaw);
  if (fromAnime) {
    if (!tmdbId && fromAnime.tmdb_id) tmdbId = fromAnime.tmdb_id;
    if (!movie && fromAnime.season != null && fromAnime.episode != null) {
      const paramHasExplicitEp =
        firstPresent(p, ["episode", "episodeNumber", "IndexNumber", "episodeId"]) !=
        null;
      if (!paramHasExplicitEp || episodeSource === "default_1") {
        season = fromAnime.season;
        episode = fromAnime.episode;
        seasonSource = "animeId";
        episodeSource = "animeId";
      }
    }
  }

  return {
    title: title,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    year: year,
    season: season,
    episode: episode,
    seasonSource: seasonSource,
    episodeSource: episodeSource,
    rawSeasonEpisode: se.raw,
    type: movie ? "movie" : kind === "episode" ? "episode" : rawType || "tv",
    mediaKind: movie ? "movie" : kind === "episode" ? "episode" : "tv",
    isMovie: movie,
    original_title:
      firstPresent(p, [
        "original_title",
        "originalTitle",
        "originalName",
        "OriginalTitle"
      ]) || null,
    region: firstPresent(p, ["region", "country", "Country"]) || null,
    animeId: animeIdRaw != null ? animeIdRaw : null,
    episodeId: firstPresent(p, ["episodeId", "commentId"]) || null
  };
}

function buildQuery(identity, cfg, extra) {
  const q = {};
  if (identity.tmdb_id) q.tmdb_id = identity.tmdb_id;
  if (identity.imdb_id) q.imdb_id = identity.imdb_id;
  if (identity.title) q.title = identity.title;
  if (identity.year) q.year = identity.year;
  if (identity.original_title) q.original_title = identity.original_title;
  if (identity.region) q.region = identity.region;
  // 电影 / 电视剧类型明确下发
  q.type = identity.isMovie ? "movie" : "tv";
  // 强制 1-based；电视剧必须始终带 season+episode，禁止只发 title
  q.season = String(Math.max(1, Number(identity.season) || 1));
  q.episode = String(Math.max(1, Number(identity.episode) || 1));
  q.color_to_white = cfg.colorToWhite ? "1" : "0";
  q.force_scroll = cfg.forceScroll ? "1" : "0";
  if (extra && extra.debug) q.debug = "1";
  if (extra && extra.force) q.force = "1";
  if (extra && extra.resolve_only) q.resolve_only = "1";
  return q;
}

/** 本地生成展示标题：SE 永远来自 identity，不被服务端陈旧 display 覆盖 */
function buildLocalDisplay(identity, media) {
  const title =
    (media && (media.title || media.display_title)) ||
    identity.title ||
    "未知";
  const regionLabel =
    (media && (media.region_label || media.region)) || identity.region || null;
  // 展示年：优先系列年/查询年，其次 matched season_year（仅作参考）
  const year =
    (media && media.year) ||
    identity.year ||
    (media && media.season_year) ||
    null;
  const segs = [];
  if (regionLabel) segs.push(String(regionLabel));
  if (year) segs.push(String(year));
  const version = segs.length ? " (" + segs.join(" ") + ")" : "";
  if (identity.isMovie) {
    return String(title).replace(/\s*S\d{1,2}E\d{1,2}\s*$/i, "").trim() + version;
  }
  const s = String(Math.max(1, Number(identity.season) || 1)).padStart(2, "0");
  const e = String(Math.max(1, Number(identity.episode) || 1)).padStart(2, "0");
  // 去掉服务端 display 里可能已带的 SxxExx，再拼本地 SE
  const base = String(title)
    .replace(/\s*S\d{1,2}E\d{1,2}\s*$/i, "")
    .replace(/\s*S\d{1,2}\s*$/i, "")
    .trim();
  // 若 title 已含 version 括号则不再重复
  if (/\(\s*[^)]+\s*\)\s*$/.test(base)) {
    return base + " S" + s + "E" + e;
  }
  return base + version + " S" + s + "E" + e;
}

function logOutboundApi(cfg, identity, queryObj, tag, requestUrl) {
  // 始终打印关键请求上下文（定位跨集复用）
  safeLog(true, tag || "发送 Forward API", {
    type: identity.isMovie ? "movie" : "tv",
    mediaKind: identity.mediaKind || (identity.isMovie ? "movie" : "tv"),
    title: identity.title,
    tmdb: identity.tmdb_id,
    season: identity.season,
    episode: identity.episode,
    seasonSource: identity.seasonSource,
    episodeSource: identity.episodeSource,
    year: identity.year,
    animeId: identity.animeId || null,
    query: queryObj,
    request_url: requestUrl || null
  });
}

function qs(obj) {
  const parts = [];
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v == null || v === "") return;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return parts.join("&");
}

function headers(cfg) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": FUSION_UA
  };
}

/** 拼出 Forward 专属接口完整 URL（Token 已在 requestBase 路径中） */
function forwardDanmakuUrl(cfg, queryObj) {
  const base = stripSlash(cfg.requestBase || "");
  return base + "/api/forward/danmaku?" + qs(queryObj);
}

async function httpGet(url, cfg) {
  if (typeof Widget === "undefined" || !Widget.http || !Widget.http.get) {
    throw new Error("Widget.http 不可用");
  }
  const resp = await Widget.http.get(url, {
    headers: headers(cfg),
    timeout: cfg.timeoutMs
  });
  if (resp == null) return null;
  return resp.data !== undefined ? resp.data : resp;
}

async function httpGetRetry(url, cfg, tag) {
  let last = null;
  const n = 1 + (cfg.retry || 0);
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      const data = await httpGet(url, cfg);
      safeLog(cfg.debug, tag || "http", {
        attempt: i + 1,
        ms: Date.now() - t0,
        ok: true
      });
      return data;
    } catch (e) {
      last = e;
      safeLog(cfg.debug, tag || "http", {
        attempt: i + 1,
        ms: Date.now() - t0,
        ok: false,
        error: String(e && e.message ? e.message : e)
      });
      if (i < n - 1) {
        await new Promise(function (r) {
          setTimeout(r, 300 * (i + 1));
        });
      }
    }
  }
  throw last || new Error("请求失败");
}

function cacheGet(key) {
  try {
    if (typeof Widget !== "undefined" && Widget.storage && Widget.storage.get) {
      return Widget.storage.get(CACHE_PREFIX + key);
    }
  } catch (e) {}
  return null;
}

function cacheSet(key, val) {
  try {
    if (typeof Widget !== "undefined" && Widget.storage && Widget.storage.set) {
      Widget.storage.set(CACHE_PREFIX + key, val);
    }
  } catch (e) {}
}

/**
 * 模块侧缓存 key：
 * - 电影：可按 tmdb 固定
 * - 电视剧：必须含 season+episode，禁止跨集命中
 */
function cacheKey(identity) {
  if (identity.isMovie) {
    if (identity.tmdb_id) return "movie:tmdb:" + identity.tmdb_id;
    return (
      "movie:t:" +
      String(identity.title || "").toLowerCase() +
      ":y" +
      (identity.year || "")
    );
  }
  // 电视剧 / 分集
  if (identity.tmdb_id) {
    return (
      "tv:tmdb:" +
      identity.tmdb_id +
      ":s" +
      identity.season +
      ":e" +
      identity.episode
    );
  }
  return (
    "tv:t:" +
    String(identity.title || "").toLowerCase() +
    ":y" +
    (identity.year || "") +
    ":s" +
    identity.season +
    ":e" +
    identity.episode
  );
}

/** 校验缓存条目是否属于当前 identity（电视剧不得跨集） */
function cacheEntryMatches(identity, entry) {
  if (!entry || !entry._fusion_meta) return true; // 旧缓存无 meta：电视剧一律不用
  const m = entry._fusion_meta;
  if (identity.isMovie) {
    return m.isMovie === true;
  }
  if (m.isMovie) return false;
  return (
    Number(m.season) === Number(identity.season) &&
    Number(m.episode) === Number(identity.episode) &&
    String(m.tmdb_id || "") === String(identity.tmdb_id || "")
  );
}

function adaptComments(payload) {
  if (!payload) return { count: 0, comments: [] };
  let list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.comments)
      ? payload.comments
      : [];
  const clean = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || typeof c !== "object") continue;
    let p = c.p != null ? String(c.p) : "";
    let m =
      c.m != null
        ? String(c.m)
        : c.content != null
          ? String(c.content)
          : "";
    if (!m) continue;
    p = p.replace(/,?\s*[\[【][^\]】]*[\]】]\s*$/u, "");
    const parts = p.split(",").map(function (s) {
      return s.trim();
    });
    if (parts.length < 3) p = (parts[0] || "0.00") + ",1,16777215";
    else if (parts.length > 3 && parts.length < 8) p = parts.slice(0, 3).join(",");
    else p = parts.join(",");
    const item = { p: p, m: m, cid: c.cid != null ? c.cid : i + 1 };
    if (c.t != null) item.t = c.t;
    clean.push(item);
  }
  return { count: clean.length, comments: clean };
}

/** 调试：打印每个来源明细（不进播放器 UI） */
function logSourcesDetail(cfg, media, sourcesDetail, count) {
  if (!cfg.debug) return;
  safeLog(cfg.debug, "match", media || {});
  const list = sourcesDetail || [];
  safeLog(cfg.debug, "sources_count", list.length);
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    safeLog(cfg.debug, "source#" + (i + 1), {
      source: s.source,
      file: s.file_name || s.fileName || s.raw_file,
      matched_title: s.matched_title || s.anime_title,
      region: s.region_label || s.region,
      year: s.year,
      season: s.season,
      episode: s.episode,
      count_raw: s.count_raw
    });
  }
  safeLog(cfg.debug, "merged_count", count);
}

/**
 * animeId 生成规则（关键）：
 * - 电影：tmdb_{id}_movie —— 允许固定匹配
 * - 电视剧：tmdb_{id}_tv_{season}_{episode} —— 每集唯一，禁止跨集复用
 * 对应 unionId 形态：34307_tv_4_12
 */
function stableAnimeId(identity) {
  if (identity.isMovie) {
    if (identity.tmdb_id) return "tmdb_" + identity.tmdb_id + "_movie";
    const raw =
      (identity.title || "m") + "|" + (identity.year || "") + "|movie";
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return "fusion_movie_" + h;
  }
  const s = Math.max(1, Number(identity.season) || 1);
  const e = Math.max(1, Number(identity.episode) || 1);
  if (identity.tmdb_id) {
    return "tmdb_" + identity.tmdb_id + "_tv_" + s + "_" + e;
  }
  const raw = (identity.title || "m") + "|" + (identity.year || "");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return "fusion_tv_" + h + "_s" + s + "_e" + e;
}

// ---------------------------------------------------------------------------
// Forward 入口
// ---------------------------------------------------------------------------

async function searchDanmu(params) {
  const cfg = resolveConfig(params);
  const identity = resolveIdentity(params);
  safeLog(true, "searchDanmu.raw_params", {
    type: params && params.type,
    season: params && params.season,
    episode: params && params.episode,
    IndexNumber: params && params.IndexNumber,
    ParentIndexNumber: params && params.ParentIndexNumber,
    episodeNumber: params && params.episodeNumber,
    episodeId: params && params.episodeId,
    animeId: params && params.animeId,
    seriesName: params && params.seriesName,
    title: params && params.title,
    tmdbId: params && (params.tmdbId || params.tmdb_id)
  });
  safeLog(true, "searchDanmu.resolved", {
    mediaKind: identity.mediaKind,
    isMovie: identity.isMovie,
    title: identity.title,
    season: identity.season,
    episode: identity.episode,
    seasonSource: identity.seasonSource,
    episodeSource: identity.episodeSource,
    tmdb_id: identity.tmdb_id,
    year: identity.year,
    animeId_will_be: stableAnimeId(identity)
  });

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { animes: [] };
  }

  let media = null;
  let displayTitle = null;
  try {
    const queryObj = buildQuery(identity, cfg, {
      debug: cfg.debug,
      resolve_only: true
    });
    const url = forwardDanmakuUrl(cfg, queryObj);
    logOutboundApi(cfg, identity, queryObj, "发送 Forward API(resolve)", url);
    const raw = await httpGetRetry(
      url,
      Object.assign({}, cfg, { timeoutMs: Math.min(cfg.timeoutMs, 45000), retry: 0 }),
      "resolve"
    );
    media = raw && raw.media ? raw.media : null;
    // 展示 SE 必须以本地 identity 为准
    displayTitle = buildLocalDisplay(identity, media);
    if (media) {
      safeLog(true, "resolve.media_se", {
        media_season: media.season,
        media_episode: media.episode,
        media_display: media.display,
        local_season: identity.season,
        local_episode: identity.episode
      });
    }
  } catch (e) {
    safeLog(cfg.debug, "resolve.fail", String(e && e.message ? e.message : e));
  }

  if (!displayTitle) {
    displayTitle = buildLocalDisplay(identity, null);
  }

  // 电视剧：animeId 绑定当前 SE，每次换集都是新 id，Forward 不会复用 E10 的匹配
  const animeId = stableAnimeId(identity);
  return {
    animes: [
      {
        animeId: animeId,
        bangumiId: String(animeId),
        animeTitle: displayTitle,
        type: identity.isMovie ? "movie" : "tvseries",
        typeDescription: identity.isMovie ? "电影" : "Danmu Fusion",
        imageUrl: "",
        startDate:
          media && media.year
            ? media.year + "-01-01"
            : identity.year
              ? identity.year + "-01-01"
              : "",
        // 电影 / 当前剧集条目：都只暴露 1 集，避免伪造多集列表
        episodeCount: 1,
        rating: 0,
        isFavorited: false
      }
    ]
  };
}

/**
 * 分集列表
 * 历史 bug：upper = episode + 2 → 电影默认 episode=1 时固定生成 3 集
 * 修复：电影永远只返回 1 条「正片」；剧集只返回当前播放集（不做虚假扩集）
 */
async function getDetailById(params) {
  const identity = resolveIdentity(params);
  // 优先用本次 identity 生成 id（含 SE）；若 params.animeId 已是带 SE 的新格式且 SE 一致则沿用
  let animeId = stableAnimeId(identity);
  if (params && params.animeId != null) {
    const parsed = parseAnimeId(params.animeId);
    if (
      parsed &&
      !parsed.legacy &&
      !identity.isMovie &&
      Number(parsed.season) === Number(identity.season) &&
      Number(parsed.episode) === Number(identity.episode)
    ) {
      animeId = String(params.animeId);
    } else if (parsed && parsed.legacy && identity.isMovie) {
      animeId = String(params.animeId);
    }
  }
  const baseId =
    (Number(String(animeId).replace(/\D/g, "").slice(-6) || "1") || 1) * 1000;
  const air = identity.year ? identity.year + "-01-01" : "";

  safeLog(true, "getDetail.resolved", {
    mediaKind: identity.mediaKind,
    isMovie: identity.isMovie,
    season: identity.season,
    episode: identity.episode,
    episodeSource: identity.episodeSource,
    animeId: animeId
  });

  if (identity.isMovie) {
    return [
      {
        seasonId: "season-" + animeId,
        episodeId: baseId + 1,
        episodeTitle: identity.title || "正片",
        episodeNumber: "1",
        airDate: air
      }
    ];
  }

  // 剧集：仅当前集；episodeId 绑定当前 E，避免和其它集混淆
  const ep = identity.episode;
  return [
    {
      seasonId: "season-" + animeId,
      episodeId: baseId + ep,
      episodeTitle: "第" + ep + "集",
      episodeNumber: String(ep),
      airDate: air
    }
  ];
}

async function getCommentsById(params) {
  const cfg = resolveConfig(params);
  const identity = resolveIdentity(params);
  safeLog(true, "getComments.raw_params", {
    type: params && params.type,
    season: params && params.season,
    episode: params && params.episode,
    IndexNumber: params && params.IndexNumber,
    episodeId: params && params.episodeId,
    commentId: params && params.commentId,
    episodeNumber: params && params.episodeNumber,
    animeId: params && params.animeId,
    tmdbId: params && (params.tmdbId || params.tmdb_id)
  });
  safeLog(true, "getComments.resolved", {
    mediaKind: identity.mediaKind,
    isMovie: identity.isMovie,
    title: identity.title,
    season: identity.season,
    episode: identity.episode,
    seasonSource: identity.seasonSource,
    episodeSource: identity.episodeSource,
    tmdb_id: identity.tmdb_id
  });

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { count: 0, comments: [] };
  }

  // 电视剧：必须已解析出有效 SE（禁止只靠 title 固定匹配）
  if (!identity.isMovie) {
    if (!(Number(identity.season) >= 1) || !(Number(identity.episode) >= 1)) {
      safeLog(true, "getComments.reject", "tv missing season/episode");
      return { count: 0, comments: [] };
    }
  }

  const ck = cacheKey(identity);
  if (cfg.cacheEnabled) {
    const hit = cacheGet(ck);
    if (hit && hit.comments && hit.comments.length && cacheEntryMatches(identity, hit)) {
      safeLog(true, "module_cache_hit", {
        key: ck,
        count: hit.count,
        type: identity.isMovie ? "movie" : "tv",
        season: identity.season,
        episode: identity.episode
      });
      return hit;
    }
    if (hit && !cacheEntryMatches(identity, hit)) {
      safeLog(true, "module_cache_skip_mismatch", {
        key: ck,
        want: { s: identity.season, e: identity.episode },
        got: hit._fusion_meta || null
      });
    }
  }

  // 每次按当前 identity 重新请求（电视剧禁止固定旧 episode）
  const queryObj = buildQuery(identity, cfg, { debug: cfg.debug });
  const url = forwardDanmakuUrl(cfg, queryObj);
  logOutboundApi(cfg, identity, queryObj, "发送 Forward API(danmaku)", url);

  try {
    const raw = await httpGetRetry(url, cfg, "forward.danmaku");
    const adapted = adaptComments(raw);
    if (raw && raw.media) {
      adapted.media = Object.assign({}, raw.media, {
        season: identity.season,
        episode: identity.episode,
        display: buildLocalDisplay(identity, raw.media)
      });
    }

    const detail =
      (raw && raw.sources_detail) ||
      (raw && raw.meta && (raw.meta.sources_detail || raw.meta.sources)) ||
      [];
    logSourcesDetail(cfg, adapted.media, detail, adapted.count);

    // 仅电影或校验通过的 TV 条目写入缓存；带上 meta 防止跨集命中
    if (cfg.cacheEnabled && adapted.count > 0) {
      adapted._fusion_meta = {
        isMovie: !!identity.isMovie,
        tmdb_id: identity.tmdb_id || null,
        season: identity.season,
        episode: identity.episode,
        title: identity.title || null
      };
      cacheSet(ck, adapted);
    }
    return adapted;
  } catch (e) {
    safeLog(cfg.debug, "getComments.error", String(e && e.message ? e.message : e));
    return { count: 0, comments: [] };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WidgetMetadata: typeof WidgetMetadata !== "undefined" ? WidgetMetadata : null,
    searchDanmu: searchDanmu,
    getDetailById: getDetailById,
    getCommentsById: getCommentsById,
    // 测试导出
    _test: {
      classifyMediaKind: classifyMediaKind,
      stableAnimeId: stableAnimeId,
      parseAnimeId: parseAnimeId,
      resolveIdentity: resolveIdentity,
      cacheKey: cacheKey,
      buildQuery: buildQuery
    }
  };
}

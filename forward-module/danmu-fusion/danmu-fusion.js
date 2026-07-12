/**
 * Danmu Fusion · 弹幕融合
 * Forward 专用弹幕聚合播放模块
 *
 * 版本：1.2.1
 *
 * 架构（电影 / 电视剧完全分离）：
 *
 *  类型唯一依据：unionId = {tmdb_id}_{type}_{season}_{episode}
 *    36557_movie_0_0  → movie（忽略 0/0，禁止 S01E01）
 *    34307_tv_5_3     → tv（使用 season/episode）
 *
 *  电影：title + year，固定唯一匹配，不下发 season/episode
 *  电视剧：title + year + 本季全集列表，默认选中播放器 episode
 *
 *  缓存：只缓存弹幕数据，无模块级媒体类型状态
 */

WidgetMetadata = {
  id: "tzb360.danmu.fusion",
  title: "Danmu Fusion",
  version: "1.2.1",
  requiredVersion: "0.0.2",
  description:
    "Danmu Fusion：按 unionId 分流 movie/tv。电影仅标题+年份；电视剧按季集动态请求，详情展开本季全集。",
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
const FUSION_UA = "DanmuFusion/1.2.1 (tzb360; Forward)";
// v5：unionId 分流 movie/tv；缓存只绑弹幕，无类型状态
const CACHE_PREFIX = "tzb360.danmu.fusion.v5:";
/** 本季分集列表上限（未知总集数时兜底，保证当前集可被选中） */
const TV_SEASON_LIST_MAX = 40;

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
 * 解析播放器 unionId（权威身份）
 *
 * 唯一标准格式：
 *   {tmdb_id}_{type}_{season}_{episode}
 *
 * 示例：
 *   36557_movie_0_0   → movie（season/episode 占位 0，忽略）
 *   34307_tv_5_3      → tv/episode
 *   tmdb_36557_movie_0_0（兼容前缀）
 *
 * 不要靠标题/TMDB 搜索结果猜类型。
 */
function parseUnionOrMediaId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // 主格式：36557_movie_0_0 / 34307_tv_5_3
  let m = s.match(/^(?:tmdb_)?(\d+)_(movie|tv|episode|show|series)_(\d+)_(\d+)$/i);
  if (m) {
    const typeRaw = m[2].toLowerCase();
    const isMovie = typeRaw === "movie";
    const season = Number(m[3]);
    const episode = Number(m[4]);
    return {
      tmdb_id: m[1],
      type: isMovie ? "movie" : "tv",
      media_type: isMovie ? "movie" : "tv",
      season: isMovie ? null : season > 0 ? season : null,
      episode: isMovie ? null : episode > 0 ? episode : null,
      isMovie: isMovie,
      kind: isMovie ? "movie" : "episode",
      source: "unionId",
      raw: s
    };
  }

  // 兼容：tmdb_36557_movie / 36557_movie（无季集占位）
  m = s.match(/^(?:tmdb_)?(\d+)_movie$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      type: "movie",
      media_type: "movie",
      season: null,
      episode: null,
      isMovie: true,
      kind: "movie",
      source: "unionId",
      raw: s
    };
  }

  // 兼容：34307_tv_s5_e3 / tmdb_34307_tv_5_3 已由主格式覆盖
  m = s.match(/^(?:tmdb_)?(\d+)_tv_s(\d+)[_eE](\d+)$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      type: "tv",
      media_type: "tv",
      season: Number(m[2]),
      episode: Number(m[3]),
      isMovie: false,
      kind: "episode",
      source: "unionId",
      raw: s
    };
  }

  return null;
}

/**
 * 媒体类型分流：movie | tv | episode
 *
 * 优先级（从高到低）：
 *   1) unionId 内的 type 字段（唯一权威，禁止用标题/TMDB 猜）
 *   2) 播放器显式 type/mediaType（movie / episode / tv）
 *   3) 仅当完全没有 type 线索时，才用「有效」季集（>0）推断
 *
 * 注意：电影常见 season=0 episode=0，绝不能当成剧集！
 */
function classifyMediaKind(p) {
  const p0 = p || {};

  // 1) unionId 权威
  const unionRaw = firstPresent(p0, [
    "unionId",
    "union_id",
    "mediaId",
    "MediaId",
    "itemId",
    "ItemId"
  ]);
  const fromUnion = parseUnionOrMediaId(unionRaw);
  if (fromUnion) {
    return fromUnion.isMovie ? "movie" : "episode";
  }

  // 2) 显式 type
  const t = String(
    p0.type || p0.Type || p0.mediaType || p0.MediaType || p0.media_type || p0.itemType || ""
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

  // 3) 无 type 时：仅「有效」季或集（>=1）才视为剧集
  //    season=0 / episode=0 是电影占位，忽略
  const sNum = toInt(
    firstPresent(p0, [
      "season",
      "seasonNumber",
      "SeasonNumber",
      "ParentIndexNumber",
      "parentIndexNumber"
    ]),
    null
  );
  const eNum = toInt(
    firstPresent(p0, [
      "episode",
      "episodeNumber",
      "EpisodeNumber",
      "IndexNumber",
      "indexNumber"
    ]),
    null
  );
  if ((sNum != null && sNum >= 1) || (eNum != null && eNum >= 1)) {
    return "episode";
  }

  // 默认电影（避免把 0/0 当剧集）
  return "movie";
}

/** 是否电影 */
function isMovieType(type, season, episode, params) {
  if (params) return classifyMediaKind(params) === "movie";
  return classifyMediaKind({ type: type, season: season, episode: episode }) === "movie";
}

/**
 * 解析模块 animeId
 * 电影: tmdb_{id}_movie
 * 电视剧(季级，v1.2): tmdb_{id}_tv_s{season}__{version}
 * 兼容旧集级: tmdb_{id}_tv_{s}_{e}[__{version}]
 */
function parseAnimeId(animeId) {
  const s = String(animeId || "").trim();
  if (!s) return null;

  // 季级：tmdb_34307_tv_s5__us_2011_s5
  let m = s.match(/^tmdb_(\d+)_tv_s(\d+)__(.+)$/i);
  if (m) {
    const vkParts = String(m[3]).match(/^([a-z0-9]+)_(\d{4}|0)_s(\d+)$/i);
    const version_key = vkParts
      ? vkParts[1] + ":" + vkParts[2] + ":s" + vkParts[3]
      : m[3] === "auto"
        ? null
        : null;
    return {
      tmdb_id: m[1],
      season: Number(m[2]),
      episode: null, // 季级 id 不含集，集必须来自播放器
      version_key: version_key,
      isMovie: false,
      kind: "tv_season",
      legacy: false,
      seasonScoped: true
    };
  }

  // 旧集级：tmdb_34307_tv_4_12__us_2011_s4
  m = s.match(/^tmdb_(\d+)_tv_(\d+)_(\d+)__(.+)$/i);
  if (m) {
    const vkParts = String(m[4]).match(/^([a-z0-9]+)_(\d{4}|0)_s(\d+)$/i);
    const version_key = vkParts
      ? vkParts[1] + ":" + vkParts[2] + ":s" + vkParts[3]
      : null;
    return {
      tmdb_id: m[1],
      season: Number(m[2]),
      episode: Number(m[3]),
      version_key: version_key,
      isMovie: false,
      kind: "tv",
      legacy: false,
      seasonScoped: false
    };
  }
  m = s.match(/^tmdb_(\d+)_tv_(\d+)_(\d+)$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: Number(m[2]),
      episode: Number(m[3]),
      version_key: null,
      isMovie: false,
      kind: "tv",
      legacy: false,
      seasonScoped: false
    };
  }
  m = s.match(/^tmdb_(\d+)_movie$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: 1,
      episode: 1,
      version_key: null,
      isMovie: true,
      kind: "movie",
      legacy: false,
      seasonScoped: false
    };
  }
  // 播放器 unionId 也可能直接当 animeId 传入
  const u = parseUnionOrMediaId(s);
  if (u) {
    return {
      tmdb_id: u.tmdb_id,
      season: u.season,
      episode: u.episode,
      version_key: null,
      isMovie: !!u.isMovie,
      kind: u.isMovie ? "movie" : "tv",
      legacy: false,
      seasonScoped: false
    };
  }
  m = s.match(/^tmdb_(\d+)$/i);
  if (m) {
    return {
      tmdb_id: m[1],
      season: null,
      episode: null,
      version_key: null,
      isMovie: null,
      kind: "legacy",
      legacy: true,
      seasonScoped: false
    };
  }
  return null;
}

/** version_key → animeId 安全片段 us:2011:s4 → us_2011_s4 */
function versionKeyToIdPart(versionKey) {
  return String(versionKey || "auto")
    .replace(/:/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");
}

function formatSE(season, episode) {
  const s = String(Math.max(1, Number(season) || 1)).padStart(2, "0");
  const e = String(Math.max(1, Number(episode) || 1)).padStart(2, "0");
  return "S" + s + "E" + e;
}

/**
 * 电视剧专用：从播放器 params 解析 season/episode。
 * 优先级（高→低）：
 *   1) 显式 episode / season 字段（播放器权威）
 *   2) IndexNumber / ParentIndexNumber
 *   3) unionId（如 34307_tv_5_3）
 *   4) 路径/标题 SxxExx
 *   5) 合成 episodeId
 *   6) animeId 内嵌（仅缺省时）
 * 禁止：无证据时静默当 E01 当作「已匹配成功」。
 */
function resolveSeasonEpisode(p, isMovie) {
  if (isMovie) {
    return {
      season: 1,
      episode: 1,
      seasonSource: "movie_fixed",
      episodeSource: "movie_fixed",
      hasPlayerEpisode: true,
      hasPlayerSeason: true,
      raw: {}
    };
  }

  const rawSnap = {
    season: p.season,
    seasonNumber: p.seasonNumber,
    SeasonNumber: p.SeasonNumber,
    ParentIndexNumber: p.ParentIndexNumber,
    parentIndexNumber: p.parentIndexNumber,
    episode: p.episode,
    episodeNumber: p.episodeNumber,
    EpisodeNumber: p.EpisodeNumber,
    IndexNumber: p.IndexNumber,
    indexNumber: p.indexNumber,
    unionId: p.unionId || p.union_id || p.mediaId,
    episodeId: p.episodeId,
    commentId: p.commentId,
    animeId: p.animeId,
    episodeTitle: p.episodeTitle
  };

  let season = null;
  let episode = null;
  let seasonSource = "missing";
  let episodeSource = "missing";

  // 1) 显式字段
  const s1 = toInt(
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
  if (s1 != null && s1 >= 0) {
    season = s1 === 0 ? 1 : s1;
    seasonSource =
      p.season != null && String(p.season).trim() !== ""
        ? "season"
        : p.ParentIndexNumber != null
          ? "ParentIndexNumber"
          : "season_alt";
  }

  const e1 = toInt(
    firstPresent(p, [
      "episode",
      "episodeNumber",
      "EpisodeNumber",
      "e",
      "ep"
    ]),
    null
  );
  if (e1 != null && e1 >= 1) {
    episode = e1;
    episodeSource =
      p.episode != null && String(p.episode).trim() !== ""
        ? "episode"
        : p.episodeNumber != null
          ? "episodeNumber"
          : "episode_alt";
  }

  // 2) Emby IndexNumber（仅 episode 仍缺时）
  if (episode == null) {
    const idx = toInt(firstPresent(p, ["IndexNumber", "indexNumber"]), null);
    if (idx != null) {
      episode = idx === 0 ? 1 : idx;
      episodeSource = idx === 0 ? "IndexNumber_zero_as_1" : "IndexNumber";
    }
  }

  // 3) unionId 34307_tv_5_3 —— 播放器权威信号
  const unionRaw = firstPresent(p, [
    "unionId",
    "union_id",
    "mediaId",
    "MediaId",
    "itemId",
    "ItemId"
  ]);
  const fromUnion = parseUnionOrMediaId(unionRaw);
  if (fromUnion && !fromUnion.isMovie) {
    if (fromUnion.season != null && (season == null || seasonSource === "missing")) {
      season = fromUnion.season;
      seasonSource = "unionId";
    }
    if (fromUnion.episode != null && (episode == null || episodeSource === "missing")) {
      episode = fromUnion.episode;
      episodeSource = "unionId";
    }
    // 显式字段与 unionId 冲突：以显式字段为准，但记录
    if (
      fromUnion.episode != null &&
      episode != null &&
      Number(fromUnion.episode) !== Number(episode) &&
      episodeSource !== "unionId"
    ) {
      safeLog(true, "unionId_episode_diff_keep_player", {
        player: episode,
        unionId: fromUnion.episode,
        keep: episodeSource
      });
    }
  }

  // 4) 路径 / 标题 SxxExx（仅填补缺失，不覆盖已有播放器字段）
  const pathHint = String(
    firstPresent(p, [
      "Path",
      "path",
      "fileName",
      "FileName",
      "videoUrl",
      "VideoUrl",
      "MediaPath"
    ]) || ""
  );
  const pathSE = pathHint.match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
  const titleSE = String(
    firstPresent(p, ["episodeTitle", "EpisodeTitle", "name"]) || ""
  ).match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
  if (pathSE) {
    if (season == null) {
      season = parseInt(pathSE[1], 10);
      seasonSource = "path_SxxExx";
    }
    if (episode == null) {
      episode = parseInt(pathSE[2], 10);
      episodeSource = "path_SxxExx";
    }
  } else if (titleSE) {
    if (season == null) {
      season = parseInt(titleSE[1], 10);
      seasonSource = "title_SxxExx";
    }
    if (episode == null) {
      episode = parseInt(titleSE[2], 10);
      episodeSource = "title_SxxExx";
    }
  }

  // 5) episodeId 合成 id
  if (episode == null) {
    const sid = firstPresent(p, ["episodeId", "commentId", "comment_id"]);
    const decoded = decodeEpisodeFromSyntheticId(sid, p.animeId || p.bangumiId);
    if (decoded != null) {
      episode = decoded;
      episodeSource = "episodeId_decode";
    }
  }

  // 6) 标题「第N集」
  if (episode == null) {
    const et = String(p.episodeTitle || p.name || "");
    const m = et.match(/第\s*(\d{1,4})\s*[集话期話]/);
    if (m) {
      episode = parseInt(m[1], 10);
      episodeSource = "episodeTitle";
    }
  }

  // 7) animeId 内嵌（季级不含 episode；旧集级有）
  const fromAnime = parseAnimeId(p.animeId || p.bangumiId);
  if (fromAnime && !fromAnime.isMovie) {
    if (season == null && fromAnime.season != null) {
      season = fromAnime.season;
      seasonSource = "animeId";
    }
    if (episode == null && fromAnime.episode != null) {
      episode = fromAnime.episode;
      episodeSource = "animeId";
    }
  }

  const hasPlayerSeason = season != null && season >= 1;
  const hasPlayerEpisode = episode != null && episode >= 1;

  // 最后兜底：仅用于不阻断流程，标记 default 供上层报警
  if (season == null || season < 1) {
    season = 1;
    seasonSource = "default_1_UNSAFE";
  }
  if (episode == null || episode < 1) {
    episode = 1;
    episodeSource = "default_1_UNSAFE";
  }

  return {
    season: Math.max(1, Math.floor(season)),
    episode: Math.max(1, Math.floor(episode)),
    seasonSource: seasonSource,
    episodeSource: episodeSource,
    hasPlayerSeason: hasPlayerSeason,
    hasPlayerEpisode: hasPlayerEpisode,
    raw: rawSnap
  };
}

/**
 * 电影 / 电视剧完全分离的身份解析
 * 电视剧：永远以播放器当前 SE 为准，禁止用缓存选择结果覆盖
 */
function resolveIdentity(params) {
  const p = params || {};
  const kind = classifyMediaKind(p);
  const movie = kind === "movie";
  const rawType = String(p.type || p.Type || p.mediaType || "").toLowerCase();

  // 电影：title；电视剧：seriesName 优先
  const title = String(
    movie
      ? firstPresent(p, ["title", "name", "seriesName", "keyword", "mediaName"]) || ""
      : firstPresent(p, [
          "seriesName",
          "SeriesName",
          "series_name",
          "title",
          "name",
          "keyword",
          "mediaName"
        ]) || ""
  ).trim();

  let tmdbId = null;
  const tmdbIdRaw = firstPresent(p, [
    "tmdbId",
    "tmdb_id",
    "TmdbId",
    "ProviderIds.Tmdb",
    "providerIds.Tmdb"
  ]);
  if (tmdbIdRaw != null && String(tmdbIdRaw).trim() !== "") {
    tmdbId = String(tmdbIdRaw).trim().replace(/^tmdb_/i, "");
  }

  const tvdbIdRaw = firstPresent(p, [
    "tvdbId",
    "tvdb_id",
    "TvdbId",
    "ProviderIds.Tvdb"
  ]);
  const tvdbId =
    tvdbIdRaw != null && String(tvdbIdRaw).trim() !== ""
      ? String(tvdbIdRaw).trim()
      : null;

  const imdbIdRaw = firstPresent(p, ["imdbId", "imdb_id", "ImdbId"]);
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

  // —— 电影路径：完全忽略 season/episode（含播放器 0/0 占位）——
  if (movie) {
    const animeIdRaw = p.animeId != null ? p.animeId : p.bangumiId;
    const fromAnime = parseAnimeId(animeIdRaw);
    const fromUnion = parseUnionOrMediaId(
      firstPresent(p, ["unionId", "union_id", "mediaId", "MediaId", "itemId"])
    );
    if (!tmdbId && fromAnime && fromAnime.tmdb_id) tmdbId = fromAnime.tmdb_id;
    if (!tmdbId && fromUnion && fromUnion.tmdb_id) tmdbId = fromUnion.tmdb_id;
    // 电影绝不能走剧集 SE 逻辑
    return {
      title: title,
      tmdb_id: tmdbId,
      imdb_id: imdbId,
      tvdb_id: tvdbId,
      year: year,
      season: null,
      episode: null,
      seasonSource: "movie_none",
      episodeSource: "movie_none",
      hasPlayerSeason: false,
      hasPlayerEpisode: false,
      rawSeasonEpisode: {
        note: "movie ignores season/episode placeholders",
        season_raw: p.season,
        episode_raw: p.episode,
        unionId: fromUnion && fromUnion.raw
      },
      type: "movie",
      mediaKind: "movie",
      isMovie: true,
      original_title:
        firstPresent(p, [
          "original_title",
          "originalTitle",
          "originalName",
          "OriginalTitle"
        ]) || null,
      region: firstPresent(p, ["region", "country", "Country"]) || null,
      version_key: null,
      animeId: animeIdRaw != null ? animeIdRaw : null,
      episodeId: null
    };
  }

  // —— 电视剧路径 ——
  const se = resolveSeasonEpisode(p, false);
  let season = se.season;
  let episode = se.episode;
  let seasonSource = se.seasonSource;
  let episodeSource = se.episodeSource;

  const animeIdRaw = p.animeId != null ? p.animeId : p.bangumiId;
  const fromAnime = parseAnimeId(animeIdRaw);
  let version_key =
    firstPresent(p, ["version_key", "versionKey", "version"]) || null;
  let region = firstPresent(p, ["region", "country", "Country"]) || null;

  // unionId 补 tmdb
  const fromUnion = parseUnionOrMediaId(
    firstPresent(p, ["unionId", "union_id", "mediaId", "MediaId", "itemId"])
  );
  if (!tmdbId && fromUnion && fromUnion.tmdb_id) tmdbId = fromUnion.tmdb_id;
  if (!tmdbId && fromAnime && fromAnime.tmdb_id) tmdbId = fromAnime.tmdb_id;

  // animeId：只补「播放器没给」的字段；绝不覆盖播放器 SE
  if (fromAnime && !fromAnime.isMovie) {
    if (!se.hasPlayerSeason && fromAnime.season != null) {
      season = fromAnime.season;
      seasonSource = "animeId";
    }
    if (!se.hasPlayerEpisode && fromAnime.episode != null) {
      episode = fromAnime.episode;
      episodeSource = "animeId";
    }
    if (fromAnime.version_key) {
      version_key = fromAnime.version_key;
      const vk = String(fromAnime.version_key).split(":");
      if (vk[0] && vk[0] !== "unk" && !region) region = vk[0];
    }
  }

  // 播放器明确给了 SE 时，强制使用（防止 animeId 旧集污染）
  if (se.hasPlayerSeason) {
    season = se.season;
    seasonSource = se.seasonSource;
  }
  if (se.hasPlayerEpisode) {
    episode = se.episode;
    episodeSource = se.episodeSource;
  }

  return {
    title: title,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    tvdb_id: tvdbId,
    year: year,
    season: season,
    episode: episode,
    seasonSource: seasonSource,
    episodeSource: episodeSource,
    hasPlayerSeason: se.hasPlayerSeason,
    hasPlayerEpisode: se.hasPlayerEpisode,
    rawSeasonEpisode: se.raw,
    type: kind === "episode" ? "episode" : rawType || "tv",
    mediaKind: kind === "episode" ? "episode" : "tv",
    isMovie: false,
    original_title:
      firstPresent(p, [
        "original_title",
        "originalTitle",
        "originalName",
        "OriginalTitle"
      ]) || null,
    region: region,
    version_key: version_key,
    animeId: animeIdRaw != null ? animeIdRaw : null,
    episodeId: firstPresent(p, ["episodeId", "commentId"]) || null
  };
}

/** 输入 SE vs 输出 SE 一致性检查；不一致必须报警 */
function assertEpisodeConsistent(inputIdentity, outputEpisode, tag) {
  const want = Number(inputIdentity && inputIdentity.episode);
  const got = Number(outputEpisode);
  if (!Number.isFinite(want) || want < 1) return true;
  if (!Number.isFinite(got) || got < 1) return true;
  if (want === got) return true;
  safeLog(true, "EPISODE_MISMATCH_ERROR", {
    tag: tag || "assert",
    input: formatSE(inputIdentity.season, want),
    output: formatSE(inputIdentity.season, got),
    title: inputIdentity.title,
    tmdb: inputIdentity.tmdb_id,
    message:
      "输入 " +
      formatSE(inputIdentity.season, want) +
      " 但输出 " +
      formatSE(inputIdentity.season, got) +
      " —— 禁止静默使用错误集"
  });
  return false;
}

function logMediaProbe(identity, phase) {
  safeLog(true, "MediaProbe." + (phase || "pre_api"), {
    MediaType: identity.isMovie ? "movie" : identity.mediaKind || "episode",
    Title: identity.title,
    Season: identity.isMovie ? null : identity.season,
    Episode: identity.isMovie ? null : identity.episode,
    SE: identity.isMovie ? null : formatSE(identity.season, identity.episode),
    TMDB: identity.tmdb_id,
    TVDB: identity.tvdb_id || null,
    seasonSource: identity.seasonSource,
    episodeSource: identity.episodeSource,
    hasPlayerEpisode: identity.hasPlayerEpisode,
    version_key: identity.version_key || null
  });
  if (
    !identity.isMovie &&
    (identity.episodeSource === "default_1_UNSAFE" ||
      identity.seasonSource === "default_1_UNSAFE")
  ) {
    safeLog(true, "WARN_DEFAULT_SE", {
      message: "播放器未提供可靠 season/episode，已不安全回落到 1",
      seasonSource: identity.seasonSource,
      episodeSource: identity.episodeSource,
      raw: identity.rawSeasonEpisode
    });
  }
}

function buildQuery(identity, cfg, extra) {
  const q = {};
  if (identity.tmdb_id) q.tmdb_id = identity.tmdb_id;
  if (identity.imdb_id) q.imdb_id = identity.imdb_id;
  if (identity.title) q.title = identity.title;
  if (identity.year) q.year = identity.year;
  if (identity.original_title) q.original_title = identity.original_title;
  if (identity.region) q.region = identity.region;
  // 电影 / 电视剧：type 必须正确；禁止共用匹配参数
  q.type = identity.isMovie ? "movie" : "tv";
  if (identity.isMovie) {
    // 电影：禁止下发 season/episode（服务端按电影唯一匹配）
  } else {
    // 电视剧：必须带当前季集
    q.season = String(Math.max(1, Number(identity.season) || 1));
    q.episode = String(Math.max(1, Number(identity.episode) || 1));
  }
  // 用户选择的版本（切换美版/英版时传入）
  if (identity.version_key) q.version_key = String(identity.version_key);
  q.color_to_white = cfg.colorToWhite ? "1" : "0";
  q.force_scroll = cfg.forceScroll ? "1" : "0";
  if (extra && extra.debug) q.debug = "1";
  if (extra && extra.force) q.force = "1";
  if (extra && extra.resolve_only) q.resolve_only = "1";
  return q;
}

/**
 * 本地展示标题
 * 电影：中文名 + 年份   →  007：大战皇家赌场 (2006)   禁止 S01E01
 * 电视剧：剧名 + 年份   →  无耻之徒 (2015)           SE 在详情列表，不拼进系列名
 * opts.withSE=true 时电视剧才附加当前 SxxExx（调试/当前集标签用）
 */
function buildLocalDisplay(identity, media, opts) {
  const o = opts || {};
  let title =
    (media && (media.title || media.display_title)) ||
    identity.title ||
    "未知";
  // 剥掉任何误带的 SxxExx / 版本噪声
  title = String(title)
    .replace(/\s*S\d{1,2}E\d{1,2}\s*$/i, "")
    .replace(/\s*S\d{1,2}\s*$/i, "")
    .trim();

  const year =
    (media && media.year) ||
    identity.year ||
    (media && media.season_year) ||
    null;

  if (identity.isMovie) {
    // 电影：禁止 season/episode/S01E01
    if (year) return title + " (" + year + ")";
    return title;
  }

  // 电视剧：剧名 + 年份；可选附加当前集
  let out = year ? title + " (" + year + ")" : title;
  if (o.withSE) {
    out = out + " " + formatSE(identity.season, identity.episode);
  }
  return out;
}

function logOutboundApi(cfg, identity, queryObj, tag, requestUrl) {
  safeLog(true, tag || "发送 Forward API", {
    type: identity.isMovie ? "movie" : "tv",
    mediaKind: identity.mediaKind || (identity.isMovie ? "movie" : "tv"),
    title: identity.title,
    tmdb: identity.tmdb_id,
    season: identity.season,
    episode: identity.episode,
    version_key: identity.version_key || null,
    region: identity.region || null,
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
 * - 电影：tmdb 固定
 * - 电视剧：tmdb + season + episode + version（禁止跨集/跨版本）
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
  const vk = identity.version_key || "auto";
  if (identity.tmdb_id) {
    return (
      "tv:tmdb:" +
      identity.tmdb_id +
      ":s" +
      identity.season +
      ":e" +
      identity.episode +
      ":v" +
      versionKeyToIdPart(vk)
    );
  }
  return (
    "tv:t:" +
    String(identity.title || "").toLowerCase() +
    ":s" +
    identity.season +
    ":e" +
    identity.episode +
    ":v" +
    versionKeyToIdPart(vk)
  );
}

/** 校验缓存条目是否属于当前 identity（电视剧不得跨集/跨版本） */
function cacheEntryMatches(identity, entry) {
  if (!entry || !entry._fusion_meta) return false;
  const m = entry._fusion_meta;
  if (identity.isMovie) {
    return m.isMovie === true;
  }
  if (m.isMovie) return false;
  return (
    Number(m.season) === Number(identity.season) &&
    Number(m.episode) === Number(identity.episode) &&
    String(m.tmdb_id || "") === String(identity.tmdb_id || "") &&
    String(m.version_key || "") === String(identity.version_key || "")
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
 * animeId：
 * - 电影：tmdb_{id}_movie（固定唯一）
 * - 电视剧：tmdb_{id}_tv_s{season}__{version}（季级，不含 episode）
 *   当前集只在 getDetail 列表与 getComments 请求里体现，禁止用 animeId 钉死集号
 */
function stableAnimeId(identity, versionKey) {
  if (identity.isMovie) {
    if (identity.tmdb_id) return "tmdb_" + identity.tmdb_id + "_movie";
    const raw =
      (identity.title || "m") + "|" + (identity.year || "") + "|movie";
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return "fusion_movie_" + h;
  }
  const s = Math.max(1, Number(identity.season) || 1);
  const vk = versionKeyToIdPart(versionKey || identity.version_key || "auto");
  if (identity.tmdb_id) {
    return "tmdb_" + identity.tmdb_id + "_tv_s" + s + "__" + vk;
  }
  const raw = (identity.title || "m") + "|" + (identity.year || "");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return "fusion_tv_" + h + "_s" + s + "__" + vk;
}

/** 本季分集数量：至少覆盖当前集，默认上限 TV_SEASON_LIST_MAX */
function resolveSeasonEpisodeCount(identity, media) {
  const cur = Math.max(1, Number(identity.episode) || 1);
  let n = 0;
  if (media) {
    const cands = [
      media.episode_count,
      media.episodeCount,
      media.season_episode_count,
      media.episodes_in_season
    ];
    for (let i = 0; i < cands.length; i++) {
      const v = Number(cands[i]);
      if (Number.isFinite(v) && v > n) n = Math.floor(v);
    }
  }
  n = Math.max(n, cur, 12);
  return Math.min(TV_SEASON_LIST_MAX, n);
}

// ---------------------------------------------------------------------------
// Forward 入口 —— 电影 / 电视剧分流
// ---------------------------------------------------------------------------

async function searchDanmu(params) {
  const cfg = resolveConfig(params);
  const identity = resolveIdentity(params);

  safeLog(true, "searchDanmu.raw_params", {
    type: params && (params.type || params.Type || params.mediaType),
    season: params && params.season,
    episode: params && params.episode,
    IndexNumber: params && params.IndexNumber,
    ParentIndexNumber: params && params.ParentIndexNumber,
    seriesName: params && params.seriesName,
    title: params && params.title,
    tmdbId: params && (params.tmdbId || params.tmdb_id),
    unionId: params && (params.unionId || params.union_id || params.mediaId),
    animeId: params && params.animeId
  });
  logMediaProbe(identity, "searchDanmu");

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { animes: [] };
  }

  // ========== 电影：固定唯一匹配（禁止 S01E01）==========
  if (identity.isMovie) {
    let media = null;
    try {
      const queryObj = buildQuery(identity, cfg, { debug: true, resolve_only: true });
      // 自检：电影 query 不得带 season/episode
      if (queryObj.season != null || queryObj.episode != null) {
        safeLog(true, "MOVIE_QUERY_HAS_SE_ERROR", queryObj);
        delete queryObj.season;
        delete queryObj.episode;
      }
      const url = forwardDanmakuUrl(cfg, queryObj);
      logOutboundApi(cfg, identity, queryObj, "发送 Forward API(movie resolve)", url);
      const raw = await httpGetRetry(
        url,
        Object.assign({}, cfg, { timeoutMs: Math.min(cfg.timeoutMs, 45000), retry: 0 }),
        "resolve.movie"
      );
      media = raw && raw.media ? raw.media : null;
    } catch (e) {
      safeLog(true, "resolve.movie.fail", String(e && e.message ? e.message : e));
    }
    const animeId = stableAnimeId(identity);
    // 中文名 + 年份，禁止任何 SxxExx
    let title = buildLocalDisplay(identity, media);
    if (/S\d{1,2}E\d{1,2}/i.test(title)) {
      safeLog(true, "MOVIE_DISPLAY_HAS_SE_ERROR", { title: title });
      title = title.replace(/\s*S\d{1,2}E\d{1,2}\s*/gi, " ").trim();
    }
    safeLog(true, "searchDanmu.movie.final", {
      MediaType: "movie",
      Title: title,
      TMDB: identity.tmdb_id,
      animeId: animeId,
      hasSE: /S\d{1,2}E\d{1,2}/i.test(title)
    });
    return {
      animes: [
        {
          animeId: animeId,
          bangumiId: String(animeId),
          animeTitle: title,
          type: "movie",
          typeDescription: "电影",
          imageUrl: "",
          startDate:
            (media && media.year) || identity.year
              ? String((media && media.year) || identity.year) + "-01-01"
              : "",
          episodeCount: 1,
          rating: 0,
          isFavorited: true
        }
      ]
    };
  }

  // ========== 电视剧：版本候选 + 本季全集（详情里展开） ==========
  // 展示：剧名 (年份)；当前集在详情列表默认选中
  const playerSE = formatSE(identity.season, identity.episode);
  let candidates = [];
  let selectedVersion = null;
  let media = null;
  try {
    const queryObj = buildQuery(identity, cfg, { debug: true, resolve_only: true });
    const url = forwardDanmakuUrl(cfg, queryObj);
    logOutboundApi(cfg, identity, queryObj, "发送 Forward API(tv resolve/candidates)", url);
    const raw = await httpGetRetry(
      url,
      Object.assign({}, cfg, { timeoutMs: Math.min(cfg.timeoutMs, 45000), retry: 0 }),
      "resolve.tv"
    );
    media = raw && raw.media ? raw.media : null;
    candidates = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
    selectedVersion = (raw && raw.selected_version) || null;

    // 校验：服务端返回的 episode 必须与输入一致
    if (media && media.episode != null) {
      if (!assertEpisodeConsistent(identity, media.episode, "search.resolve.media")) {
        // 强制用播放器 SE 覆盖展示，不采用错误 media.episode
        media = Object.assign({}, media, {
          episode: identity.episode,
          season: identity.season
        });
      }
    }
    safeLog(true, "resolve.candidates", {
      n: candidates.length,
      selected: selectedVersion,
      playerSE: playerSE,
      list: candidates.map(function (c) {
        return {
          version_key: c.version_key,
          display: c.display,
          episode: c.episode,
          score: c.score,
          is_default: c.is_default
        };
      })
    });
  } catch (e) {
    safeLog(true, "resolve.tv.fail", String(e && e.message ? e.message : e));
  }

  const epCount = resolveSeasonEpisodeCount(identity, media);
  const animes = [];

  if (candidates.length > 0) {
    candidates.sort(function (a, b) {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return (b.score || 0) - (a.score || 0);
    });
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] || {};
      // 候选若带错误 episode，报警并用播放器覆盖展示
      if (c.episode != null && Number(c.episode) !== Number(identity.episode)) {
        assertEpisodeConsistent(identity, c.episode, "search.candidate." + c.version_key);
      }
      const idPart = Object.assign({}, identity, {
        version_key: c.version_key,
        region: c.region || identity.region,
        year: c.year || identity.year
      });
      const animeId = stableAnimeId(idPart, c.version_key);
      // 剧名 + 年份（不拼 SxxExx；当前集在详情列表）
      const seriesTitle = buildLocalDisplay(
        Object.assign({}, idPart, { isMovie: false }),
        {
          title: c.title || identity.title,
          year: c.year || identity.year,
          region_label: c.region_label
        }
      );
      const mark = c.is_default || i === 0 ? "★ " : "▷ ";
      // 多版本时版本标签放描述，标题保持「剧名 (年)」
      const display = seriesTitle;
      safeLog(true, "searchDanmu.tv.candidate", {
        mark: mark.trim(),
        display: display,
        playerSE: playerSE,
        version_key: c.version_key,
        episodeCount: epCount
      });
      animes.push({
        animeId: animeId,
        bangumiId: String(animeId),
        animeTitle: mark + display,
        type: "tvseries",
        typeDescription:
          "当前 " +
          playerSE +
          " · 本季全集 · 版本 " +
          (c.region_label || c.region || "") +
          " " +
          (c.sources_preview || []).join("/"),
        imageUrl: "",
        startDate: c.year ? c.year + "-01-01" : identity.year ? identity.year + "-01-01" : "",
        episodeCount: epCount,
        rating: Number(c.score) || 0,
        isFavorited: Boolean(c.is_default)
      });
    }
  } else {
    const animeId = stableAnimeId(identity);
    const display = buildLocalDisplay(identity, null);
    safeLog(true, "searchDanmu.tv.fallback", {
      display: display,
      playerSE: playerSE,
      episodeCount: epCount
    });
    animes.push({
      animeId: animeId,
      bangumiId: String(animeId),
      animeTitle: "★ " + display,
      type: "tvseries",
      typeDescription: "当前 " + playerSE + " · 本季全集",
      imageUrl: "",
      startDate: identity.year ? identity.year + "-01-01" : "",
      episodeCount: epCount,
      rating: 0,
      isFavorited: true
    });
  }

  safeLog(true, "searchDanmu.tv.final", {
    MediaType: "episode",
    Title: animes[0] && animes[0].animeTitle,
    Season: identity.season,
    Episode: identity.episode,
    playerSE: playerSE,
    n: animes.length,
    episodeCount: epCount
  });
  return { animes: animes };
}

/**
 * 分集列表
 * 电影：1 条正片
 * 电视剧：返回本季全集，★ 标记当前播放集；默认应选中当前集
 */
async function getDetailById(params) {
  // 每次重新从播放器 params 解析 —— 禁止用本地缓存决定当前集
  const identity = resolveIdentity(params);
  logMediaProbe(identity, "getDetail");

  let animeId = stableAnimeId(identity);
  if (params && params.animeId != null) {
    const parsed = parseAnimeId(params.animeId);
    if (parsed && !parsed.legacy && identity.isMovie && parsed.isMovie) {
      animeId = String(params.animeId);
    } else if (
      parsed &&
      !parsed.legacy &&
      !identity.isMovie &&
      Number(parsed.season) === Number(identity.season)
    ) {
      // 同季：沿用用户选中的版本 animeId（含 version_key）
      animeId = String(params.animeId);
      if (parsed.version_key) identity.version_key = parsed.version_key;
    }
  }

  const baseId =
    (Number(String(animeId).replace(/\D/g, "").slice(-6) || "1") || 1) * 1000;
  const air = identity.year ? identity.year + "-01-01" : "";

  // ========== 电影 ==========
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

  // ========== 电视剧：本季全集 ==========
  const cur = Math.max(1, Number(identity.episode) || 1);
  const season = Math.max(1, Number(identity.season) || 1);
  const epCount = resolveSeasonEpisodeCount(identity, null);
  const list = [];
  for (let e = 1; e <= epCount; e++) {
    const se = formatSE(season, e);
    const isCur = e === cur;
    list.push({
      seasonId: "season-" + animeId,
      episodeId: baseId + e,
      episodeTitle: (isCur ? "★ " : "") + se + (isCur ? " 当前" : ""),
      episodeNumber: String(e),
      airDate: air
    });
  }

  safeLog(true, "getDetail.tv.list", {
    season: season,
    current: cur,
    currentSE: formatSE(season, cur),
    count: list.length,
    selectedTitle: list[cur - 1] && list[cur - 1].episodeTitle,
    animeId: animeId
  });

  // 自检：列表中当前集必须存在且 episodeNumber 正确
  const selected = list[cur - 1];
  if (!selected || Number(selected.episodeNumber) !== cur) {
    safeLog(true, "EPISODE_MISMATCH_ERROR", {
      tag: "getDetail.list",
      input: formatSE(season, cur),
      output: selected ? selected.episodeNumber : null
    });
  }

  return list;
}

async function getCommentsById(params) {
  const cfg = resolveConfig(params);
  // 每次重新读播放器 —— 切换剧集/下一集必须重新解析 SE
  const identity = resolveIdentity(params);

  safeLog(true, "getComments.raw_params", {
    type: params && (params.type || params.Type),
    season: params && params.season,
    episode: params && params.episode,
    IndexNumber: params && params.IndexNumber,
    ParentIndexNumber: params && params.ParentIndexNumber,
    episodeId: params && params.episodeId,
    commentId: params && params.commentId,
    episodeNumber: params && params.episodeNumber,
    animeId: params && params.animeId,
    unionId: params && (params.unionId || params.union_id || params.mediaId),
    tmdbId: params && (params.tmdbId || params.tmdb_id)
  });
  logMediaProbe(identity, "getComments");

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { count: 0, comments: [] };
  }

  // 电视剧：必须有 SE；若仍是不安全 default，尽量用 episodeId 再解一次
  if (!identity.isMovie) {
    if (!(Number(identity.season) >= 1) || !(Number(identity.episode) >= 1)) {
      safeLog(true, "getComments.reject", "tv missing season/episode");
      return { count: 0, comments: [] };
    }
    // 若播放器通过 episodeId 选中列表项，而 params.episode 缺失，decode 已在 resolve 中处理
    // 若 episodeId 与 player episode 不一致：播放器 SE 优先，但记录
    if (params && params.episodeId != null && identity.hasPlayerEpisode) {
      const decoded = decodeEpisodeFromSyntheticId(
        params.episodeId,
        params.animeId || identity.animeId
      );
      if (decoded != null && Number(decoded) !== Number(identity.episode)) {
        safeLog(true, "getComments.episodeId_vs_player", {
          player: identity.episode,
          episodeId: decoded,
          keep: "player"
        });
      }
    }
  }

  // 缓存：只缓存弹幕数据，key 含 s+e+version；不缓存「选择结果」
  const ck = cacheKey(identity);
  if (cfg.cacheEnabled) {
    const hit = cacheGet(ck);
    if (hit && hit.comments && hit.comments.length && cacheEntryMatches(identity, hit)) {
      safeLog(true, "module_cache_hit_danmaku_only", {
        key: ck,
        count: hit.count,
        SE: formatSE(identity.season, identity.episode)
      });
      // 命中弹幕缓存时仍校验 meta.episode
      if (!identity.isMovie && hit._fusion_meta) {
        if (!assertEpisodeConsistent(identity, hit._fusion_meta.episode, "cache.meta")) {
          safeLog(true, "module_cache_discard_wrong_ep", hit._fusion_meta);
        } else {
          return hit;
        }
      } else {
        return hit;
      }
    }
  }

  const queryObj = buildQuery(identity, cfg, { debug: true });
  const url = forwardDanmakuUrl(cfg, queryObj);
  logOutboundApi(cfg, identity, queryObj, "发送 Forward API(danmaku)", url);
  safeLog(true, "getComments.request", {
    MediaType: identity.isMovie ? "movie" : "episode",
    Title: identity.title,
    Season: identity.season,
    Episode: identity.episode,
    TMDB: identity.tmdb_id,
    SE: formatSE(identity.season, identity.episode)
  });

  try {
    const raw = await httpGetRetry(url, cfg, "forward.danmaku");
    const adapted = adaptComments(raw);

    // 校验返回集数
    const retEp =
      raw && raw.media && raw.media.episode != null
        ? Number(raw.media.episode)
        : null;
    if (!identity.isMovie && retEp != null) {
      if (!assertEpisodeConsistent(identity, retEp, "getComments.api.media")) {
        // 硬错误：拒绝用错误集的弹幕
        safeLog(true, "getComments.reject_wrong_episode", {
          input: formatSE(identity.season, identity.episode),
          api: formatSE(identity.season, retEp)
        });
        return { count: 0, comments: [], error: "episode_mismatch" };
      }
    }

    safeLog(true, "getComments.result", {
      Candidate: retEp != null ? formatSE(identity.season, retEp) : formatSE(identity.season, identity.episode),
      Final: formatSE(identity.season, identity.episode),
      count: adapted.count
    });

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

    // 只缓存弹幕，meta 绑定 SE
    if (cfg.cacheEnabled && adapted.count > 0) {
      adapted._fusion_meta = {
        isMovie: !!identity.isMovie,
        tmdb_id: identity.tmdb_id || null,
        season: identity.season,
        episode: identity.episode,
        version_key: identity.version_key || null,
        title: identity.title || null
      };
      cacheSet(ck, adapted);
    }
    return adapted;
  } catch (e) {
    safeLog(true, "getComments.error", String(e && e.message ? e.message : e));
    return { count: 0, comments: [] };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WidgetMetadata: typeof WidgetMetadata !== "undefined" ? WidgetMetadata : null,
    searchDanmu: searchDanmu,
    getDetailById: getDetailById,
    getCommentsById: getCommentsById,
    _test: {
      classifyMediaKind: classifyMediaKind,
      stableAnimeId: stableAnimeId,
      parseAnimeId: parseAnimeId,
      parseUnionOrMediaId: parseUnionOrMediaId,
      resolveIdentity: resolveIdentity,
      resolveSeasonEpisode: resolveSeasonEpisode,
      cacheKey: cacheKey,
      buildQuery: buildQuery,
      buildLocalDisplay: buildLocalDisplay,
      versionKeyToIdPart: versionKeyToIdPart,
      formatSE: formatSE,
      resolveSeasonEpisodeCount: resolveSeasonEpisodeCount,
      assertEpisodeConsistent: assertEpisodeConsistent
    }
  };
}

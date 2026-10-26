/**
 * Danmu Fusion · 弹幕融合
 * Forward 专用弹幕聚合播放模块
 *
 * 版本：1.5.2
 *
 * 架构（电影 / 电视剧完全分离）：
 *
 *  优先采用播放器 unionId = {tmdb_id}_{type}_{season}_{episode}
 *    36557_movie_0_0  → movie（忽略 0/0，禁止 S01E01）
 *    34307_tv_5_3     → tv（使用 season/episode）
 *
 *  电影：标题/年份/类型保守匹配，不混入电视剧季集
 *  电视剧：标题/年份/类型/季集保守确认，支持真实资源手动选择
 *
 *  协议：统一使用弹弹 Play 兼容接口，扩展自动降级
 *  缓存：按 API、作品、季集隔离并自动过期
 */

var WidgetMetadata = {
  id: "tzb360.danmu.fusion",
  title: "Danmu Fusion",
  version: "1.5.2",
  requiredVersion: "0.0.2",
  description:
    "支持 1～3 个弹幕 API，独立选源与安全聚合，保留服务端原生聚合。",
  author: "tzb360",
  site: "https://github.com/tzb360/danmu-fusion",
  website: "https://github.com/tzb360/danmu-fusion",
  globalParams: [
    {
      name: "danmu_api_url",
      title: "弹幕 API 1（主要接口）",
      type: "input",
      placeholders: [{ title: "示例", value: "https://example.com/your-token" }]
    }
    ,{ name: "danmu_api_url_2", title: "弹幕 API 2（可选）", type: "input", placeholders: [{ title: "可留空", value: "" }] },
    { name: "danmu_api_url_3", title: "弹幕 API 3（可选）", type: "input", placeholders: [{ title: "可留空", value: "" }] }
  ],
  modules: [
    { id: "getDanmuWithSegmentTime", title: "获取指定时刻弹幕", functionName: "getDanmuWithSegmentTime", type: "danmu", cacheDuration: 0, params: [] },
    {
      id: "searchDanmu",
      title: "搜索弹幕",
      functionName: "searchDanmu",
      type: "danmu",
      cacheDuration: 0,
      params: []
    },
    {
      id: "getDetail",
      title: "获取详情",
      functionName: "getDetailById",
      type: "danmu",
      cacheDuration: 0,
      params: []
    },
    {
      id: "getComments",
      title: "获取弹幕",
      functionName: "getCommentsById",
      type: "danmu",
      cacheDuration: 0,
      params: []
    }
  ]
};

// ---------------------------------------------------------------------------
const FUSION_UA = "DanmuFusion/1.5.2 (tzb360; Forward)";
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
 *   http://host:9321/TOKEN/api/v2
 */
function parseDanmuApiUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("请填写弹幕 API 地址");
  if (!/^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?(?:[?#].*)?$/i.test(raw) || /^https?:\/\/[^/]*@/i.test(raw) || /[\\\u0000-\u001f]/.test(raw)) {
    throw new Error("弹幕 API 地址须为有效的 HTTP(S) URL");
  }
  const parts=raw.split('#');
  if(parts.length>1)throw new Error("API 地址不能包含 fragment");
  const queryIndex=raw.indexOf('?');
  let query=queryIndex<0?'':raw.slice(queryIndex+1);
  raw=stripSlash(queryIndex<0?raw:raw.slice(0,queryIndex));
  const legacy=/\/api\/(?:v2\/)?forward(?:\/danmaku)?$/i.test(raw);
  // Only known legacy media query fields are obsolete. Authentication query
  // bytes, path case and percent escapes must survive exactly as supplied.
  if(legacy)query=query.split('&').filter(v=>! /^(?:title|keyword|type|year|season|episode|tmdb_id|tmdbId|unionId|debug|force)=/i.test(v)).join('&');
  raw=raw.replace(/\/api\/(?:v2\/)?forward(?:\/danmaku)?$/i, "").replace(/\/api\/v2$/i, "");
  raw=raw.replace(/^(https?):\/\/([^/]+)/i,function(_,scheme,authority){
    scheme=scheme.toLowerCase();authority=authority.toLowerCase();
    authority=authority.replace(scheme==='https'?/:443$/:/:80$/,'');
    return scheme+'://'+authority;
  });
  return { requestBase:raw, query:query, display:"[API 地址已隐藏]" };
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
    t = t.replace(/https?:\/\/[^\s"'<>]+/gi, "[API URL]");
    console.log("[DanmuFusion][" + tag + "] " + t);
  } catch (e) {
    console.log("[DanmuFusion][" + tag + "] <log-error>");
  }
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
 *   1) unionId（如 34307_tv_5_3，唯一权威）
 *   2) 显式 episode / season 字段（仅无 unionId 时）
 *   3) IndexNumber / ParentIndexNumber（仅无 unionId 时）
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

  const unionRaw = firstPresent(p, [
    "unionId", "union_id", "mediaId", "MediaId", "itemId", "ItemId"
  ]);
  const fromUnion = parseUnionOrMediaId(unionRaw);
  if (fromUnion && !fromUnion.isMovie && fromUnion.season > 0 && fromUnion.episode > 0) {
    return {
      season: fromUnion.season,
      episode: fromUnion.episode,
      seasonSource: "unionId",
      episodeSource: "unionId",
      hasPlayerSeason: true,
      hasPlayerEpisode: true,
      raw: rawSnap
    };
  }

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
  // unionId 缺失或无合法季集时，才允许兼容旧播放器字段。
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
      safeLog(false, "unionId_episode_diff_keep_player", {
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

function headers() {
  return { "Content-Type":"application/json", Accept:"application/json", "User-Agent":FUSION_UA };
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
  const positions = { normal: 0, top: 0, bottom: 0, final: clean.length };
  for (const c of clean) {
    const mode = String(c.p || "").split(",")[1];
    if (mode === "5") positions.top += 1;
    else if (mode === "4") positions.bottom += 1;
    else positions.normal += 1;
  }
  // 诊断与播放器共享同一份已解析队列，不能用服务端原始/XML 中间统计替代。
  return {
    count: clean.length,
    comments: clean,
    finalDanmuStats: positions,
    trace_id: payload && payload.meta ? payload.meta.trace_id || null : null,
    providerStats: payload && payload.meta && payload.meta.providerStats ? payload.meta.providerStats : null,
    danmuStats: payload && payload.meta && payload.meta.danmuStats
      ? Object.assign({}, payload.meta.danmuStats, {
          forwardParsedCount: clean.length,
          finalQueueCount: clean.length,
          normalCount: positions.normal,
          topCount: positions.top,
          bottomCount: positions.bottom
        })
      : null
  };
}

/** 调试：打印每个来源明细（不进播放器 UI） */
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

/** 本季分集数量：至少覆盖当前集，默认上限 2000 */
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
  n = Math.max(n, cur);
  return Math.max(cur, Math.min(2000, n));
}

async function searchDanmu(params = {}) {
  return fusionMultiSearch(params);
}

async function getDetailById(params = {}) {
  return fusionMultiDetail(params);
}

async function getCommentsById(params = {}) { return fusionMultiComments(params,false); }

// BEGIN GENERATED FUSION ENGINE
// =====================
// 中文繁简转化
// =====================

function charPYStr(){
    return '锕皑蔼碍爱嗳嫒瑷暧霭谙铵鹌肮袄奥媪骜鳌坝罢钯摆败呗颁办绊钣帮绑镑谤剥饱宝报鲍鸨龅辈贝钡狈备惫鹎贲锛绷笔毕毙币闭荜哔滗铋筚跸边编贬变辩辫苄缏笾标骠飑飙镖镳鳔鳖别瘪濒滨宾摈傧缤槟殡膑镔髌鬓饼禀拨钵铂驳饽钹鹁补钸财参蚕残惭惨灿骖黪苍舱仓沧厕侧册测恻层诧锸侪钗搀掺蝉馋谗缠铲产阐颤冁谄谶蒇忏婵骣觇禅镡场尝长偿肠厂畅伥苌怅阊鲳钞车彻砗尘陈衬伧谌榇碜龀撑称惩诚骋枨柽铖铛痴迟驰耻齿炽饬鸱冲冲虫宠铳畴踌筹绸俦帱雠橱厨锄雏础储触处刍绌蹰传钏疮闯创怆锤缍纯鹑绰辍龊辞词赐鹚聪葱囱从丛苁骢枞凑辏蹿窜撺错锉鹾达哒鞑带贷骀绐担单郸掸胆惮诞弹殚赕瘅箪当挡党荡档谠砀裆捣岛祷导盗焘灯邓镫敌涤递缔籴诋谛绨觌镝颠点垫电巅钿癫钓调铫鲷谍叠鲽钉顶锭订铤丢铥东动栋冻岽鸫窦犊独读赌镀渎椟牍笃黩锻断缎簖兑队对怼镦吨顿钝炖趸夺堕铎鹅额讹恶饿谔垩阏轭锇锷鹗颚颛鳄诶儿尔饵贰迩铒鸸鲕发罚阀珐矾钒烦贩饭访纺钫鲂飞诽废费绯镄鲱纷坟奋愤粪偾丰枫锋风疯冯缝讽凤沣肤辐抚辅赋复负讣妇缚凫驸绂绋赙麸鲋鳆钆该钙盖赅杆赶秆赣尴擀绀冈刚钢纲岗戆镐睾诰缟锆搁鸽阁铬个纥镉颍给亘赓绠鲠龚宫巩贡钩沟苟构购够诟缑觏蛊顾诂毂钴锢鸪鹄鹘剐挂鸹掴关观馆惯贯诖掼鹳鳏广犷规归龟闺轨诡贵刽匦刿妫桧鲑鳜辊滚衮绲鲧锅国过埚呙帼椁蝈铪骇韩汉阚绗颉号灏颢阂鹤贺诃阖蛎横轰鸿红黉讧荭闳鲎壶护沪户浒鹕哗华画划话骅桦铧怀坏欢环还缓换唤痪焕涣奂缳锾鲩黄谎鳇挥辉毁贿秽会烩汇讳诲绘诙荟哕浍缋珲晖荤浑诨馄阍获货祸钬镬击机积饥迹讥鸡绩缉极辑级挤几蓟剂济计记际继纪讦诘荠叽哜骥玑觊齑矶羁虿跻霁鲚鲫夹荚颊贾钾价驾郏浃铗镓蛲歼监坚笺间艰缄茧检碱硷拣捡简俭减荐槛鉴践贱见键舰剑饯渐溅涧谏缣戋戬睑鹣笕鲣鞯将浆蒋桨奖讲酱绛缰胶浇骄娇搅铰矫侥脚饺缴绞轿较挢峤鹪鲛阶节洁结诫届疖颌鲒紧锦仅谨进晋烬尽劲荆茎卺荩馑缙赆觐鲸惊经颈静镜径痉竞净刭泾迳弪胫靓纠厩旧阄鸠鹫驹举据锯惧剧讵屦榉飓钜锔窭龃鹃绢锩镌隽觉决绝谲珏钧军骏皲开凯剀垲忾恺铠锴龛闶钪铐颗壳课骒缂轲钶锞颔垦恳龈铿抠库裤喾块侩郐哙脍宽狯髋矿旷况诓诳邝圹纩贶亏岿窥馈溃匮蒉愦聩篑阃锟鲲扩阔蛴蜡腊莱来赖崃徕涞濑赉睐铼癞籁蓝栏拦篮阑兰澜谰揽览懒缆烂滥岚榄斓镧褴琅阆锒捞劳涝唠崂铑铹痨乐鳓镭垒类泪诔缧篱狸离鲤礼丽厉励砾历沥隶俪郦坜苈莅蓠呖逦骊缡枥栎轹砺锂鹂疠粝跞雳鲡鳢俩联莲连镰怜涟帘敛脸链恋炼练蔹奁潋琏殓裢裣鲢粮凉两辆谅魉疗辽镣缭钌鹩猎临邻鳞凛赁蔺廪檩辚躏龄铃灵岭领绫棂蛏鲮馏刘浏骝绺镏鹨龙聋咙笼垄拢陇茏泷珑栊胧砻楼娄搂篓偻蒌喽嵝镂瘘耧蝼髅芦卢颅庐炉掳卤虏鲁赂禄录陆垆撸噜闾泸渌栌橹轳辂辘氇胪鸬鹭舻鲈峦挛孪滦乱脔娈栾鸾銮抡轮伦仑沦纶论囵萝罗逻锣箩骡骆络荦猡泺椤脶镙驴吕铝侣屡缕虑滤绿榈褛锊呒妈玛码蚂马骂吗唛嬷杩买麦卖迈脉劢瞒馒蛮满谩缦镘颡鳗猫锚铆贸么没镁门闷们扪焖懑钔锰梦眯谜弥觅幂芈谧猕祢绵缅渑腼黾庙缈缪灭悯闽闵缗鸣铭谬谟蓦馍殁镆谋亩钼呐钠纳难挠脑恼闹铙讷馁内拟腻铌鲵撵辇鲶酿鸟茑袅聂啮镊镍陧蘖嗫颟蹑柠狞宁拧泞苎咛聍钮纽脓浓农侬哝驽钕诺傩疟欧鸥殴呕沤讴怄瓯盘蹒庞抛疱赔辔喷鹏纰罴铍骗谝骈飘缥频贫嫔苹凭评泼颇钋扑铺朴谱镤镨栖脐齐骑岂启气弃讫蕲骐绮桤碛颀颃鳍牵钎铅迁签谦钱钳潜浅谴堑佥荨悭骞缱椠钤枪呛墙蔷强抢嫱樯戗炝锖锵镪羟跄锹桥乔侨翘窍诮谯荞缲硗跷窃惬锲箧钦亲寝锓轻氢倾顷请庆揿鲭琼穷茕蛱巯赇虮鳅趋区躯驱龋诎岖阒觑鸲颧权劝诠绻辁铨却鹊确阕阙悫让饶扰绕荛娆桡热韧认纫饪轫荣绒嵘蝾缛铷颦软锐蚬闰润洒萨飒鳃赛伞毵糁丧骚扫缫涩啬铯穑杀刹纱铩鲨筛晒酾删闪陕赡缮讪姗骟钐鳝墒伤赏垧殇觞烧绍赊摄慑设厍滠畲绅审婶肾渗诜谂渖声绳胜师狮湿诗时蚀实识驶势适释饰视试谥埘莳弑轼贳铈鲥寿兽绶枢输书赎属术树竖数摅纾帅闩双谁税顺说硕烁铄丝饲厮驷缌锶鸶耸怂颂讼诵擞薮馊飕锼苏诉肃谡稣虽随绥岁谇孙损笋荪狲缩琐锁唢睃獭挞闼铊鳎台态钛鲐摊贪瘫滩坛谭谈叹昙钽锬顸汤烫傥饧铴镗涛绦讨韬铽腾誊锑题体屉缇鹈阗条粜龆鲦贴铁厅听烃铜统恸头钭秃图钍团抟颓蜕饨脱鸵驮驼椭箨鼍袜娲腽弯湾顽万纨绾网辋韦违围为潍维苇伟伪纬谓卫诿帏闱沩涠玮韪炜鲔温闻纹稳问阌瓮挝蜗涡窝卧莴龌呜钨乌诬无芜吴坞雾务误邬庑怃妩骛鹉鹜锡牺袭习铣戏细饩阋玺觋虾辖峡侠狭厦吓硖鲜纤贤衔闲显险现献县馅羡宪线苋莶藓岘猃娴鹇痫蚝籼跹厢镶乡详响项芗饷骧缃飨萧嚣销晓啸哓潇骁绡枭箫协挟携胁谐写泻谢亵撷绁缬锌衅兴陉荥凶汹锈绣馐鸺虚嘘须许叙绪续诩顼轩悬选癣绚谖铉镟学谑泶鳕勋询寻驯训讯逊埙浔鲟压鸦鸭哑亚讶垭娅桠氩阉烟盐严岩颜阎艳厌砚彦谚验厣赝俨兖谳恹闫酽魇餍鼹鸯杨扬疡阳痒养样炀瑶摇尧遥窑谣药轺鹞鳐爷页业叶靥谒邺晔烨医铱颐遗仪蚁艺亿忆义诣议谊译异绎诒呓峄饴怿驿缢轶贻钇镒镱瘗舣荫阴银饮隐铟瘾樱婴鹰应缨莹萤营荧蝇赢颖茔莺萦蓥撄嘤滢潆璎鹦瘿颏罂哟拥佣痈踊咏镛优忧邮铀犹诱莸铕鱿舆鱼渔娱与屿语狱誉预驭伛俣谀谕蓣嵛饫阈妪纡觎欤钰鹆鹬龉鸳渊辕园员圆缘远橼鸢鼋约跃钥粤悦阅钺郧匀陨运蕴酝晕韵郓芸恽愠纭韫殒氲杂灾载攒暂赞瓒趱錾赃脏驵凿枣责择则泽赜啧帻箦贼谮赠综缯轧铡闸栅诈斋债毡盏斩辗崭栈战绽谵张涨帐账胀赵诏钊蛰辙锗这谪辄鹧贞针侦诊镇阵浈缜桢轸赈祯鸩挣睁狰争帧症郑证诤峥钲铮筝织职执纸挚掷帜质滞骘栉栀轵轾贽鸷蛳絷踬踯觯钟终种肿众锺诌轴皱昼骤纣绉猪诸诛烛瞩嘱贮铸驻伫槠铢专砖转赚啭馔颞桩庄装妆壮状锥赘坠缀骓缒谆准着浊诼镯兹资渍谘缁辎赀眦锱龇鲻踪总纵偬邹诹驺鲰诅组镞钻缵躜鳟翱并卜沉丑淀迭斗范干皋硅柜后伙秸杰诀夸里里凌么霉捻凄扦圣尸抬涂洼喂污锨咸蝎彝涌游吁御愿岳云灶扎札筑于志注凋讠谫郄勐凼坂垅垴埯埝苘荬荮莜莼菰藁揸吒吣咔咝咴噘噼嚯幞岙嵴彷徼犸狍馀馇馓馕愣憷懔丬溆滟溷漤潴澹甯纟绔绱珉枧桊桉槔橥轱轷赍肷胨飚煳煅熘愍淼砜磙眍钚钷铘铞锃锍锎锏锘锝锪锫锿镅镎镢镥镩镲稆鹋鹛鹱疬疴痖癯裥襁耢颥螨麴鲅鲆鲇鲞鲴鲺鲼鳊鳋鳘鳙鞒鞴齄丬为亸众伪余冢净凌凼刬勋勐勚卤叆叇启咔咤咴哌哗唝唡唣唿啮啰啴呵噼嚯垅垧垯垱埙埝塆墙壸妫姜娴婳屃岽峃峣崄嵚嵛嵴庼彟御愍慭憷扎扦挜挦捻揸旸昽札桊梼梾棂槚檐污沓沨沩沵浉浐浕涌涢湿溇滪漤煅煳熘牦犟狍狝猬玙玚玱珉珏珰琎璇畲疴瘆瘘癯眬着硁硅硙硚硷碹磙祎秾筜签箓糇纟纮纴纻纼绖绤绦绬绱绹缊缐缞缰翙翚肷脏腌腘腭臜艳艹荙莜莼萚藁虬螀蟏袅袆袯裈裥襁襕觃觍詟讱讻诇诐诪谞谥谷豮贠赍赑赒赗赟赪跖跶踊轪辀辌辒郁郄酦鉅鉴钎钑钖钘钵钻铏铚铦铻锈锏锜锠锨锳锽镃镈镕镚镠镢镮镴闬闲闿阇阓阘阛陕鞴韨颋颎颒颕颙颣飏飐飔飖飗饤饥饦饳饸饹饻饾馂馃馉馌馎驲骃骉骍骎骔骕骙骦鱽鱾鲀鲄鲉鲊鲌鲏鲓鲖鲗鲘鲙鲝鲪鲬鲯鲹鲾鲿鳀鳁鳂鳈鳉鳑鳒鳛鳠鳡鳣鸤鸧鸮鸰鸴鸻鸼鹀鹇鹍鹐鹒鹓鹔鹖鹝鹟鹠鹡鹢鹥鹯鹲鹴黡鼌鼗龁龂志制咨只系松尝面干拼恶赞发僵致奸获练回系迹只辟板你';
}
function ftPYStr(){
    return '錒皚藹礙愛噯嬡璦曖靄諳銨鵪骯襖奧媼驁鰲壩罷鈀擺敗唄頒辦絆鈑幫綁鎊謗剝飽寶報鮑鴇齙輩貝鋇狽備憊鵯賁錛繃筆畢斃幣閉蓽嗶潷鉍篳蹕邊編貶變辯辮芐緶籩標驃颮飆鏢鑣鰾鱉別癟瀕濱賓擯儐繽檳殯臏鑌髕鬢餅稟撥缽鉑駁餑鈸鵓補鈽財參蠶殘慚慘燦驂黲蒼艙倉滄廁側冊測惻層詫鍤儕釵攙摻蟬饞讒纏鏟產闡顫囅諂讖蕆懺嬋驏覘禪鐔場嘗長償腸廠暢倀萇悵閶鯧鈔車徹硨塵陳襯傖諶櫬磣齔撐稱懲誠騁棖檉鋮鐺癡遲馳恥齒熾飭鴟沖衝蟲寵銃疇躊籌綢儔幬讎櫥廚鋤雛礎儲觸處芻絀躕傳釧瘡闖創愴錘綞純鶉綽輟齪辭詞賜鶿聰蔥囪從叢蓯驄樅湊輳躥竄攛錯銼鹺達噠韃帶貸駘紿擔單鄲撣膽憚誕彈殫賧癉簞當擋黨蕩檔讜碭襠搗島禱導盜燾燈鄧鐙敵滌遞締糴詆諦綈覿鏑顛點墊電巔鈿癲釣調銚鯛諜疊鰈釘頂錠訂鋌丟銩東動棟凍崠鶇竇犢獨讀賭鍍瀆櫝牘篤黷鍛斷緞籪兌隊對懟鐓噸頓鈍燉躉奪墮鐸鵝額訛惡餓諤堊閼軛鋨鍔鶚顎顓鱷誒兒爾餌貳邇鉺鴯鮞發罰閥琺礬釩煩販飯訪紡鈁魴飛誹廢費緋鐨鯡紛墳奮憤糞僨豐楓鋒風瘋馮縫諷鳳灃膚輻撫輔賦復負訃婦縛鳧駙紱紼賻麩鮒鰒釓該鈣蓋賅桿趕稈贛尷搟紺岡剛鋼綱崗戇鎬睪誥縞鋯擱鴿閣鉻個紇鎘潁給亙賡綆鯁龔宮鞏貢鉤溝茍構購夠詬緱覯蠱顧詁轂鈷錮鴣鵠鶻剮掛鴰摑關觀館慣貫詿摜鸛鰥廣獷規歸龜閨軌詭貴劊匭劌媯檜鮭鱖輥滾袞緄鯀鍋國過堝咼幗槨蟈鉿駭韓漢闞絎頡號灝顥閡鶴賀訶闔蠣橫轟鴻紅黌訌葒閎鱟壺護滬戶滸鶘嘩華畫劃話驊樺鏵懷壞歡環還緩換喚瘓煥渙奐繯鍰鯇黃謊鰉揮輝毀賄穢會燴匯諱誨繪詼薈噦澮繢琿暉葷渾諢餛閽獲貨禍鈥鑊擊機積饑跡譏雞績緝極輯級擠幾薊劑濟計記際繼紀訐詰薺嘰嚌驥璣覬齏磯羈蠆躋霽鱭鯽夾莢頰賈鉀價駕郟浹鋏鎵蟯殲監堅箋間艱緘繭檢堿鹼揀撿簡儉減薦檻鑒踐賤見鍵艦劍餞漸濺澗諫縑戔戩瞼鶼筧鰹韉將漿蔣槳獎講醬絳韁膠澆驕嬌攪鉸矯僥腳餃繳絞轎較撟嶠鷦鮫階節潔結誡屆癤頜鮚緊錦僅謹進晉燼盡勁荊莖巹藎饉縉贐覲鯨驚經頸靜鏡徑痙競凈剄涇逕弳脛靚糾廄舊鬮鳩鷲駒舉據鋸懼劇詎屨櫸颶鉅鋦窶齟鵑絹錈鐫雋覺決絕譎玨鈞軍駿皸開凱剴塏愾愷鎧鍇龕閌鈧銬顆殼課騍緙軻鈳錁頷墾懇齦鏗摳庫褲嚳塊儈鄶噲膾寬獪髖礦曠況誆誑鄺壙纊貺虧巋窺饋潰匱蕢憒聵簣閫錕鯤擴闊蠐蠟臘萊來賴崍徠淶瀨賚睞錸癩籟藍欄攔籃闌蘭瀾讕攬覽懶纜爛濫嵐欖斕鑭襤瑯閬鋃撈勞澇嘮嶗銠鐒癆樂鰳鐳壘類淚誄縲籬貍離鯉禮麗厲勵礫歷瀝隸儷酈壢藶蒞蘺嚦邐驪縭櫪櫟轢礪鋰鸝癘糲躒靂鱺鱧倆聯蓮連鐮憐漣簾斂臉鏈戀煉練蘞奩瀲璉殮褳襝鰱糧涼兩輛諒魎療遼鐐繚釕鷯獵臨鄰鱗凜賃藺廩檁轔躪齡鈴靈嶺領綾欞蟶鯪餾劉瀏騮綹鎦鷚龍聾嚨籠壟攏隴蘢瀧瓏櫳朧礱樓婁摟簍僂蔞嘍嶁鏤瘺耬螻髏蘆盧顱廬爐擄鹵虜魯賂祿錄陸壚擼嚕閭瀘淥櫨櫓轤輅轆氌臚鸕鷺艫鱸巒攣孿灤亂臠孌欒鸞鑾掄輪倫侖淪綸論圇蘿羅邏鑼籮騾駱絡犖玀濼欏腡鏍驢呂鋁侶屢縷慮濾綠櫚褸鋝嘸媽瑪碼螞馬罵嗎嘜嬤榪買麥賣邁脈勱瞞饅蠻滿謾縵鏝顙鰻貓錨鉚貿麼沒鎂門悶們捫燜懣鍆錳夢瞇謎彌覓冪羋謐獼禰綿緬澠靦黽廟緲繆滅憫閩閔緡鳴銘謬謨驀饃歿鏌謀畝鉬吶鈉納難撓腦惱鬧鐃訥餒內擬膩鈮鯢攆輦鯰釀鳥蔦裊聶嚙鑷鎳隉蘗囁顢躡檸獰寧擰濘苧嚀聹鈕紐膿濃農儂噥駑釹諾儺瘧歐鷗毆嘔漚謳慪甌盤蹣龐拋皰賠轡噴鵬紕羆鈹騙諞駢飄縹頻貧嬪蘋憑評潑頗釙撲鋪樸譜鏷鐠棲臍齊騎豈啟氣棄訖蘄騏綺榿磧頎頏鰭牽釬鉛遷簽謙錢鉗潛淺譴塹僉蕁慳騫繾槧鈐槍嗆墻薔強搶嬙檣戧熗錆鏘鏹羥蹌鍬橋喬僑翹竅誚譙蕎繰磽蹺竊愜鍥篋欽親寢鋟輕氫傾頃請慶撳鯖瓊窮煢蛺巰賕蟣鰍趨區軀驅齲詘嶇闃覷鴝顴權勸詮綣輇銓卻鵲確闋闕愨讓饒擾繞蕘嬈橈熱韌認紉飪軔榮絨嶸蠑縟銣顰軟銳蜆閏潤灑薩颯鰓賽傘毿糝喪騷掃繅澀嗇銫穡殺剎紗鎩鯊篩曬釃刪閃陜贍繕訕姍騸釤鱔墑傷賞坰殤觴燒紹賒攝懾設厙灄畬紳審嬸腎滲詵諗瀋聲繩勝師獅濕詩時蝕實識駛勢適釋飾視試謚塒蒔弒軾貰鈰鰣壽獸綬樞輸書贖屬術樹豎數攄紓帥閂雙誰稅順說碩爍鑠絲飼廝駟緦鍶鷥聳慫頌訟誦擻藪餿颼鎪蘇訴肅謖穌雖隨綏歲誶孫損筍蓀猻縮瑣鎖嗩脧獺撻闥鉈鰨臺態鈦鮐攤貪癱灘壇譚談嘆曇鉭錟頇湯燙儻餳鐋鏜濤絳討韜鋱騰謄銻題體屜緹鵜闐條糶齠鰷貼鐵廳聽烴銅統慟頭鈄禿圖釷團摶頹蛻飩脫鴕馱駝橢籜鼉襪媧膃彎灣頑萬紈綰網輞韋違圍為濰維葦偉偽緯謂衛諉幃闈溈潿瑋韙煒鮪溫聞紋穩問閿甕撾蝸渦窩臥萵齷嗚鎢烏誣無蕪吳塢霧務誤鄔廡憮嫵騖鵡鶩錫犧襲習銑戲細餼鬩璽覡蝦轄峽俠狹廈嚇硤鮮纖賢銜閑顯險現獻縣餡羨憲線莧薟蘚峴獫嫻鷴癇蠔秈躚廂鑲鄉詳響項薌餉驤緗饗蕭囂銷曉嘯嘵瀟驍綃梟簫協挾攜脅諧寫瀉謝褻擷紲纈鋅釁興陘滎兇洶銹繡饈鵂虛噓須許敘緒續詡頊軒懸選癬絢諼鉉鏇學謔澩鱈勛詢尋馴訓訊遜塤潯鱘壓鴉鴨啞亞訝埡婭椏氬閹煙鹽嚴巖顏閻艷厭硯彥諺驗厴贗儼兗讞懨閆釅魘饜鼴鴦楊揚瘍陽癢養樣煬瑤搖堯遙窯謠藥軺鷂鰩爺頁業葉靨謁鄴曄燁醫銥頤遺儀蟻藝億憶義詣議誼譯異繹詒囈嶧飴懌驛縊軼貽釔鎰鐿瘞艤蔭陰銀飲隱銦癮櫻嬰鷹應纓瑩螢營熒蠅贏穎塋鶯縈鎣攖嚶瀅瀠瓔鸚癭頦罌喲擁傭癰踴詠鏞優憂郵鈾猶誘蕕銪魷輿魚漁娛與嶼語獄譽預馭傴俁諛諭蕷崳飫閾嫗紆覦歟鈺鵒鷸齬鴛淵轅園員圓緣遠櫞鳶黿約躍鑰粵悅閱鉞鄖勻隕運蘊醞暈韻鄆蕓惲慍紜韞殞氳雜災載攢暫贊瓚趲鏨贓臟駔鑿棗責擇則澤賾嘖幘簀賊譖贈綜繒軋鍘閘柵詐齋債氈盞斬輾嶄棧戰綻譫張漲帳賬脹趙詔釗蟄轍鍺這謫輒鷓貞針偵診鎮陣湞縝楨軫賑禎鴆掙睜猙爭幀癥鄭證諍崢鉦錚箏織職執紙摯擲幟質滯騭櫛梔軹輊贄鷙螄縶躓躑觶鐘終種腫眾鍾謅軸皺晝驟紂縐豬諸誅燭矚囑貯鑄駐佇櫧銖專磚轉賺囀饌顳樁莊裝妝壯狀錐贅墜綴騅縋諄準著濁諑鐲茲資漬諮緇輜貲眥錙齜鯔蹤總縱傯鄒諏騶鯫詛組鏃鉆纘躦鱒翺並蔔沈醜澱叠鬥範幹臯矽櫃後夥稭傑訣誇裡裏淩麽黴撚淒扡聖屍擡塗窪餵汙鍁鹹蠍彜湧遊籲禦願嶽雲竈紮劄築於誌註雕訁譾郤猛氹阪壟堖垵墊檾蕒葤蓧蒓菇槁摣咤唚哢噝噅撅劈謔襆嶴脊仿僥獁麅餘餷饊饢楞怵懍爿漵灩混濫瀦淡寧糸絝緔瑉梘棬案橰櫫軲軤賫膁腖飈糊煆溜湣渺碸滾瞘鈈鉕鋣銱鋥鋶鐦鐧鍩鍀鍃錇鎄鎇鎿鐝鑥鑹鑔穭鶓鶥鸌癧屙瘂臒襇繈耮顬蟎麯鮁鮃鮎鯗鯝鯴鱝鯿鰠鰵鱅鞽韝齇丬爲嚲衆僞餘冢淨凌凼剗勳勐勩滷靉靆啓咔吒咴哌譁嗊啢唣唿齧囉嘽呵噼嚯壠垧墶壋壎埝壪牆壼嬀姜嫺嫿屓崬嶨嶢嶮嶔嵛嵴廎彠御愍憖憷扎扦掗撏捻揸暘曨札桊檮棶櫺檟檐污沓渢潙沵溮滻濜涌溳溼漊澦漤煅煳熘犛犟狍獮蝟璵瑒瑲珉珏璫璡璇畲痾瘮瘻癯矓着硜硅磑礄礆碹磙禕穠簹籤籙餱糹紘紝紵紖絰綌絛緓鞝綯縕線縗繮翽翬肷髒醃膕齶臢豔艹薘莜蓴蘀藁虯螿蠨嫋褘襏褌襉襁襴覎覥讋訒訩詗詖譸諝諡谷豶貟齎贔賙賵贇赬跖躂踊軑輈輬轀鬱郄醱鉅鑑釺鈒鍚鈃鉢鑽鉶銍銛鋙鏽鐗錡錩杴鍈鍠鎡鎛鎔鏰鏐钁鐶鑞閈閒闓闍闠闒闤陝鞴韍頲熲頮頴顒纇颺颭颸颻飀飣飢飥飿餄餎餏餖餕餜餶饁餺馹駰驫騂駸騌驌騤驦魛魢魨魺鮋鮓鮊鮍鮳鮦鰂鮜鱠鮺鮶鯒鯕鰺鰏鱨鯷鰮鰃鰁鱂鰟鰜鰼鱯鱤鱣鳲鶬鴞鴒鷽鴴鵃鵐鷳鵾鵮鶊鵷鷫鶡鷊鶲鶹鶺鷁鷖鸇鸏鸘黶鼂鞀齕齗志制諮只系鬆嚐面乾拼噁讚髮殭緻姦穫鍊迴係蹟隻闢闆妳';
}

// 例外列表：简体字 -> 繁体字（这些字不转换）
const exceptionMap = new Map([
    ['吃', '吃'],      // 吃 -> 喫，但同源，不转换
    ['注', '注'],      // 注 -> 註，但同源，不转换
]);

function traditionalized(cc){
    let str = '';
    for(let i=0; i<cc.length; i++){
        const char = cc.charAt(i);

        // 检查是否在例外列表中
        if (exceptionMap.has(char)) {
            str += char; // 保持原样，不转换
            continue;
        }

        const index = charPYStr().indexOf(char);
        if(index !== -1) {
            str += ftPYStr().charAt(index);
        } else {
            str += char;
        }
    }
    return str;
}

function simplized(cc){
    let str = '';
    for(let i=0; i<cc.length; i++){
        if(ftPYStr().indexOf(cc.charAt(i))!=-1)
            str+=charPYStr().charAt(ftPYStr().indexOf(cc.charAt(i)));
        else
            str+=cc.charAt(i);
    }
    return str;
}

function isNonChinese(str) {
  // 匹配任何中文字符（Unicode 范围）
  // \u4e00-\u9fff 涵盖常用汉字（CJK 统一表意文字）
  // 更完整可包括 \u3400-\u4dbf 等扩展区，但通常 \u4e00-\u9fff 足够
  const chineseRegex = /[\u4e00-\u9fff]/;
  return !chineseRegex.test(str);
}

/** Pure Forward matching/deduplication. AGPL-3.0-only.
 * Also embedded by scripts/build-danmu-fusion.mjs; no Node API in this file.
 */
function fusionNormalize(value) {
  var text = String(value == null ? '' : value);
  if (text.normalize) text = text.normalize('NFKC');
  return text.replace(/\s+/g, ' ').trim();
}

function fusionHash(value) {
  var h = 2166136261, s = String(value);
  for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function fusionSource(value) {
  var s = String(value || 'unknown').toLowerCase();
  return ({ qq: 'tencent', qiyi: 'iqiyi', mango: 'imgo', bilibili1: 'bilibili' })[s] || s;
}

function fusionSpecial(title) {
  var s = fusionNormalize(title).toLowerCase();
  var m = s.match(/(?:^|[^a-z])(ova|oad|sp)(?:[^a-z]|$)|特别篇|特別篇|番外|特典|总集篇|總集篇|特别节目|特別節目/);
  return m ? (m[1] || 'special') : 'regular';
}

function fusionTitle(title) {
  return simplized(fusionNormalize(title)).toLowerCase()
    .replace(/\bfrom\s+[a-z0-9&_-]+.*$/i, '')
    .replace(/[【\[][^】\]]*[】\]]/g, '')
    .replace(/\((?:19|20)\d{2}\)/g, '')
    .replace(/第[一二三四五六七八九十\d]+季|\bs\d{1,2}(?:e\d+)?\b|season\s*\d+/gi, '')
    .replace(/[\s.,:;!?，。；：！？、'"()（）·_\-]/g, '');
}

function fusionMatch(identity, candidate) {
  var title = candidate.animeTitle || candidate.title || '';
  var type = [candidate.type,candidate.mediaType,candidate.typeDescription].filter(Boolean).join(' ').toLowerCase();
  var movie = /movie|film|电影|電影|剧场版|劇場版/.test(type + ' ' + title);
  var tv = /tv|series|episode|剧集|電視|电视剧|番剧/.test(type);
  var id = candidate.tmdb_id || candidate.tmdbId;
  var sameId = !!(id && identity.tmdb_id && String(id) === String(identity.tmdb_id));
  var year = String(candidate.startDate || candidate.year || title).match(/(?:19|20)\d{2}/);
  var season = title.match(/第([一二三四五六七八九十\d]+)季|\bs(\d{1,2})(?:e\d+)?\b|season\s*(\d+)/i);
  var nums = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  var sn = candidate.season != null ? Number(candidate.season) : season ? Number(nums[season[1]] || season[1] || season[2] || season[3]) : null;
  var special = fusionSpecial((identity.title || '') + ' ' + (identity.episodeName || ''));
  if (id && identity.tmdb_id && !sameId) return { reliable:false, reason:'id_conflict' };
  if (movie && !identity.isMovie || tv && identity.isMovie) return { reliable:false, reason:'type_conflict' };
  if (fusionSpecial(title) !== special) return { reliable:false, reason:'special_conflict' };
  if (!identity.isMovie && sn != null && sn !== Number(identity.season)) return { reliable:false, reason:'season_conflict' };
  // A season's premiere year differs from the series premiere year. Without an
  // explicit shared ID this is ambiguous and remains a manual selection.
  if (year && identity.year && year[0] !== String(identity.year) && !sameId) return { reliable:false, reason:'year_conflict' };
  var names = [identity.title, identity.original_title].concat(identity.aliases || []).filter(Boolean).map(fusionTitle);
  var aliases = [title].concat(candidate.aliases || []).map(fusionTitle);
  var titleHit = names.some(function(n) { return aliases.indexOf(n) >= 0; });
  var knownType = identity.isMovie ? movie : tv;
  var knownSeason = identity.isMovie || sn === Number(identity.season);
  return { reliable: !!((sameId && knownType || titleHit && year && identity.year && knownType) && knownSeason), reason: sameId ? 'id' : 'title_year_type_season' };
}

/** O(n log n) sorting + bounded hash buckets. Keeps source multiplicity:
 * one A record may consume at most one matching record from each other source.
 * Unknown provenance / already processed data never receives fuzzy dedupe.
 */
function fusionDedupe(input, options) {
  var o = options || {}, tolerance = Number(o.tolerance == null ? 2 : o.tolerance);
  tolerance = Number.isFinite(tolerance) ? Math.max(0, Math.min(10, tolerance)) : 2;
  var stats = { original:input.length, invalid:0, exact:0, near:0, retained:0, truncated:0 };
  var items = [], cap = Math.max(1, Number(o.maxItems) || 200000);
  for (var i=0; i<Math.min(input.length, cap); i++) {
    var c = input[i], t = Number(c.time), text = fusionNormalize(c.content);
    var source = fusionSource(c.source);
    var shift = !o.serverProcessed && o.offsets ? Number(o.offsets[source] || 0) : 0;
    t += shift;
    if (!Number.isFinite(t) || t < 0 || !text || text.length > 4000) { stats.invalid++; continue; }
    items.push(Object.assign({}, c, { time:t, timestamp:t, _norm:text, source:source, _index:i }));
  }
  stats.truncated = Math.max(0, input.length-cap);
  items.sort(function(a,b) { return a.time-b.time || a._index-b._index; });
  var buckets = new Map(), ids = new Map(), kept = [];
  var width = Math.max(tolerance, 0.001), lastBucket = null;
  for (var j=0; j<items.length; j++) {
    var item = items[j], ep = String(item.episode == null ? '' : item.episode);
    var known = item.source !== 'unknown';
    var recordId = item.recordId; // Only true upstream IDs, never generated indexes.
    var idKey = JSON.stringify([ep,item.source,recordId,item.time,item._norm,item.color,item.position]);
    if (o.enabled !== false && recordId != null && ids.has(idKey)) { stats.exact++; continue; }
    if (recordId != null) ids.set(idKey, true);
    var b = Math.floor(item.time/width);
    if (lastBucket !== b) {
      for (var old of buckets.keys()) if (old < b-1) buckets.delete(old);
      lastBucket = b;
    }
    // Near dedupe only removes optional spacing around punctuation. Letters,
    // emoji, repeated syllables, punctuation counts and case remain meaningful.
    var norm = o.near === false ? item._norm : item._norm.replace(/\s*([,，。.!！?？:：;；])\s*/g, '$1');
    var key = JSON.stringify([ep,norm,item.color,item.position]);
    var duplicate = false;
    var lowInfo = item._norm.length < 6 || new Set(item._norm).size <= 2;
    if (o.enabled !== false && !o.serverProcessed && known && !lowInfo) {
      for (var bi=b-1; bi<=b && !duplicate; bi++) {
        var index = buckets.get(bi), group = index && index.get(key);
        if (!group) continue;
        // A bounded list prevents dense identical comments from becoming n².
        for (var k=0; k<group.length; k++) {
          var cluster = group[k];
          if (!cluster.sources.has(item.source) && Math.abs(item.time-cluster.item.time) <= tolerance) {
            cluster.sources.add(item.source);
            stats[item._norm === cluster.item._norm ? 'exact' : 'near']++;
            duplicate = true; break;
          }
        }
      }
    }
    if (duplicate) continue;
    kept.push(item);
    if (known && !lowInfo) {
      if (!buckets.has(b)) buckets.set(b,new Map());
      var ix=buckets.get(b), q=ix.get(key) || [];
      q.push({item:item,sources:new Set([item.source])});
      if (q.length>64) q.shift();
      ix.set(key,q);
    }
  }
  var result=kept.map(function(c) { var copy=Object.assign({},c); delete copy._norm; delete copy._index; return copy; });
  stats.retained=result.length;
  stats.removed=stats.original-stats.retained;
  return { items:result, stats:stats };
}

/* Forward runtime only. Embedded in danmu-fusion.js by the reproducible build. */
const fusionMemory = new Map();
const fusionPending = new Map();
const fusionCapabilities = new Map();
const fusionHttpWaiters = [];
let fusionHttpActive = 0;
let fusionStorageQueue = Promise.resolve();
const fusionSchema = 'fusion-v8';

function fusionOptions(params) {
  const p=params || {};
  // Keep the established address key so upgrades retain saved configuration.
  // All other parameters are media context; historical technical settings are
  // deliberately not read, validated or incorporated into cache signatures.
  const cfg={
    requestBase:parseDanmuApiUrl(p.danmu_api_url || p.server || "").requestBase,
    timeoutMs:30000, retry:1, cacheEnabled:true, ttl:300000, chunk:60,
    tolerance:2, maxSources:8,
    order:['tencent','iqiyi','youku','imgo','bilibili','dandan']
  };
  cfg.signature=JSON.stringify([fusionSchema,cfg.requestBase]);
  return cfg;
}

function fusionIdentity(params) {
  const identity=resolveIdentity(params);
  identity.episodeName=String(params.episodeName || params.episodeTitle || '');
  identity.runtime=Number(params.runtime) || null;
  identity.airDate=params.airDate || null;
  identity.premiereDate=params.premiereDate || null;
  identity.link=params.link || null;
  identity.videoUrl=params.videoUrl || null;
  identity.aliases=Array.isArray(params.aliases) ? params.aliases : [];
  // Prefer series premiere year to the currently playing episode's air date.
  identity.year=yearFrom(params.year) || yearFrom(params.ProductionYear) || yearFrom(params.premiereDate) || identity.year;
  if (params.tmdbId && /^(tv|movie)\.\d+$/.test(String(params.tmdbId))) identity.tmdb_id=String(params.tmdbId).split('.')[1];
  const explicitSeason=firstPresent(params,['season','seasonNumber','ParentIndexNumber']);
  const union=parseUnionOrMediaId(params.unionId || params.union_id);
  if (union && union.tmdb_id) identity.tmdb_id=union.tmdb_id;
  if (!identity.isMovie && (Number(explicitSeason)===0 && explicitSeason!=null || union && !union.isMovie && union.season===0)) identity.specialSeason=true;
  identity.special=fusionSpecial(identity.title+' '+identity.episodeName)!=='regular' || !!identity.specialSeason;
  if (identity.specialSeason) identity.season=0;
  identity.reliableSE=identity.isMovie || identity.seasonSource!=='default_1_UNSAFE' && identity.episodeSource!=='default_1_UNSAFE';
  return identity;
}

function fusionKey(identity,cfg,extra) {
  // Full signature comparison protects even the unlikely 32-bit hash collision.
  return fusionSchema+':'+fusionHash(cfg.signature)+':'+JSON.stringify([identity.isMovie?'movie':'tv',identity.tmdb_id,identity.imdb_id,identity.title,identity.year,identity.season,identity.episode,identity.special,identity.version_key,extra]);
}

async function fusionCached(key,cfg,loader,ttl) {
  const now=Date.now();
  let entry=fusionMemory.get(key);
  if (!entry && cfg.cacheEnabled && Widget.storage) {
    try { entry=await Widget.storage.get(key); if (typeof entry==='string') entry=JSON.parse(entry); } catch(e) {}
  }
  if (cfg.cacheEnabled && entry && entry.signature===cfg.signature && entry.expires>now) return JSON.parse(JSON.stringify(entry.value));
  // In-flight entries disappear on success and failure; failed requests never cache.
  if (fusionPending.has(key)) return JSON.parse(JSON.stringify(await fusionPending.get(key)));
  const work=(async()=>{
    const value=await loader();
    if (cfg.cacheEnabled && !(value && value.partial)) {
      entry={ signature:cfg.signature, expires:Date.now()+(ttl || cfg.ttl), value:value };
      fusionMemory.set(key,entry);
      // Storage holds only a bounded manifest of our own schema keys. Old user data
      // and settings are never removed. Large source payloads stay memory-only.
      entry._bytes=JSON.stringify(entry).length*2;
      const persist=entry._bytes<3000000;
      let bytes=0; fusionMemory.forEach(e=>{bytes+=e._bytes || 0;});
      while (fusionMemory.size>32 || bytes>8*1024*1024) {
        const old=fusionMemory.keys().next().value;
        bytes-=fusionMemory.get(old)._bytes || 0; fusionMemory.delete(old);
      }
      if (persist && Widget.storage && Widget.storage.set) {
        const persistWork=fusionStorageQueue.then(async()=>{
          await Widget.storage.set(key,entry);
          let list=await Widget.storage.get(fusionSchema+':keys');
          if (!Array.isArray(list)) list=[];
          list=list.filter(k=>k!==key); list.push(key);
          while (list.length>32) { const old=list.shift(); if (Widget.storage.remove) await Widget.storage.remove(old); }
          await Widget.storage.set(fusionSchema+':keys',list);
        });
        fusionStorageQueue=persistWork.catch(()=>{});
        await fusionStorageQueue; // optional storage failure cannot discard data
      }
    }
    return value;
  })();
  fusionPending.set(key,work);
  try { return JSON.parse(JSON.stringify(await work)); } finally { fusionPending.delete(key); }
}

async function fusionRequest(cfg,path,body) {
  const isSearch=/\/api\/v2\/search\//.test(path);
  // danmu_api's first search waits for all source discovery pipelines, which
  // can legitimately exceed a comment request's budget. Do not launch another
  // expensive discovery when the first one times out.
  const requestTimeout=isSearch?90000:cfg.timeoutMs;
  let last;
  for (let attempt=0;attempt<=cfg.retry;attempt++) {
    let timer;
    if (fusionHttpActive>=3) await new Promise(resolve=>fusionHttpWaiters.push(resolve));
    else fusionHttpActive++;
    try {
      const url=/^https?:\/\//i.test(path) ? path : cfg.requestBase+path;
      const options={headers:headers(cfg),timeout:requestTimeout};
      if (body!==undefined && !Widget.http.post) { const e=new Error('分片扩展不可用'); e.status=501; throw e; }
      const request=body===undefined ? Widget.http.get(url,options) : Widget.http.post(url,body,options);
      const response=typeof setTimeout==='function' ? await Promise.race([request,new Promise((_,reject)=>{ timer=setTimeout(()=>{ const e=new Error('弹幕请求超时'); e.status=408; reject(e); },requestTimeout); })]) : await request;
      const status=Number(response && (response.status || response.statusCode)) || 200;
      if (status>=400) { const e=new Error('弹幕 API HTTP '+status); e.status=status; throw e; }
      let data=response && response.data!==undefined ? response.data : response;
      if (typeof data==='string') { if (data.length>24000000) throw new Error('弹幕响应过大'); try { data=JSON.parse(data); } catch(e) { throw new Error('弹幕 API JSON 无效'); } }
      if (!data || typeof data!=='object') throw new Error('弹幕 API 响应无效');
      if (data.success===false || Number(data.errorCode)>0) { const e=new Error('弹幕 API 返回失败'); e.status=Number(data.errorCode)||502; throw e; }
      return data;
    } catch(e) {
      last=e;
      // No URL, token, response text or native exception is logged.
      if (isSearch && (!e.status || Number(e.status)===408) || Number(e.status)===501 || e.status && ![408,429].includes(e.status) && e.status<500) break;
      if (attempt<cfg.retry && typeof setTimeout==='function') await new Promise(resolve=>setTimeout(resolve,Math.min(1500,200*(attempt+1))));
    } finally {
      if (timer && typeof clearTimeout==='function') clearTimeout(timer);
      if (fusionHttpWaiters.length) fusionHttpWaiters.shift()();
      else fusionHttpActive--;
    }
  }
  // Never propagate a native transport error containing a credentialed URL.
  const error=new Error(last && last.status ? '弹幕 API HTTP '+last.status : '弹幕 API 请求或数据解析失败');
  error.status=last && last.status; throw error;
}

async function fusionPool(items,fn) {
  let cursor=0; const results=new Array(items.length);
  await Promise.all([0,1,2].map(async()=>{ while(cursor<items.length) { const i=cursor++; try { results[i]={value:await fn(items[i],i)}; } catch(e) { results[i]={error:e}; } } }));
  return results;
}

function fusionUnsupported(error) { return [400,404,405,415,422,501].includes(Number(error && error.status)); }

function fusionCapability(cfg,feature,value) {
  const key=cfg.signature+':'+feature;
  if (value!==undefined) {
    fusionCapabilities.set(key,{value:value,expires:Date.now()+cfg.ttl});
    while (fusionCapabilities.size>32) fusionCapabilities.delete(fusionCapabilities.keys().next().value);
  }
  const entry=fusionCapabilities.get(key);
  return entry && entry.expires>Date.now() ? entry.value : undefined;
}

async function fusionCatalog(identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,'catalog'),cfg,async()=>{
    const title=identity.title || identity.original_title || '';
    if (!title && !identity.tmdb_id) return [];
    let raw;
    try { raw=await fusionRequest(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(title)); }
    catch(e) { if (!fusionUnsupported(e)) throw e; }
    if (!raw || Array.isArray(raw.animes) && !raw.animes.length) {
      try {
        const query='anime='+encodeURIComponent(title)+(identity.tmdb_id?'&tmdbId='+encodeURIComponent(identity.tmdb_id)+'&tmdbIdType='+(identity.isMovie?'1':'0'):'')+(!identity.isMovie && identity.reliableSE?'&episode='+identity.episode:'');
        raw=await fusionRequest(cfg,'/api/v2/search/episodes?'+query);
      } catch(e) { if (!fusionUnsupported(e)) throw e; }
    }
    if (!raw || !Array.isArray(raw.animes)) throw new Error('弹幕搜索结构发生变化');
    let candidates=raw.animes.slice(0,80).filter(a=>a && (a.animeId!=null || a.bangumiId)).map(fusionCandidate);
    const baseName=fusionSeriesName(identity.title,identity.season);
    // A player can supply the series premiere year with a numbered season
    // title. Retrieve the base series once so that a first-season record can
    // prove that year, rather than relaxing year checks for every show.
    if (!identity.isMovie && baseName && (baseName!==fusionTitle(identity.title) || Number(identity.season)>1 && /第.+季|\bS\d+\b|season\s*\d+/i.test(identity.title))) {
      try {
        const base=await fusionRequest(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(baseName));
        if (Array.isArray(base.animes)) {
          const seen=new Set(candidates.map(a=>String(a.source)+'|'+a.animeId));
          base.animes.slice(0,80).map(fusionCandidate).forEach(a=>{const k=String(a.source)+'|'+a.animeId;if(!seen.has(k)){seen.add(k);candidates.push(a);}});
        }
      } catch(e) { /* keep the valid original search if the auxiliary one fails */ }
    }
    return fusionSeriesEvidence(candidates,identity);
  });
}

function fusionTvType(candidate) {
  const type=String(candidate.type || '')+' '+String(candidate.typeDescription || '');
  return /tv|series|episode|drama|番[剧劇]|[电電][视視][剧劇]|[剧劇]集|[剧劇](?:\s|$)/i.test(type) && !/movie|电影|電影|[剧劇][场場]版/i.test(type);
}

function fusionSeriesName(title,season) {
  const normalized=fusionTitle(title);
  const suffix=normalized.match(/^(.+?[^\d])(\d{1,2})$/);
  return suffix && Number(suffix[2])===Number(season) && suffix[1].length>=2 ? suffix[1] : normalized;
}

function fusionSeasonCandidate(identity,candidate) {
  if (identity.isMovie || !fusionTvType(candidate)) return {identity:identity,candidate:candidate};
  const copy=Object.assign({},candidate,{type:'tvseries',typeDescription:'tvseries'});
  const desired=Number(identity.season), name=fusionTitle(candidate.animeTitle || candidate.title || '');
  const base=fusionSeriesName(identity.title,desired);
  const suffix=name.match(/^(.+?[^\d])(\d{1,2})$/);
  // A numeric suffix is a season only when its base matches this exact work
  // and the requested season supplies corroborating evidence.
  if (suffix && suffix[1]===base) {
    copy.season=Number(suffix[2]);
    copy.animeTitle=suffix[1]+' S'+suffix[2];
    const year=yearFrom(candidate.startDate || candidate.year || candidate.animeTitle);
    if (year) copy.startDate=year+'-01-01';
  } else if (desired===1 && name===base && !/第.+季|\bS\d+\b|season\s*\d+/i.test(String(candidate.animeTitle || ''))) {
    copy.season=1;
  }
  const context=Object.assign({},identity,{title:base});
  if (candidate._fusionSeriesYear && String(candidate._fusionSeriesYear)===String(identity.year)) {
    context.year=yearFrom(candidate.startDate || candidate.year || candidate.animeTitle) || identity.year;
  }
  return {identity:context,candidate:copy};
}

function fusionSeriesEvidence(candidates,identity) {
  if (identity.isMovie || !identity.year) return candidates;
  const base=fusionSeriesName(identity.title,identity.season), bySource=new Map(), seasonYears=new Map();
  candidates.forEach(a=>{
    if (!a.source || !fusionTvType(a)) return;
    const normalized=fusionSeasonCandidate(identity,a), year=yearFrom(a.startDate || a.year || a.animeTitle);
    if (!year || !fusionMatch(Object.assign({},normalized.identity,{year:year}),normalized.candidate).reliable) return;
    const key=fusionSource(a.source); if(!seasonYears.has(key))seasonYears.set(key,new Set());seasonYears.get(key).add(year);
  });
  candidates.forEach(a=>{
    if (!a.source || !fusionTvType(a)) return;
    const title=fusionTitle(a.animeTitle || '');
    // Only an unnumbered exact base title or explicit season 1 can establish
    // the series premiere. Multiple competing years stay ambiguous.
    const explicit=String(a.animeTitle || '').match(/第\s*([一1])\s*季|\bS0?1\b|season\s*1\b/i);
    if (fusionSeriesName(a.animeTitle || '',1)!==base || (/第.+季|\bS\d+\b|season\s*\d+/i.test(String(a.animeTitle || ''))&&!explicit)) return;
    const year=yearFrom(a.startDate || a.year || a.animeTitle);
    if (!year) return;
    const key=fusionSource(a.source); if(!bySource.has(key))bySource.set(key,new Set());bySource.get(key).add(year);
  });
  const premiereYears=new Set(), targetYears=new Set();
  bySource.forEach(years=>years.forEach(year=>premiereYears.add(year)));
  seasonYears.forEach(years=>years.forEach(year=>targetYears.add(year)));
  // Cross-platform evidence needs two independent first-season listings and
  // one unambiguous year for the requested season. A single unrelated listing
  // cannot override the player's year. Competing remakes remain manual.
  const consensus=bySource.size>=2 && premiereYears.size===1 && premiereYears.has(String(identity.year)) && targetYears.size===1;
  return candidates.map(a=>{
    const years=bySource.get(fusionSource(a.source));
    const target=seasonYears.get(fusionSource(a.source)), year=yearFrom(a.startDate || a.year || a.animeTitle);
    const own=years && years.size===1 && years.has(String(identity.year));
    return fusionTvType(a) && (own || consensus) && target && target.size===1 && Number(year)>=Number(identity.year) ? Object.assign({},a,{_fusionSeriesYear:String(identity.year)}) : a;
  });
}

function fusionCandidate(candidate) {
  const item=Object.assign({},candidate);
  if (item.animeId==null) item.animeId=item.bangumiId;
  if (item.type==='jpdrama') item.type='tvseries';
  const id=String(item.bangumiId || '').match(/^tmdb-(tv|movie)-(\d+)$/);
  if (id) { item.tmdb_id=id[2]; item.type=id[1]==='movie'?'movie':'tvseries'; item._multiSeason=id[1]==='tv'; }
  return item;
}

function fusionReliable(identity,candidate) {
  if (/^(?:tvspecial|ova|oad)$/i.test(String(candidate.type || ''))) return false;
  const normalized=fusionSeasonCandidate(identity,candidate);
  if (fusionMatch(normalized.identity,normalized.candidate).reliable) return true;
  // A shared series ID needs per-episode season proof in the actual detail.
  return !!(candidate._multiSeason && fusionMatch(identity,Object.assign({},candidate,{season:identity.season})).reliable);
}

async function fusionSearch(params) {
  const cfg=fusionOptions(params), identity=fusionIdentity(params);
  const list=await fusionCatalog(identity,cfg);
  const reliable=list.filter(a=>fusionReliable(identity,a));
  // Include uncertain candidates for explicit user selection, without secretly
  // including them in the automatic merged track.
  const manual=list.map(a=>Object.assign({},a,{isFavorited:false}));
  if (reliable.length && identity.reliableSE && !identity.special) {
    const id=fusionAutoId(identity,cfg,'anime');
    manual.unshift({animeId:id,bangumiId:String(id),animeTitle:identity.title+' · 自动匹配',type:identity.isMovie?'movie':'tvseries',episodeCount:Math.max(1,Number(identity.episode)||1),isFavorited:true});
  }
  return {animes:manual};
}

async function fusionEpisodes(candidate,identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,['detail',candidate.animeId]),cfg,async()=>{
    if (Array.isArray(candidate.episodes)) return candidate.episodes.slice(0,2000);
    const id=/^tmdb-(?:tv|movie)-\d+$/.test(String(candidate.bangumiId || '')) ? candidate.bangumiId : candidate.animeId;
    const raw=await fusionRequest(cfg,'/api/v2/bangumi/'+encodeURIComponent(id));
    if (!raw.bangumi || !Array.isArray(raw.bangumi.episodes)) throw new Error('弹幕详情结构发生变化');
    const seasons=new Map((raw.bangumi.seasons || []).map(s=>{
      const m=String(s.name || '').match(/(?:season\s*|\bS)(\d+)\b|第([一二三四五六七八九十\d]+)季/i);
      const cn={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
      return [String(s.id),m?Number(m[1]||cn[m[2]]||m[2]):null];
    }));
    return raw.bangumi.episodes.slice(0,2000).map(e=>Object.assign({},e,{_season:seasons.get(String(e.seasonId))}));
  });
}

function fusionLegacySelection(params) {
  const id=String(params.animeId || '');
  return /^(?:tmdb_|fusion_(?:tv|movie)_)/i.test(id) || !!parseUnionOrMediaId(id);
}

function fusionAutoId(identity,cfg,kind) {
  return -(Number.parseInt(fusionHash(fusionKey(identity,cfg,kind)),36)%500000000+(kind==='anime'?1000000000:1500000000));
}

function fusionAutomatic(params) {
  const a=Number(params.animeId), c=Number(params.commentId);
  return a<=-1000000000 && a>-1500000000 || c<=-1500000000 && c>-2000000000 || String(params.animeId || '').startsWith('fusion-auto:') || String(params.commentId || '').startsWith('fusion-track:') || fusionLegacySelection(params);
}

function fusionEpisodeNumber(ep) {
  // danmu_api generates episodeNumber from the array index (and renumbers it
  // after filtering). Only the original episode title proves a platform number.
  const raw=String(ep.episodeTitle || '');
  const title=raw.replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/, '');
  if (fusionSpecial(raw)!=='regular' || /预告|預告|花絮|解说|解說|上集|下集|上篇|下篇|\(上\)|\(下\)|（上）|（下）/.test(raw)) return null;
  const m=title.match(/第\s*(\d+)\s*[集话話]|(?:^|\b)E(?:P)?\s*(\d+)\b|^\s*(\d+)\s*$/i);
  return m ? Number(m[1]||m[2]||m[3]) : null;
}

function fusionEpisodeSource(ep,candidate) {
  const tag=String(ep.episodeTitle || '').match(/^\s*(?:【([^】]+)】|\[([^\]]+)\])/);
  const source=tag && fusionSource(tag[1] || tag[2]);
  const known=['tencent','iqiyi','youku','imgo','bilibili','migu','renren','aiyifan','dandan'];
  const host=(String(ep.url || '').match(/^https?:\/\/([^/:?#]+)/i) || [])[1] || '';
  const domains=[['qq.com','tencent'],['iqiyi.com','iqiyi'],['youku.com','youku'],['mgtv.com','imgo'],['bilibili.com','bilibili'],['migu.cn','migu']];
  const domain=domains.find(d=>host.toLowerCase()===d[0] || host.toLowerCase().endsWith('.'+d[0]));
  if(known.includes(source) && domain && source!==domain[1]) return 'unknown';
  if(domain)return domain[1];
  if(known.includes(source))return source;
  const fallback=fusionSource(candidate.source);
  // 360 is a catalog, not an independent video platform. Its actual platform
  // must be established by the episode tag or official video URL.
  return fallback==='360'?'unknown':fallback;
}

function fusionCommentId(key) {
  // A stable, exactly representable 53-bit ID avoids reusing 1..N at every
  // progress callback. Forward may use cid to recognize already-loaded rows.
  return Number.parseInt(fusionHash(key),36)*2097152+Number.parseInt(fusionHash('cid:'+key),36)%2097152;
}

async function fusionDetail(params) {
  const cfg=fusionOptions(params), identity=fusionIdentity(params);
  if (fusionAutomatic(params)) {
    // Only expose the proven current episode; do not invent a 40-episode season.
    return [{episodeId:fusionAutoId(identity,cfg,'episode'),episodeTitle:identity.isMovie?'正片':formatSE(identity.season,identity.episode),episodeNumber:String(identity.isMovie?1:identity.episode)}];
  }
  const selected=(await fusionCatalog(identity,cfg)).find(a=>String(a.animeId)===String(params.animeId) || String(a.bangumiId)===String(params.animeId));
  return fusionEpisodes(selected || {animeId:params.animeId},identity,cfg);
}

async function fusionTracks(params,identity,cfg) {
  const auto=fusionAutomatic(params) || !params.animeId && !params.commentId;
  if (!auto && params.commentId!=null) {
    let selected;
    try { selected=(await fusionCatalog(identity,cfg)).find(a=>String(a.animeId)===String(params.animeId)); } catch(e) {}
    const merged=selected && ((selected.mergedChildren || []).length || (selected.links || []).some(l=>String(l.url).includes('$$$')));
    return [{commentId:params.commentId,source:selected?fusionSource(selected.source):'unknown',serverMerged:!!merged,serverSources:selected?[selected.source].concat((selected.mergedChildren || []).map(c=>c.source)).filter(Boolean).map(fusionSource):[]}];
  }
  if (!identity.reliableSE || identity.special) throw new Error('当前季集或特别篇身份不明确，请手动选择资源');
  const catalog=await fusionCatalog(identity,cfg);
  let reliable=catalog.filter(a=>fusionReliable(identity,a) && !a.isHiddenChild);
  reliable.sort((a,b)=>{ const rank=s=>{ const n=cfg.order.indexOf(fusionSource(s)); return n<0?999:n; }; return rank(a.source)-rank(b.source); });
  const composite=reliable.find(a=>(a.mergedChildren || []).length || (a.links || []).some(l=>String(l.url).includes('$$$')));
  // Native merges contain all children: request that entry once.
  if (composite) reliable=[composite];
  const platforms=new Set();
  reliable=reliable.filter(a=>{const source=fusionSource(a.source); if(platforms.has(source))return false; platforms.add(source); return true;});
  if (reliable.some(a=>fusionSource(a.source)!=='unknown')) reliable=reliable.filter(a=>fusionSource(a.source)!=='unknown');
  const details=await fusionPool(reliable.slice(0,cfg.maxSources),async a=>{
    const eps=await fusionEpisodes(a,identity,cfg);
    let hits;
    if (identity.isMovie) hits=eps.length===1 ? eps : eps.filter(e=>/正片|全片/.test(String(e.episodeTitle)));
    else hits=eps.filter(e=>fusionEpisodeNumber(e)===Number(identity.episode) && (!a._multiSeason || e._season===Number(identity.season)));
    if (hits.length!==1) return null; // Never use array index as platform episode.
    const ep=hits[0], link=(a.links || []).find(l=>String(l.id)===String(ep.episodeId));
    const source=fusionEpisodeSource(ep,a);
    return {commentId:ep.episodeId,source:source,serverMerged:!!composite || String(ep.url || '').includes('$$$') || !!(link && String(link.url).includes('$$$')),serverSources:[source].concat((a.mergedChildren || []).map(c=>c.source)).filter(Boolean).map(fusionSource)};
  });
  const seen=new Set(), origins=new Set();
  return details.filter(r=>r.value).map(r=>r.value).filter(r=>{
    const k=String(r.commentId); if(seen.has(k) || r.source!=='unknown' && origins.has(r.source)) return false;
    seen.add(k); origins.add(r.source); return true;
  });
}

function fusionParse(payload,track,identity) {
  const list=Array.isArray(payload) ? payload : payload.comments;
  if (!Array.isArray(list)) throw new Error('弹幕数据结构发生变化');
  if (list.length>200000) throw new Error('单源弹幕超过 200000 条限制');
  const episodeKey=fusionKey(identity,{signature:'',requestBase:''},'episode');
  const parsed=list.map(c=>{
    const p=String(c && c.p || '').split(',');
    if (!c || !c.p || p.length<3 || c.m==null || !p[0].trim()) return null;
    const time=Number(p[0]), position=Number(p[1]), color=Number(p.length>=8?p[3]:p[2]);
    if (!Number.isFinite(time) || !Number.isFinite(position) || !Number.isFinite(color) || color<0 || color>16777215) return null;
    // Bilibili 8-field p: time,mode,fontSize,color,...; Dandan: time,mode,color.
    return {time:time,position:position,color:color,content:String(c.m),recordId:c.cid,source:track.serverMerged?'unknown':track.source,episode:episodeKey};
  }).filter(Boolean);
  if (list.length && !parsed.length) throw new Error('API 弹幕记录均无效');
  return parsed;
}

async function fusionFullTrack(track,identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,['full',track.commentId]),cfg,async()=>{
    const raw=await fusionRequest(cfg,'/api/v2/comment/'+encodeURIComponent(track.commentId)+'?withRelated=true');
    if (!Array.isArray(raw.comments)) throw new Error('标准弹幕接口未返回 comments 数组');
    return {comments:raw.comments};
  });
}

async function fusionManifest(track,identity,cfg,refresh) {
  const key=fusionKey(identity,cfg,['manifest',track.commentId]);
  if (refresh) {
    fusionMemory.delete(key);
    if (Widget.storage && Widget.storage.remove) { try { await Widget.storage.remove(key); } catch(e) {} }
  }
  return fusionCached(key,cfg,async()=>{
    if (fusionCapability(cfg,'segments')===false) return fusionFullTrack(track,identity,cfg);
    let raw;
    try { raw=await fusionRequest(cfg,'/api/v2/comment/'+encodeURIComponent(track.commentId)+'?withRelated=true&segmentflag=true'); }
    catch(e) {
      if (!fusionUnsupported(e)) throw e;
      fusionCapability(cfg,'segments',false);
      return fusionFullTrack(track,identity,cfg);
    }
    const list=raw.comments && raw.comments.segmentList || raw.barrage_list;
    if (Array.isArray(list)) {
      const direct=Array.isArray(raw.barrage_list);
      if (list.length>10000 || list.some(s=>!s || !Number.isFinite(s.segment_start) || !Number.isFinite(s.segment_end) || s.segment_end<=s.segment_start || (direct?!/^https?:\/\//i.test(String(s.segment_url || '')):!s.type || typeof s.url!=='string'))) return fusionFullTrack(track,identity,cfg);
      return {segments:list,direct:direct};
    }
    // A standard Dandan endpoint ignores segmentflag and already returns the
    // canonical timeline. Cache it once, and don't probe that extension again.
    if (Array.isArray(raw.comments)) {
      // Do not disable segmentation globally: another origin on the same server
      // may implement it. This manifest itself is cached per selected episode.
      return {comments:raw.comments};
    }
    return fusionFullTrack(track,identity,cfg);
  });
}

async function fusionWindow(params,identity,cfg,start,end,initial) {
  const tracks=await fusionTracks(params,identity,cfg);
  if (!tracks.length) return {count:0,comments:[],error:'no_reliable_source'};

  const margin=cfg.tolerance;
  const fetched=await fusionPool(tracks,async track=>{
    async function load(refresh) {
      const manifest=await fusionManifest(track,identity,cfg,refresh);
      if (manifest.comments) return {items:fusionParse(manifest,track,identity),full:true};
      const offset=0; // Preserve the server timeline; no client platform shifts.
      const segments=manifest.segments.filter(s=>s.segment_start<end-offset+margin && s.segment_end>start-offset-margin);
      if (!manifest.direct && fusionCapability(cfg,'segmentPost')===false) {
        const full=await fusionFullTrack(track,identity,cfg);
        return {items:fusionParse(full,track,identity),full:true};
      }
      const batches=await fusionPool(segments,seg=>fusionCached(fusionKey(identity,cfg,['segment',track.commentId,seg]),cfg,()=>manifest.direct?fusionRequest(cfg,seg.segment_url):fusionRequest(cfg,'/api/v2/segmentcomment?format=json',seg)));
      const ok=batches.filter(r=>r.value), failed=batches.filter(r=>r.error);
      if (failed.length && !manifest.direct && failed.some(r=>[400,405,415,422,501].includes(Number(r.error.status)))) {
        fusionCapability(cfg,'segmentPost',false);
        try {
          const full=await fusionFullTrack(track,identity,cfg);
          return {items:fusionParse(full,track,identity),full:true};
        } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && !refresh) {
        try { return await load(true); } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && refresh && failed.some(r=>fusionUnsupported(r.error))) {
        try {
          const full=await fusionFullTrack(track,identity,cfg);
          return {items:fusionParse(full,track,identity),full:true};
        } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && !ok.length) throw failed[0].error;
      const items=[];
      ok.forEach(r=>{ fusionParse(r.value,track,identity).forEach(c=>items.push(c)); });
      // Repeated records across overlapping manifests have identical upstream IDs.
      return {items:items,partial:failed.length>0};
    }
    return load(false);
  });
  const input=[], errors=[];
  fetched.forEach((r,i)=>{ if (r.error) errors.push(tracks[i].source); else r.value.items.forEach(c=>input.push(c)); });
  const processed=fusionDedupe(input,{enabled:true,tolerance:cfg.tolerance,serverProcessed:false});
  // Official Forward behavior for a standard/full-track response is to return
  // the full comments array. Otherwise a resume beyond minute 1 can stay empty
  // in clients that do not issue progress callbacks for a non-segmented track.
  const available=fetched.filter(r=>r.value);
  const fullTrack=!!initial && available.length>0 && available.every(r=>r.value.full);
  const occurrences=new Map();let occurrenceTime=null;
  const comments=processed.items.filter(c=>fullTrack || c.time>=start && c.time<end).map(c=>{
    if(c.time!==occurrenceTime){occurrences.clear();occurrenceTime=c.time;}
    const key=JSON.stringify([c.episode,c.source,c.recordId,c.time,c.position,c.color,c.content]);
    const ordinal=occurrences.get(key) || 0;occurrences.set(key,ordinal+1);
    return {p:[c.time,[1,4,5].includes(c.position)?c.position:1,c.color].join(','),m:c.content,cid:fusionCommentId(key+':'+ordinal)};
  });
  const successful=tracks.filter((track,i)=>fetched[i].value && fetched[i].value.items.length);
  const proven=new Set();
  successful.forEach(track=>(track.serverSources || [track.source]).forEach(source=>{if(source && source!=='unknown') proven.add(source);}));
  const aggregation={mode:successful.some(track=>track.serverMerged)?'server':proven.size>1?'client':'single',sourceCount:proven.size || null,successfulTrackCount:successful.length};
  return Object.assign(adaptComments({comments:comments}),{fullTrack:fullTrack,aggregation:aggregation,partial:errors.length>0 || fetched.some(r=>r.value && r.value.partial),error:errors.length===tracks.length?'all_sources_failed':undefined,stats:processed.stats,sources:tracks.map(t=>t.source),failedSources:errors,fullFallback:fetched.some(r=>r.value && r.value.full),segment:{segment_start:start,segment_end:end}});
}

async function fusionLoad(params,initial) {
  try {
    const cfg=fusionOptions(params), identity=fusionIdentity(params);
    const time=params.segmentTime==null || params.segmentTime==='' ? 0 : Number(params.segmentTime);
    if (!Number.isFinite(time) || time<0) throw new Error('播放时间无效');
    const start=Math.floor(time/cfg.chunk)*cfg.chunk, end=start+cfg.chunk;
    return await fusionCached(fusionKey(identity,cfg,[initial?'initial':'window',params.animeId,params.commentId,start]),cfg,
      ()=>fusionWindow(params,identity,cfg,start,end,initial));
  } catch(e) {
    return {count:0,comments:[],error:String(e.message || '弹幕加载失败'),success:false};
  }
}

async function getDanmuWithSegmentTime(params) { return fusionMultiComments(params || {},true); }

/* AGPL-3.0-only. Small Forward adapter; no browser/Node globals required.
 * Reference behavior: real API IDs -> episodes[] -> response.data.
 * Keep the experimental client aggregation engine separate from this path.
 */
// Recovery stages 1..6 are exercised independently by the timer-free harness.
// This is an internal build default, never a user-visible/configurable option.
let compatStage=6;
const compatEvents=[];
const compatLookups=new Map();
const compatResponses=new Map();
const compatPending=new Map();
const compatYearMatches=new Map();
const compatSafeErrors=new WeakSet();
const compatCommentJobs=new Map();
const compatValidated=new WeakSet();
const compatWindows=new WeakMap();
const compatCounters={validations:0,records:0};
const compatMatchUnsupported=new Set();
let compatStorageQueue=Promise.resolve();

function compatMessage(code,status){
  if(code==='HTTP_STATUS')return status===401 || status===403?'接口认证失败，请检查地址中的凭据或访问权限':status===404?'接口地址不存在，请检查服务器根地址':status>=500?'弹幕服务器暂时故障，请稍后重试':'接口拒绝了请求，请检查服务端兼容性';
  const messages={INVALID_ADDRESS:'API 地址格式错误，请填写 HTTP(S) 服务器根地址或以 /api/v2 结尾的地址',NO_API:'请先填写有效的弹幕 API 地址',TIMEOUT:'弹幕请求超时，请稍后重试或手动选择其他来源',NETWORK:'无法连接弹幕服务器，请检查网络后重试',NO_RESULTS:'没有找到匹配作品，可尝试手动搜索其他片名',NO_COMMENTS:'当前剧集暂无弹幕，可手动选择其他来源',SOURCE_CHANGED:'已选来源的地址或凭据已变化，请重新搜索并选择',PREFERENCE_EXPIRED:'来源记忆已失效，将重新验证并推荐',UNPROVEN_TIMELINE:'缺少同集、片长或视频版本证据，请独立选择来源',TIMELINE_CHANGED:'弹幕视频版本已变化，已停止自动使用该来源，请重新选源',FALLBACK_USED:'原来源不可用，已切换至验证过的同集同版本备用来源',FALLBACK_FAILED:'原来源和已验证备用来源均不可用，请手动重新选源',BUSY:'当前请求较多，请稍后重试',PENDING_TASK:'服务器正在准备弹幕，请稍后重试',INVALID_SELECTION:'历史选择无效，请重新搜索',AMBIGUOUS_LEGACY_ID:'旧选择未绑定来源，请重新搜索并选择',TOO_LARGE:'弹幕响应超过容量限制，请独立选择其他来源',TOO_MANY_COMMENTS:'弹幕条数超过容量限制，请独立选择其他来源',MERGE_CAPACITY:'合并轨道超过容量限制，已返回一条完整来源'};
  return messages[code] || (/^INVALID_|^MISSING_|EMPTY_RESPONSE|API_ERROR/.test(code)?'弹幕接口返回格式异常或缺少必要数据，请向开发者反馈诊断摘要':null);
}
function compatCategory(code,status){return code==='HTTP_STATUS'?(status===401 || status===403?'AUTH':status===404?'NOT_FOUND':status>=500?'SERVER':'HTTP'):code;}
function compatLog(stage,code,message,status) {
  const event={stage:stage,code:code,category:compatCategory(code,status),message:compatMessage(code,status) || message};
  if(Number.isInteger(status))event.status=status;
  compatEvents.push(event);if(compatEvents.length>64)compatEvents.shift();
  // Only fixed messages/counts. Never log native exceptions or server text.
  if(typeof console!=='undefined' && typeof console.log==='function')console.log('[Danmu Fusion]['+stage+']['+event.category+'] '+event.message);
}
function compatDiagnostics(){return JSON.parse(JSON.stringify(compatEvents));}
function compatSummary(){return {version:WidgetMetadata.version,events:compatDiagnostics().filter(e=>!['OK','REQUEST','RESPONSE','HIT','READY','RETURN','COUNTS'].includes(e.code)).slice(-12)};}
function compatEmpty(error){
  const safe=error && compatSafeErrors.has(error),code=safe?error.code:'RUNTIME_ERROR',status=safe?error.status:undefined;
  return {comments:[],count:0,success:false,error:{code:code,category:compatCategory(code,status)},message:compatMessage(code,status) || '弹幕加载异常，请向开发者反馈诊断摘要',diagnostics:compatSummary()};
}
function compatSetStage(stage){compatStage=Math.max(1,Math.min(6,Number(stage)||1));compatLookups.clear();compatResponses.clear();compatPending.clear();compatYearMatches.clear();compatMatchUnsupported.clear();}
function compatError(stage,code,message,status){const e=new Error(message);e.fusionSafe=true;e.stage=stage;e.code=code;e.status=status;compatSafeErrors.add(e);return e;}
function compatFailure(stage,error){
  if(error && compatSafeErrors.has(error))compatLog(error.stage,error.code,error.message,error.status);
  else compatLog(stage,'RUNTIME_ERROR','模块运行异常，请反馈安全诊断摘要');
}
function compatConfig(params){
  try{
    const cfg=parseDanmuApiUrl(firstPresent(params,['danmu_api_url','server']) || '');
    if(/\/api\/v2\/(?:search\/(?:anime|episodes)|bangumi\/[^/]+|comment\/[^/]+|match|segmentcomment)\/?$/i.test(cfg.requestBase))throw new Error('endpoint');
    const authority=(cfg.requestBase.match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
    const parsed=authority.match(/^(?:\[[a-f0-9:.]+\]|[^:[\]]+)(?::(\d+))?$/i);
    if(!parsed || parsed[1]!=null && !(Number(parsed[1])>=1 && Number(parsed[1])<=65535) || /%(?![a-f0-9]{2})/i.test(cfg.requestBase+'?'+cfg.query))throw new Error('address');
    compatLog('Address','OK','API address normalized');return cfg;
  }catch(e){throw compatError('Address','INVALID_ADDRESS','Invalid API address; use an HTTP(S) server root or /api/v2 suffix');}
}
function compatPresent(id){return id!==undefined && id!==null && String(id).trim()!=='';}
function compatLegacyId(id){return /^(?:fusion-auto:|fusion-track:|tmdb_|fusion_(?:tv|movie)_)/i.test(String(id)) || Number(id)<=-1000000000 && Number(id)>-2000000000;}
function compatKey(cfg,id){return fusionDigest(JSON.stringify([cfg.requestBase,cfg.query || '',String(id)]));}
function compatPlaybackKey(cfg,params,id){return compatKey(cfg,[id,params.tmdbId,params.type,params.seriesName,params.title,params.season,params.episode].join('|'));}

async function compatHttp(cfg,path,stage,body){
  const key=fusionDigest(JSON.stringify([cfg.requestBase,cfg.query || '',path,body || null]));
  // Responses are private to the adapter. Public results are copied at output.
  if(compatPending.has(key)){const data=await compatPending.get(key);return stage==='Comments' || stage==='Segment'?data:compatCopy(data);}
  if(compatPending.size>=12)throw compatError(stage,'BUSY','Native request capacity reached; retry later');
  const task=(async()=>{
    compatLog(stage,'REQUEST','Request started');
    if(typeof Widget==='undefined' || !Widget.http || typeof Widget.http.get!=='function')throw compatError('Init','HTTP_UNAVAILABLE','Widget.http.get unavailable');
    let response;
    try{
      const external=/^https?:\/\//i.test(path);
      const url=external?path:cfg.requestBase+path+(cfg.query?(path.includes('?')?'&':'?')+cfg.query:'');
      if(body){
        if(typeof Widget.http.request==='function')response=await Widget.http.request({url:url,method:'POST',data:body,headers:headers()});
        else if(typeof Widget.http.post==='function')response=await Widget.http.post(url,body,{headers:headers()});
        else throw compatError('Match','POST_UNAVAILABLE','Optional match POST unavailable');
      }else response=await Widget.http.get(url,{headers:headers()});
    }
    catch(e){
      if(e && compatSafeErrors.has(e))throw e;
      const status=Number(e && (e.statusCode || e.status || e.response && (e.response.statusCode || e.response.status)));
      if(status>=400 && status<=599)throw compatError('HTTP','HTTP_STATUS','Request failed: '+status,status);
      const timeout=e && (e.name==='AbortError' || e.name==='TimeoutError' || e.code==='ETIMEDOUT' || e.code===-1001);
      throw compatError('HTTP',timeout?'TIMEOUT':'NETWORK',timeout?'Request timed out in native HTTP':'Request failed: network or native HTTP error');
    }
    if(!response)throw compatError('HTTP','EMPTY_RESPONSE','Empty HTTP response');
    const status=Number(response.statusCode || response.status || 200);
    if(status>=400)throw compatError('HTTP','HTTP_STATUS','Request failed: '+status,status);
    // Exactly one response.data unwrap, as in the working Rex modules.
    let data=response.data!==undefined?response.data:response;
    if(typeof data==='string'){
      if(data.length>64000000)throw compatError(stage,'TOO_LARGE','Response exceeds 64 MB size limit');
      try{data=JSON.parse(data);}catch(e){throw compatError(stage,'INVALID_JSON','Invalid JSON response');}
    }
    if(!data || typeof data!=='object')throw compatError(stage,'INVALID_RESPONSE','Invalid response structure');
    if(data.success===false || Number(data.errorCode)>0)throw compatError(stage,'API_ERROR','API reported failure');
    compatLog(stage,'RESPONSE','Response parsed');return data;
  })();
  compatPending.set(key,task);
  try{return await task;}finally{compatPending.delete(key);}
}

async function compatRemember(cfg,candidate){
  const id=candidate.animeId,key=compatKey(cfg,id);
  const record={expires:Date.now()+300000,candidate:candidate};
  compatLookups.set(key,record);
  while(compatLookups.size>32)compatLookups.delete(compatLookups.keys().next().value);
  if(compatStage<5 || typeof Widget==='undefined' || !Widget.storage)return;
  // Only lightweight lookup metadata is persisted, always as JSON strings.
  // Full comments are memory-only; storage failure never blocks playback.
  const storeKey='fusion-compat-v1:lookup:'+key;
  const write=compatStorageQueue.then(async()=>{
  try{
    const value=JSON.stringify(record);if(value.length>200000)return;
    await Widget.storage.set(storeKey,value);
    const indexKey='fusion-compat-v1:lookup-index';
    let list=await Widget.storage.get(indexKey);try{list=typeof list==='string'?JSON.parse(list):list;}catch(e){list=[];}
    if(!Array.isArray(list))list=[];
    list=list.filter(k=>k!==storeKey);list.push(storeKey);
    while(list.length>32){const old=list.shift();if(Widget.storage.remove)await Widget.storage.remove(old);}
    await Widget.storage.set(indexKey,JSON.stringify(list));
  }catch(e){compatLog('Cache','STORAGE_UNAVAILABLE','Optional lookup storage unavailable');}
  });compatStorageQueue=write.catch(()=>{});await write;
}
async function compatRecall(cfg,id){
  const key=compatKey(cfg,id);let record=compatLookups.get(key);
  if(!record && compatStage>=5 && typeof Widget!=='undefined' && Widget.storage){
    try{record=await Widget.storage.get('fusion-compat-v1:lookup:'+key);if(typeof record==='string')record=JSON.parse(record);}catch(e){}
  }
  return record && record.expires>Date.now()?record.candidate:null;
}
function compatDeclaredSeason(value){
  const m=String(value || '').match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*季|\bS(\d{1,2})(?:E\d+)?\b|season\s*(\d+)/i);
  if(!m)return null;
  const valueString=m[1] || m[2] || m[3],digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if(/^\d+$/.test(valueString))return Number(valueString);
  const parts=valueString.split('十');return parts.length>1?(digits[parts[0]] || 1)*10+(digits[parts[1]] || 0):digits[valueString];
}
function compatRank(candidates,params){
  if(compatStage<2)return candidates;
  const identity=fusionIdentity(params), evidence=fusionSeriesEvidence(candidates.map(fusionCandidate),identity);
  return evidence.map((a,index)=>{
    const pair=fusionSeasonCandidate(identity,a), match=fusionMatch(pair.identity,pair.candidate);
    // Ranking is advisory: uncertain candidates remain selectable. Never insert
    // a synthetic automatic track that depends on missing playback metadata.
    const title=String(a.animeTitle || ''),kind=String(a.type || '')+' '+String(a.typeDescription || '')+' '+String(a.mediaType || '');
    const derivative=/纪录|紀錄|纪实|紀實|documentary|docuseries|解说|解說|赏析|賞析|影评|影評|剧评|劇評|速看|预告|預告|花絮|特辑|特輯|剧情解析|剧情解读|commentary|review|recap|trailer/i.test(title+' '+kind);
    const names=[identity.title,identity.original_title].concat(identity.aliases || []).filter(Boolean).map(n=>identity.isMovie?fusionTitle(n):fusionSeriesName(n,identity.season));
    const name=identity.isMovie?fusionTitle(title):fusionSeriesName(title,pair.candidate.season || identity.season);
    const movie=/movie|film|电影|電影|剧场版|劇場版/i.test(kind),tv=fusionTvType(a);
    const explicitSeason=pair.candidate.season!=null?Number(pair.candidate.season):compatDeclaredSeason(title);
    // Rex may automatically explore the first candidate. Keeping a known
    // conflicting season/name here can silently load another work's comments.
    let allowed=!derivative && names.includes(name) && !(movie && !identity.isMovie || tv && identity.isMovie);
    if(!identity.isMovie && explicitSeason!=null && Number(explicitSeason)!==Number(identity.season))allowed=false;
    if(!identity.isMovie && tv && identity.reliableSE && Number(identity.season)>1 && explicitSeason==null)allowed=false;
    if(match.reason==='special_conflict' || match.reason==='id_conflict')allowed=false;
    const airYear=!identity.isMovie && yearFrom(params.airDate),candidateYear=compatReleaseYear(a);
    if(candidateYear && identity.year && candidateYear!==String(identity.year) && (identity.isMovie || Number(identity.season)<=1))allowed=false;
    if(airYear && candidateYear && airYear!==candidateYear)allowed=false;
    return {candidate:candidates[index],index:index,score:match.reliable?100:0,allowed:allowed};
  }).filter(a=>a.allowed).sort((a,b)=>b.score-a.score || a.index-b.index).map(a=>a.candidate);
}

function compatReleaseYear(candidate){
  const explicit=String(candidate.startDate || candidate.year || '').match(/\b(?:19|20)\d{2}\b/);
  const title=fusionNormalize(candidate.animeTitle || candidate.title || '');
  const annotated=title.match(/\(((?:19|20)\d{2})(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\)/);
  return explicit?explicit[0]:annotated?annotated[1]:null;
}
function compatYearMatchPlan(params,raw){
  const identity=fusionIdentity(params);
  // A later season's year is not the series premiere year. Only its episode
  // airDate is independent evidence; never turn the series year into S04's year.
  const year=identity.isMovie?identity.year:yearFrom(params.airDate) || (Number(identity.season)===1?identity.year:null);
  if(!year || identity.special || !identity.isMovie && !identity.reliableSE)return null;
  const name=identity.isMovie?fusionTitle(identity.title):fusionSeriesName(identity.title,identity.season);
  const years=new Set(raw.filter(c=>{
    const pair=fusionSeasonCandidate(identity,fusionCandidate(c));
    const candidateName=identity.isMovie?fusionTitle(c.animeTitle):fusionSeriesName(c.animeTitle,pair.candidate.season || identity.season);
    if(candidateName!==name)return false;
    const kind=String(c.type || '')+' '+String(c.typeDescription || '');
    if(identity.isMovie?fusionTvType(c):/movie|film|电影|電影|剧场版|劇場版/i.test(kind))return false;
    if(!identity.isMovie && pair.candidate.season!=null && Number(pair.candidate.season)!==Number(identity.season))return false;
    return true;
  }).map(compatReleaseYear).filter(Boolean));
  // Only disambiguate actual year conflicts; normal playback adds no POST.
  if(years.size<2)return null;
  let title=String(identity.title || '').replace(/\s*from\s+[a-z0-9&_-]+.*$/i,'').replace(/[【\[][^】\]]*[】\]]/g,'').replace(/[（(](?:19|20)\d{2}[）)]/g,'').trim();
  if(!identity.isMovie){
    title=title.replace(/第\s*[一二三四五六七八九十\d]+\s*季|\bS\d{1,2}(?:E\d+)?\b|season\s*\d+/gi,'').trim();
    if(/[\u4e00-\u9fff]/.test(title) && Number(identity.season)>1)title=title.replace(new RegExp(String(identity.season)+'$'),'').trim();
  }
  if(!title || /^https?:/i.test(title))return null;
  return {identity:identity,year:String(year),fileName:title+'.'+year+(identity.isMovie?'':'.S'+String(identity.season).padStart(2,'0')+'E'+String(identity.episode).padStart(2,'0'))};
}
async function compatVerifyYear(cfg,params,raw,candidates){
  if(compatStage<2 || !candidates.length || compatMatchUnsupported.has(compatKey(cfg,'match')))return candidates;
  const plan=compatYearMatchPlan(params,raw);
  if(!plan || !Widget.http || typeof Widget.http.request!=='function' && typeof Widget.http.post!=='function')return candidates;
  const key=compatKey(cfg,plan.fileName);let data,saved=compatYearMatches.get(key);
  try{
    if(saved && saved.expires>Date.now())data=saved.data;
    else{
      // Official MatchRequest has no year property. danmu_api extracts the
      // year from fileName; filename-only mode needs neither file bytes nor MD5.
      data=await compatHttp(cfg,'/api/v2/match','Match',{fileName:plan.fileName,fileHash:null,fileSize:0,videoDuration:0,matchMode:'fileNameOnly'});
      if(!Array.isArray(data.matches))throw compatError('Match','INVALID_MATCHES','Invalid match response; keeping standard search results');
      compatYearMatches.set(key,{expires:Date.now()+300000,data:data});
      while(compatYearMatches.size>16)compatYearMatches.delete(compatYearMatches.keys().next().value);
    }
    const confirmed=new Set();
    for(const match of data.matches.slice(0,32)){
      if(!match || !compatPresent(match.animeId) || !compatPresent(match.episodeId))continue;
      const candidate=candidates.find(c=>String(c.animeId)===String(match.animeId));
      // A filename match is advisory, even when isMatched=true. It may apply
      // a server mapping/preference or incorrectly return S01 for S04.
      if(!candidate || compatReleaseYear(candidate)!==plan.year)continue;
      const returnedYear=compatReleaseYear(match);if(returnedYear && returnedYear!==plan.year)continue;
      const checked=Object.assign({},candidate,{animeTitle:match.animeTitle || candidate.animeTitle,type:match.type || candidate.type,typeDescription:match.typeDescription || candidate.typeDescription});
      if(!compatRank([checked],Object.assign({},params,{year:plan.year})).length)continue;
      if(!plan.identity.isMovie && fusionEpisodeNumber(match)!==Number(plan.identity.episode))continue;
      const episodeSeason=compatDeclaredSeason(match.episodeTitle);
      if(!plan.identity.isMovie && episodeSeason!=null && episodeSeason!==Number(plan.identity.season))continue;
      confirmed.add(String(candidate.animeId));
    }
    compatLog('Match',confirmed.size?'YEAR_VERIFIED':'UNVERIFIED','Year match verified candidates: '+confirmed.size+'; unverified results ignored');
    // Keep a reliable native multi-source resource ahead of a single source.
    return candidates.map((c,index)=>({c:c,index:index,score:(Array.isArray(c.mergedChildren)&&c.mergedChildren.length?2:0)+(confirmed.has(String(c.animeId))?1:0)})).sort((a,b)=>b.score-a.score || a.index-b.index).map(v=>v.c);
  }catch(e){
    if([401,403,404,405,501].includes(e.status))compatMatchUnsupported.add(compatKey(cfg,'match'));
    while(compatMatchUnsupported.size>16)compatMatchUnsupported.delete(compatMatchUnsupported.values().next().value);
    compatFailure('Match',e);compatLog('Match','FALLBACK','Optional year match unavailable; keeping standard search results');return candidates;
  }
}
async function fusionCompatSearch(params){
  try{
    const cfg=compatConfig(params);
    // Rex passes the user's manual search term in title; seriesName continues
    // to describe the video and must not replace that explicit search term.
    const title=String(params.title || params.keyword || params.seriesName || '').trim();
    if(!title){compatLog('Search','MISSING_TITLE','Missing title');return {animes:[]};}
    let data;
    try{data=await compatHttp(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(title),'Search');}
    catch(e){if(![404,405,501].includes(e.status))throw e;}
    if(!data || Array.isArray(data.animes) && !data.animes.length)data=await compatHttp(cfg,'/api/v2/search/episodes?anime='+encodeURIComponent(title),'Search');
    if(!Array.isArray(data.animes))throw compatError('Search','INVALID_ANIMES','Invalid response structure: animes must be an array');
    const raw=data.animes.filter(a=>a && compatPresent(a.animeId) && typeof a.animeTitle==='string');
    const animes=await compatVerifyYear(cfg,params,raw,compatRank(raw,params));
    for(const candidate of animes.slice(0,32))await compatRemember(cfg,candidate);
    if(!animes.length)compatLog('Search','NO_RESULTS','No matching work');
    compatLog('Search','RETURN','Returning animes: '+animes.length);
    return animes.length?{animes:animes}:{animes:[],message:compatMessage('NO_RESULTS'),diagnostics:compatSummary()};
  }catch(e){compatFailure('Search',e);const failure=compatEmpty(e);return {animes:[],message:failure.message,error:failure.error,diagnostics:failure.diagnostics};}
}

function compatEpisodes(data){
  if(!data || !data.bangumi || !Array.isArray(data.bangumi.episodes))throw compatError('Detail','INVALID_EPISODES','Invalid response structure: bangumi.episodes must be an array');
  const episodes=data.bangumi.episodes.filter(e=>e && compatPresent(e.episodeId)).map(e=>{
    const copy=Object.assign({},e);
    if(copy.episodeNumber==null){const number=fusionEpisodeNumber(e);if(number!=null)copy.episodeNumber=String(number);}
    return copy;
  });
  if(data.bangumi.episodes.length && !episodes.length)throw compatError('Detail','MISSING_EPISODE_ID','Episode entries missing episodeId');
  return episodes;
}
async function fusionCompatDetail(params){
  try{
    if(!compatPresent(params.animeId))throw compatError('Detail','MISSING_ANIME_ID','Missing animeId');
    if(compatLegacyId(params.animeId))throw compatError('Detail','LEGACY_SELECTION','Legacy automatic selection; select a real search result again');
    const cfg=compatConfig(params), selected=await compatRecall(cfg,params.animeId);
    if(selected && Array.isArray(selected.episodes)){
      const result=compatEpisodes({bangumi:{episodes:selected.episodes}});compatLog('Detail','RETURN','Returning episodes: '+result.length);return result;
    }
    let data;
    try{data=await compatHttp(cfg,'/api/v2/bangumi/'+encodeURIComponent(String(params.animeId)),'Detail');}
    catch(e){
      // Try only an alternate ID explicitly supplied for this selected record.
      // danmu_api normally uses numeric animeId; some compatible services use A….
      if(![400,404,422].includes(e.status) || !selected || !compatPresent(selected.bangumiId) || String(selected.bangumiId)===String(params.animeId))throw e;
      compatLog('Detail','ALTERNATE_ID','Retrying server-provided alternate ID');
      data=await compatHttp(cfg,'/api/v2/bangumi/'+encodeURIComponent(String(selected.bangumiId)),'Detail');
    }
    const episodes=compatEpisodes(data);compatLog('Detail','RETURN','Returning episodes: '+episodes.length);return episodes;
  }catch(e){compatFailure('Detail',e);return [];}
}

function compatCopy(value){
  if(!value || typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(compatCopy);
  const copy={};for(const key of Object.keys(value))copy[key]=compatCopy(value[key]);return copy;
}
function compatSave(key,data,track){
  if(compatStage<5 || !data || data.taskId || Array.isArray(data.comments) && !data.comments.length)return;
  let bytes,value;
  if(track){
    // Count object/index overhead as well as UTF-16 payload. Stop estimating as
    // soon as it is too big; never serialize an entire oversized track to reject it.
    bytes=256+data.comments.length*160;
    if(bytes>2*1024*1024)return;
    const metadata=Object.assign({},data);delete metadata.comments;
    bytes+=JSON.stringify(metadata).length*2;
    for(const c of data.comments){bytes+=JSON.stringify(c).length*2;if(bytes>2*1024*1024)return;}
    const windows=new Map();
    for(let i=0;i<data.comments.length;i++){
      const minute=Math.floor(compatTime(data.comments[i])/60);
      if(!windows.has(minute))windows.set(minute,[]);windows.get(minute).push(i);
    }
    compatWindows.set(data,windows);value=data;
  }else{value=JSON.stringify(data);bytes=value.length*2;if(bytes>2*1024*1024)return;}
  // Expire all entries on access/insertion, with no timer dependency.
  for(const [k,v] of compatResponses)if(v.expires<=Date.now())compatResponses.delete(k);
  compatResponses.delete(key);compatResponses.set(key,{expires:Date.now()+180000,value:value,bytes:bytes,track:!!track});
  let size=0;compatResponses.forEach(v=>{size+=v.bytes;});
  while(compatResponses.size>4 || size>2*1024*1024){const first=compatResponses.keys().next().value;size-=compatResponses.get(first).bytes;compatResponses.delete(first);}
}
function compatRead(key,borrow){
  if(compatStage<5)return null;
  for(const [k,v] of compatResponses)if(v.expires<=Date.now())compatResponses.delete(k);
  const saved=compatResponses.get(key);if(!saved)return null;
  compatLog('Cache','HIT','Cache hit');
  return saved.track?(borrow?saved.value:compatCopy(saved.value)):JSON.parse(saved.value);
}
function compatCacheStats(){let bytes=0;compatResponses.forEach(v=>bytes+=v.bytes);return {entries:compatResponses.size,bytes:bytes,pending:compatPending.size,commentJobs:compatCommentJobs.size,validations:compatCounters.validations,records:compatCounters.records};}
function compatTime(c){return Number(c.p.slice(0,c.p.indexOf(',')));}
function compatCommentsResult(data,progress,params){
  if(!Array.isArray(data.comments))throw compatError('Comments','INVALID_COMMENTS','Invalid response structure: comments must be an array');
  // Verified native multi-source movies exceed 200k rows. The old limit made
  // an otherwise valid merged track empty; keep the full verified-size track.
  if(data.comments.length>500000)throw compatError('Comments','TOO_MANY_COMMENTS','Comment count exceeds 500000 safety limit');
  if(!compatValidated.has(data)){compatCounters.validations++;compatCounters.records+=data.comments.length;}
  const seen=new Set();let invalid=0,removed=0;
  let list=compatValidated.has(data)?data.comments:data.comments.filter(c=>{
    const fields=c && typeof c.p==='string'?c.p.split(','):[];
    if(!c || fields.length<3 || !fields[0].trim() || c.m==null || !Number.isFinite(Number(fields[0])) || Number(fields[0])<0 || !Number.isFinite(Number(fields[1])) || !Number.isFinite(Number(fields.length>=8?fields[3]:fields[2]))){invalid++;return false;}
    if(compatStage<4 || !compatPresent(c.cid))return true;
    const key=JSON.stringify([c.cid,c.p,c.m]);if(seen.has(key)){removed++;return false;}seen.add(key);return true;
  });
  if(invalid && !list.length)throw compatError('Comments','INVALID_RECORDS','Invalid comment records: expected p and m');
  if(progress && compatStage>=6){
    const time=Number(params.segmentTime);if(!Number.isFinite(time) || time<0)throw compatError('Comments','INVALID_PROGRESS','Invalid segmentTime');
    const start=Math.floor(time/60)*60,windows=compatWindows.get(data);
    list=windows?(windows.get(start/60) || []).map(i=>data.comments[i]):list.filter(c=>compatTime(c)>=start && compatTime(c)<start+60);
  }
  compatLog('Parse','COUNTS','Comments parsed: '+data.comments.length+'; invalid: '+invalid+'; duplicates: '+removed+'; returned: '+list.length);
  const result=Object.assign({},data,{comments:list,count:list.length});
  compatValidated.add(result);return result;
}
async function compatLoadComments(cfg,params,id,key){
  const cached=compatRead(key,true);if(cached)return cached;
  if(compatCommentJobs.has(key))return compatCommentJobs.get(key);
  if(compatCommentJobs.size>=12)throw compatError('Comments','BUSY','Comment request capacity reached');
  const task=compatFetchComments(cfg,params,id,key);compatCommentJobs.set(key,task);
  try{return await task;}finally{compatCommentJobs.delete(key);}
}
async function compatFetchComments(cfg,params,id,key){
  const related=compatStage>=3?'true':'false';let data;
  try{data=await compatHttp(cfg,'/api/v2/comment/'+encodeURIComponent(String(id))+'?async=1&withRelated='+related+'&chConvert=1','Comments');}
  catch(e){
    if(![400,422].includes(e.status))throw e;
    compatLog('Comments','STANDARD_FALLBACK','Optional comment parameters rejected; using standard request');
    data=await compatHttp(cfg,'/api/v2/comment/'+encodeURIComponent(String(id))+'?withRelated='+related,'Comments');
  }
  if(data.taskId && (!Array.isArray(data.comments) || !data.comments.length)){
    compatLog('Comments','PENDING_TASK','Server download pending; retry playback later');return Object.assign({},data,{comments:[],count:0});
  }
  if(Array.isArray(data))data={comments:data};
  if(Array.isArray(data.comments)){
    data=compatCommentsResult(data,false,params);compatSave(key,data,true);
  }
  return data;
}
async function fusionCompatComments(params,progress){
  try{
    const id=firstPresent(params,['commentId','episodeId']);
    if(!compatPresent(id))throw compatError('Comments','MISSING_COMMENT_ID','Missing commentId');
    if(compatLegacyId(id))throw compatError('Comments','LEGACY_SELECTION','Legacy automatic selection; select an episode again');
    const cfg=compatConfig(params),key=compatPlaybackKey(cfg,params,id);
    let data=await compatLoadComments(cfg,params,id,key);
    if(compatStage>=6 && Array.isArray(data.barrage_list) && data.barrage_list.length && (!Array.isArray(data.comments) || !data.comments.length)){
      const time=Number(params.segmentTime || 0);
      if(!Number.isFinite(time) || time<0)throw compatError('Comments','INVALID_PROGRESS','Invalid segmentTime');
      const segment=data.barrage_list.find(s=>s && time>=Number(s.segment_start) && time<Number(s.segment_end));
      if(!segment){compatLog('Segment','EMPTY','No segment at requested time');return {comments:[],count:0};}
      if(!/^https?:\/\//i.test(String(segment.segment_url || '')))throw compatError('Segment','INVALID_URL','Invalid segment URL');
      const segmentKey=key+':segment:'+fusionDigest(JSON.stringify(segment));
      let fragment=compatRead(segmentKey,true);
      if(!fragment){fragment=await compatHttp(cfg,segment.segment_url,'Segment');if(Array.isArray(fragment))fragment={comments:fragment};fragment=compatCommentsResult(fragment,false,params);compatSave(segmentKey,fragment,true);}
      data=fragment;
    }
    const result=compatCommentsResult(data,!!progress && params.segmentTime!=null,params);
    if(!result.count && !progress && !result.taskId)compatLog('Comments','NO_COMMENTS','No comments in current episode');
    compatLog('Comments','RETURN','Returning response.data comments: '+result.count);
    const output=compatCopy(result);
    for(const field of ['error','message','diagnostics','diagnostic','headers','request','config','authorization','Authorization'])delete output[field];
    if(!output.count && !progress){output.message=compatMessage(output.taskId?'PENDING_TASK':'NO_COMMENTS');output.diagnostics=compatSummary();}
    return output;
  }catch(e){compatFailure('Comments',e);return compatEmpty(e);}
}

compatLog('Init','READY','Adapter ready; browser timers '+(typeof setTimeout==='function'?'available':'unavailable'));

/* AGPL-3.0-only. Advisory source preferences, never routing/merge authority.
 * String-only Widget storage; bounded records, TTL, no credentials or titles.
 */
let preferenceState=null;
let preferenceOperations=0;
const preferenceStorageKey='fusion-preference-v1';
function preferenceKey(e){
  if(!e || !e.title || !e.year || !['tv','movie'].includes(e.kind) || e.kind==='tv' && !(e.season>0))return null;
  return fusionDigest(JSON.stringify([e.title,e.year,e.kind,e.season,e.tmdb || '',e.edition || '',e.language || '',e.context || '']));
}
async function preferenceAccess(sources,update){
  // Preference storage is optional; saturation never delays playback in a queue.
  if(preferenceOperations>=8)return {};
  preferenceOperations++;
  const signature=fusionDigest(sources.map(c=>c.s).sort().join(':'));
  const task=multiStorageQueue.then(async()=>{
    if(!preferenceState){
      try{const saved=Widget.storage && await Widget.storage.get(preferenceStorageKey);if(typeof saved==='string' && saved.length<=20000)preferenceState=JSON.parse(saved);}catch(e){}
    }
    if(!preferenceState || preferenceState.config!==signature || !preferenceState.items || typeof preferenceState.items!=='object' || Array.isArray(preferenceState.items)){
      if(preferenceState)compatLog('Memory','PREFERENCE_EXPIRED','Source preference invalidated');
      preferenceState={config:signature,items:{}};
    }
    const items=preferenceState.items,now=Date.now();
    for(const key of Object.keys(items)){
      const r=items[key];
      if(!/^[a-f0-9]{64}$/.test(key) || !r || !sources.some(c=>c.s===r.source) || !Number.isFinite(r.expires) || r.expires<=now)delete items[key];
    }
    if(update && update.key && sources.some(c=>c.s===update.source)){
      delete items[update.key];items[update.key]={source:update.source,expires:now+30*86400000};
    }
    while(Object.keys(items).length>48)delete items[Object.keys(items)[0]];
    try{if(Widget.storage)await Widget.storage.set(preferenceStorageKey,JSON.stringify(preferenceState));}catch(e){compatLog('Memory','MEMORY_ONLY','Optional preference storage unavailable');}
    return Object.assign({},items);
  });
  multiStorageQueue=task.catch(()=>{});
  try{return await task;}finally{preferenceOperations--;}
}
async function preferenceSelect(sources,ref){
  const key=preferenceKey(ref.e || ref.p && ref.p.work);
  if(!key)return;
  const signature=fusionDigest(sources.map(c=>c.s).sort().join(':'));
  const saved=preferenceState && preferenceState.config===signature && preferenceState.items[key];
  if(saved && saved.source===ref.s && saved.expires>Date.now())return;
  await preferenceAccess(sources,{key:key,source:ref.s});
}
function preferenceMatches(items,e,source){const key=preferenceKey(e);return !!(key && items[key] && items[key].source===source);}

/* AGPL-3.0-only. Incremental orchestration around the verified 1.4.5 adapter.
 * No timers, fetch, URL, Node APIs, or background polling. IDs contain only
 * SHA-256 source fingerprints and real protocol IDs, never configured URLs.
 */
const multiPrefix='df15:';
const multiJobs=new Map();
let multiStorageQueue=Promise.resolve();

// SHA-256 over UTF-8, implemented here because Widget has no crypto global.
function fusionDigest(value){
  const bytes=unescape(encodeURIComponent(String(value))),words=[];
  for(let i=0;i<bytes.length;i++)words[i>>2]=(words[i>>2] || 0)|bytes.charCodeAt(i)<<(24-i%4*8);
  words[bytes.length>>2]=(words[bytes.length>>2] || 0)|0x80<<(24-bytes.length%4*8);
  words[((bytes.length+8>>6)+1)*16-1]=bytes.length*8;
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=[];
  const r=(x,n)=>x>>>n|x<<(32-n);
  for(let offset=0;offset<words.length;offset+=16){
    for(let j=0;j<64;j++){
      if(j<16)w[j]=words[offset+j] || 0;
      else{const a=w[j-15],b=w[j-2];w[j]=((r(a,7)^r(a,18)^a>>>3)+w[j-16]+(r(b,17)^r(b,19)^b>>>10)+w[j-7])|0;}
    }
    let [a,b,c,d,e,f,g,z]=h;
    for(let j=0;j<64;j++){
      const t=(z+(r(e,6)^r(e,11)^r(e,25))+(e&f^~e&g)+k[j]+w[j])|0;
      const t2=((r(a,2)^r(a,13)^r(a,22))+(a&b^a&c^b&c))|0;
      z=g;g=f;f=e;e=d+t|0;d=c;c=b;b=a;a=t+t2|0;
    }
    [a,b,c,d,e,f,g,z].forEach((v,j)=>{h[j]=h[j]+v|0;});
  }
  return h.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
function multiBase(cfg){return cfg.requestBase+(cfg.query?'?'+cfg.query:'');}
function multiSources(params){
  const values=[firstPresent(params,['danmu_api_url','server']),params.danmu_api_url_2,params.danmu_api_url_3],result=[];
  for(let i=0;i<3;i++){
    if(!String(values[i] || '').trim())continue;
    try{
      const cfg=compatConfig({danmu_api_url:values[i]}),fingerprint=fusionDigest(multiBase(cfg));
      if(result.some(c=>c.s===fingerprint)){compatLog('Address','DUPLICATE','Duplicate API ignored');continue;}
      result.push(Object.assign(cfg,{s:fingerprint,slot:i+1}));
    }catch(e){compatFailure('Address',e);}
  }
  if(!result.length)throw compatError('Address','NO_API','No valid API configured');
  return result;
}
function multiParams(params,cfg){
  const descriptors=Object.getOwnPropertyDescriptors(params);
  for(const key of ['api_mode','aggregate','sources','source_priority','dedupe','dedupe_tolerance','offset_owner','offset_rules','cache_ttl','timeout','retry','cache','color_to_white','force_scroll','debug'])delete descriptors[key];
  const copy=Object.defineProperties({},descriptors);
  Object.defineProperty(copy,'danmu_api_url',{value:multiBase(cfg),writable:true,enumerable:true,configurable:true});return copy;
}
function multiRawId(id){return (typeof id==='string' && id.length>0 && id.length<=512 && !/^https?:\/\//i.test(id) || typeof id==='number' && Number.isSafeInteger(id)) && !String(id).startsWith(multiPrefix);}
function multiId(kind,refs){
  const id=multiPrefix+kind+':'+encodeURIComponent(JSON.stringify(refs));
  if(id.length>12000)throw compatError('Route','ID_TOO_LARGE','Selection too large; choose an individual source');
  return id;
}
function multiDecode(id,kind,sources){
  if(!String(id).startsWith(multiPrefix))return null;
  try{
    const text=String(id);if(text.length>12000 || !text.startsWith(multiPrefix+kind+':'))throw 0;
    const refs=JSON.parse(decodeURIComponent(text.slice((multiPrefix+kind+':').length)));
    if(!Array.isArray(refs) || refs.length<1 || refs.length>3 || new Set(refs.map(r=>r.s)).size!==refs.length)throw 0;
    for(const ref of refs){
      if(!ref || !/^[a-f0-9]{64}$/.test(ref.s) || !multiRawId(ref.i) || ref.b!=null && !multiRawId(ref.b))throw 0;
      if(!sources.some(s=>s.s===ref.s))throw compatError('Route','SOURCE_CHANGED','Selected API changed or was removed; search and select again');
      if(ref.a!=null){
        if(!Array.isArray(ref.a) || ref.a.length>2 || new Set([ref.s].concat(ref.a.map(r=>r && r.s))).size!==ref.a.length+1)throw 0;
        for(const alt of ref.a){
          if(!alt || !/^[a-f0-9]{64}$/.test(alt.s) || !multiRawId(alt.i) || alt.b!=null && !multiRawId(alt.b) || alt.a!=null)throw 0;
          if(!sources.some(s=>s.s===alt.s))throw compatError('Route','SOURCE_CHANGED','Backup API changed; search and select again');
        }
      }
    }
    return refs;
  }catch(e){if(e && compatSafeErrors.has(e))throw e;throw compatError('Route','INVALID_SELECTION','Invalid historical selection; search and select again');}
}
function multiRef(cfg,candidate,evidence){
  if(!multiRawId(candidate.animeId))throw compatError('Route','INVALID_ID','Unsupported server resource ID');
  const ref={s:cfg.s,i:candidate.animeId};
  if(multiRawId(candidate.bangumiId))ref.b=candidate.bangumiId;
  if(evidence)ref.e=evidence;
  return ref;
}

// Bare 1.4.5 IDs retain their original single-API path. Once observed, the
// primary fingerprint and a bounded set of fresh selections guard URL changes.
// This registry contains no URLs or credentials and uses string-only storage.
const multiBareMemory={};
async function multiBare(sources,kind,id,fresh){
  if(sources.length!==1 || sources[0].slot!==1)throw compatError('Route','AMBIGUOUS_LEGACY_ID','Unbound ID with multiple APIs; search and select again');
  const cfg=sources[0],keys=(Array.isArray(id)?id:[id]).map(value=>fusionDigest(kind+':'+String(value)));
  const operation=multiStorageQueue.then(async()=>{
    let record=multiBareMemory.record;
    if(!record){
      try{const saved=Widget.storage && await Widget.storage.get('fusion-multi-v1:bare');if(typeof saved==='string')record=JSON.parse(saved);}catch(e){}
      if(!record || typeof record.origin!=='string' || !record.ids || typeof record.ids!=='object')record={origin:cfg.s,ids:{}};
    }
    if(!fresh && record.origin!==cfg.s && keys.some(key=>record.ids[key]!==cfg.s))throw compatError('Route','SOURCE_CHANGED','Primary API changed; search and select again');
    if(fresh){for(const key of keys){delete record.ids[key];record.ids[key]=cfg.s;}while(Object.keys(record.ids).length>128)delete record.ids[Object.keys(record.ids)[0]];}
    multiBareMemory.record=record;
    try{if(Widget.storage)await Widget.storage.set('fusion-multi-v1:bare',JSON.stringify(record));}catch(e){compatLog('Route','MEMORY_ONLY','Optional historical selection storage unavailable');}
  });
  multiStorageQueue=operation.catch(()=>{});await operation;
}

// Resolution driven by actual completions. A successful API never waits for a
// slow peer. Late results populate the same bounded cache for the next call.
async function multiFirst(tasks,usable){
  if(!tasks.length)return {values:[],partial:false};
  const states=tasks.map(()=>({done:false,value:null}));let remaining=tasks.length,finish,accepting=true;
  const ready=new Promise(resolve=>{finish=resolve;});
  tasks.forEach((task,index)=>Promise.resolve(task).then(value=>{
    if(accepting)states[index]={done:true,value:value};remaining--;if(usable(value) || !remaining)finish();
  },error=>{if(accepting)states[index]={done:true,value:null};remaining--;compatFailure('MultiAPI',error);if(!remaining)finish();}));
  await ready;
  // Drain already-queued completions; this never waits for a network event.
  await Promise.resolve();
  const values=states.filter(s=>s.done && s.value).map(s=>s.value);
  accepting=false;states.length=0;tasks.length=0;
  return {values:values,partial:remaining>0};
}
async function multiJob(cfg,key,loader){
  const cacheKey=compatKey(cfg,'multi:'+key),cached=compatRead(cacheKey);
  if(cached)return cached;
  const jobKey=cfg.s+':'+key;
  if(multiJobs.has(jobKey))return multiJobs.get(jobKey);
  // Rex retries the series keyword with a season-specific keyword. Allow two
  // independent lookups per API, without an unbounded waiter queue.
  if(Array.from(multiJobs.keys()).filter(k=>k.startsWith(cfg.s+':')).length>=2)throw compatError('MultiAPI','BUSY','API has a pending lookup; retry later');
  const task=(async()=>{try{const value=await loader();if(value && (Array.isArray(value.animes)?value.animes.length:Array.isArray(value.episodes)&&value.episodes.length))compatSave(cacheKey,value);return value;}finally{multiJobs.delete(jobKey);}})();
  multiJobs.set(jobKey,task);return task;
}
function multiNative(candidate){return Array.isArray(candidate.mergedChildren)&&candidate.mergedChildren.length || /\bfrom\s+[a-z0-9_-]+&[a-z0-9_-]+/i.test(candidate.animeTitle || '')?1:0;}
function multiNativeEpisode(episode){
  const tag=String(episode.episodeTitle || '').match(/^\s*(?:【([^】]+)】|\[([^\]]+)\])/);
  const value=tag && (tag[1] || tag[2]);
  if(!value || !/^[a-z0-9_-]+(?:[&＆][a-z0-9_-]+)+$/i.test(value))return false;
  return new Set(value.split(/[&＆]/).map(fusionSource)).size>1;
}
function multiAggregateDisplay(value,field){
  const copy=Object.assign({},value,{source:'聚合'});
  if(value.source && value.source!=='聚合')copy.originalSource=value.source;
  const title=String(value[field] || '');copy[field]=/^【聚合】/.test(title)?title:'【聚合】'+title;
  return copy;
}
// Reuse only unexpired, source-bound native candidates already stored by the
// stable adapter. This keeps late native aggregation discoverable across VMs;
// no new cache, background task, timer or provider allowlist is introduced.
async function multiNativeHints(sources,params){
  const records=new Map();
  for(const [key,record] of compatLookups)records.set('fusion-compat-v1:lookup:'+key,record);
  try{
    if(typeof Widget!=='undefined' && Widget.storage){
      const text=await Widget.storage.get('fusion-compat-v1:lookup-index');
      const index=typeof text==='string' && text.length<5000?JSON.parse(text):[];
      if(Array.isArray(index))for(const key of index.slice(-32)){
        if(typeof key!=='string' || !/^fusion-compat-v1:lookup:[a-f0-9]{64}$/.test(key) || records.has(key))continue;
        const value=await Widget.storage.get(key);
        if(typeof value==='string' && value.length<=200000){try{records.set(key,JSON.parse(value));}catch(e){}}
      }
    }
  }catch(e){compatLog('Cache','NATIVE_HINT_UNAVAILABLE','Optional native candidate lookup unavailable');}
  const result=[];
  for(const [key,record] of records){
    const candidate=record && record.candidate;
    if(!record || !(record.expires>Date.now()) || !candidate || !multiRawId(candidate.animeId) || !multiNative(candidate))continue;
    const cfg=sources.find(c=>key==='fusion-compat-v1:lookup:'+compatKey(c,candidate.animeId));
    if(!cfg || !multiEvidence(candidate,params) || !compatRank([candidate],params).length)continue;
    // Explicit playback versions/languages must not inherit an unknown or
    // conflicting cached edition, even though independent manual search works.
    if(multiEdition(params) && multiEdition(params)!==multiEdition(candidate) || multiLanguage(params) && multiLanguage(params)!==multiLanguage(candidate))continue;
    result.push({s:cfg.s,candidate:candidate});
    if(result.length>=32)break;
  }
  return result;
}
function multiEvidence(candidate,params){
  const identity=fusionIdentity(params),pair=fusionSeasonCandidate(identity,fusionCandidate(candidate)),c=pair.candidate;
  const title=identity.isMovie?fusionTitle(candidate.animeTitle):fusionSeriesName(candidate.animeTitle,c.season);
  const year=compatReleaseYear(candidate),movie=/movie|film|电影|電影|剧场版|劇場版/i.test([candidate.type,candidate.typeDescription,candidate.mediaType].join(' '));
  const season=identity.isMovie?null:c.season!=null?Number(c.season):compatDeclaredSeason(candidate.animeTitle);
  if(!title || !year || identity.special || fusionSpecial(candidate.animeTitle)!=='regular' || (identity.isMovie?!movie:!fusionTvType(candidate) || !(season>0)))return null;
  return {title:title,year:year,kind:identity.isMovie?'movie':'tv',season:season,tmdb:String(c.tmdb_id || c.tmdbId || ''),edition:multiEdition(candidate),language:multiLanguage(candidate),context:fusionDigest(JSON.stringify([identity.tmdb_id || '',identity.year || '',identity.version_key || '',multiEdition(params),multiLanguage(params)]))};
}
function multiSameWork(a,b){return a && b && a.title===b.title && a.year===b.year && a.kind===b.kind && a.season===b.season && !(a.tmdb && b.tmdb && a.tmdb!==b.tmdb) && a.edition===b.edition && a.language===b.language;}
function multiEdition(value){
  const explicit=value.edition || value.version || value.cut;
  const tag=String(value.animeTitle || value.episodeTitle || '').match(/导演剪辑版|導演剪輯版|加长版|加長版|院线版|院線版|未删减版|未刪減版|重映版|修复版|修復版|director.?s?\s*cut|extended(?:\s*cut)?|theatrical(?:\s*cut)?|uncut/i);
  return fusionNormalize(explicit || tag && tag[0] || '').toLowerCase();
}
function multiLanguage(value){return fusionNormalize(value.language || value.audioLanguage || '').toLowerCase();}
async function fusionMultiSearch(params){
  try{
    const sources=multiSources(params);
    if(sources.length===1 && sources[0].slot===1){
      const result=await fusionCompatSearch(multiParams(params,sources[0]));
      if(result.animes.length)await multiBare(sources,'a',result.animes.slice(0,32).map(c=>c.animeId),true);
      return Object.assign({},result,{animes:result.animes.map(c=>multiNative(c)?multiAggregateDisplay(c,'animeTitle'):c)});
    }
    const query=fusionDigest(JSON.stringify([fusionIdentity(params),params.title,params.keyword,params.seriesName]));
    const pending=multiFirst(sources.map(cfg=>multiJob(cfg,'search:'+query,async()=>{
      const result=await fusionCompatSearch(multiParams(params,cfg));return {s:cfg.s,animes:result.animes.slice(0,32)};
    })),v=>v.animes.length>0);
    const [batch,hints]=await Promise.all([pending,multiNativeHints(sources,params)]);
    // A completed fresh response is authoritative, including a valid empty one.
    // Hints fill only APIs absent from this first batch, never override it.
    let reused=0;
    for(const cfg of sources){
      if(batch.values.some(v=>v.s===cfg.s))continue;
      const animes=hints.filter(h=>h.s===cfg.s).map(h=>h.candidate);
      if(animes.length){batch.values.push({s:cfg.s,animes:animes});reused+=animes.length;}
    }
    if(reused)compatLog('Cache','NATIVE_REUSED','Verified recent native candidates reused: '+reused);
    const entries=[];
    for(const cfg of sources){
      const result=batch.values.find(v=>v.s===cfg.s);if(!result)continue;
      for(const c of result.animes){
        if(!multiRawId(c.animeId)){compatLog('Route','INVALID_ID','Unsupported server resource ID skipped');continue;}
        entries.push({cfg:cfg,c:c,e:multiEvidence(c,params)});
      }
    }
    const preferences=await preferenceAccess(sources);
    entries.sort((a,b)=>Number(preferenceMatches(preferences,b.e,b.cfg.s))-Number(preferenceMatches(preferences,a.e,a.cfg.s)) || multiNative(b.c)-multiNative(a.c) || a.cfg.slot-b.cfg.slot);
    const animes=entries.map(v=>{
      const ref=multiRef(v.cfg,v.c,v.e),alternatives=entries.filter(a=>a.cfg.s!==v.cfg.s && multiSameWork(v.e,a.e));
      ref.a=alternatives.filter((a,i)=>alternatives.findIndex(b=>b.cfg.s===a.cfg.s)===i).slice(0,2).map(a=>multiRef(a.cfg,a.c,a.e));
      const id=multiId('a',[ref]),preferred=preferenceMatches(preferences,v.e,v.cfg.s);
      const display=multiNative(v.c)?multiAggregateDisplay(v.c,'animeTitle'):v.c;
      return Object.assign({},display,{animeId:id,bangumiId:id,isFavorited:preferred || v.c.isFavorited,animeTitle:(preferred?'上次来源 · ':'')+display.animeTitle+' · API '+v.cfg.slot});
    });
    // One best (preferably native merged) candidate from each API per identity.
    // Details decide whether episodes actually have sufficient timeline proof.
    const grouped=new Set();let groups=0;
    for(let i=0;i<entries.length && groups<8;i++){
      const root=entries[i];if(!root.e || grouped.has(i))continue;
      const members=[root];
      for(let j=i+1;j<entries.length;j++){
        const v=entries[j];if(members.some(m=>m.cfg.s===v.cfg.s) || !members.every(m=>multiSameWork(m.e,v.e)))continue;
        members.push(v);grouped.add(j);
      }
      if(members.length<2)continue;groups++;
      const id=multiId('a',members.map(v=>multiRef(v.cfg,v.c,v.e)));
      animes.unshift(Object.assign({},root.c,{animeId:id,bangumiId:id,source:'跨 API 选源',originalSource:root.c.source,animeTitle:root.c.animeTitle+' · 跨 API 选源（'+members.map(v=>v.cfg.slot).join('+')+'）'}));
    }
    animes.sort((a,b)=>Number(!!b.isFavorited)-Number(!!a.isFavorited));
    compatLog('MultiAPI',batch.partial?'PARTIAL':'COMPLETE','Search APIs available: '+batch.values.filter(v=>v.animes.length).length+'; candidates: '+animes.length+(batch.partial?'; slow peers continue in bounded cache':''));
    return animes.length?{animes:animes}:{animes:[],message:'未取得可用作品，请查看诊断后重试或手动搜索',diagnostics:compatSummary()};
  }catch(e){compatFailure('Search',e);const failure=compatEmpty(e);return {animes:[],message:failure.message,error:failure.error,diagnostics:failure.diagnostics};}
}
async function multiDetailOne(ref,cfg,params){
  const selected=await compatRecall(cfg,ref.i);
  if(!selected && ref.b!=null)await compatRemember(cfg,{animeId:ref.i,bangumiId:ref.b});
  return fusionCompatDetail(Object.assign(multiParams(params,cfg),{animeId:ref.i}));
}
function multiDuration(episode){
  const value=firstPresent(episode,['durationSeconds','videoDuration','runtimeSeconds','duration']);
  const n=Number(value);return Number.isFinite(n)&&n>0?n:null;
}
function multiTimeline(episode){
  const hash=String(episode.videoHash || episode.fileHash || '').toLowerCase();
  if(/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash))return 'hash:'+hash;
  const url=String(episode.videoUrl || episode.url || '');
  // Public official video URLs establish content identity. Generic API URLs,
  // catalog IDs and unqualified timelineId strings are not timeline evidence.
  const official=/^https?:\/\/v\.qq\.com\/x\/(?:cover\/[a-z0-9]+\/[a-z0-9]+|page\/[a-z0-9]+)\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?iqiyi\.com\/v_[a-z0-9]+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/v\.youku\.com\/v_show\/id_[a-z0-9=]+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?mgtv\.com\/b\/\d+\/\d+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?bilibili\.com\/(?:video\/(?:BV[a-z0-9]+|av\d+)|bangumi\/play\/ep\d+)\/?(?:[?#]|$)/i.test(url);
  if(official)return 'video:'+fusionDigest(url.replace(/^http:/i,'https:').split('#')[0]);
  return null;
}
function multiEpisodeProof(episode,evidence){
  if(!evidence || fusionSpecial(episode.episodeTitle)!=='regular' || /预告|預告|花絮|解说|解說|赏析|上下集|上集|下集|上篇|下篇|[（(][上下][）)]/i.test(episode.episodeTitle || ''))return null;
  const duration=multiDuration(episode),timeline=multiTimeline(episode);
  if(!duration || !timeline)return null;
  const explicit=firstPresent(episode,['season','seasonNumber','_season']),declared=compatDeclaredSeason(episode.episodeTitle);
  if(evidence.kind==='tv' && (explicit!=null && Number(explicit)!==evidence.season || declared!=null && declared!==evidence.season))return null;
  if(evidence.kind==='movie' && !/^(?:【[^】]*】|\[[^\]]*\])?\s*(?:正片|全片)(?:\s|$)/.test(episode.episodeTitle || '') && fusionTitle(episode.episodeTitle)!==evidence.title)return null;
  const number=evidence.kind==='movie'?null:fusionEpisodeNumber(episode);
  if(evidence.kind==='tv' && !(number>0))return null;
  if(multiEdition(episode) && evidence.edition && multiEdition(episode)!==evidence.edition || multiLanguage(episode) && evidence.language && multiLanguage(episode)!==evidence.language)return null;
  const edition=multiEdition(episode)||evidence.edition,language=multiLanguage(episode)||evidence.language;
  return {work:evidence,number:number,duration:duration,timeline:timeline,edition:edition,language:language};
}
function multiSameEpisode(a,b){return a && b && multiSameWork(a.work,b.work) && a.number===b.number && a.duration===b.duration && a.timeline===b.timeline && a.edition===b.edition && a.language===b.language;}
async function fusionMultiDetail(params){
  try{
    const sources=multiSources(params),refs=multiDecode(params.animeId,'a',sources);
    if(!refs){
      if(compatPresent(params.animeId))await multiBare(sources,'a',params.animeId,false);
      const episodes=await fusionCompatDetail(multiParams(params,sources[0]));
      if(episodes.length)await multiBare(sources,'c',episodes.slice(0,2000).map(e=>e.episodeId),true);
      return episodes.map(e=>multiNativeEpisode(e)?multiAggregateDisplay(e,'episodeTitle'):e);
    }
    const requested=refs.slice();
    if(refs.length===1 && refs[0].a)for(const alt of refs[0].a)if(multiSameWork(refs[0].e,alt.e))requested.push(alt);
    const batch=await multiFirst(requested.map(ref=>{
      const cfg=sources.find(c=>c.s===ref.s);
      return multiJob(cfg,'detail:'+fusionDigest(JSON.stringify(ref)),async()=>({ref:ref,episodes:(await multiDetailOne(ref,cfg,params)).slice(0,2000)}));
    }),v=>v.episodes.length>0 && refs.some(r=>r.s===v.ref.s));
    const entries=[];
    for(const ref of requested){
      const result=batch.values.find(v=>v.ref.s===ref.s);if(!result)continue;
      const cfg=sources.find(c=>c.s===ref.s);
      for(const e of result.episodes){
        if(!multiRawId(e.episodeId))continue;
        entries.push({cfg:cfg,e:e,work:ref.e,proof:multiEpisodeProof(e,ref.e)});
      }
    }
    // Index exact proof buckets once. TMDB conflicts are still checked below;
    // duplicate episode numbers per API are counted before recommending backups.
    const proofBuckets=new Map();
    const proofKey=p=>p && JSON.stringify([p.work.title,p.work.year,p.work.kind,p.work.season,p.work.edition,p.work.language,p.number,p.duration,p.timeline,p.edition,p.language]);
    for(const entry of entries){
      const key=proofKey(entry.proof);if(!key)continue;
      if(!proofBuckets.has(key))proofBuckets.set(key,{members:[],counts:new Map()});
      const bucket=proofBuckets.get(key);bucket.members.push(entry);bucket.counts.set(entry.cfg.s,(bucket.counts.get(entry.cfg.s) || 0)+1);
    }
    const episodes=entries.filter(v=>refs.some(r=>r.s===v.cfg.s)).map(v=>{
      const ref={s:v.cfg.s,i:v.e.episodeId,e:v.work,p:v.proof};
      // Duplicate episode numbers within an API are ambiguous, even if hashes
      // happen to agree. Never pick an alternative by array position.
      const bucket=proofBuckets.get(proofKey(v.proof));
      if(bucket && bucket.counts.get(v.cfg.s)===1){
        ref.a=bucket.members.filter(a=>a.cfg.s!==v.cfg.s && bucket.counts.get(a.cfg.s)===1 && multiSameEpisode(v.proof,a.proof)).slice(0,2).map(a=>({s:a.cfg.s,i:a.e.episodeId,p:a.proof}));
      }
      const display=multiNativeEpisode(v.e)?multiAggregateDisplay(v.e,'episodeTitle'):v.e;
      return Object.assign({},display,{episodeId:multiId('c',[ref]),episodeTitle:display.episodeTitle+' · API '+v.cfg.slot});
    });
    const used=new Set();
    for(let i=0;refs.length>1 && i<entries.length;i++){
      if(used.has(i))continue;const root=entries[i],members=[root];
      for(let j=i+1;j<entries.length;j++){
        const v=entries[j];if(members.some(m=>m.cfg.s===v.cfg.s) || !members.every(m=>multiSameEpisode(m.proof,v.proof)))continue;
        members.push(v);used.add(j);
      }
      if(members.length<2)continue;
      episodes.unshift(Object.assign({},multiAggregateDisplay(root.e,'episodeTitle'),{episodeId:multiId('c',members.map(v=>({s:v.cfg.s,i:v.e.episodeId,p:v.proof}))),episodeTitle:'【聚合】'+root.e.episodeTitle+' · 安全聚合 API '+members.map(v=>v.cfg.slot).join('+')}));
    }
    if(refs.length>1 && !episodes.some(e=>e.episodeTitle.includes('安全聚合')))compatLog('Route','UNPROVEN_TIMELINE','Choose independent source');
    compatLog('MultiAPI',batch.partial?'PARTIAL':'COMPLETE','Returning routed episodes: '+episodes.length);
    return episodes;
  }catch(e){compatFailure('Detail',e);return [];}
}
function multiRecordOrigin(c){
  const source=fusionSource(c.source),known=['tencent','iqiyi','youku','imgo','bilibili','migu','aiyifan','dandan','renren','sohu','leshi','bahamut','animeko'];
  const origin=firstPresent(c,['sourceCommentId','originId','originalId']);
  if(known.includes(source) && origin!=null)return [source,String(origin)];
  const cid=String(c.cid || ''),m=cid.match(/^(tencent|iqiyi|youku|imgo|bilibili|migu|aiyifan|dandan|renren|sohu|leshi|bahamut|animeko):(.+)$/i);
  return m?[fusionSource(m[1]),m[2]]:null;
}
function multiMerge(values){
  // Maps keyed by exact source record/time/style/text; no fuzzy text matching.
  // Only cross-API replays are removed. Same-text independent viewers survive.
  const seen=new Map(),comments=[];let removed=0,size=32;
  for(const value of values){
    for(const c of value.data.comments){
      const origin=multiRecordOrigin(c),key=origin?JSON.stringify([origin,c.p,c.m]):null;
      if(key && seen.has(key) && seen.get(key)!==value.s){removed++;continue;}
      if(key && !seen.has(key))seen.set(key,value.s);
      const copy=Object.assign({},c,{cid:multiPrefix+value.s+':'+encodeURIComponent(String(c.cid==null?comments.length:c.cid))});
      size+=JSON.stringify(copy).length+1;
      if(values.length>1 && (comments.length>=500000 || size>64000000)){compatLog('MultiAPI','MERGE_CAPACITY','Combined track exceeds capacity; returning one complete source');return multiMerge([values[0]]);}
      comments.push(copy);
    }
  }
  compatLog('MultiAPI','MERGED','Merged APIs: '+values.length+'; exact upstream replays removed: '+removed+'; returned: '+comments.length);
  comments.sort((a,b)=>parseFloat(a.p)-parseFloat(b.p));
  return {comments:comments,count:comments.length};
}
async function fusionMultiComments(params,progress){
  try{
    const id=firstPresent(params,['commentId','episodeId']),sources=multiSources(params),refs=multiDecode(id,'c',sources);
    if(!refs){
      if(compatPresent(id))await multiBare(sources,'c',id,false);
      return fusionCompatComments(multiParams(params,sources[0]),progress);
    }
    if(refs.length===1)return await multiSelectedComments(params,progress,sources,refs[0]);
    if(refs.length>1 && (!refs[0].p || !refs.every(r=>multiSameEpisode(refs[0].p,r.p))))throw compatError('Route','UNPROVEN_TIMELINE','Historical aggregate lacks timeline evidence; select an individual source');
    const batch=await multiFirst(refs.map(async ref=>{
      const cfg=sources.find(c=>c.s===ref.s),data=await fusionCompatComments(Object.assign(multiParams(params,cfg),{commentId:ref.i,episodeId:ref.i}),progress);
      // A server which now explicitly reports another duration/hash/version
      // invalidates the earlier proof. Never apply offsets or silently mix it.
      if(ref.p && (multiDuration(data)!=null && multiDuration(data)!==ref.p.duration || multiTimeline(data)!=null && multiTimeline(data)!==ref.p.timeline || multiEdition(data) && multiEdition(data)!==ref.p.edition || multiLanguage(data) && multiLanguage(data)!==ref.p.language)){
        compatLog('MultiAPI','TIMELINE_CHANGED','Server timeline changed; select an individual source');return null;
      }
      return {s:ref.s,data:data};
    }),v=>v && Array.isArray(v.data.comments) && (v.data.comments.length>0 || progress && v.data.success!==false && !v.data.taskId));
    const values=batch.values.filter(v=>v.data && Array.isArray(v.data.comments) && v.data.success!==false);
    const usable=values.filter(v=>v.data.comments.length);
    if(batch.partial)compatLog('MultiAPI','PARTIAL','Returning available comments without waiting for slow peers');
    if(usable.length>1)return multiMerge(usable);
    if(usable.length===1)return refs.length>1?multiMerge(usable):usable[0].data;
    return values.length?values[0].data:{comments:[],count:0,success:false};
  }catch(e){compatFailure('Comments',e);return compatEmpty(e);}
}

function multiResponseMatches(data,proof){
  return !proof || !(multiDuration(data)!=null && multiDuration(data)!==proof.duration || multiTimeline(data)!=null && multiTimeline(data)!==proof.timeline || multiEdition(data) && multiEdition(data)!==proof.edition || multiLanguage(data) && multiLanguage(data)!==proof.language);
}
async function multiSelectedComments(params,progress,sources,ref){
  const load=async member=>{
    const cfg=sources.find(c=>c.s===member.s);
    const data=await fusionCompatComments(Object.assign(multiParams(params,cfg),{commentId:member.i,episodeId:member.i}),progress);
    if(!multiResponseMatches(data,member.p)){
      const error=compatError('Route','TIMELINE_CHANGED','Server video version changed');compatFailure('Route',error);return compatEmpty(error);
    }
    return data;
  };
  const primary=await load(ref);
  // A valid empty progress window is success, not evidence that a track failed.
  if(primary.success!==false && !primary.taskId && (primary.count>0 || progress)){
    if(primary.count>0)await preferenceSelect(sources,ref);
    return primary;
  }
  const alternatives=(ref.a || []).filter(a=>multiSameEpisode(ref.p,a.p));
  if(!alternatives.length){
    if(ref.a && ref.a.length)compatLog('Fallback','UNPROVEN_TIMELINE','Unverified fallback rejected');
    return primary;
  }
  const original=primary.error || {code:primary.taskId?'PENDING_TASK':'NO_COMMENTS',category:primary.taskId?'PENDING_TASK':'NO_COMMENTS'};
  // At most two, each attempted once. No recursion, cycles, offsets or merging.
  for(const alternative of alternatives){
    const data=await load(alternative);
    if(data.success===false || data.taskId || !data.count && !progress)continue;
    compatLog('Fallback','FALLBACK_USED','Verified fallback used');
    return Object.assign({},data,{message:compatMessage('FALLBACK_USED'),fallback:{original:original,from:sources.find(c=>c.s===ref.s).slot,to:sources.find(c=>c.s===alternative.s).slot},diagnostics:compatSummary()});
  }
  compatLog('Fallback','FALLBACK_FAILED','No healthy verified fallback');
  return Object.assign({},primary,{diagnostics:compatSummary()});
}

// END GENERATED FUSION ENGINE

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WidgetMetadata: typeof WidgetMetadata !== "undefined" ? WidgetMetadata : null,
    searchDanmu: searchDanmu,
    getDetailById: getDetailById,
    getCommentsById: getCommentsById,
    getDanmuWithSegmentTime: getDanmuWithSegmentTime,
    _test: {
      fusionDedupe, fusionMatch, fusionNormalize, fusionOptions, fusionIdentity,
      fusionWindow, fusionKey, fusionEpisodeNumber, fusionParse, fusionLoad,
      fusionAutoId, fusionAutomatic, fusionSeasonCandidate,
      fusionSearch, fusionDetail, fusionCompatSearch, fusionCompatDetail, fusionCompatComments,
      compatSetStage, compatDiagnostics, compatSummary, compatCacheStats,
      parseDanmuApiUrl, fusionTracks,
      decodeEpisodeFromSyntheticId, classifyMediaKind, stableAnimeId,
      parseAnimeId, parseUnionOrMediaId, resolveIdentity, resolveSeasonEpisode,
      buildLocalDisplay, versionKeyToIdPart, formatSE, resolveSeasonEpisodeCount
    }
  };
}

/**
 * Danmu Fusion · 弹幕融合
 * Forward 专用弹幕聚合播放模块
 *
 * 版本：1.0.0
 * 作者：仅通过 WidgetMetadata.author 展示
 *
 * 职责（客户端适配，不做聚合/匹配）：
 *   Forward 参数 → 专属 /api/forward/danmaku（需配套部署 Danmu API）
 *   → 展示版本信息 / debug 来源明细 → 播放器纯净弹幕
 */

WidgetMetadata = {
  id: "tzb360.danmu.fusion",
  title: "Danmu Fusion",
  version: "1.0.0",
  requiredVersion: "0.0.2",
  description:
    "Danmu Fusion 是一个弹幕聚合播放模块，需要配套使用 Danmu API 服务。本模块通过专属 Forward API 获取经过聚合、版本匹配和处理后的弹幕数据，为 Emby/Jellyfin 提供稳定的弹幕播放体验。请先部署或连接 Danmu API 后再配置服务地址。",
  author: "tzb360",
  site: "https://github.com/tzb360/danmu_api",
  website: "https://github.com/tzb360/danmu_api",
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
const FUSION_UA = "DanmuFusion/1.0.0 (tzb360; Forward)";
const CACHE_PREFIX = "tzb360.danmu.fusion.v1:";

function truthy(v, defaultVal) {
  if (v === undefined || v === null || v === "") return defaultVal;
  if (v === true || v === 1) return true;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toInt(v, fb) {
  const n = parseInt(String(v == null ? "" : v).trim(), 10);
  return Number.isFinite(n) ? n : fb;
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

/** 是否电影：Forward 约定电影时 season/episode 为空 */
function isMovieType(type, season, episode) {
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
  // type 缺失时：无季无集 → 按电影处理（避免默认 tv 再被拆成多集）
  if (!t || t === "unknown") {
    const seasonEmpty = season == null || season === "";
    const episodeEmpty = episode == null || episode === "";
    if (seasonEmpty && episodeEmpty) return true;
  }
  return false;
}

function resolveIdentity(params) {
  const p = params || {};
  const rawType = String(p.type || "").toLowerCase();
  const title = String(p.seriesName || p.title || p.name || p.keyword || "").trim();
  const tmdbId =
    p.tmdbId != null && String(p.tmdbId).trim() !== ""
      ? String(p.tmdbId).trim()
      : p.tmdb_id != null && String(p.tmdb_id).trim() !== ""
        ? String(p.tmdb_id).trim()
        : null;
  const imdbId =
    p.imdbId != null && String(p.imdbId).trim() !== ""
      ? String(p.imdbId).trim()
      : p.imdb_id != null && String(p.imdb_id).trim() !== ""
        ? String(p.imdb_id).trim()
        : null;
  const year =
    yearFrom(p.year) || yearFrom(p.airDate) || yearFrom(p.premiereDate) || null;

  const movie = isMovieType(rawType, p.season, p.episode);
  let season;
  let episode;
  if (movie) {
    // 电影固定 S1E1，绝不生成多集列表
    season = 1;
    episode = 1;
  } else {
    season = Math.max(1, toInt(p.season, 1));
    episode = Math.max(1, toInt(p.episode, 1));
  }

  return {
    title,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    year,
    season,
    episode,
    type: movie ? "movie" : rawType || "tv",
    isMovie: movie,
    original_title: p.original_title || p.originalTitle || p.originalName || null,
    region: p.region || null
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
  q.season = String(identity.season);
  q.episode = String(identity.episode);
  q.color_to_white = cfg.colorToWhite ? "1" : "0";
  q.force_scroll = cfg.forceScroll ? "1" : "0";
  if (extra && extra.debug) q.debug = "1";
  if (extra && extra.force) q.force = "1";
  if (extra && extra.resolve_only) q.resolve_only = "1";
  return q;
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

function cacheKey(identity) {
  if (identity.tmdb_id) {
    return "tmdb:" + identity.tmdb_id + ":s" + identity.season + ":e" + identity.episode;
  }
  return (
    "t:" +
    String(identity.title || "").toLowerCase() +
    ":y" +
    (identity.year || "") +
    ":s" +
    identity.season +
    ":e" +
    identity.episode
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

function stableAnimeId(identity) {
  if (identity.tmdb_id) return "tmdb_" + identity.tmdb_id;
  const raw =
    (identity.title || "m") +
    "|" +
    (identity.year || "") +
    "|s" +
    identity.season;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return "fusion_" + h;
}

// ---------------------------------------------------------------------------
// Forward 入口
// ---------------------------------------------------------------------------

async function searchDanmu(params) {
  const cfg = resolveConfig(params);
  const identity = resolveIdentity(params);
  safeLog(cfg.debug, "searchDanmu.params", identity);

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { animes: [] };
  }

  let media = null;
  let displayTitle = null;
  try {
    const url = forwardDanmakuUrl(
      cfg,
      buildQuery(identity, cfg, { debug: cfg.debug, resolve_only: true })
    );
    const raw = await httpGetRetry(
      url,
      Object.assign({}, cfg, { timeoutMs: Math.min(cfg.timeoutMs, 45000), retry: 0 }),
      "resolve"
    );
    media = raw && raw.media ? raw.media : null;
    if (media && media.display) {
      displayTitle = String(media.display);
      // 电影：去掉服务端可能带的 Sxx/Exx 展示
      if (identity.isMovie) {
        displayTitle = displayTitle
          .replace(/\s*S\d{1,2}E\d{1,2}\s*$/i, "")
          .replace(/\s*S\d{1,2}\s*$/i, "")
          .trim();
      }
    } else if (media && media.display_title) {
      displayTitle = String(media.display_title);
      if (!identity.isMovie) {
        displayTitle =
          displayTitle + " S" + String(identity.season).padStart(2, "0");
      }
    }
    if (raw && raw.meta && raw.meta.source_count != null) {
      safeLog(cfg.debug, "resolve.source_count", raw.meta.source_count);
    }
  } catch (e) {
    safeLog(cfg.debug, "resolve.fail", String(e && e.message ? e.message : e));
  }

  if (!displayTitle) {
    displayTitle =
      (identity.title || "未知") +
      (identity.year ? " (" + identity.year + ")" : "");
    if (!identity.isMovie) {
      displayTitle =
        displayTitle + " S" + String(identity.season).padStart(2, "0");
    }
  }

  const animeId = stableAnimeId(identity);
  return {
    animes: [
      {
        animeId: animeId,
        bangumiId: String(animeId),
        animeTitle: displayTitle,
        // dandan/Forward：电影用 movie，剧集用 tvseries
        type: identity.isMovie ? "movie" : "tvseries",
        typeDescription: identity.isMovie ? "电影" : "Danmu Fusion",
        imageUrl: "",
        startDate:
          media && media.year
            ? media.year + "-01-01"
            : identity.year
              ? identity.year + "-01-01"
              : "",
        // 电影必须为 1，禁止多集
        episodeCount: identity.isMovie ? 1 : Math.max(identity.episode, 1),
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
  const animeId =
    params && params.animeId != null ? params.animeId : stableAnimeId(identity);
  const baseId =
    (Number(String(animeId).replace(/\D/g, "").slice(-6) || "1") || 1) * 1000;
  const air = identity.year ? identity.year + "-01-01" : "";

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

  // 剧集：仅当前集，避免伪造第 N+1、N+2 集
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
  safeLog(cfg.debug, "getComments.params", identity);

  if (!identity.title && !identity.tmdb_id && !identity.imdb_id) {
    return { count: 0, comments: [] };
  }

  const ck = cacheKey(identity);
  if (cfg.cacheEnabled) {
    const hit = cacheGet(ck);
    if (hit && hit.comments && hit.comments.length) {
      safeLog(cfg.debug, "module_cache_hit", { key: ck, count: hit.count });
      return hit;
    }
  }

  const url = forwardDanmakuUrl(cfg, buildQuery(identity, cfg, { debug: cfg.debug }));

  try {
    const raw = await httpGetRetry(url, cfg, "forward.danmaku");
    const adapted = adaptComments(raw);
    if (raw && raw.media) adapted.media = raw.media;

    // 来源明细仅 debug 日志，不写入播放器可见字段污染 UI
    const detail =
      (raw && raw.sources_detail) ||
      (raw && raw.meta && (raw.meta.sources_detail || raw.meta.sources)) ||
      [];
    logSourcesDetail(cfg, raw && raw.media, detail, adapted.count);

    if (cfg.cacheEnabled && adapted.count > 0) cacheSet(ck, adapted);
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
    getCommentsById: getCommentsById
  };
}

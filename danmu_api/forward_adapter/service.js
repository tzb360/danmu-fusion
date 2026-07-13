/**
 * Forward 适配服务 — 自动化入口
 *
 * Forward 请求参数 (title/season/episode/tmdb/imdb/year)
 *   → 原有 searchAnime 识别剧集
 *   → 收集该集所有平台链接（不依赖后台手工聚合）
 *   → 多源抓取 + 聚合清洗 Pipeline
 *   → 自动缓存
 *   → 返回纯净弹幕（无来源标签）
 */
import { log } from '../utils/log-util.js';
import { globals } from '../configs/globals.js';
import { searchAnime, getBangumi, getComment } from '../apis/dandan-api.js';
import { resolveAnimeByIdFromDetailStore } from '../utils/cache-util.js';
import { createTraceContext, trace, finalizeDanmuStats } from './trace-context.js';
import { tryLoadEpisodeCache, autoSaveEpisodeCache } from '../aggregation/request-pipeline.js';
import {
  aggregateEpisode,
  collectEpisodeSourcesFromAnimes,
  collectMovieSourcesFromAnimes
} from '../aggregation/episode-service.js';
import {
  buildEpisodeIdentity,
  inferRegionFromTitle,
  normalizeRegion,
  regionLabel,
  extractYearValue,
  buildSourceFileLabel,
  formatVersionDisplay
} from '../aggregation/episode-identity.js';
import { filterContentCandidates } from '../aggregation/content-filter.js';
import { extractSeasonNumberFromAnimeTitle } from '../utils/common-util.js';
import {
  buildVersionCandidates,
  slimCandidate,
  pickCandidate
} from './version-candidates.js';
import {
  buildForwardDanmakuPayload,
  toPlayerXml,
  toPlayerAss,
  sanitizePlayerTitle,
  sanitizeEpisodeList,
  sanitizeAnimeList,
  toPlayerComments,
  applyPlayerPresentation,
  buildFinalDanmuStats
} from './format.js';

export function parseForwardQuery(urlOrObject = {}) {
  const sp = typeof urlOrObject.searchParams?.get === 'function'
    ? urlOrObject.searchParams
    : null;

  const get = (keys, fallback = null) => {
    if (sp) {
      for (const k of keys) {
        const v = sp.get(k);
        if (v != null && String(v).trim() !== '') return v;
      }
      return fallback;
    }
    for (const k of keys) {
      if (urlOrObject[k] != null && String(urlOrObject[k]).trim() !== '') {
        return urlOrObject[k];
      }
    }
    return fallback;
  };

  const yearRaw = get(['year', 'airDate', 'premiereDate'], null);
  const yearMatch = yearRaw != null ? String(yearRaw).match(/(19|20)\d{2}/) : null;

  const asBool = (v) => {
    if (v === true || v === 1) return true;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  };

  const typeRaw = get(['type', 'media_type', 'mediaType'], 'tv');
  const type = String(typeRaw || 'tv').toLowerCase();
  const isMovie =
    type === 'movie' ||
    type === 'movies' ||
    type === 'film' ||
    type === '电影' ||
    type === '动画电影' ||
    type === '剧场版';

  // 电视剧默认 S1E1；电影 season/episode 保持原样（可为 0/null），禁止强制成 1
  const seasonRaw = get(
    ['season', 's', 'seasonNumber', 'SeasonNumber', 'ParentIndexNumber'],
    isMovie ? null : 1
  );
  const episodeRaw = get(
    ['episode', 'e', 'ep', 'episodeNumber', 'EpisodeNumber', 'IndexNumber'],
    isMovie ? null : 1
  );

  return {
    title: get(['title', 'name', 'seriesName', 'keyword'], '') || '',
    original_title: get(['original_title', 'originalTitle', 'original_name'], null),
    tmdb_id: get(['tmdb_id', 'tmdbid', 'tmdbId'], null),
    imdb_id: get(['imdb_id', 'imdbid', 'imdbId'], null),
    tvdb_id: get(['tvdb_id', 'tvdbid', 'tvdbId'], null),
    movie_id: get(['movie_id', 'movieId', 'media_id', 'mediaId'], null),
    year: yearMatch ? yearMatch[0] : (yearRaw != null ? String(yearRaw) : null),
    country: get(['country', 'origin_country', 'originCountry'], null),
    network: get(['network', 'networks', 'studio'], null),
    season: seasonRaw,
    episode: episodeRaw,
    episode_id: get(['episode_id', 'comment_id', 'commentId', 'episodeId'], null),
    anime_id: get(['anime_id', 'animeId'], null),
    // 用户/模块选择的版本键，如 us:2011:s4
    version_key: get(['version_key', 'versionKey', 'version'], null),
    type: isMovie ? 'movie' : type || 'tv',
    is_movie: isMovie,
    force: asBool(get(['force', 'refresh'], 'false')),
    format: String(get(['format'], 'json')).toLowerCase(),
    // debug=1：响应附带 sources/stats + 完整 matched metadata
    debug: asBool(get(['debug'], 'false')),
    // resolve_only=1：只做剧集识别与 metadata，不抓弹幕（供 Forward 显示层）
    resolve_only: asBool(get(['resolve_only', 'meta_only'], 'false')),
    // Forward 播放呈现：默认开启颜色转白 / 统一滚动；color_to_white=0 / force_scroll=0 可关
    color_to_white: get(['color_to_white', 'colorToWhite'], null) == null
      ? true
      : asBool(get(['color_to_white', 'colorToWhite'], '1')),
    force_scroll: get(['force_scroll', 'forceScroll', 'scroll_top'], null) == null
      ? true
      : asBool(get(['force_scroll', 'forceScroll', 'scroll_top'], '1')),
    region: get(['region', 'country_code'], null)
  };
}

function isMovieQuery(query) {
  if (!query) return false;
  if (query.is_movie === true || query.isMovie === true) return true;
  const t = String(query.type || '').toLowerCase();
  return t === 'movie' || t === 'movies' || t === 'film' || t === '电影';
}

function toSeasonNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function toEpisodeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function titleLooksMatch(animeTitle, queryTitle) {
  if (!animeTitle || !queryTitle) return true;
  const a = String(animeTitle).toLowerCase().replace(/\s/g, '');
  const q = String(queryTitle).toLowerCase().replace(/\s/g, '');
  return a.includes(q) || q.includes(a.slice(0, Math.min(4, a.length)));
}

function animeYear(anime) {
  const d = String(anime?.startDate || '');
  const m1 = d.match(/(19|20)\d{2}/);
  if (m1) return m1[0];
  const t = String(anime?.animeTitle || '');
  const m2 = t.match(/\(((?:19|20)\d{2})\)/);
  return m2 ? m2[1] : null;
}

function animeEpisodeCapacity(anime) {
  if (Array.isArray(anime?.links) && anime.links.length) return anime.links.length;
  const n = Number(anime?.episodeCount);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 用结构化条件筛选候选（外部 ID / 季号 / 集数容量 / 地区 / 系列年）
 * 地区来自源条目自身标注（美版/英版/US/UK），用于拆分缓存，不是「标题瞎猜」
 */
export function filterAnimesByIdentity(animes, {
  season, episode, year, tmdb_id, imdb_id, tvdb_id, region, allAnimes = null
} = {}) {
  const steps = [];
  let list = Array.isArray(animes) ? [...animes] : [];
  const pool = Array.isArray(allAnimes) && allAnimes.length ? allAnimes : list;
  steps.push({ step: 'input', count: list.length });

  if (tmdb_id) {
    const id = String(tmdb_id);
    const hit = list.filter(a => String(a.tmdb_id || a.tmdbId || a.tmdbid || '') === id);
    if (hit.length) {
      list = hit;
      steps.push({ step: 'tmdb_id', count: list.length, tmdb_id: id });
    } else {
      steps.push({ step: 'tmdb_id', count: list.length, note: 'no anime carries tmdb_id; keep all' });
    }
  }
  if (imdb_id) {
    const id = String(imdb_id);
    const hit = list.filter(a => String(a.imdb_id || a.imdbId || a.imdbid || '') === id);
    if (hit.length) {
      list = hit;
      steps.push({ step: 'imdb_id', count: list.length, imdb_id: id });
    } else {
      steps.push({ step: 'imdb_id', count: list.length, note: 'no anime carries imdb_id; keep all' });
    }
  }
  if (tvdb_id) {
    const id = String(tvdb_id);
    const hit = list.filter(a => String(a.tvdb_id || a.tvdbId || '') === id);
    if (hit.length) {
      list = hit;
      steps.push({ step: 'tvdb_id', count: list.length });
    }
  }

  // 严格季号：有季号的必须等于目标季。
  // 无严格命中时：只保留「标题未标季」的合集；绝不回退到错误季
  // （线上故障：S4 + 错误候选仅剩 S1/英版S8 时，fallback_or_all 会错配整季弹幕）
  if (season != null) {
    const s = toSeasonNum(season);
    const strict = list.filter(a => {
      const extracted = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
      return Number(extracted.season) === s;
    });
    if (strict.length) {
      list = strict;
      steps.push({ step: 'season_number', season: s, count: list.length, mode: 'strict' });
    } else {
      const loose = list.filter(a => {
        const extracted = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
        return extracted.season == null;
      });
      // 即使 loose 为空也不保留错误季
      list = loose;
      steps.push({
        step: 'season_number',
        season: s,
        count: list.length,
        mode: 'fallback_unspecified_only'
      });
    }
  }

  if (episode != null) {
    const e = toEpisodeNum(episode);
    const cap = list.filter(a => animeEpisodeCapacity(a) >= e);
    if (cap.length) {
      list = cap;
      steps.push({ step: 'episode_capacity', episode: e, count: list.length });
    } else {
      steps.push({ step: 'episode_capacity', episode: e, count: 0, note: 'none has enough episodes' });
    }
  }

  // 地区拆分：禁止 US/UK 同批聚合
  // 指定 region 时：无命中则只保留未标注地区项，绝不静默保留对立地区
  // （线上故障：美版请求 + 只剩英版时 hit=[] 却继续用英版）
  const wantRegion = normalizeRegion(region);
  if (wantRegion) {
    const hit = list.filter(a => {
      const r = inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region;
      return r === wantRegion;
    });
    if (hit.length) {
      list = hit;
      steps.push({ step: 'region', region: wantRegion, count: list.length });
    } else {
      const unk = list.filter(a => {
        const r = inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region;
        return !r;
      });
      list = unk;
      steps.push({
        step: 'region',
        region: wantRegion,
        count: list.length,
        note: 'no_region_match_keep_unlabeled'
      });
    }
  } else {
    const byReg = new Map();
    for (const a of list) {
      const r = inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region || 'unk';
      if (!byReg.has(r)) byReg.set(r, []);
      byReg.get(r).push(a);
    }
    if (byReg.size > 1) {
      // 系列年消歧：query.year 匹配各 region 的 S1 年
      const y = extractYearValue(year);
      let chosen = null;
      if (y) {
        for (const [r, arr] of byReg.entries()) {
          const s1year = findSeriesYearForRegion(pool, r);
          if (s1year === y) {
            chosen = arr;
            steps.push({ step: 'region_by_series_year', region: r, year: y, count: arr.length });
            break;
          }
        }
      }
      if (!chosen) {
        // 默认取条目最多的 region（通常美版源更全）；并记录
        let best = null;
        let bestN = -1;
        for (const [r, arr] of byReg.entries()) {
          if (arr.length > bestN) {
            bestN = arr.length;
            best = { r, arr };
          }
        }
        chosen = best?.arr || list;
        steps.push({
          step: 'region_pick_largest',
          region: best?.r || 'unk',
          count: chosen.length,
          regions: [...byReg.keys()]
        });
      }
      list = chosen;
    } else {
      steps.push({ step: 'region', region: [...byReg.keys()][0] || null, count: list.length });
    }
  }

  // 年份：系列年 或 该季年
  // 已有 season 严格命中时：年份仅软偏好——air year 过滤不得砍光正确季
  // （Emby 常传系列首播年，S4 的 air year 往往不同）
  if (year) {
    const y = extractYearValue(year);
    if (y) {
      const yearHit = list.filter(a => animeYear(a) === y);
      // 也接受：系列年匹配（S1 year == y）
      const seriesHit = list.filter(a => {
        const r = inferRegionFromTitle(a.animeTitle || '').region;
        return findSeriesYearForRegion(pool, r) === y;
      });
      const hasSeasonConstraint = season != null;
      if (yearHit.length && yearHit.length < list.length) {
        // 有季号约束时：仅当 yearHit 仍覆盖目标季（或无季号）才收紧
        if (hasSeasonConstraint) {
          const s = toSeasonNum(season);
          const yearHitOk = yearHit.some(a => {
            const es = extractSeasonNumberFromAnimeTitle(a.animeTitle || '').season;
            return es == null || Number(es) === s;
          });
          if (yearHitOk && yearHit.length > 0) {
            // 优先 air year，但若 yearHit 全是错误季则跳过（上面 yearHitOk 已保）
            list = yearHit;
            steps.push({ step: 'year_air', year: y, count: list.length, mode: 'soft_with_season' });
          } else if (seriesHit.length) {
            list = seriesHit;
            steps.push({ step: 'year_series', year: y, count: list.length, mode: 'soft_with_season' });
          } else {
            steps.push({ step: 'year', year: y, count: list.length, mode: 'soft_skip_keep_season' });
          }
        } else {
          list = yearHit;
          steps.push({ step: 'year_air', year: y, count: list.length });
        }
      } else if (seriesHit.length && seriesHit.length <= list.length) {
        list = seriesHit;
        steps.push({ step: 'year_series', year: y, count: list.length });
      } else {
        steps.push({ step: 'year', year: y, count: list.length, mode: 'no_change' });
      }
    }
  }

  return { animes: list, steps };
}

/** 同 region 下 S1 的播出年 ≈ 系列年 */
function findSeriesYearForRegion(animes, region) {
  const r = normalizeRegion(region);
  for (const a of animes || []) {
    const ar = inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region;
    if (r && ar && ar !== r) continue;
    if (r && !ar) continue;
    const { season } = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
    if (Number(season) === 1) {
      const y = animeYear(a);
      if (y) return y;
    }
  }
  return null;
}

/**
 * 从匹配结果构建完整影视 metadata（调试 + Forward 显示）
 * 字段缺失时显式为 null，便于确认 LogVar 实际识别到什么
 */
export function buildMatchedMediaMetadata(query, matchedAnimes = [], filterSteps = [], allAnimes = []) {
  const movie = isMovieQuery(query);
  const season = movie ? null : toSeasonNum(query.season);
  const episode = movie ? null : toEpisodeNum(query.episode);
  const primary = matchedAnimes[0] || null;
  const aliases = Array.isArray(primary?.aliases) ? primary.aliases : [];
  const originalFromAlias = aliases.find(a => /^[A-Za-z0-9]/.test(String(a))) || aliases[0] || null;
  // 中文名优先：查询 title，否则从匹配条目标题去季号
  let titleCn = String(query.title || '').trim() || null;
  if (!titleCn && primary?.animeTitle) {
    titleCn = String(primary.animeTitle)
      .replace(/【[^】]*】/g, ' ')
      .replace(/\s*from\s+[\w.-]+/gi, ' ')
      .replace(/[（(]美版[）)]/g, ' ')
      .replace(/[（(]英版[）)]/g, ' ')
      .replace(/\(\d{4}\)/g, ' ')
      .replace(/第\s*[0-9一二三四五六七八九十百千万]+\s*[季期部].*$/u, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const primaryTitle = primary ? sanitizePlayerTitle(primary.animeTitle || '') : null;
  const regInfo = primary
    ? inferRegionFromTitle(primary.animeTitle || '', (aliases || []).join(' '))
    : { region: normalizeRegion(query.region), region_label: regionLabel(query.region) };
  const region = normalizeRegion(query.region) || regInfo.region;
  const region_label = regionLabel(region) || regInfo.region_label;
  const pool = allAnimes.length ? allAnimes : matchedAnimes;
  const seriesYear = findSeriesYearForRegion(pool, region)
    || extractYearValue(query.year)
    || (primary ? animeYear(primary) : null);

  // 电影：仅 片名 (年份)，禁止 S01E01
  let display;
  let displayFull;
  if (movie) {
    const y = seriesYear ? ` (${seriesYear})` : '';
    display = `${titleCn || '未知'}${y}`;
    displayFull = display;
  } else {
    display = formatVersionDisplay({
      title: titleCn,
      region,
      region_label,
      year: seriesYear,
      season,
      episode,
      withEpisode: false
    });
    displayFull = formatVersionDisplay({
      title: titleCn,
      region,
      region_label,
      year: seriesYear,
      season,
      episode,
      withEpisode: true
    });
  }

  const meta = {
    title: titleCn,
    original_title:
      query.original_title ||
      (originalFromAlias ? String(originalFromAlias) : null),
    year: seriesYear,
    season_year: primary ? animeYear(primary) : null,
    region: region || null,
    region_label: region_label || null,
    tmdb_id: query.tmdb_id || primary?.tmdb_id || primary?.tmdbId || null,
    imdb_id: query.imdb_id || primary?.imdb_id || primary?.imdbId || null,
    tvdb_id: query.tvdb_id || primary?.tvdb_id || primary?.tvdbId || null,
    country: query.country || (region === 'us' ? '美国' : region === 'uk' ? '英国' : null),
    network: query.network || primary?.network || null,
    type: movie ? 'movie' : (query.type || 'tv'),
    season,
    episode,
    display_title: display,
    display: displayFull,
    matched_anime_id: primary?.animeId ?? primary?.bangumiId ?? null,
    matched_anime_title: primaryTitle,
    matched_source: primary?.source || null,
    matched_start_date: primary?.startDate || null,
    matched_episode_count: primary ? animeEpisodeCapacity(primary) : null,
    matched_count: matchedAnimes.length,
    matched_titles: matchedAnimes.slice(0, 12).map(a => sanitizePlayerTitle(a.animeTitle || '')),
    filter_steps: filterSteps,
    query_ids: {
      tmdb_id: query.tmdb_id || null,
      imdb_id: query.imdb_id || null,
      tvdb_id: query.tvdb_id || null,
      movie_id: query.movie_id || null
    }
  };

  log('info', `[LogVar-Meta] ${JSON.stringify(meta)}`);
  return meta;
}

/**
 * 搜索并收集可用来源
 * 电影 / 电视剧 完全分离，禁止共用 episode 严格匹配
 */
async function resolveMultiSources(query) {
  const movie = isMovieQuery(query);
  // 电影：不使用 season/episode；电视剧：1-based
  const season = movie ? null : toSeasonNum(query.season);
  const episode = movie ? null : toEpisodeNum(query.episode);
  let keyword = query.title || '';
  if (!keyword && query.tmdb_id) keyword = String(query.tmdb_id);
  if (!keyword && query.movie_id) keyword = String(query.movie_id);
  if (!keyword && query.imdb_id) keyword = String(query.imdb_id);
  // 不把 year 拼进 keyword 做标题猜测；年份仅作结构化过滤
  if (!keyword) {
    return {
      sources: [],
      animes: [],
      keyword: '',
      season,
      episode,
      media: buildMatchedMediaMetadata(query, [], [{ step: 'empty_keyword', count: 0 }]),
      filterSteps: []
    };
  }

  const searchUrl = new URL('http://local/api/v2/search/anime');
  searchUrl.searchParams.set('keyword', keyword);
  // 电影：不传假 S1E1，避免下游当剧集过滤
  if (movie) {
    searchUrl.searchParams.set('type', 'movie');
  } else {
    searchUrl.searchParams.set('season', String(season));
    searchUrl.searchParams.set('episode', String(episode));
  }

  if (movie) {
    log(
      'info',
      `[ForwardAdapter] Movie Request: tmdb_id=${query.tmdb_id || '-'} title="${keyword}" ` +
        `original_title=${query.original_title || '-'} year=${query.year || '-'} ` +
        `(no season/episode)`
    );
  } else {
    log(
      'info',
      `[ForwardAdapter] TV Request: tmdb_id=${query.tmdb_id || '-'} title="${keyword}" ` +
        `season=${season} episode=${episode} year=${query.year || '-'}`
    );
  }
  log(
    'info',
    `[ForwardAdapter] search keyword="${keyword}" type=${movie ? 'movie' : 'tv'} ` +
      `${movie ? '' : `S${season}E${episode} `}year=${query.year || '-'} tmdb=${query.tmdb_id || '-'} imdb=${query.imdb_id || '-'}`
  );
  const t0 = Date.now();
  // 搜索详情只属于本请求；绝不能在异步搜索结束后回读 globals.animes。
  const requestDetailStore = new Map();
  const searchRes = await searchAnime(searchUrl, null, null, requestDetailStore);
  const searchBody = JSON.parse(await searchRes.text());
  const searchMs = Date.now() - t0;
  const animes = searchBody.animes || [];
  log(
    'info',
    `[ForwardAdapter] search done type=${movie ? 'movie' : 'tv'} animes=${animes.length} ${searchMs}ms`
  );

  // 补全带 links 的详情：优先 globals.animes，必要时 getBangumi
  const detailed = [];
  const seenIds = new Set();
  // 搜索结果中的 aliases / 外部字段，按 id 合并（globals 里常缺 aliases）
  const searchById = new Map();
  for (const a of animes) {
    const id = a?.bangumiId || a?.animeId;
    if (id != null) searchById.set(String(id), a);
  }
  const mergeSearchMeta = (a) => {
    const id = a?.bangumiId || a?.animeId;
    const s = id != null ? searchById.get(String(id)) : null;
    if (!s) return a;
    return {
      ...a,
      aliases: a.aliases?.length ? a.aliases : s.aliases,
      tmdb_id: a.tmdb_id || a.tmdbId || s.tmdb_id || s.tmdbId || null,
      imdb_id: a.imdb_id || a.imdbId || s.imdb_id || s.imdbId || null,
      tvdb_id: a.tvdb_id || a.tvdbId || s.tvdb_id || s.tvdbId || null,
      country: a.country || s.country || null,
      network: a.network || s.network || null
    };
  };

  // 对本请求的搜索结果补全 links。detailStore 在 searchAnime 内逐源填充，
  // 因而不会混入其他请求的全局缓存条目。
  for (const a of animes.slice(0, 40)) {
    const id = a.bangumiId || a.animeId;
    if (!id || seenIds.has(String(id))) continue;
    try {
      const g =
        resolveAnimeByIdFromDetailStore(id, requestDetailStore, a.source) ||
        resolveAnimeByIdFromDetailStore(id, requestDetailStore);
      if (g?.links?.length) {
        detailed.push(mergeSearchMeta(g));
        seenIds.add(String(id));
        continue;
      }
      const detailRes = await getBangumi(String(id), requestDetailStore, a.source);
      const detailBody = JSON.parse(await detailRes.text());
      const g2 =
        resolveAnimeByIdFromDetailStore(id, requestDetailStore, a.source) ||
        resolveAnimeByIdFromDetailStore(id, requestDetailStore);
      if (g2?.links?.length) {
        detailed.push(mergeSearchMeta(g2));
        seenIds.add(String(id));
      } else if (detailBody?.bangumi) {
        detailed.push({
          ...a,
          animeTitle: detailBody.bangumi.animeTitle || a.animeTitle,
          links: (detailBody.bangumi.episodes || []).map(ep => ({
            id: ep.episodeId,
            title: ep.episodeTitle,
            url: null
          })),
          source: a.source
        });
        seenIds.add(String(id));
      }
    } catch (e) {
      log('warn', `[ForwardAdapter] getBangumi ${id} failed: ${e.message}`);
    }
  }

  // 内容消歧：排除同名综艺/赏析/幕后纪实/非主标题引用
  const contentQuery = {
    title: query.title || keyword,
    type: movie ? 'movie' : query.type || 'tv',
    year: query.year || null,
    season: movie ? null : season
  };
  const {
    kept: contentKept,
    rejected: contentRejected,
    steps: contentSteps
  } = filterContentCandidates(detailed, contentQuery);
  for (const r of (contentRejected || []).slice(0, 20)) {
    log(
      'info',
      `[ForwardAdapter] content reject [${r.reason}] type=${r.type || '-'} title=${r.title || '-'}`
    );
  }
  log(
    'info',
    `[ForwardAdapter] content filter ${detailed.length} -> ${contentKept.length} (rejected ${contentRejected.length})`
  );

  // ========== 电影路径：唯一匹配 + 全片链接，禁止 episode 过滤 ==========
  if (movie) {
    const episodeMatchDebug = {};
    const rawSources = collectMovieSourcesFromAnimes(contentKept, {}, {
      debugOut: episodeMatchDebug
    });
    log(
      'info',
      `[ForwardAdapter] Movie Provider: search keyword="${keyword}" response animes=${animes.length} ` +
        `kept=${contentKept.length} sources=${rawSources.length} ` +
        `[${rawSources.map((s) => s.source).join(',')}]`
    );

    const media = buildMatchedMediaMetadata(
      { ...query, type: 'movie', is_movie: true, season: null, episode: null },
      contentKept,
      [
        ...(contentSteps || []),
        { step: 'movie_collect_sources', count: rawSources.length }
      ],
      contentKept
    );
    media.season = null;
    media.episode = null;
    media.version_key = null;
    media.candidates_count = 1;

    const byPlat = new Map();
    for (const s of rawSources) {
      const k = String(s.source || 'unknown').toLowerCase();
      if (!byPlat.has(k)) {
        // 文件名用清洗后的片名/原名，不用带【电影】from xxx 的原始 animeTitle
        const cleanTitle = media.title || media.matched_anime_title || s.anime_title;
        const fileName = buildSourceFileLabel({
          source: s.source,
          original_title: media.original_title,
          title: cleanTitle,
          region: media.region,
          year: media.year,
          season: null,
          episode: null,
          url: s.url,
          type: 'movie',
          is_movie: true
        });
        byPlat.set(k, {
          ...s,
          region: media.region,
          year: media.year,
          original_title: media.original_title,
          anime_title: s.anime_title || media.matched_anime_title || media.title,
          fileName,
          file_name: fileName,
          match_reason: s.match_reason || 'movie_full',
          matched_episode: null,
          type: 'movie'
        });
      }
    }
    // 电影：不过滤 matched_episode，每平台一条全片源
    const movieSources = [...byPlat.values()].slice(0, 8);

    media.episode_match = {
      input_season: null,
      input_episode: null,
      policy: 'movie_no_episode',
      selected_sources: movieSources.map((s) => ({
        source: s.source,
        episode_title: s.episode_title,
        matched_episode: null,
        match_reason: s.match_reason
      })),
      debug: episodeMatchDebug
    };

    // 电影：单候选（固定匹配），供模块展示
    const slimList = [
      {
        version_key: 'movie',
        display: media.display,
        title: media.title,
        region: media.region,
        region_label: media.region_label,
        year: media.year,
        season: null,
        episode: null,
        score: movieSources.length ? 100 : 40,
        source_count: movieSources.length,
        sources_preview: movieSources.map((s) => s.source),
        is_default: true
      }
    ];

    log(
      'info',
      `[ForwardAdapter] Movie resolved display="${media.display}" sources=${movieSources.length}`
    );

    return {
      sources: movieSources,
      animes: contentKept,
      allCandidates: detailed,
      versionCandidates: [],
      candidates: slimList,
      selected_version: 'movie',
      keyword,
      season: null,
      episode: null,
      searchMs,
      animeCount: animes.length,
      media,
      filterSteps: [
        ...(contentSteps || []),
        { step: 'movie_path', sources: movieSources.length }
      ],
      episodeMatchDebug
    };
  }

  // ========== 电视剧路径：版本候选 + 严格 episode ==========
  const versionBundle = buildVersionCandidates(contentKept, {
    title: query.title || keyword,
    season,
    episode,
    year: query.year,
    region: query.region,
    type: query.type
  });
  const candidates = versionBundle.candidates || [];
  const selected = pickCandidate(candidates, {
    version_key: query.version_key,
    region: query.region
  });

  const filtered = selected?._animes || [];
  const filterSteps = [
    ...(contentSteps || []),
    ...(versionBundle.steps || []),
    {
      step: 'version_select',
      version_key: selected?.version_key || null,
      from_query: query.version_key || null,
      candidates: candidates.length
    }
  ];

  const mediaQuery = {
    ...query,
    region: selected?.region || query.region,
    year: selected?.year || query.year
  };
  const media = buildMatchedMediaMetadata(mediaQuery, filtered, filterSteps, contentKept);
  if (selected) {
    media.display = selected.display;
    media.region = selected.region;
    media.region_label = selected.region_label;
    media.year = selected.year;
    media.version_key = selected.version_key;
    media.season = season;
    media.episode = episode;
  }

  log(
    'info',
    `[ForwardAdapter] version selected="${selected?.version_key || '-'}" ` +
      `display="${media.display}" candidates=${candidates.length} ` +
      `animes=${filtered.length}`
  );

  let rawSources = selected?._sources || [];
  const episodeMatchDebug = selected?._episode_match || {};
  if (!rawSources.length && filtered.length) {
    rawSources = collectEpisodeSourcesFromAnimes(filtered, episode, {}, {
      strict: true,
      debugOut: episodeMatchDebug
    });
  }

  const byPlat = new Map();
  for (const s of rawSources) {
    const k = String(s.source || 'unknown').toLowerCase();
    if (!byPlat.has(k)) {
      byPlat.set(k, {
        ...s,
        region: media.region,
        year: media.year,
        original_title: media.original_title,
        anime_title: s.anime_title || media.matched_anime_title || media.title,
        fileName: buildSourceFileLabel({
          source: s.source,
          original_title: media.original_title,
          title: media.title,
          region: media.region,
          year: media.year,
          season,
          episode,
          url: s.url
        })
      });
    }
  }
  const strictSources = [...byPlat.values()]
    .filter((s) => s.matched_episode == null || Number(s.matched_episode) === Number(episode))
    .slice(0, 8);

  media.episode_match = {
    input_season: season,
    input_episode: episode,
    policy: 'strict_exact_only',
    selected_sources: strictSources.map((s) => ({
      source: s.source,
      episode_title: s.episode_title,
      matched_episode: s.matched_episode,
      match_reason: s.match_reason
    })),
    debug: episodeMatchDebug
  };
  media.version_key = selected?.version_key || null;
  media.candidates_count = candidates.length;

  const slimList = candidates.map(slimCandidate);

  return {
    sources: strictSources,
    animes: filtered,
    allCandidates: detailed,
    versionCandidates: candidates,
    candidates: slimList,
    selected_version: selected?.version_key || null,
    keyword,
    season,
    episode,
    searchMs,
    animeCount: animes.length,
    media,
    filterSteps,
    episodeMatchDebug
  };
}

/**
 * Forward 主入口
 */
export async function getForwardDanmaku(queryInput = {}) {
  const started = Date.now();
  const query = parseForwardQuery(queryInput);
  const ctx = createTraceContext(queryInput.trace_id || queryInput.traceId);
  const traceId = ctx.trace_id;
  const movie = isMovieQuery(query);
  // 电影：不强制 S1E1；电视剧：1-based
  const season = movie ? null : toSeasonNum(query.season);
  const episode = movie ? null : toEpisodeNum(query.episode);
  const titleHint = query.title || query.tmdb_id || query.movie_id || query.imdb_id || '';

  log(
    'info',
    `[ForwardAdapter][trace=${traceId}] request_start type=${movie ? 'movie' : 'tv'} title="${query.title || ''}" ` +
      `tmdb=${query.tmdb_id || '-'} year=${query.year || '-'} ` +
      `season=${movie ? 'n/a' : season} episode=${movie ? 'n/a' : episode} ` +
      `raw_season=${query.season} raw_episode=${query.episode}`
  );
  trace(ctx, 'request_start', { type: movie ? 'movie' : 'tv', tmdb_id: query.tmdb_id, season, episode });

  if (!titleHint && !query.episode_id && !query.anime_id) {
    const err = new TypeError('require title, tmdb_id, movie_id, imdb_id or episode_id');
    err.status = 400;
    throw err;
  }

  // cacheIdentity 在 resolve 后用完整 identity 构建
  let cacheIdentity = {
    title: String(query.title || titleHint),
    original_title: query.original_title || null,
    tmdb_id: query.tmdb_id || query.movie_id || null,
    imdb_id: query.imdb_id || null,
    region: query.region || null,
    year: query.year || null,
    season,
    episode,
    type: movie ? 'movie' : 'tv',
    is_movie: movie
  };

  if (query.episode_id) {
    log('info', `[ForwardAdapter] episode_id=${query.episode_id} noted; still force aggregate path`);
  }

  // —— 搜索 +（电影：全片源 / 电视剧：版本候选）——
  const resolved = await resolveMultiSources({
    ...query,
    season,
    episode,
    title: titleHint,
    type: movie ? 'movie' : query.type || 'tv',
    is_movie: movie
  });
  trace(ctx, 'candidate_match', { candidates: resolved.animeCount, sources: resolved.sources.length });
  const { sources, searchMs, animeCount, media, candidates, selected_version } = resolved;
  const cacheProbe = {
    hit: false,
    empty_hit: false,
    key: null
  };

  // 仅识别：返回候选版本列表（模块负责展示/切换，不在此固定唯一结果）
  if (query.resolve_only) {
    const elapsed = Date.now() - started;
    log(
      'info',
      `[ForwardAdapter] resolve_only display="${media?.display || '-'}" ` +
        `candidates=${(candidates || []).length} selected=${selected_version || '-'} ${elapsed}ms`
    );
    const payload = {
      count: 0,
      comments: [],
      media: slimMedia(media),
      // 始终返回 candidates，供 Forward 模块做版本切换
      candidates: candidates || [],
      selected_version: selected_version || null
    };
    if (query.debug) {
      payload.meta = {
        resolve_only: true,
        media,
        candidates,
        selected_version,
        filter_steps: resolved.filterSteps || media?.filter_steps || [],
        processing_ms: elapsed,
        search_ms: searchMs,
        anime_count: animeCount,
        source_count: sources.length
      };
    }
    return wrapResult(payload, query, {
      cached: false,
      resolve_only: true,
      processing_ms: elapsed,
      media,
      candidates,
      selected_version,
      source_count: sources.length
    });
  }

  // Forward 专属：强制走聚合缓存
  // 电影：tmdb:id:movie；电视剧：tmdb + s/e + version
  cacheIdentity = {
    title: media?.title || query.title || titleHint,
    original_title: media?.original_title || query.original_title || null,
    tmdb_id: query.tmdb_id || query.movie_id || media?.tmdb_id || null,
    imdb_id: query.imdb_id || media?.imdb_id || null,
    region: media?.region || query.region || null,
    region_label: media?.region_label || null,
    year: media?.year || query.year || null,
    version_key: movie
      ? null
      : selected_version || media?.version_key || query.version_key || null,
    season: movie ? null : season,
    episode: movie ? null : episode,
    type: movie ? 'movie' : 'tv',
    is_movie: movie
  };
  cacheProbe.key = buildEpisodeIdentity(cacheIdentity).key;

  // 带完整 identity 的缓存命中（新 key 含 region/year）
  if (!query.force) {
    const cached = await tryLoadEpisodeCache(cacheIdentity);
    if (cached?.comments?.length) {
      const elapsed = Date.now() - started;
      const presented = applyPlayerPresentation(toPlayerComments(cached.comments), { colorToWhite: query.color_to_white, forceScroll: query.force_scroll });
      const finalQueue = buildFinalDanmuStats(presented);
      ctx.providerStats.rawDanmuCount = Number(cached.stats?.total_before || 0);
      ctx.providerStats.mergedDanmuCount = Number(cached.stats?.total_after || cached.comments.length);
      ctx.providerStats.filteredDanmuCount = ctx.providerStats.mergedDanmuCount;
      ctx.providerStats.usableSourceCount = (cached.sources || []).filter(s => Number(s.count_used ?? s.count_raw ?? 0) > 0).length;
      ctx.providerStats.failedSourceCount = (cached.sources || []).filter(s => s.status === 'failed' || s.error).length;
      ctx.providerStats.emptySourceCount = (cached.sources || []).filter(s => Number(s.count_raw || 0) === 0 && !s.error).length;
      ctx.danmuStats.providerRawDanmuCount = ctx.providerStats.rawDanmuCount;
      ctx.danmuStats.aggregationInputCount = ctx.providerStats.rawDanmuCount;
      ctx.danmuStats.mergedDanmuCount = ctx.providerStats.mergedDanmuCount;
      ctx.danmuStats.filteredDanmuCount = ctx.providerStats.filteredDanmuCount;
      finalizeDanmuStats(ctx, finalQueue);
      trace(ctx, 'cache_hit', { key: cached.key, final: finalQueue.final });
      log('info', `[ForwardAdapter] cache hit ${cached.key} count=${cached.comments.length} ${elapsed}ms`);
      const payload = buildForwardDanmakuPayload({
        comments: cached.comments,
        includeMeta: query.debug,
        meta: query.debug
          ? {
              cached: true,
              key: cached.key,
              identity: cached.identity,
              media: slimMedia(media),
              sources: cached.sources || [],
              sources_detail: cached.sources || [],
              stats: cached.stats || {},
              trace_id: traceId,
              providerStats: ctx.providerStats,
              danmuStats: ctx.danmuStats,
              processing_ms: elapsed,
              pipeline: 'cache→present'
            }
          : null,
        colorToWhite: query.color_to_white,
        forceScroll: query.force_scroll
      });
      payload.media = slimMedia(media);
      payload.candidates = candidates || [];
      payload.selected_version = selected_version || media?.version_key || null;
      payload.sources_detail = query.debug ? (cached.sources || []) : undefined;
      return wrapResult(payload, query, {
        cached: true,
        key: cached.key,
        sources: cached.sources,
        stats: cached.stats,
        processing_ms: elapsed,
        media,
        candidates,
        selected_version,
        source_count: (cached.sources || []).length
      });
    }
    log('info', `[ForwardAdapter][debug] cache miss key=${cacheProbe.key} empty_hit=false`);
  }

  if (!sources.length) {
    // 无来源：Forward 不允许「裸单源旁路」，直接空结果 + media
    const emptyMedia = media || buildMatchedMediaMetadata(query, [], resolved.filterSteps || [], []);
    const emptyMeta = {
      cached: false,
      empty_cache_hit: false,
      key: cacheProbe.key,
      union_id: query.tmdb_id
        ? `${query.tmdb_id}_${movie ? 'movie_0_0' : `tv_${season}_${episode}`}`
        : null,
      tmdb_id: query.tmdb_id || null,
      type: movie ? 'movie' : 'tv',
      title: query.title || null,
      original_title: query.original_title || null,
      year: query.year || null,
      search_keywords: [resolved.keyword].filter(Boolean),
      provider_candidates: resolved.episodeMatchDebug?.anime_matches || [],
      anime_count: animeCount,
      source_count: 0,
      sources: [],
      sources_detail: [],
      filter_steps: resolved.filterSteps || emptyMedia?.filter_steps || [],
      stats: { total_before: 0, total_after: 0, removed: 0 },
      trace_id: traceId,
      providerStats: ctx.providerStats,
      danmuStats: ctx.danmuStats,
      final_count: 0
    };
    log('info', `[ForwardAdapter][debug] empty ${JSON.stringify(emptyMeta)}`);
    return wrapResult(
      {
        count: 0,
        comments: [],
        media: slimMedia(emptyMedia),
        candidates: candidates || [],
        selected_version: selected_version || null,
        ...(query.debug ? { meta: emptyMeta } : {})
      },
      query,
      {
        cached: false,
        errorMessage: '未找到可用弹幕来源（Forward 强制聚合路径）',
        processing_ms: Date.now() - started,
        media: emptyMedia
      }
    );
  }

  log(
    'info',
    `[ForwardAdapter] FORCE aggregate type=${movie ? 'movie' : 'tv'} n=${sources.length} ` +
      `media=${media?.display || '-'} key=${buildEpisodeIdentity(cacheIdentity).key}`
  );
  const agg = await aggregateEpisode({
    title: cacheIdentity.title,
    original_title: cacheIdentity.original_title,
    tmdb_id: cacheIdentity.tmdb_id,
    imdb_id: cacheIdentity.imdb_id,
    region: cacheIdentity.region,
    region_label: cacheIdentity.region_label,
    year: cacheIdentity.year,
    version_key: cacheIdentity.version_key || null,
    // 电影：season/episode 必须为 null，禁止假 S01E01 污染来源文件名
    season: movie ? null : season,
    episode: movie ? null : episode,
    type: movie ? 'movie' : 'tv',
    is_movie: movie,
    force: query.force === true,
    timeline: true,
    strict_sources: true,
    sources: sources.map((s) => {
      const fileName =
        s.fileName ||
        s.file_name ||
        buildSourceFileLabel({
          source: s.source,
          original_title: s.original_title || cacheIdentity.original_title,
          title: s.anime_title || cacheIdentity.title,
          region: s.region || cacheIdentity.region,
          year: s.year || cacheIdentity.year,
          season: movie ? null : season,
          episode: movie ? null : episode,
          url: s.url,
          type: movie ? 'movie' : 'tv',
          is_movie: movie
        });
      return {
        source: s.source,
        url: s.url || s.episode_id,
        full_url: s.full_url || s.url,
        episode_id: s.episode_id,
        anime_title: s.anime_title,
        episode_title: s.episode_title,
        fileName,
        file_name: fileName,
        region: s.region || cacheIdentity.region,
        year: s.year || cacheIdentity.year,
        original_title: s.original_title || cacheIdentity.original_title,
        match_reason: s.match_reason || (movie ? 'movie_full' : null),
        matched_episode: movie ? null : s.matched_episode,
        type: movie ? 'movie' : 'tv'
      };
    })
  });

  let comments = toPlayerComments(agg.comments || []);
  // 固定流水线末段：颜色/位置转换（Forward 服务端完成）
  comments = applyPlayerPresentation(comments, {
    colorToWhite: query.color_to_white,
    forceScroll: query.force_scroll
  });
  const finalDanmuStats = buildFinalDanmuStats(comments);
  ctx.providerStats.searchedProviderCount = new Set((resolved.allCandidates || []).map(a => a?.source).filter(Boolean)).size;
  ctx.providerStats.candidateProviderCount = new Set((resolved.animes || []).map(a => a?.source).filter(Boolean)).size;
  ctx.providerStats.usableSourceCount = (agg.sources || []).filter(s => Number(s.count_used ?? s.count_after ?? s.count_raw ?? 0) > 0).length;
  ctx.providerStats.failedSourceCount = (agg.sources || []).filter(s => s.status === 'failed' || s.error).length;
  ctx.providerStats.emptySourceCount = (agg.sources || []).filter(s => Number(s.count_raw || 0) === 0 && !s.error).length;
  ctx.providerStats.rejectedCandidateCount = (resolved.filterSteps || []).reduce((n, s) => n + Number(s.rejected || 0), 0);
  ctx.providerStats.rawDanmuCount = Number(agg.stats?.total_before || 0);
  ctx.providerStats.mergedDanmuCount = Number(agg.stats?.total_after || 0);
  ctx.providerStats.filteredDanmuCount = Number(agg.stats?.total_after || 0);
  ctx.danmuStats.providerRawDanmuCount = ctx.providerStats.rawDanmuCount;
  ctx.danmuStats.aggregationInputCount = ctx.providerStats.rawDanmuCount;
  ctx.danmuStats.mergedDanmuCount = Number(agg.stats?.total_after || 0);
  ctx.danmuStats.filteredDanmuCount = Number(agg.stats?.total_after || 0);
  finalizeDanmuStats(ctx, finalDanmuStats);
  trace(ctx, 'adapter_return', { final: comments.length });
  const elapsed = Date.now() - started;

  const sourcesDetail = (agg.sources || []).map((s, i) => ({
    ...s,
    file_name: s.file_name || s.fileName || sources[i]?.fileName || null,
    matched_title: s.matched_title || s.anime_title || sources[i]?.anime_title || null
  }));

  const meta = {
    cached: Boolean(agg.cached),
    key: agg.key,
    identity: {
      ...cacheIdentity,
      display: media?.display
    },
    media,
    sources: sourcesDetail,
    sources_detail: sourcesDetail,
    stats: {
      total_before: agg.stats?.total_before,
      total_after: comments.length,
      removed: agg.stats?.removed,
      removed_by_reason: agg.stats?.removed_by_reason,
      processing_ms: agg.stats?.processing_ms,
      pipeline_ms: elapsed,
      search_ms: searchMs,
      color_to_white: query.color_to_white,
      force_scroll: query.force_scroll,
      final_queue: finalDanmuStats
    },
    anime_count: animeCount,
    source_count: sourcesDetail.length,
    trace_id: traceId,
    providerStats: ctx.providerStats,
    danmuStats: ctx.danmuStats,
    /*providerStats: {
      // moduleProviderCount 不在服务端推断；它是模块生命周期指标。
      searchedProviderCount: new Set((resolved.allCandidates || []).map(a => a?.source).filter(Boolean)).size,
      candidateProviderCount: new Set((resolved.animes || []).map(a => a?.source).filter(Boolean)).size,
      usableSourceCount: sourcesDetail.filter(s => Number(s.count_used ?? s.count_after ?? s.count_raw ?? 0) > 0).length,
      failedSourceCount: sourcesDetail.filter(s => s.status === 'failed' || s.error).length,
      emptySourceCount: sourcesDetail.filter(s => Number(s.count_raw || 0) === 0 && !s.error).length,
      rejectedCandidateCount: (resolved.filterSteps || []).reduce((n, s) => n + Number(s.rejected || 0), 0),
      rawDanmuCount: Number(agg.stats?.total_before || 0),
      deduplicatedDanmuCount: Number(agg.stats?.total_after || 0),
      finalDanmuCount: finalDanmuStats.final,
      finalPositionCounts: finalDanmuStats
    },*/
    pipeline: 'match→aggregate→dedupe→color→scroll→return'
  };

  const payload = buildForwardDanmakuPayload({
    comments,
    includeMeta: query.debug,
    meta: query.debug ? meta : null,
    // 已在上方 apply，避免双重
    colorToWhite: false,
    forceScroll: false
  });
  // 覆盖 count（apply 后）
  payload.count = comments.length;
  payload.comments = comments;
  payload.media = slimMedia(media);
  // 始终返回候选版本，便于模块切换
  payload.candidates = candidates || [];
  payload.selected_version = selected_version || media?.version_key || null;
  if (query.debug) {
    payload.sources_detail = sourcesDetail;
    meta.candidates = candidates;
    meta.selected_version = selected_version;
  }

  return wrapResult(payload, query, {
    cached: Boolean(agg.cached),
    key: agg.key,
    sources: sourcesDetail,
    stats: meta.stats,
    processing_ms: elapsed,
    source_count: sourcesDetail.length,
    media,
    candidates,
    selected_version
  });
}

/** 播放器可见的轻量 media（无来源统计） */
function slimMedia(media) {
  if (!media) return null;
  return {
    title: media.title ?? null,
    original_title: media.original_title ?? null,
    year: media.year ?? null,
    season_year: media.season_year ?? null,
    region: media.region ?? null,
    region_label: media.region_label ?? null,
    tmdb_id: media.tmdb_id ?? null,
    imdb_id: media.imdb_id ?? null,
    tvdb_id: media.tvdb_id ?? null,
    country: media.country ?? null,
    network: media.network ?? null,
    season: media.season ?? null,
    episode: media.episode ?? null,
    display_title: media.display_title ?? null,
    display: media.display ?? null,
    version_key: media.version_key ?? null
  };
}

function wrapResult(payload, query, extra = {}) {
  return {
    success: (payload.comments?.length || 0) > 0 || !extra.errorMessage,
    errorMessage: extra.errorMessage || '',
    format: query.format,
    payload,
    internal: extra,
    json: payload,
    xml: () => toPlayerXml(payload.comments || []),
    ass: () => toPlayerAss(payload.comments || [])
  };
}

export function adaptSearchAnimesForForward(animes = []) {
  return sanitizeAnimeList(animes);
}

export function adaptEpisodesForForward(episodes = []) {
  return sanitizeEpisodeList(episodes);
}

export function resolveForwardIdentity() {
  return null;
}

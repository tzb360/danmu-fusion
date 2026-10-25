import { jsonResponse } from '../utils/http-util.js';
import { log } from '../utils/log-util.js';
import { globals } from '../configs/globals.js';
import {
  aggregateEpisode,
  listAggregatedEpisodes,
  getAggregatedEpisodeDetail,
  clearAggregatedEpisode,
  reaggregateEpisode
} from '../aggregation/episode-service.js';
import {
  getForwardDanmaku,
  parseForwardQuery,
  adaptSearchAnimesForForward,
  adaptEpisodesForForward
} from '../forward_adapter/index.js';
import { searchAnime, getBangumi } from './dandan-api.js';

async function readJsonBody(req) {
  try {
    return await req.json();
  } catch {
    throw new SyntaxError('Invalid JSON request body');
  }
}

/**
 * 缓存清理/重建：TOKEN 或 ADMIN_TOKEN 均可
 * （原先仅 ADMIN，导致 Web 用普通 TOKEN 登录时清空缓存 403 Forbidden）
 */
function hasWritePermission() {
  const current = String(globals.currentToken || '').trim();
  if (!current) return false;
  const adminToken = String(globals.adminToken || '').trim();
  const apiToken = String(globals.token || '').trim();
  if (adminToken && current === adminToken) return true;
  if (apiToken && current === apiToken) return true;
  // 无鉴权/默认开放时
  if (!adminToken && !apiToken) return true;
  return false;
}

function forbidden() {
  return jsonResponse({
    errorCode: 403,
    success: false,
    errorMessage: 'Forbidden：请使用带 TOKEN 的管理地址访问（URL 路径中的 token）'
  }, 403);
}

/**
 * POST /api/episode/aggregate
 * 管理端：可返回完整 comments（含内部 p 来源，供调试）
 * 查询参数 player=1 时返回播放器纯净格式
 */
export async function handleEpisodeAggregate(req, url) {
  try {
    const body = await readJsonBody(req);
    const result = await aggregateEpisode(body);
    const status = result.success === false && result.errorMessage ? 404 : 200;

    let comments = result.comments;
    // 默认管理接口保留内部格式；player=1 时净化
    if (url?.searchParams?.get('player') === '1' || body.player === true) {
      const { toPlayerComments } = await import('../forward_adapter/format.js');
      comments = toPlayerComments(result.comments || []);
    }

    return jsonResponse({
      errorCode: result.success === false ? 404 : 0,
      success: result.success !== false,
      errorMessage: result.errorMessage || '',
      key: result.key,
      identity: result.identity,
      cached: result.cached,
      sources: result.sources,
      stats: result.stats,
      count: comments?.length ?? result.count,
      comments
    }, status);
  } catch (error) {
    const status = error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
    log(status >= 500 ? 'error' : 'warn', `[EpisodeAggregate] aggregate failed: ${error.message}`);
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message
    }, status);
  }
}

/**
 * GET /api/forward/danmaku
 * 播放器专用：纯净弹幕，无来源标签
 * 参数：title|tmdb_id|movie_id|imdb_id + season + episode + format
 */
export async function handleForwardDanmaku(req, url) {
  try {
    const query = parseForwardQuery(url);
    if (!query.title && !query.tmdb_id && !query.movie_id && !query.imdb_id && !query.episode_id) {
      return jsonResponse({
        errorCode: 400,
        success: false,
        errorMessage: 'require title, tmdb_id, movie_id, imdb_id or episode_id',
        count: 0,
        comments: []
      }, 400);
    }

    const fwd = await getForwardDanmaku(url);

    // 无弹幕时仍返回 404，但必须带齐 media/candidates/meta，
    // 否则调用方无法验证 movie/tv 分流与匹配链路（通用流程可观测性）
    if (!fwd.success && (!fwd.payload?.comments || !fwd.payload.comments.length)) {
      const emptyPayload = fwd.payload || {};
      return jsonResponse({
        errorCode: 404,
        success: false,
        errorMessage: fwd.errorMessage || 'no danmaku',
        count: 0,
        comments: [],
        media: emptyPayload.media || null,
        candidates: emptyPayload.candidates || [],
        selected_version: emptyPayload.selected_version || null,
        meta: emptyPayload.meta || {
          media: emptyPayload.media || fwd.internal?.media || null,
          key: fwd.internal?.key || null,
          sources: fwd.internal?.sources || [],
          sources_detail: fwd.internal?.sources || [],
          processing_ms: fwd.internal?.processing_ms || null,
          errorMessage: fwd.errorMessage || 'no danmaku'
        }
      }, 404);
    }

    // 严格校验：播放器 JSON 不得含来源标记
    const comments = fwd.payload.comments || [];
    for (const c of comments) {
      if (c.source != null || c.provider != null || c._sourceLabel != null) {
        delete c.source;
        delete c.provider;
        delete c._sourceLabel;
      }
    }

    if (query.format === 'xml') {
      return new Response(fwd.xml(), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8' }
      });
    }
    if (query.format === 'ass') {
      return new Response(fwd.ass(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // 默认 JSON：纯净 {count, comments} + media；debug=1 才带 meta（含 sources 统计）
    const media = fwd.payload?.media || fwd.internal?.media || null;
    const headers = {
      'X-Danmaku-Count': String(comments.length),
      'X-Danmaku-Cached': String(Boolean(fwd.internal?.cached)),
      'X-Danmaku-Sources': String(fwd.internal?.source_count || fwd.internal?.sources?.length || 0),
      'X-Danmaku-Ms': String(fwd.internal?.processing_ms || 0)
    };
    if (fwd.internal?.stats?.total_before != null) {
      headers['X-Danmaku-Before'] = String(fwd.internal.stats.total_before);
    }
    // HTTP 头必须是 ByteString；中文 display 放在 JSON body.media，头里仅放 ASCII 安全字段
    if (media?.year && /^[\x00-\x7F]+$/.test(String(media.year))) {
      headers['X-Danmaku-Year'] = String(media.year);
    }
    if (media?.season != null) {
      headers['X-Danmaku-Season'] = String(media.season);
    }
    if (media?.episode != null) {
      headers['X-Danmaku-Episode'] = String(media.episode);
    }
    if (media?.tmdb_id && /^[\x00-\x7F]+$/.test(String(media.tmdb_id))) {
      headers['X-Danmaku-Tmdb-Id'] = String(media.tmdb_id);
    }
    const { sliceForwardPayload } = await import('../forward_adapter/options.js');
    return jsonResponse(sliceForwardPayload({
      ...fwd.payload,
      partial: (fwd.internal?.sources || []).some(s => s.error || s.status === 'failed')
    }, url.searchParams), 200, headers);
  } catch (error) {
    const status = error.status || (error instanceof TypeError ? 400 : 500);
    log(status >= 500 ? 'error' : 'warn', `[ForwardAdapter] danmaku failed: ${error.message}`);
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message,
      count: 0,
      comments: []
    }, status);
  }
}

/**
 * GET /api/forward/search?keyword|title=
 * 返回净化标题的搜索列表（无【renren】装饰）
 */
export async function handleForwardSearch(url) {
  try {
    const title = url.searchParams.get('title')
      || url.searchParams.get('keyword')
      || url.searchParams.get('name')
      || '';
    if (!title) {
      return jsonResponse({ success: false, errorMessage: 'title required', animes: [] }, 400);
    }
    // 复用 searchAnime：构造临时 URL
    const fake = new URL('http://local/api/v2/search/anime');
    fake.searchParams.set('keyword', title);
    const season = url.searchParams.get('season');
    const episode = url.searchParams.get('episode');
    if (season) fake.searchParams.set('season', season);
    if (episode) fake.searchParams.set('episode', episode);

    const res = await searchAnime(fake);
    const body = JSON.parse(await res.text());
    if (body.animes) {
      body.animes = adaptSearchAnimesForForward(body.animes);
    }
    return jsonResponse(body);
  } catch (error) {
    log('warn', `[ForwardAdapter] search failed: ${error.message}`);
    return jsonResponse({ success: false, errorMessage: error.message, animes: [] }, 500);
  }
}

/**
 * GET /api/forward/detail?animeId=
 * 分集列表标题净化
 */
export async function handleForwardDetail(url) {
  try {
    const animeId = url.searchParams.get('animeId') || url.searchParams.get('anime_id');
    if (!animeId) {
      return jsonResponse({ success: false, errorMessage: 'animeId required' }, 400);
    }
    const res = await getBangumi(animeId);
    const body = JSON.parse(await res.text());
    if (body?.bangumi?.episodes) {
      body.bangumi.episodes = adaptEpisodesForForward(body.bangumi.episodes);
    }
    if (body?.bangumi?.animeTitle) {
      const { sanitizePlayerTitle } = await import('../forward_adapter/format.js');
      body.bangumi.animeTitle = sanitizePlayerTitle(body.bangumi.animeTitle);
    }
    return jsonResponse(body);
  } catch (error) {
    log('warn', `[ForwardAdapter] detail failed: ${error.message}`);
    return jsonResponse({ success: false, errorMessage: error.message }, 500);
  }
}

export async function handleListEpisodeCache() {
  const items = await listAggregatedEpisodes();
  return jsonResponse({
    success: true,
    total: items.length,
    items
  });
}

export async function handleGetEpisodeCacheDetail(url) {
  const key = url.searchParams.get('key');
  if (!key) {
    return jsonResponse({ success: false, errorMessage: 'key required' }, 400);
  }
  const detail = await getAggregatedEpisodeDetail(key);
  if (!detail) {
    return jsonResponse({ success: false, errorMessage: 'not found' }, 404);
  }
  return jsonResponse({ success: true, detail });
}

export async function handleDeleteEpisodeCache(url) {
  if (!hasWritePermission()) return forbidden();
  const key = url.searchParams.get('key') || null;
  const result = await clearAggregatedEpisode(key);
  log('info', `[EpisodeAggregate] cache cleared key=${key || '*'}`);
  return jsonResponse({ success: true, ...result });
}

export async function handleReaggregateEpisode(req) {
  try {
    if (!hasWritePermission()) return forbidden();
    const body = await readJsonBody(req);
    const result = await reaggregateEpisode(body);
    return jsonResponse({
      errorCode: 0,
      success: true,
      key: result.key,
      identity: result.identity,
      cached: false,
      sources: result.sources,
      stats: result.stats,
      count: result.count,
      comments: result.comments
    });
  } catch (error) {
    const status = error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message
    }, status);
  }
}

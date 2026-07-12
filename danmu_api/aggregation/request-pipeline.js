/**
 * 请求链路插入点：多源抓取结果 → 聚合清洗 → 播放器纯净输出 + 自动剧集缓存
 *
 * 不替代原有 search / 来源抓取，只在「已有多源弹幕」之后增强处理。
 */
import { log } from '../utils/log-util.js';
import { globals } from '../configs/globals.js';
import { processDanmakuMerge } from './aggregator.js';
import { toDandanComment } from './parser.js';
import { toPlayerComments } from '../forward_adapter/format.js';
import { buildEpisodeIdentity } from './episode-identity.js';
import { loadEpisodeCache, saveEpisodeCache } from './episode-cache.js';
import { convertToDanmakuJson } from '../utils/danmu-util.js';
import { extractAnimeInfo } from '../utils/common-util.js';
import { recordProcessingStatistics } from './statistics.js';

/**
 * 将各源 formatComments 结果转为 processDanmakuMerge 的 sources
 * @param {Array<Array>} results - 每源弹幕数组
 * @param {string[]} sourceNames
 */
export function buildMergeSourcesFromFetchResults(results = [], sourceNames = []) {
  const sources = [];
  for (let i = 0; i < results.length; i++) {
    const list = results[i] || [];
    const name = sourceNames[i] || list[0]?._sourceLabel || `source_${i + 1}`;
    if (!list.length) continue;

    const data = list.map((item, idx) => {
      if (item && item.p && item.m !== undefined) {
        return {
          p: item.p,
          m: item.m,
          content: item.m,
          source: item._sourceLabel || name,
          id: item.cid || `${name}-${idx}`
        };
      }
      // 原始 formatComments 对象
      return {
        ...item,
        content: item.content || item.m || item.text,
        time: item.time ?? item.timepoint ?? item.t,
        source: item._sourceLabel || name
      };
    });

    sources.push({ source: name, data });
  }
  return sources;
}

/**
 * 多源抓取后：智能聚合清洗 → 播放器纯净 comments
 * 保留 convertToDanmakuJson 的屏蔽词/采样等后处理能力：先聚合清洗再走兼容转换
 *
 * @returns {{ comments: Array, stats: object, total_before: number, total_after: number }}
 */
export function aggregateAndCleanFetchedSources(results, sourceNames, options = {}) {
  const mergeSources = buildMergeSourcesFromFetchResults(results, sourceNames);
  if (!mergeSources.length) {
    return { comments: [], stats: {}, total_before: 0, total_after: 0 };
  }

  const merged = processDanmakuMerge({
    episode: options.episode ?? null,
    sources: mergeSources,
    output_format: 'standard',
    rules: {
      timeline: { enabled: options.timeline !== false },
      ...(options.rules || {})
    }
  });

  // 播放器纯净 p/m（无来源标签）；内部 stats 已含各源计数
  let playerComments = (merged.result || []).map((item, index) => {
    const d = toDandanComment(item, { includeSource: false });
    return {
      p: d.p,
      m: d.m,
      cid: index + 1,
      t: d.t
    };
  });
  playerComments = toPlayerComments(playerComments);

  // 可选：再走屏蔽词/采样等兼容处理（globals 已初始化时）
  try {
    if (globals?.blockedWords !== undefined || globals?.groupMinute !== undefined) {
      const intermediate = playerComments.map((c, index) => ({
        p: c.p,
        m: c.m,
        content: c.m,
        timepoint: c.t,
        ct: 1
      }));
      let after = convertToDanmakuJson(intermediate, 'pool');
      if (after && after.comments) after = after.comments;
      if (Array.isArray(after) && after.length) {
        playerComments = toPlayerComments(after);
      }
    }
  } catch {
    // globals 未就绪时跳过
  }

  try {
    recordProcessingStatistics({
      total_before: merged.total_before,
      total_after: playerComments.length,
      removed: merged.total_before - playerComments.length,
      stats: merged.stats
    }, { operation: 'request_pipeline' });
  } catch { /* ignore */ }

  log('info', `[RequestPipeline] multi-source aggregate ${merged.total_before} -> ${playerComments.length}`);

  return {
    comments: playerComments,
    stats: {
      ...merged.stats,
      total_before: merged.total_before,
      total_after: playerComments.length,
      removed: merged.total_before - playerComments.length,
      removed_by_reason: merged.stats?.removed_by_reason || {}
    },
    total_before: merged.total_before,
    total_after: playerComments.length,
    sources_summary: mergeSources.map(s => ({
      source: s.source,
      count_raw: Array.isArray(s.data) ? s.data.length : 0
    }))
  };
}

/**
 * 单源/已合并 comments 最终净化（去掉来源标签）
 */
export function finalizePlayerComments(comments = []) {
  if (!Array.isArray(comments)) return [];
  // 若已是 {comments} 包装
  const list = comments.comments && Array.isArray(comments.comments) ? comments.comments : comments;
  return toPlayerComments(list);
}

/**
 * 自动写入剧集缓存（后台可查看，播放器不依赖人工触发）
 */
export async function autoSaveEpisodeCache(meta = {}, pipelineResult = {}) {
  try {
    if (!meta.title && !meta.tmdb_id && !meta.imdb_id) return null;
    const identity = buildEpisodeIdentity({
      title: meta.title || '',
      original_title: meta.original_title || null,
      tmdb_id: meta.tmdb_id || null,
      imdb_id: meta.imdb_id || null,
      region: meta.region || null,
      region_label: meta.region_label || null,
      year: meta.year || null,
      version_key: meta.version_key || null,
      season: meta.is_movie === true || meta.type === 'movie' ? null : (meta.season ?? 1),
      episode: meta.is_movie === true || meta.type === 'movie' ? null : (meta.episode ?? 1),
      type: meta.type || null,
      is_movie: meta.is_movie === true || meta.isMovie === true
    });
    await saveEpisodeCache({
      key: identity.key,
      identity,
      sources: pipelineResult.sources_summary || pipelineResult.sources || meta.sources || [],
      sources_detail: pipelineResult.sources_detail || pipelineResult.sources_summary || meta.sources || [],
      stats: {
        total_before: pipelineResult.total_before ?? pipelineResult.stats?.total_before,
        total_after: pipelineResult.total_after ?? pipelineResult.comments?.length,
        removed: pipelineResult.stats?.removed,
        removed_by_reason: pipelineResult.stats?.removed_by_reason || {}
      },
      comments: pipelineResult.comments || []
    });
    return identity.key;
  } catch (error) {
    log('warn', `[RequestPipeline] auto cache skip: ${error.message}`);
    return null;
  }
}

export async function tryLoadEpisodeCache(meta = {}) {
  try {
    if (!meta.title && !meta.tmdb_id && !meta.imdb_id) return null;
    const identity = buildEpisodeIdentity({
      title: meta.title || '',
      original_title: meta.original_title || null,
      tmdb_id: meta.tmdb_id || null,
      imdb_id: meta.imdb_id || null,
      region: meta.region || null,
      region_label: meta.region_label || null,
      year: meta.year || null,
      version_key: meta.version_key || null,
      season: meta.is_movie === true || meta.type === 'movie' ? null : (meta.season ?? 1),
      episode: meta.is_movie === true || meta.type === 'movie' ? null : (meta.episode ?? 1),
      type: meta.type || null,
      is_movie: meta.is_movie === true || meta.isMovie === true
    });
    const cached = await loadEpisodeCache(identity.key);
    if (cached?.comments?.length) {
      return {
        key: identity.key,
        comments: finalizePlayerComments(cached.comments),
        stats: cached.stats,
        sources: cached.sources,
        identity: cached.identity
      };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 从 animeTitle + episodeTitle 推断季集
 */
export function inferSeasonEpisode(animeTitle, episodeTitle, fallbackEpisode = 1) {
  try {
    const info = extractAnimeInfo(animeTitle || '', episodeTitle || '');
    return {
      title: info.baseTitle || animeTitle || '',
      season: info.season || 1,
      episode: info.episode || fallbackEpisode || 1
    };
  } catch {
    return { title: animeTitle || '', season: 1, episode: fallbackEpisode || 1 };
  }
}

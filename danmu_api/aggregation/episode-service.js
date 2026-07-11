/**
 * 剧集级弹幕聚合编排服务
 * 识别剧集 → 发现多来源 → 抓取 → 标准化 → 合并清洗 → 缓存
 */
import { globals } from '../configs/globals.js';
import { log } from '../utils/log-util.js';
import { sourceLogContext, toLogSourceName } from '../utils/http-util.js';
import {
  findUrlById,
  findTitleById,
  findAnimeTitleById,
  getSearchCache,
  getCommentCache,
  setCommentCache
} from '../utils/cache-util.js';
import { MERGE_DELIMITER } from '../utils/merge-util.js';
import { extractEpisodeTitle } from '../utils/common-util.js';
import { processDanmakuMerge } from './aggregator.js';
import { toDandanComment } from './parser.js';
import {
  buildEpisodeIdentity,
  resolveSourceWeight,
  buildSourceFileLabel,
  formatVersionDisplay
} from './episode-identity.js';
import { loadEpisodeCache, saveEpisodeCache, listEpisodeCaches, deleteEpisodeCache, getEpisodeCacheDetail } from './episode-cache.js';
import { limitDanmusByCount } from '../utils/danmu-util.js';
import {
  getGuardConfig,
  protectMultiSource,
  capFinalComments,
  logEpisodeDiagnostics,
  withTimeout,
  getMemorySnapshot
} from './source-guard.js';

import RenrenSource from '../sources/renren.js';
import HanjutvSource from '../sources/hanjutv.js';
import BahamutSource from '../sources/bahamut.js';
import DandanSource from '../sources/dandan.js';
import CustomSource from '../sources/custom.js';
import TencentSource from '../sources/tencent.js';
import IqiyiSource from '../sources/iqiyi.js';
import MangoSource from '../sources/mango.js';
import BilibiliSource from '../sources/bilibili.js';
import MiguSource from '../sources/migu.js';
import YoukuSource from '../sources/youku.js';
import SohuSource from '../sources/sohu.js';
import LeshiSource from '../sources/leshi.js';
import XiguaSource from '../sources/xigua.js';
import MaiduiduiSource from '../sources/maiduidui.js';
import AiyifanSource from '../sources/aiyifan.js';
import AnimekoSource from '../sources/animeko.js';
import OtherSource from '../sources/other.js';

const renrenSource = new RenrenSource();
const hanjutvSource = new HanjutvSource();
const bahamutSource = new BahamutSource();
const dandanSource = new DandanSource();
const customSource = new CustomSource();
const tencentSource = new TencentSource();
const youkuSource = new YoukuSource();
const iqiyiSource = new IqiyiSource();
const mangoSource = new MangoSource();
const bilibiliSource = new BilibiliSource();
const miguSource = new MiguSource();
const sohuSource = new SohuSource();
const leshiSource = new LeshiSource();
const xiguaSource = new XiguaSource();
const maiduiduiSource = new MaiduiduiSource();
const aiyifanSource = new AiyifanSource();
const animekoSource = new AnimekoSource();
const otherSource = new OtherSource();

const SOURCE_INSTANCES = {
  renren: renrenSource,
  hanjutv: hanjutvSource,
  bahamut: bahamutSource,
  dandan: dandanSource,
  custom: customSource,
  tencent: tencentSource,
  youku: youkuSource,
  iqiyi: iqiyiSource,
  imgo: mangoSource,
  mango: mangoSource,
  bilibili: bilibiliSource,
  bilibili1: bilibiliSource,
  migu: miguSource,
  sohu: sohuSource,
  leshi: leshiSource,
  xigua: xiguaSource,
  maiduidui: maiduiduiSource,
  aiyifan: aiyifanSource,
  animeko: animekoSource,
  other: otherSource,
  other_server: otherSource
};

function inferPlatformFromUrl(url, titleHint = '') {
  const u = String(url || '');
  const t = String(titleHint || '');
  if (u.includes('.qq.com')) return 'tencent';
  if (u.includes('.iqiyi.com')) return 'iqiyi';
  if (u.includes('.mgtv.com')) return 'imgo';
  if (u.includes('.bilibili.com') || u.includes('b23.tv')) return 'bilibili';
  if (u.includes('.youku.com')) return 'youku';
  if (u.includes('.miguvideo.com')) return 'migu';
  if (u.includes('.sohu.com')) return 'sohu';
  if (u.includes('.le.com')) return 'leshi';
  if (u.includes('.douyin.com') || u.includes('.ixigua.com')) return 'xigua';
  if (u.includes('.mddcloud.com.cn')) return 'maiduidui';
  if (u.includes('.yfsp.tv')) return 'aiyifan';
  const plat = extractEpisodeTitle(t);
  if (plat && SOURCE_INSTANCES[plat]) return plat;
  if (u.includes(':') && !u.startsWith('http')) {
    return u.split(':')[0];
  }
  return 'unknown';
}

function parseCompositeUrl(url) {
  if (!url || !String(url).includes(MERGE_DELIMITER)) {
    return url ? [{ raw: url }] : [];
  }
  return String(url).split(MERGE_DELIMITER).map(part => {
    const idx = part.indexOf(':');
    if (idx === -1) return { raw: part, source: 'unknown', id: part };
    return {
      raw: part,
      source: part.slice(0, idx),
      id: part.slice(idx + 1)
    };
  });
}

/**
 * 从已有 anime 列表中收集指定集的多平台链接
 */
export function collectEpisodeSourcesFromAnimes(animes = [], episodeNumber = 1, sourceWeights = {}) {
  const order = globals.sourceOrderArr || [];
  const found = [];
  const seen = new Set();

  for (const anime of animes) {
    if (!anime) continue;
    const links = anime.links || [];
    if (!links.length) continue;

    const sourceName = anime.source || 'unknown';
    // episodeNumber 严格 1-based
    // 优先按标题/name 中的集号匹配，避免 links 数组顺序与集号不一致时错位
    let link = links.find((l) => {
      const title = String(l.title || l.name || '');
      const m =
        title.match(/第\s*(\d{1,4})\s*[集话期話]/) ||
        title.match(/(?:^|[^\d])E(?:P)?(\d{1,4})(?:[^\d]|$)/i) ||
        title.match(/(?:^|[^\d])(\d{1,4})(?:[^\d]|$)/);
      return m && Number(m[1]) === Number(episodeNumber);
    });
    // 回退：name 字段为纯数字集号
    if (!link) {
      link = links.find((l) => Number(l.name) === Number(episodeNumber));
    }
    // 最后回退：按 1-based 下标
    if (!link && episodeNumber >= 1 && episodeNumber <= links.length) {
      link = links[episodeNumber - 1];
    }
    if (!link?.url) continue;

    const platform = inferPlatformFromUrl(link.url, link.title || sourceName) || sourceName;
    const parts = parseCompositeUrl(link.url);
    if (parts.length > 1) {
      for (const part of parts) {
        const src = part.source || platform;
        const key = `${src}|${part.id || part.raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          source: src,
          url: part.id || part.raw,
          full_url: part.raw.includes(':') ? part.raw : `${src}:${part.raw}`,
          anime_title: anime.animeTitle || '',
          episode_title: link.title || '',
          weight: resolveSourceWeight(src, order, sourceWeights),
          episode_id: link.id
        });
      }
    } else {
      const key = `${platform}|${link.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        source: platform,
        url: link.url,
        full_url: link.url,
        anime_title: anime.animeTitle || '',
        episode_title: link.title || '',
        weight: resolveSourceWeight(platform, order, sourceWeights),
        episode_id: link.id
      });
    }
  }

  // 高权重优先
  found.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return found;
}

/**
 * 从搜索缓存 / 全局 animes 发现来源
 * options.strict_sources=true 时：仅使用调用方传入的 sources，禁止二次宽松发现（Forward 强制聚合路径）
 */
export function discoverEpisodeSources(identity, options = {}) {
  const sources = [];
  const weights = options.source_weights || {};
  const episode = identity.episode || 1;
  const title = identity.title || '';

  // Forward 专属：只信调用方已版本校验过的 sources 列表
  if (options.strict_sources && Array.isArray(options.sources) && options.sources.length) {
    for (const s of options.sources) {
      const source = s.source || s.platform || 'upload';
      sources.push({
        source,
        url: s.url || s.id || '',
        full_url: s.url || s.id || s.full_url || '',
        data: s.data || s.comments || null,
        content: s.content || null,
        fileName: s.fileName || s.file_name || null,
        anime_title: s.anime_title || title,
        episode_title: s.episode_title || '',
        weight: resolveSourceWeight(source, globals.sourceOrderArr, weights),
        episode_id: s.episode_id,
        region: s.region || identity.region || null,
        year: s.year || identity.year || null,
        original_title: s.original_title || identity.original_title || null,
        season: identity.season,
        episode: identity.episode
      });
    }
    sources.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    log('info', `[EpisodeAggregate] strict_sources n=${sources.length} (no broad discover)`);
    return sources;
  }

  // 1) episode_id → URL
  if (identity.episode_id) {
    const url = findUrlById(Number(identity.episode_id) || identity.episode_id);
    const titleHint = findTitleById(Number(identity.episode_id) || identity.episode_id) || '';
    if (url) {
      const parts = parseCompositeUrl(url);
      if (parts.length > 1) {
        for (const part of parts) {
          sources.push({
            source: part.source || inferPlatformFromUrl(part.raw, titleHint),
            url: part.id || part.raw,
            full_url: part.raw,
            anime_title: findAnimeTitleById(Number(identity.episode_id)) || title,
            episode_title: titleHint,
            weight: resolveSourceWeight(part.source, globals.sourceOrderArr, weights),
            episode_id: identity.episode_id
          });
        }
      } else {
        const platform = inferPlatformFromUrl(url, titleHint);
        sources.push({
          source: platform,
          url,
          full_url: url,
          anime_title: findAnimeTitleById(Number(identity.episode_id)) || title,
          episode_title: titleHint,
          weight: resolveSourceWeight(platform, globals.sourceOrderArr, weights),
          episode_id: identity.episode_id
        });
      }
    }
  }

  // 2) 搜索缓存 + 内存 animes
  const candidates = [];
  if (title) {
    const cached = getSearchCache(title) || getSearchCache(`${title}_S${identity.season || 1}`);
    if (cached?.results) candidates.push(...cached.results);
    if (cached?.details) {
      for (const d of (cached.details instanceof Map ? cached.details.values() : Object.values(cached.details || {}))) {
        if (d) candidates.push(d);
      }
    }
  }

  if (Array.isArray(globals.animes)) {
    const titleKey = identity.title_key || '';
    for (const anime of globals.animes) {
      if (!titleKey) {
        candidates.push(anime);
        continue;
      }
      const at = String(anime.animeTitle || '');
      if (at.includes(identity.title) || (titleKey && at.toLowerCase().replace(/\s/g, '').includes(titleKey))) {
        candidates.push(anime);
      }
    }
  }

  const fromAnimes = collectEpisodeSourcesFromAnimes(candidates, episode, weights);
  for (const item of fromAnimes) {
    const key = `${item.source}|${item.url}`;
    if (!sources.some(s => `${s.source}|${s.url}` === key)) {
      sources.push(item);
    }
  }

  // 请求内直接指定 sources
  if (Array.isArray(options.sources) && options.sources.length) {
    for (const s of options.sources) {
      const source = s.source || s.platform || 'upload';
      sources.push({
        source,
        url: s.url || s.id || '',
        full_url: s.url || s.id || '',
        data: s.data || s.comments || null,
        content: s.content || null,
        fileName: s.fileName || null,
        anime_title: s.anime_title || title,
        episode_title: s.episode_title || '',
        weight: resolveSourceWeight(source, globals.sourceOrderArr, weights),
        episode_id: s.episode_id
      });
    }
  }

  sources.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return sources;
}

async function fetchOneSource(sourceItem, guardConfig = null) {
  const sourceName = sourceItem.source || 'unknown';
  const url = sourceItem.url || sourceItem.full_url;
  const cfg = guardConfig || getGuardConfig();

  // 已有数据（上传/测试）
  if (Array.isArray(sourceItem.data)) {
    return {
      source: sourceName,
      weight: sourceItem.weight || 1,
      items: sourceItem.data,
      count_raw: sourceItem.data.length,
      error: null
    };
  }
  if (sourceItem.content) {
    return {
      source: sourceName,
      weight: sourceItem.weight || 1,
      content: sourceItem.content,
      fileName: sourceItem.fileName || `${sourceName}.txt`,
      count_raw: null,
      error: null
    };
  }

  if (!url) {
    return { source: sourceName, weight: sourceItem.weight || 1, items: [], count_raw: 0, error: 'missing url' };
  }

  // 短缓存命中单源（仅当有数据）
  const cached = getCommentCache(url);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return {
      source: sourceName,
      weight: sourceItem.weight || 1,
      items: cached.map(c => ({ p: c.p, m: c.m, content: c.m, source: sourceName })),
      count_raw: cached.length,
      error: null,
      from_cache: true
    };
  }

  const instance = SOURCE_INSTANCES[sourceName];
  try {
    const work = sourceLogContext.run(toLogSourceName(sourceName), async () => {
      let items = [];
      if (instance && typeof instance.getEpisodeDanmu === 'function') {
        // 非 http id 形式
        let id = url;
        if (url.includes(':') && !url.startsWith('http')) {
          id = url.slice(url.indexOf(':') + 1);
        }
        const raw = await instance.getEpisodeDanmu(id);
        const formatted = instance.formatComments(raw);
        items = Array.isArray(formatted) ? formatted : [];
      } else if (instance && typeof instance.getComments === 'function') {
        items = await instance.getComments(url, sourceName, false);
      } else if (url.startsWith('http')) {
        // 按域名路由
        const plat = inferPlatformFromUrl(url);
        const src = SOURCE_INSTANCES[plat];
        if (src?.getComments) {
          items = await src.getComments(url, plat, false);
        } else {
          items = await otherSource.getComments(url, 'other_server', false);
        }
      }

      // 统一为可解析结构
      const normalized = (items || []).map((item, index) => {
        if (item && typeof item === 'object' && item.p && item.m !== undefined) {
          return {
            p: item.p,
            m: item.m,
            content: item.m,
            source: sourceName,
            id: item.cid || `${sourceName}-${index}`,
            _weight: sourceItem.weight || 1
          };
        }
        return {
          ...item,
          source: sourceName,
          _weight: sourceItem.weight || 1
        };
      });

      return {
        source: sourceName,
        weight: sourceItem.weight || 1,
        items: normalized,
        count_raw: normalized.length,
        error: null
      };
    });

    // 单源超时：只失败该源
    return await withTimeout(work, cfg.fetchTimeoutMs, `fetch:${sourceName}`);
  } catch (error) {
    log('warn', `[EpisodeAggregate] source failed source=${sourceName} err=${error.message}`);
    return {
      source: sourceName,
      weight: sourceItem.weight || 1,
      items: [],
      count_raw: 0,
      error: error.message || String(error),
      status: 'failed'
    };
  }
}

/**
 * 按权重排序后送入清洗：同时间重复时高权重更易保留（先出现）
 */
function buildMergeSources(fetchResults) {
  const sources = [];
  for (const fr of fetchResults) {
    if (fr.content) {
      sources.push({
        source: fr.source,
        fileName: fr.fileName,
        content: fr.content,
        weight: fr.weight
      });
      continue;
    }
    if (!fr.items?.length) continue;
    // 按权重降序：清洗流水线按输入顺序保留第一条 exact
    const items = [...fr.items].sort((a, b) => (b._weight || fr.weight || 0) - (a._weight || fr.weight || 0));
    sources.push({
      source: fr.source,
      data: items,
      weight: fr.weight
    });
  }
  // 整体按权重排序源
  sources.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return sources;
}

/**
 * 主入口：剧集聚合
 *
 * 架构：
 *   发现源 → 隔离抓取(超时/异常不扩散) → 数据保护层(时间桶采样)
 *   → 质量排序 → 分源清洗合并 → 最终上限 → 缓存保护
 */
export async function aggregateEpisode(query = {}) {
  const identity = buildEpisodeIdentity(query);
  const force = query.force === true || query.refresh === true;
  const guardConfig = getGuardConfig();

  if (!force) {
    const cached = await loadEpisodeCache(identity.key);
    if (cached?.comments?.length) {
      log('info', `[EpisodeAggregate] cache hit ${identity.key} (${cached.comments.length})`);
      return {
        success: true,
        cached: true,
        key: identity.key,
        identity: cached.identity || identity,
        sources: cached.sources || [],
        stats: cached.stats || {},
        comments: cached.comments,
        count: cached.comments.length
      };
    }
  }

  const discovered = discoverEpisodeSources(identity, {
    source_weights: query.source_weights,
    sources: query.sources,
    strict_sources: query.strict_sources === true
  });

  if (!discovered.length) {
    // 不缓存空结果
    return {
      success: false,
      cached: false,
      key: identity.key,
      identity,
      sources: [],
      stats: { total_before: 0, total_after: 0, removed: 0, removed_by_reason: {} },
      comments: [],
      count: 0,
      errorMessage: '未发现可用弹幕来源。请先搜索该剧或传入 sources / episode_id'
    };
  }

  log('info', `[EpisodeAggregate] ${identity.key} discovering ${discovered.length} sources: ${discovered.map(s => `${s.source}:${s.anime_title || ''}`).join(' | ')}`);
  for (const s of discovered) {
    log('info', `[EpisodeAggregate][source] platform=${s.source} title=${s.anime_title || '-'} ep=${s.episode_title || '-'} url=${String(s.url || '').slice(0, 80)}`);
  }

  // 并行抓取；单源失败只记 status=failed
  const fetchResults = await Promise.all(
    discovered.map((s) => fetchOneSource(s, guardConfig).then((fr) => ({
      ...fr,
      anime_title: s.anime_title,
      episode_title: s.episode_title,
      fileName: s.fileName,
      region: s.region,
      year: s.year,
      original_title: s.original_title,
      season: s.season ?? identity.season,
      episode: s.episode ?? identity.episode,
      url: s.url
    })))
  );

  for (const fr of fetchResults) {
    log(
      'info',
      `[EpisodeAggregate][count] source=${fr.source} raw=${fr.count_raw || 0} err=${fr.error || '-'} title=${fr.anime_title || '-'}`
    );
  }

  // —— 数据保护层：时间桶采样 + 总量控制 + 质量评分 ——
  const protectedBundle = protectMultiSource(fetchResults, guardConfig);
  const protectedSources = protectedBundle.sources;

  const mergeSources = buildMergeSources(protectedSources);

  if (!mergeSources.length) {
    logEpisodeDiagnostics(identity, protectedSources, { total_before: 0, total_after: 0, removed: 0 });
    return {
      success: false,
      cached: false,
      key: identity.key,
      identity,
      sources: protectedSources.map(fr => summarizeSourceMeta(fr, identity)),
      stats: {
        total_before: 0,
        total_after: 0,
        removed: 0,
        guard: {
          total_before_protect: protectedBundle.total_before_protect,
          total_after_protect: 0,
          memory: protectedBundle.memory
        }
      },
      comments: [],
      count: 0,
      errorMessage: '所有来源抓取失败或为空'
    };
  }

  let merged;
  try {
    merged = processDanmakuMerge({
      episode: identity.episode,
      sources: mergeSources,
      output_format: 'dandan',
      max_input_items: guardConfig.totalMax,
      rules: {
        ...(query.rules || {}),
        performance: {
          max_input_items: guardConfig.totalMax,
          ...(query.rules?.performance || {})
        },
        timeline: {
          enabled: query.timeline !== false,
          ...(query.rules?.timeline || {})
        },
        pipeline: { enabled: true }
      }
    });
  } catch (error) {
    // 聚合异常：尽量从各源已保护数据中拼接保底结果，避免整片 0
    log('error', `[EpisodeAggregate] merge failed, fallback per-source: ${error.message}`);
    const fallbackItems = [];
    for (const fr of protectedSources) {
      if (!fr.items?.length) continue;
      const take = Math.min(fr.items.length, 3000);
      for (let i = 0; i < take; i++) {
        const it = fr.items[i];
        fallbackItems.push(
          it?.p && it?.m !== undefined
            ? { p: it.p, m: it.m, cid: i + 1 }
            : toDandanComment({ ...it, source: fr.source })
        );
      }
    }
    merged = {
      total_before: protectedBundle.total_after_protect,
      total_after: fallbackItems.length,
      removed: 0,
      result: fallbackItems,
      stats: {
        removed_by_reason: { merge_fallback: 1 },
        processing_ms: 0,
        memory_after: getMemorySnapshot()
      }
    };
  }

  // 输出 dandan 格式 comments
  let comments = Array.isArray(merged.result) ? merged.result : [];
  comments = comments.map((item, index) => {
    if (item.p && item.m !== undefined) {
      return { p: item.p, m: item.m, cid: item.cid || index + 1, t: item.t, quality_score: item.quality_score };
    }
    return toDandanComment(item);
  });

  // DANMU_LIMIT（k）+ 架构 finalMax 双保险
  if (globals.danmuLimit > 0) {
    const limited = limitDanmusByCount(comments, globals.danmuLimit);
    if (limited.length !== comments.length) {
      log('info', `[EpisodeAggregate] DANMU_LIMIT applied ${comments.length} -> ${limited.length}`);
      comments = limited;
    }
  }
  const capped = capFinalComments(comments, guardConfig.finalMax);
  if (capped.after !== capped.before) {
    log('info', `[EpisodeAggregate] final cap ${capped.before} -> ${capped.after}`);
    comments = capped.comments;
  }

  // used 回写到各源诊断
  const afterBySource = merged.stats?.source_counts_after || {};
  const sourceMeta = protectedSources.map((fr) => {
    const meta = summarizeSourceMeta(fr, identity);
    meta.count_used = afterBySource[fr.source] ?? fr.count_used ?? fr.count_sampled ?? 0;
    return meta;
  });

  const stats = {
    total_before: merged.total_before,
    total_after: comments.length,
    removed: Math.max(0, (merged.total_before || 0) - comments.length),
    removed_by_reason: merged.stats?.removed_by_reason || {},
    processing_ms: merged.stats?.processing_ms,
    source_counts_before: merged.stats?.source_counts_before,
    source_counts_after: afterBySource,
    timeline_offsets: merged.stats?.timeline_offsets,
    guard: {
      total_before_protect: protectedBundle.total_before_protect,
      total_after_protect: protectedBundle.total_after_protect,
      per_source_max: guardConfig.perSourceMax,
      total_max: guardConfig.totalMax,
      final_max: guardConfig.finalMax,
      memory: getMemorySnapshot()
    }
  };

  logEpisodeDiagnostics(identity, sourceMeta, stats);

  const entry = {
    key: identity.key,
    identity: {
      ...identity,
      display: formatVersionDisplay({
        title: identity.title,
        region: identity.region,
        region_label: identity.region_label,
        year: identity.year,
        season: identity.season,
        episode: identity.episode,
        withEpisode: true
      })
    },
    display: formatVersionDisplay({
      title: identity.title,
      region: identity.region,
      region_label: identity.region_label,
      year: identity.year,
      season: identity.season,
      episode: identity.episode,
      withEpisode: true
    }),
    sources: sourceMeta,
    sources_detail: sourceMeta,
    stats,
    comments
  };

  // 仅非空结果可缓存
  if (comments.length > 0) {
    await saveEpisodeCache(entry);
    for (const s of discovered) {
      if (s.url) {
        try { setCommentCache(s.url, comments); } catch { /* ignore */ }
      }
      if (s.full_url && s.full_url !== s.url) {
        try { setCommentCache(s.full_url, comments); } catch { /* ignore */ }
      }
    }
  } else {
    log('info', `[EpisodeCache] skip empty result for ${identity.key}`);
  }

  // 释放受保护源的大数组引用
  for (const fr of protectedSources) {
    if (fr.items) fr.items = null;
  }

  log('info', `[EpisodeAggregate] ${identity.key} done ${stats.total_before} -> ${stats.total_after}`);

  return {
    success: comments.length > 0,
    cached: false,
    key: identity.key,
    identity,
    sources: sourceMeta,
    stats,
    comments,
    count: comments.length
  };
}

function summarizeSourceMeta(fr, identity) {
  const file_name = fr.fileName || buildSourceFileLabel({
    source: fr.source,
    original_title: fr.original_title || identity.original_title,
    title: fr.anime_title || identity.title,
    region: fr.region || identity.region,
    year: fr.year || identity.year,
    season: fr.season ?? identity.season,
    episode: fr.episode ?? identity.episode,
    url: fr.url
  });
  return {
    source: fr.source,
    count_raw: fr.count_raw || 0,
    count_sampled: fr.count_sampled ?? null,
    count_used: fr.count_used ?? fr.count_sampled ?? null,
    quality_score: fr.quality_score ?? null,
    sample_method: fr.sample_method || null,
    status: fr.status || (fr.error ? 'failed' : 'ok'),
    weight: fr.weight,
    error: fr.error || fr.fail_reason || null,
    from_cache: Boolean(fr.from_cache),
    matched_title: fr.anime_title || null,
    episode_title: fr.episode_title || null,
    original_title: fr.original_title || identity.original_title || null,
    region: fr.region || identity.region || null,
    region_label: identity.region_label || null,
    year: fr.year || identity.year || null,
    season: fr.season ?? identity.season,
    episode: fr.episode ?? identity.episode,
    file_name,
    raw_file: file_name,
    url: fr.url || null
  };
}

export async function listAggregatedEpisodes() {
  return listEpisodeCaches();
}

export async function getAggregatedEpisodeDetail(key) {
  return getEpisodeCacheDetail(key);
}

export async function clearAggregatedEpisode(key) {
  return deleteEpisodeCache(key || null);
}

export async function reaggregateEpisode(query = {}) {
  return aggregateEpisode({ ...query, force: true });
}

/**
 * 将智能聚合清洗接入播放器实时弹幕链路
 * 输入/输出均为弹弹 play 兼容的 { p, m, cid?, like? }
 */
import { parseDanmakuSources, toDandanComment } from './parser.js';
import { processDanmakuItems } from './processor.js';
import { getActiveFilterRules } from './rules.js';
import { recordProcessingStatistics } from './statistics.js';
import { log } from '../utils/log-util.js';

function dandanToSourceItems(comments = [], platform = 'live') {
  return comments.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    return {
      p: item.p,
      m: item.m,
      content: item.m,
      cid: item.cid ?? index + 1,
      id: item.cid ?? item.id ?? `${platform}-${index + 1}`,
      like: item.like,
      source: platform,
      _sourceLabel: platform
    };
  }).filter(Boolean);
}

/**
 * 对实时弹幕列表应用聚合清洗规则
 * @param {Array} comments - [{p,m,cid?,like?}]
 * @param {string} platform - 来源标记
 * @param {object} options
 * @returns {Array}
 */
export function applyLiveDanmakuAggregation(comments, platform = 'unknown', options = {}) {
  if (!Array.isArray(comments) || comments.length === 0) return comments || [];

  const rules = getActiveFilterRules(options.rules || {});
  if (rules.pipeline?.enabled === false) {
    return comments;
  }

  try {
    const sourceItems = dandanToSourceItems(comments, platform);
    const parsed = parseDanmakuSources([{
      source: platform,
      data: sourceItems
    }]);

    // 实时链路默认关闭跨源时间轴对齐（通常单集已是同源或已对齐）
    const liveRules = {
      ...rules,
      timeline: {
        ...(rules.timeline || {}),
        enabled: rules.pipeline?.timeline !== true ? false : (rules.timeline?.enabled !== false)
      }
    };

    const processed = processDanmakuItems(parsed.items, liveRules);
    const result = processed.items.map((item, index) => {
      const dandan = toDandanComment(item);
      const original = comments[index];
      // 尽量保留 like；cid 使用处理结果 id 的数字部分或顺序
      const cidNum = Number(item.id);
      return {
        p: dandan.p,
        m: dandan.m,
        cid: Number.isFinite(cidNum) ? cidNum : (index + 1),
        like: item.like ?? original?.like,
        t: dandan.t,
        quality_score: item.quality_score,
        status: item.status || 'active'
      };
    });

    if (rules.statistics?.enabled !== false && options.recordStats !== false) {
      recordProcessingStatistics({
        total_before: comments.length,
        total_after: result.length,
        removed: comments.length - result.length,
        stats: {
          removed_by_reason: processed.stats.removed_by_reason,
          source_counts_before: parsed.sourceStats,
          source_counts_after: processed.stats.source_counts_after,
          timeline_offsets: processed.stats.timeline_offsets || {},
          processing_ms: 0
        }
      }, { operation: 'live_pipeline' });
    }

    if (comments.length !== result.length) {
      log('info', `[DanmakuAggregation] live pipeline: ${comments.length} -> ${result.length} (${platform})`);
    }

    return result;
  } catch (error) {
    log('warn', `[DanmakuAggregation] live pipeline failed, fallback to original: ${error.message}`);
    return comments;
  }
}

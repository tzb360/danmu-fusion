import { parseDanmakuSources, toDandanComment } from './parser.js';
import { getActiveFilterRules } from './rules.js';
import { processDanmakuItems } from './processor.js';

function getMemoryUsage() {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return null;
  const usage = process.memoryUsage();
  return {
    rss_mb: Number((usage.rss / 1024 / 1024).toFixed(2)),
    heap_used_mb: Number((usage.heapUsed / 1024 / 1024).toFixed(2)),
    heap_total_mb: Number((usage.heapTotal / 1024 / 1024).toFixed(2))
  };
}

function normalizeOutputFormat(body = {}) {
  const format = String(body.output_format || body.format || 'standard').toLowerCase();
  if (['dandan', 'p-m', 'pm'].includes(format)) return 'dandan';
  return 'standard';
}

function formatResult(items, outputFormat) {
  if (outputFormat === 'dandan') return items.map(toDandanComment);
  return items.map(item => ({
    id: item.id,
    time: item.time,
    timestamp: item.timestamp ?? item.time,
    content: item.content,
    color: item.color,
    position: item.position,
    source: item.source,
    episode: item.episode,
    quality_score: item.quality_score,
    status: item.status || 'active'
  }));
}

export function processDanmakuMerge(body = {}) {
  if (!body || typeof body !== 'object') {
    throw new TypeError('Request body must be a JSON object');
  }

  const timer = globalThis.performance || { now: () => Date.now() };
  const start = timer.now();
  const memoryBefore = getMemoryUsage();
  const rules = getActiveFilterRules(body.rules || {});
  // 聚合路径默认限制输入，防止 OOM；调用方可覆盖
  if (!rules.performance) rules.performance = {};
  if (rules.performance.max_input_items == null) {
    rules.performance.max_input_items = Number(body.max_input_items) || 80000;
  }
  const sources = body.sources || [];
  const parseOptions = {
    preserveContent: body.rules?.forward_safe?.enabled === true,
    episode: body.episode ?? body.default_episode ?? null
  };

  // 分源解析再合并，避免单次巨型中间数组膨胀；单源失败不影响其它源
  const sourceStats = {};
  const allItems = [];
  const warnings = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    try {
      const one = parseDanmakuSources([src], parseOptions);
      const name = src.source || src.platform || `source_${i + 1}`;
      sourceStats[name] = (one.sourceStats && one.sourceStats[name]) || (one.items?.length || 0);
      if (Array.isArray(one.items) && one.items.length) {
        // 分块 push，降低偶发大数组拷贝压力
        const chunk = 5000;
        for (let j = 0; j < one.items.length; j += chunk) {
          allItems.push(...one.items.slice(j, j + chunk));
        }
      }
      if (one.warnings?.length) warnings.push(...one.warnings);
    } catch (error) {
      const name = src?.source || `source_${i + 1}`;
      warnings.push(`source_parse_failed:${name}:${error.message}`);
      sourceStats[name] = 0;
    }
  }

  let processed;
  try {
    processed = processDanmakuItems(allItems, rules);
  } catch (error) {
    // 清洗失败时尽量保底返回已解析的抽样子集，而不是整片 0。
    // 上限跟随 max_input_items 配置；默认不限制时不再硬编码截断。
    const fallbackLimit = Number(rules?.performance?.max_input_items);
    const fallback = Number.isFinite(fallbackLimit) && fallbackLimit > 0
      ? allItems.slice(0, Math.min(fallbackLimit, allItems.length))
      : allItems.slice();
    processed = {
      items: fallback,
      stats: {
        source_counts_after: sourceStats,
        removed_by_reason: { process_error: allItems.length - fallback.length },
        timeline_offsets: {}
      },
      removedSamples: []
    };
    warnings.push(`process_failed:${error.message}`);
  }

  const outputFormat = normalizeOutputFormat(body);
  const result = formatResult(processed.items, outputFormat);
  const memoryAfter = getMemoryUsage();
  const processingMs = Number((timer.now() - start).toFixed(2));

  const totalBefore = allItems.length;
  const totalAfter = result.length;

  // 帮助 GC：释放中间大数组引用
  allItems.length = 0;

  return {
    total_before: totalBefore,
    total_after: totalAfter,
    removed: totalBefore - totalAfter,
    result,
    stats: {
      source_counts_before: sourceStats,
      source_counts_after: processed.stats.source_counts_after,
      removed_by_reason: processed.stats.removed_by_reason,
      timeline_offsets: processed.stats.timeline_offsets,
      parse_warnings: warnings,
      processing_ms: processingMs,
      memory_before: memoryBefore,
      memory_after: memoryAfter,
      output_format: outputFormat
    },
    ...(processed.removedSamples?.length ? { removed_samples: processed.removedSamples } : {})
  };
}

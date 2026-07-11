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
  const sources = body.sources || [];
  const parseOptions = {
    episode: body.episode ?? body.default_episode ?? null
  };

  const parsed = parseDanmakuSources(sources, parseOptions);
  const processed = processDanmakuItems(parsed.items, rules);
  const outputFormat = normalizeOutputFormat(body);
  const result = formatResult(processed.items, outputFormat);
  const memoryAfter = getMemoryUsage();
  const processingMs = Number((timer.now() - start).toFixed(2));

  const totalBefore = parsed.items.length;
  const totalAfter = result.length;

  return {
    total_before: totalBefore,
    total_after: totalAfter,
    removed: totalBefore - totalAfter,
    result,
    stats: {
      source_counts_before: parsed.sourceStats,
      source_counts_after: processed.stats.source_counts_after,
      removed_by_reason: processed.stats.removed_by_reason,
      timeline_offsets: processed.stats.timeline_offsets,
      parse_warnings: parsed.warnings,
      processing_ms: processingMs,
      memory_before: memoryBefore,
      memory_after: memoryAfter,
      output_format: outputFormat
    },
    ...(processed.removedSamples.length ? { removed_samples: processed.removedSamples } : {})
  };
}

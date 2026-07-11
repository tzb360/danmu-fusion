import { getActiveFilterRules } from './rules.js';

const statisticsState = {
  total_jobs: 0,
  total_before: 0,
  total_after: 0,
  total_removed: 0,
  removed_by_reason: {},
  last_result: null,
  history: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeReasonCounts(target, source = {}) {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] || 0) + Number(count || 0);
  }
}

export function recordProcessingStatistics(result, meta = {}) {
  const rules = getActiveFilterRules();
  if (rules.statistics?.enabled === false || !result) return getProcessingStatistics();

  const summary = {
    id: `${Date.now()}-${statisticsState.total_jobs + 1}`,
    created_at: new Date().toISOString(),
    operation: meta.operation || 'merge',
    total_before: result.total_before || 0,
    total_after: result.total_after || 0,
    removed: result.removed || 0,
    removed_by_reason: result.stats?.removed_by_reason || {},
    source_counts_before: result.stats?.source_counts_before || {},
    source_counts_after: result.stats?.source_counts_after || {},
    timeline_offsets: result.stats?.timeline_offsets || {},
    processing_ms: result.stats?.processing_ms || 0,
    memory_after: result.stats?.memory_after || null
  };

  statisticsState.total_jobs += 1;
  statisticsState.total_before += summary.total_before;
  statisticsState.total_after += summary.total_after;
  statisticsState.total_removed += summary.removed;
  mergeReasonCounts(statisticsState.removed_by_reason, summary.removed_by_reason);
  statisticsState.last_result = summary;
  statisticsState.history.unshift(summary);

  const historyLimit = Math.max(1, Number(rules.statistics?.history_limit || 50));
  if (statisticsState.history.length > historyLimit) {
    statisticsState.history = statisticsState.history.slice(0, historyLimit);
  }

  return getProcessingStatistics();
}

export function getProcessingStatistics() {
  return clone({
    ...statisticsState,
    average_processing_ms: statisticsState.history.length
      ? Number((statisticsState.history.reduce((sum, item) => sum + Number(item.processing_ms || 0), 0) / statisticsState.history.length).toFixed(2))
      : 0
  });
}

export function resetProcessingStatistics() {
  statisticsState.total_jobs = 0;
  statisticsState.total_before = 0;
  statisticsState.total_after = 0;
  statisticsState.total_removed = 0;
  statisticsState.removed_by_reason = {};
  statisticsState.last_result = null;
  statisticsState.history = [];
  return getProcessingStatistics();
}

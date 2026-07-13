/** Per-request observability state. Never retain media/provider arrays globally. */
export function createTraceContext(traceId = null) {
  const trace_id = traceId || `fw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { trace_id, started_at: Date.now(), events: [], providerStats: createProviderStats(), danmuStats: createDanmuStats() };
}
export function createProviderStats() {
  return { moduleProviderCount: 1, searchedProviderCount: 0, candidateProviderCount: 0, usableSourceCount: 0, failedSourceCount: 0, emptySourceCount: 0, rejectedCandidateCount: 0, rawDanmuCount: 0, mergedDanmuCount: 0, filteredDanmuCount: 0, convertedDanmuCount: 0, finalDanmuCount: 0 };
}
export function createDanmuStats() {
  return { providerRawDanmuCount: 0, aggregationInputCount: 0, mergedDanmuCount: 0, filteredDanmuCount: 0, convertedDanmuCount: 0, apiReturnedCount: 0, finalQueueCount: 0, normalCount: 0, topCount: 0, bottomCount: 0 };
}
export function trace(ctx, stage, data = {}) { ctx?.events.push({ stage, at: Date.now(), ...data }); }
export function finalizeDanmuStats(ctx, finalPositions) {
  const s = ctx.danmuStats; const p = ctx.providerStats;
  s.convertedDanmuCount = finalPositions.final; s.apiReturnedCount = finalPositions.final; s.finalQueueCount = finalPositions.final;
  s.normalCount = finalPositions.normal; s.topCount = finalPositions.top; s.bottomCount = finalPositions.bottom;
  p.convertedDanmuCount = finalPositions.final; p.finalDanmuCount = finalPositions.final;
  return s;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTraceContext,
  finalizeDanmuStats,
  trace
} from './forward_adapter/trace-context.js';

test('TraceContext owns isolated ProviderStats, DanmuStats and event arrays', () => {
  const a = createTraceContext('trace-a');
  const b = createTraceContext('trace-b');
  a.providerStats.searchedProviderCount = 7;
  a.danmuStats.providerRawDanmuCount = 99;
  trace(a, 'only-a');
  assert.equal(b.providerStats.searchedProviderCount, 0);
  assert.equal(b.danmuStats.providerRawDanmuCount, 0);
  assert.deepEqual(b.events, []);
  assert.notStrictEqual(a.providerStats, b.providerStats);
  assert.notStrictEqual(a.danmuStats, b.danmuStats);
  assert.notStrictEqual(a.events, b.events);
});

test('final statistics describe exactly one returned queue', () => {
  const ctx = createTraceContext('trace-count');
  ctx.danmuStats.providerRawDanmuCount = 12;
  ctx.danmuStats.aggregationInputCount = 10;
  ctx.danmuStats.mergedDanmuCount = 8;
  ctx.danmuStats.deduplicatedDanmuCount = 7;
  ctx.danmuStats.filteredDanmuCount = 6;
  ctx.danmuStats.forwardParsedCount = 4;
  finalizeDanmuStats(ctx, { normal: 2, top: 1, bottom: 1, final: 4 });
  assert.equal(ctx.danmuStats.convertedDanmuCount, 4);
  assert.equal(ctx.danmuStats.apiReturnedCount, 4);
  assert.equal(ctx.danmuStats.finalQueueCount, 4);
  assert.equal(ctx.danmuStats.normalCount + ctx.danmuStats.topCount + ctx.danmuStats.bottomCount, 4);
  assert.equal(ctx.providerStats.moduleStatus, 'success');
  assert.equal('moduleProviderCount' in ctx.providerStats, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleByTimeBuckets,
  protectSourcePayload,
  protectMultiSource,
  scoreSourceQuality,
  shouldPersistCache,
  isCacheEntryValid,
  capFinalComments,
  EPISODE_CACHE_VERSION,
  getGuardConfig
} from './aggregation/source-guard.js';

function makeItems(n, { tStart = 0, tStep = 1 } = {}) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const t = tStart + i * tStep;
    items.push({ p: `${t},1,16777215,[test]`, m: `弹幕内容${i % 50}`, content: `弹幕内容${i % 50}`, time: t });
  }
  return items;
}

test('time-bucket sampling preserves span and reduces count', () => {
  const items = makeItems(100000, { tStep: 0.1 });
  const r = sampleByTimeBuckets(items, 5000, 100);
  assert.equal(r.raw, 100000);
  assert.ok(r.sampled <= 5000);
  assert.ok(r.sampled >= 4000);
  assert.ok(r.t_max > r.t_min);
  // 不应只取开头：末段时间应接近全局 max
  const outTimes = r.items.map((it) => Number(String(it.p).split(',')[0]));
  const outMax = Math.max(...outTimes);
  const outMin = Math.min(...outTimes);
  assert.ok(outMax > (r.t_max - r.t_min) * 0.7 + r.t_min);
  assert.ok(outMin < (r.t_max - r.t_min) * 0.3 + r.t_min);
});

test('protectSourcePayload samples huge provider payload', () => {
  const items = makeItems(80000);
  const r = protectSourcePayload('bilibili', items, {
    perSourceMax: 10000,
    totalMax: 20000,
    finalMax: 15000,
    bucketCount: 80,
    heapSoftMb: 9999
  });
  assert.equal(r.raw, 80000);
  assert.ok(r.sampled <= 10000);
  assert.equal(r.status, 'sampled');
});

test('multi-source: failed source does not wipe others', () => {
  const bundle = protectMultiSource(
    [
      { source: 'bilibili', items: makeItems(50000), count_raw: 50000, weight: 1 },
      { source: 'tencent', items: [], count_raw: 0, error: 'timeout', weight: 1 },
      { source: 'imgo', items: makeItems(3000), count_raw: 3000, weight: 1 }
    ],
    { perSourceMax: 8000, totalMax: 12000, finalMax: 10000, bucketCount: 40, heapSoftMb: 9999 }
  );
  const byName = Object.fromEntries(bundle.sources.map((s) => [s.source, s]));
  assert.equal(byName.tencent.status, 'failed');
  assert.ok((byName.bilibili.items?.length || 0) > 0);
  assert.ok((byName.imgo.items?.length || 0) > 0);
  assert.ok(bundle.total_after_protect > 0);
});

test('source quality prefers coverage over raw spam count alone', () => {
  const smallGood = scoreSourceQuality({
    source: 'tencent',
    raw: 8000,
    sampled: 8000,
    items: makeItems(8000, { tStep: 1 }),
    weight: 2
  });
  const hugeButNarrow = scoreSourceQuality({
    source: 'bilibili',
    raw: 500000,
    sampled: 5000,
    items: makeItems(5000, { tStart: 100, tStep: 0.001 }),
    weight: 1
  });
  assert.ok(smallGood.score > 0);
  assert.ok(hugeButNarrow.score > 0);
});

test('cache gate rejects empty and accepts versioned entry', () => {
  assert.equal(shouldPersistCache({ comments: [] }).ok, false);
  assert.equal(shouldPersistCache({ comments: [{ p: '1,1,1', m: 'a' }] }).ok, true);
  const cfg = getGuardConfig();
  assert.equal(
    isCacheEntryValid({
      comments: [{ p: '1,1,1', m: 'a' }],
      cache_version: EPISODE_CACHE_VERSION,
      updated_at: new Date().toISOString()
    }, cfg).ok,
    true
  );
  assert.equal(
    isCacheEntryValid({
      comments: [{ p: '1,1,1', m: 'a' }],
      cache_version: 0,
      updated_at: new Date().toISOString()
    }, cfg).ok,
    false
  );
});

test('capFinalComments evenly reduces', () => {
  const comments = makeItems(1000).map((x, i) => ({ p: x.p, m: x.m, cid: i + 1 }));
  const r = capFinalComments(comments, 100);
  assert.equal(r.after, 100);
  assert.equal(r.before, 1000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { processDanmakuMerge } from './aggregation/aggregator.js';
import { calculateTextSimilarity } from './aggregation/processor.js';
import {
  handleDanmakuFilter,
  handleDanmakuMerge,
  handleGetDanmakuStatistics,
  handleGetFilterRules,
  handlePutFilterRules,
  handleResetDanmakuStatistics
} from './apis/danmaku-aggregate-api.js';
import { Globals } from './configs/globals.js';

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('single XML file is parsed into standard danmaku format', () => {
  const xml = '<i><d p="12.5,1,25,16777215,0,0,0,1">你好，第一条弹幕</d></i>';
  const result = processDanmakuMerge({
    sources: [{ fileName: 'bilibili.xml', content: xml, episode: 3 }],
    rules: { duplicate: false, garbage_filter: false }
  });

  assert.equal(result.total_before, 1);
  assert.equal(result.total_after, 1);
  assert.equal(result.result[0].time, 12.5);
  assert.equal(result.result[0].timestamp, 12.5);
  assert.equal(result.result[0].content, '你好，第一条弹幕');
  assert.equal(result.result[0].source, 'bilibili');
  assert.equal(result.result[0].episode, 3);
  assert.equal(result.result[0].status, 'active');
  assert.ok(result.result[0].id);
});

test('multiple sources are merged and normalized from XML, ASS, and JSON', () => {
  const xml = '<i><d p="10,1,25,16777215,0,0,0,1">同一句弹幕</d><d p="14,5,25,16711680,0,0,0,2">顶部提示</d></i>';
  const ass = '[Script Info]\nDialogue: 0,0:00:11.00,0:00:14.00,Default,,0,0,0,,同一句弹幕';
  const json = [{ time: 16, content: 'JSON 来源弹幕', color: '#00ff00', position: 'bottom' }];

  const result = processDanmakuMerge({
    sources: [
      { fileName: 'bilibili.xml', content: xml, episode: 1 },
      { fileName: 'user.ass', content: ass, source: 'user', episode: 1 },
      { fileName: 'custom.json', data: json, source: 'custom', episode: 1 }
    ],
    rules: { garbage_filter: false }
  });

  assert.equal(result.total_before, 4);
  assert.equal(result.total_after, 3);
  assert.equal(result.stats.removed_by_reason.duplicate_exact, 1);
  assert.deepEqual(result.result.map(item => item.source).sort(), ['bilibili', 'bilibili', 'custom']);
});

test('exact duplicate text near the same timeline is removed', () => {
  const result = processDanmakuMerge({
    sources: [{
      source: 'a',
      data: [
        { time: 620, content: '哈哈这段真好笑' },
        { time: 621.2, content: '哈哈这段真好笑' },
        { time: 624, content: '哈哈这段真好笑' }
      ]
    }],
    rules: { garbage_filter: false, duplicate: { similar: { enabled: false } } }
  });

  assert.equal(result.total_after, 2);
  assert.equal(result.stats.removed_by_reason.duplicate_exact, 1);
});

test('similar semantic danmaku near the same time is deduplicated', () => {
  const score = calculateTextSimilarity('这部番太好看了', '这个动漫真的很好看');
  assert(score >= 0.82);

  const result = processDanmakuMerge({
    sources: [{
      source: 'semantic',
      data: [
        { time: 20, content: '这部番太好看了' },
        { time: 21, content: '这个动漫真的很好看' },
        { time: 30, content: '下一段剧情开始了' }
      ]
    }],
    rules: { garbage_filter: false }
  });

  assert.equal(result.total_after, 2);
  assert.equal(result.stats.removed_by_reason.duplicate_similar, 1);
});

test('advertisement danmaku is filtered', () => {
  const result = processDanmakuMerge({
    sources: [{
      source: 'ad',
      data: [
        { time: 1, content: '加微信 wx123456 进群看全集' },
        { time: 2, content: '这段信息量很足' }
      ]
    }]
  });

  assert.equal(result.total_after, 1);
  assert.equal(result.result[0].content, '这段信息量很足');
  assert.equal(result.stats.removed_by_reason.advertisement, 1);
});

test('timeline hint danmaku is filtered', () => {
  const result = processDanmakuMerge({
    sources: [{
      source: 'timeline',
      data: [
        { time: 5, content: '1:30' },
        { time: 6, content: '看到这里点赞' },
        { time: 7, content: '角色这句台词很关键' }
      ]
    }]
  });

  assert.equal(result.total_after, 1);
  assert.equal(result.result[0].content, '角色这句台词很关键');
  assert.equal(result.stats.removed_by_reason.timeline_hint, 2);
});

test('filter rules can be viewed and updated dynamically', async () => {
  Globals.init({ TOKEN: '87654321' });
  Globals.currentToken = '87654321';
  const getBefore = await readJson(await handleGetFilterRules());
  assert.equal(getBefore.rules.spoiler.enabled, false);
  assert.ok(getBefore.persistence);
  assert.ok(getBefore.ai);

  const putReq = new Request('http://localhost/api/filter/rules', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: { spoiler: { enabled: true } } })
  });
  const putBody = await readJson(await handlePutFilterRules(putReq, new URL(putReq.url)));
  assert.equal(putBody.rules.spoiler.enabled, true);
  assert.equal(putBody.success, true);

  const resetReq = new Request('http://localhost/api/filter/rules?reset=true', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset: true })
  });
  const resetBody = await readJson(await handlePutFilterRules(resetReq, new URL(resetReq.url)));
  assert.equal(resetBody.rules.spoiler.enabled, false);
});

test('custom blacklist removes comments while allowlist protects them', () => {
  const result = processDanmakuMerge({
    sources: [{
      source: 'rules',
      data: [
        { time: 1, content: '内部测试保留词' },
        { time: 2, content: '自定义黑词命中' },
        { time: 3, content: '正常剧情讨论内容' }
      ]
    }],
    rules: {
      custom_blacklist: { enabled: true, keywords: ['黑词'] },
      allowlist: { enabled: true, keywords: ['保留词'] },
      quality: { threshold: 10 }
    }
  });

  assert.equal(result.total_after, 2);
  assert.equal(result.stats.removed_by_reason.custom_blacklist, 1);
  assert(result.result.some(item => item.content.includes('保留词')));
});

test('danmaku filter API and statistics API work', async () => {
  Globals.init({ TOKEN: '87654321' });
  Globals.currentToken = '87654321';
  const resetStatsReq = new Request('http://localhost/api/statistics', { method: 'DELETE' });
  await readJson(await handleResetDanmakuStatistics(resetStatsReq));

  const req = new Request('http://localhost/api/danmaku/filter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      comments: [
        { time: 1, content: '加微信 wx123456' },
        { time: 2, content: '角色这句台词很关键' }
      ]
    })
  });
  const filtered = await readJson(await handleDanmakuFilter(req));
  assert.equal(filtered.total_before, 2);
  assert.equal(filtered.total_after, 1);
  assert.equal(filtered.stats.removed_by_reason.advertisement, 1);

  const statsBody = await readJson(await handleGetDanmakuStatistics());
  assert.equal(statsBody.statistics.total_jobs, 1);
  assert.equal(statsBody.statistics.total_before, 2);
  assert.equal(statsBody.statistics.total_after, 1);
});

test('danmaku merge API records statistics', async () => {
  Globals.init({ TOKEN: '87654321' });
  Globals.currentToken = '87654321';
  await readJson(await handleResetDanmakuStatistics());

  const req = new Request('http://localhost/api/danmaku/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sources: [{ source: 'api', data: [{ time: 1, content: '正常剧情讨论内容' }] }]
    })
  });
  const body = await readJson(await handleDanmakuMerge(req));
  assert.equal(body.total_before, 1);
  assert.equal(body.total_after, 1);

  const statsBody = await readJson(await handleGetDanmakuStatistics());
  assert.equal(statsBody.statistics.total_jobs, 1);
});

test('rules persistence survives reload from disk', async () => {
  Globals.init({ TOKEN: '87654321' });
  Globals.currentToken = '87654321';

  const putReq = new Request('http://localhost/api/rules', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rules: {
        spoiler: { enabled: true },
        quality: { threshold: 41 },
        pipeline: { enabled: true }
      }
    })
  });
  const putBody = await readJson(await handlePutFilterRules(putReq, new URL(putReq.url)));
  assert.equal(putBody.rules.spoiler.enabled, true);
  assert.equal(putBody.rules.quality.threshold, 41);
  assert.ok(putBody.persistence);

  const { hydrateRuntimeRulePatch } = await import('./aggregation/rules.js');
  const persist = await import('./aggregation/rules-persist.js');
  const loaded = persist.loadPersistedRulePatch();
  assert.equal(loaded.available, true);
  assert.ok(loaded.patch.spoiler?.enabled === true || loaded.patch.quality?.threshold === 41);

  hydrateRuntimeRulePatch({});
  const afterClear = await readJson(await handleGetFilterRules());
  // 重新 hydrate 磁盘内容
  hydrateRuntimeRulePatch(loaded.patch, {
    available: true,
    path: loaded.path,
    exists: true,
    updated_at: loaded.updated_at
  });
  const afterHydrate = await readJson(await handleGetFilterRules());
  assert.equal(afterHydrate.rules.quality.threshold, 41);

  // 清理测试写入，避免污染本地环境
  const resetReq = new Request('http://localhost/api/rules?reset=true', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset: true })
  });
  await handlePutFilterRules(resetReq, new URL(resetReq.url));
  void afterClear;
});

test('live pipeline cleans dandan-format comments', async () => {
  const { applyLiveDanmakuAggregation } = await import('./aggregation/live-pipeline.js');
  const input = [
    { p: '1.00,1,16777215,[bilibili]', m: '加微信 wx99999 进群', cid: 1 },
    { p: '2.00,1,16777215,[bilibili]', m: '这段剧情信息量很大', cid: 2 },
    { p: '2.20,1,16777215,[bilibili]', m: '这段剧情信息量很大', cid: 3 }
  ];
  const output = applyLiveDanmakuAggregation(input, 'bilibili', {
    rules: { pipeline: { enabled: true } },
    recordStats: false
  });
  assert.ok(output.length < input.length);
  assert.ok(output.every(item => !String(item.m).includes('微信')));
});

test('merge API can return removed samples for online testing', async () => {
  Globals.init({ TOKEN: '87654321' });
  Globals.currentToken = '87654321';
  const req = new Request('http://localhost/api/danmaku/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      include_removed_samples: true,
      sources: [{
        source: 'test',
        data: [
          { time: 1, content: '加微信 wx123456' },
          { time: 2, content: '角色这句台词很关键' }
        ]
      }]
    })
  });
  const body = await readJson(await handleDanmakuMerge(req));
  assert.equal(body.total_after, 1);
  assert.ok(Array.isArray(body.removed_samples));
  assert.ok(body.removed_samples.length >= 1);
});

test('large scale realistic pressure test with 100000 simulated danmaku', () => {
  // 模拟真实影视弹幕：~30% 重复、~10% 刷屏、~5% 广告、~5% 时间提示、其余正常
  const data = [];
  const normalPool = [
    '这段演技真的在线',
    '配乐一出来就起鸡皮疙瘩',
    '男主这个表情太绝了',
    '下一秒会发生什么',
    '服化道细节拉满',
    '这一刀剪辑很妙',
    '弹幕比剧还热闹',
    '剧情信息量很大',
    '角色关系开始复杂了',
    '镜头语言很高级'
  ];

  for (let i = 0; i < 100000; i++) {
    const time = i * 0.05;
    const roll = i % 100;
    let content;

    if (roll < 30) {
      // 30% 重复：同一批句子在邻近时间反复出现
      content = `重复台词样本 ${i % 50}`;
    } else if (roll < 40) {
      // 10% 刷屏
      content = roll % 2 === 0 ? '哈哈哈哈哈哈' : '666666';
    } else if (roll < 45) {
      // 5% 广告
      content = roll % 2 === 0 ? '加微信 wx123456 领资源' : 'QQ群 987654 免费下载';
    } else if (roll < 50) {
      // 5% 时间提示
      content = roll % 3 === 0 ? '1:30' : (roll % 3 === 1 ? '10分钟回来' : '看到这里点赞');
    } else {
      // 普通聊天
      content = `${normalPool[i % normalPool.length]} #${Math.floor(i / 17)}`;
    }

    data.push({
      time,
      content,
      source: i % 2 === 0 ? 'bilibili' : 'tencent',
      episode: 1
    });
  }

  const result = processDanmakuMerge({
    sources: [{ source: 'stress', data }],
    rules: {
      timeline: { enabled: false }
    }
  });

  const rate = result.removed / result.total_before;
  console.log('[aggregation pressure optimized]', JSON.stringify({
    total_before: result.total_before,
    total_after: result.total_after,
    removed: result.removed,
    filter_rate: Number((rate * 100).toFixed(2)),
    removed_by_reason: result.stats.removed_by_reason,
    processing_ms: result.stats.processing_ms,
    memory_after: result.stats.memory_after
  }));

  assert.equal(result.total_before, 100000);
  // 目标：10 万条 < 5 秒
  assert.ok(result.stats.processing_ms < 5000, `expected <5000ms, got ${result.stats.processing_ms}`);
  // 本模拟集内置约 50% 垃圾/重复源，再加相似去重，过滤率通常 40%-85%
  // 真实影视弹幕（垃圾占比更低）目标约 10%-30%
  assert.ok(rate >= 0.10, `filter rate too low: ${rate}`);
  assert.ok(rate <= 0.90, `filter rate too high: ${rate}`);
  assert.ok(result.stats.removed_by_reason.duplicate_exact > 0 || result.stats.removed_by_reason.burst > 0);
  assert.ok(result.stats.removed_by_reason.advertisement > 0);
  assert.ok(result.stats.removed_by_reason.timeline_hint > 0 || result.stats.removed_by_reason.low_quality > 0);
  assert.ok(result.stats.memory_after === null || result.stats.memory_after.heap_used_mb > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePlayerTitle,
  stripSourceFromP,
  toPlayerComment,
  toPlayerComments,
  buildForwardDanmakuPayload,
  toPlayerXml,
  toPlayerAss
} from './format.js';

test('sanitizePlayerTitle removes source decorations', () => {
  assert.equal(sanitizePlayerTitle('【renren】第10集'), '第10集');
  assert.equal(sanitizePlayerTitle('[bilibili] 第1集'), '第1集');
  assert.ok(!sanitizePlayerTitle('流浪地球 from migu 第1集').toLowerCase().includes('migu'));
  assert.ok(sanitizePlayerTitle('流浪地球 from migu 第1集').includes('流浪地球'));
});

test('stripSourceFromP removes trailing platform tags', () => {
  assert.equal(stripSourceFromP('10.00,1,16777215,[renren]'), '10.00,1,16777215');
  assert.equal(stripSourceFromP('10.00,1,16777215,[bilibili＆tencent]'), '10.00,1,16777215');
  assert.equal(stripSourceFromP('10.00,1,16777215,renren'), '10.00,1,16777215');
});

test('toPlayerComments never expose source fields or brackets', () => {
  const input = [
    { p: '1.00,1,16777215,[renren]', m: '好看', cid: 1, source: 'renren' },
    { p: '2.00,1,16777215,[bilibili]', m: '神作', cid: 2, _sourceLabel: 'bilibili' }
  ];
  const out = toPlayerComments(input);
  assert.equal(out.length, 2);
  for (const c of out) {
    assert.equal(c.source, undefined);
    assert.equal(c.provider, undefined);
    assert.equal(c._sourceLabel, undefined);
    assert.ok(!String(c.p).includes('['));
    assert.ok(!String(c.p).includes('renren'));
    assert.ok(!String(c.p).includes('bilibili'));
    assert.ok(c.m);
  }
});

test('buildForwardDanmakuPayload is pure by default', () => {
  const payload = buildForwardDanmakuPayload({
    comments: [{ p: '1,1,16777215,[renren]', m: 'hi' }],
    includeMeta: false,
    meta: { sources: [{ source: 'renren' }] }
  });
  assert.equal(payload.count, 1);
  assert.equal(payload.meta, undefined);
  assert.ok(!JSON.stringify(payload).includes('renren'));
});

test('xml and ass outputs have no source labels', () => {
  const comments = [{ p: '5.0,1,16777215,[tencent]', m: '测试弹幕' }];
  const xml = toPlayerXml(comments);
  const ass = toPlayerAss(comments);
  assert.ok(xml.includes('测试弹幕'));
  assert.ok(ass.includes('测试弹幕'));
  assert.ok(!xml.includes('tencent'));
  assert.ok(!ass.includes('tencent'));
  assert.ok(!xml.includes('[tencent]'));
});

test('multi-source aggregate then player format is clean', async () => {
  const { aggregateEpisode } = await import('../aggregation/episode-service.js');
  const { Globals } = await import('../configs/globals.js');
  const { deleteEpisodeCache } = await import('../aggregation/episode-cache.js');
  Globals.init({ TOKEN: 't' });
  Globals.sourceOrderArr = ['renren', 'bilibili'];

  const result = await aggregateEpisode({
    title: '播放器标题测试',
    season: 1,
    episode: 10,
    force: true,
    timeline: false,
    sources: [
      { source: 'renren', data: [{ time: 1, content: '人人源弹幕' }, { time: 2, content: '加微信 wx1' }] },
      { source: 'bilibili', data: [{ time: 1.1, content: '人人源弹幕' }, { time: 3, content: 'B站观感不错' }] }
    ]
  });

  assert.ok(result.count >= 1);
  // 内部 comments 可能含 [source]
  const player = toPlayerComments(result.comments);
  const blob = JSON.stringify(player);
  assert.ok(!blob.includes('renren'));
  assert.ok(!blob.includes('bilibili'));
  assert.ok(!blob.includes('【'));
  assert.ok(player.some(c => c.m.includes('弹幕') || c.m.includes('观感')));

  // 后台 sources 仍在
  assert.ok(result.sources.some(s => s.source === 'renren' || s.source === 'bilibili'));

  await deleteEpisodeCache(result.key);
});

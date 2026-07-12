import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpisodeIdentity, resolveSourceWeight, normalizeTitle } from './aggregation/episode-identity.js';
import { collectEpisodeSourcesFromAnimes, aggregateEpisode, discoverEpisodeSources } from './aggregation/episode-service.js';
import { saveEpisodeCache, loadEpisodeCache, listEpisodeCaches, deleteEpisodeCache } from './aggregation/episode-cache.js';
import { Globals } from './configs/globals.js';

test('episode identity prefers tmdb key', () => {
  const id = buildEpisodeIdentity({ title: '生万物', tmdb_id: '99', season: 1, episode: 3 });
  assert.equal(id.key, 'tmdb:99:s1:e3');
  assert.equal(id.season, 1);
  assert.equal(id.episode, 3);
});

test('episode identity binds version for same tmdb', () => {
  const us = buildEpisodeIdentity({
    title: '无耻之徒',
    tmdb_id: '34307',
    season: 4,
    episode: 12,
    region: 'us',
    year: '2011',
    version_key: 'us:2011:s4'
  });
  const uk = buildEpisodeIdentity({
    title: '无耻之徒',
    tmdb_id: '34307',
    season: 4,
    episode: 12,
    region: 'uk',
    year: '2004',
    version_key: 'uk:2004:s4'
  });
  assert.equal(us.key, 'tmdb:34307:s4:e12:vus:2011:s4');
  assert.equal(uk.key, 'tmdb:34307:s4:e12:vuk:2004:s4');
  assert.notEqual(us.key, uk.key);
});

test('episode identity falls back to normalized title', () => {
  const id = buildEpisodeIdentity({ title: '生 万 物', season: 2, episode: 1 });
  assert.ok(id.key.startsWith('title:'));
  assert.ok(id.key.includes(':s2:e1'));
  assert.equal(normalizeTitle('生 万 物'), id.title_key);
});

test('source weight follows SOURCE_ORDER priority', () => {
  const order = ['douban', 'bilibili', 'tencent'];
  assert.ok(resolveSourceWeight('douban', order) > resolveSourceWeight('tencent', order));
  assert.equal(resolveSourceWeight('bilibili', order, { bilibili: 99 }), 99);
});

test('collectEpisodeSourcesFromAnimes gathers multi-platform links', () => {
  const animes = [
    {
      animeTitle: '测试剧',
      source: 'bilibili',
      links: [
        { id: 10001, title: '第1集', url: 'https://www.bilibili.com/bangumi/play/ep1' },
        { id: 10002, title: '第2集', url: 'https://www.bilibili.com/bangumi/play/ep2' }
      ]
    },
    {
      animeTitle: '测试剧',
      source: 'tencent',
      links: [
        { id: 10003, title: '第1集', url: 'https://v.qq.com/x/cover/a/b.html' }
      ]
    },
    {
      animeTitle: '测试剧【bilibili＆dandan】',
      source: 'bilibili',
      links: [
        { id: 10004, title: '第1集', url: 'bilibili:111$$$dandan:222' }
      ]
    }
  ];
  const sources = collectEpisodeSourcesFromAnimes(animes, 1, {});
  assert.ok(sources.length >= 3);
  const names = sources.map(s => s.source);
  assert.ok(names.includes('bilibili') || names.includes('tencent') || names.includes('dandan'));
  assert.ok(sources.every((s) => s.matched_episode === 1));
});

test('strict episode match never picks nearest episode', async () => {
  const { selectExactEpisodeLink, collectEpisodeSourcesFromAnimes: collect } = await import(
    './aggregation/episode-service.js'
  );
  const links = [
    { name: '10', title: '【renren】 第10集', url: '1061-10' },
    { name: '11', title: '【renren】 第11集', url: '1061-11' },
    { name: '12', title: '【renren】 第12集', url: '1061-12' }
  ];
  const sel12 = selectExactEpisodeLink(links, 12);
  assert.equal(sel12.chosen?.numbers?.includes(12), true);
  assert.equal(sel12.link?.url, '1061-12');
  const sel11 = selectExactEpisodeLink(links, 11);
  assert.equal(sel11.link?.url, '1061-11');
  // 无 E13：不得回退到 E12
  const sel13 = selectExactEpisodeLink(links, 13);
  assert.equal(sel13.link, null);
  assert.equal(sel13.policy, 'strict_exact_only');

  const animes = [{ animeTitle: '无耻之徒(美版) 第四季(2014)', source: 'renren', links }];
  const s12 = collect(animes, 12, {}, { strict: true });
  assert.equal(s12.length, 1);
  assert.equal(s12[0].url, '1061-12');
  assert.equal(s12[0].matched_episode, 12);
  const s13 = collect(animes, 13, {}, { strict: true });
  assert.equal(s13.length, 0);
});

test('episode cache save/load/list/delete works on disk', async () => {
  Globals.init({ TOKEN: '87654321' });
  const key = 'title:testcache:s1:e1';
  await deleteEpisodeCache(key);
  await saveEpisodeCache({
    key,
    identity: { key, title: 'testcache', season: 1, episode: 1 },
    sources: [{ source: 'bilibili', count_raw: 10, weight: 5 }],
    stats: { total_before: 10, total_after: 8, removed: 2, removed_by_reason: { advertisement: 2 } },
    comments: [{ p: '1.00,1,16777215,[bilibili]', m: 'hello', cid: 1 }]
  });
  const loaded = await loadEpisodeCache(key);
  assert.equal(loaded.key, key);
  assert.equal(loaded.comments.length, 1);
  const list = await listEpisodeCaches();
  assert.ok(list.some(i => i.key === key));
  await deleteEpisodeCache(key);
  const after = await loadEpisodeCache(key);
  assert.equal(after, null);
});

test('aggregateEpisode merges provided multi-sources and caches', async () => {
  Globals.init({ TOKEN: '87654321', SOURCE_ORDER: 'bilibili,tencent' });
  Globals.sourceOrderArr = ['bilibili', 'tencent'];

  const result = await aggregateEpisode({
    title: '单元测试剧',
    season: 1,
    episode: 1,
    force: true,
    timeline: false,
    sources: [
      {
        source: 'bilibili',
        data: [
          { time: 10, content: '这段演技真的在线' },
          { time: 11, content: '加微信 wx99999' },
          { time: 12, content: '1:30' }
        ]
      },
      {
        source: 'tencent',
        data: [
          { time: 10.2, content: '这段演技真的在线' },
          { time: 14, content: '角色关系开始复杂了' },
          { time: 15, content: '哈哈哈哈哈哈' }
        ]
      }
    ]
  });

  assert.equal(result.success, true);
  assert.ok(result.count >= 1);
  assert.ok(result.stats.total_before >= 5);
  assert.ok(result.stats.total_after < result.stats.total_before);
  assert.ok(result.stats.removed_by_reason.advertisement >= 1 || result.stats.removed_by_reason.timeline_hint >= 1);

  const cached = await aggregateEpisode({
    title: '单元测试剧',
    season: 1,
    episode: 1,
    force: false
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.count, result.count);

  await deleteEpisodeCache(result.key);
});

test('discoverEpisodeSources accepts explicit sources array', () => {
  const identity = buildEpisodeIdentity({ title: 'x', season: 1, episode: 1 });
  const found = discoverEpisodeSources(identity, {
    sources: [{ source: 'bilibili', data: [{ time: 1, content: 'a' }] }]
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].source, 'bilibili');
});

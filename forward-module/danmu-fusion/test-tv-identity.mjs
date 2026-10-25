/**
 * 媒体类型分流 + 电影/电视剧展示
 * 测试1: 007 电影 unionId 36557_movie_0_0 → 无 S01E01
 * 测试2: 无耻之徒 unionId 34307_tv_5_3 → 剧名(年) + S05E03
 * 测试3: 电影→电视剧→电影 无状态残留
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'danmu-fusion.js'), 'utf8');
const sandbox = {
  console,
  module: { exports: {} },
  exports: {},
  Widget:{http:{get:async url=>{
    if(url.endsWith('/bangumi/movie-real'))return {data:{bangumi:{episodes:[{episodeId:'movie-ep',episodeTitle:'正片'}]}}};
    if(url.endsWith('/bangumi/tv-real'))return {data:{bangumi:{episodes:[{episodeId:'tv-ep3',episodeNumber:'3',episodeTitle:'第3集'}]}}};
    return {statusCode:404,data:{}};
  }}}
};
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.__exp = module.exports;', sandbox);
const t = sandbox.__exp._test;
const getDetailById = sandbox.__exp.getDetailById;
assert.ok(t, 'test exports missing');

// ========== parseUnionId 标准格式 ==========
const movieUnion = t.parseUnionOrMediaId('36557_movie_0_0');
assert.ok(movieUnion);
assert.equal(movieUnion.isMovie, true);
assert.equal(movieUnion.type, 'movie');
assert.equal(movieUnion.tmdb_id, '36557');
assert.equal(movieUnion.season, null);
assert.equal(movieUnion.episode, null);

const tvUnion = t.parseUnionOrMediaId('34307_tv_5_3');
assert.ok(tvUnion);
assert.equal(tvUnion.isMovie, false);
assert.equal(tvUnion.type, 'tv');
assert.equal(tvUnion.tmdb_id, '34307');
assert.equal(tvUnion.season, 5);
assert.equal(tvUnion.episode, 3);

// ========== classify：unionId 权威，0/0 不是剧集 ==========
assert.equal(
  t.classifyMediaKind({
    title: '007：大战皇家赌场',
    season: 0,
    episode: 0,
    unionId: '36557_movie_0_0'
  }),
  'movie'
);
// 无 unionId 时 season=0 episode=0 仍是电影（不是剧集）
assert.equal(
  t.classifyMediaKind({ title: '某片', season: 0, episode: 0 }),
  'movie'
);
assert.equal(
  t.classifyMediaKind({
    seriesName: '无耻之徒',
    season: 5,
    episode: 3,
    unionId: '34307_tv_5_3'
  }),
  'episode'
);

// ========== 测试1：007 电影 ==========
const bond = t.resolveIdentity({
  type: 'movie',
  media_type: 'movie',
  title: '007：大战皇家赌场',
  tmdbId: '36557',
  season: 0,
  episode: 0,
  year: 2006,
  unionId: '36557_movie_0_0'
});
assert.equal(bond.isMovie, true, 'bond is movie');
assert.equal(bond.mediaKind, 'movie');
assert.equal(bond.tmdb_id, '36557');
assert.equal(bond.season, null);
assert.equal(bond.episode, null);

const bondDisplay = t.buildLocalDisplay(bond, { year: 2006 });
assert.equal(bondDisplay, '007：大战皇家赌场 (2006)');
assert.ok(!/S\d{1,2}E\d{1,2}/i.test(bondDisplay), 'movie must not have SxxExx');

assert.equal(t.stableAnimeId(bond), 'tmdb_36557_movie');

const bondDetail = await getDetailById({
  danmu_api_url: "https://api.example", animeId: 'movie-real',
  type: 'movie',
  title: '007：大战皇家赌场',
  tmdbId: '36557',
  season: 0,
  episode: 0,
  year: 2006,
  unionId: '36557_movie_0_0'
});
assert.equal(bondDetail.length, 1);
assert.ok(!/S\d{1,2}E\d{1,2}/i.test(bondDetail[0].episodeTitle || ''));

// ========== 测试2：无耻之徒 S05E03 ==========
const shameless = t.resolveIdentity({
  type: 'episode',
  seriesName: '无耻之徒',
  title: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 3,
  year: 2015,
  unionId: '34307_tv_5_3'
});
assert.equal(shameless.isMovie, false);
assert.equal(shameless.season, 5);
assert.equal(shameless.episode, 3);
assert.equal(shameless.tmdb_id, '34307');

const shamelessDisplay = t.buildLocalDisplay(shameless, { year: 2015 });
assert.equal(shamelessDisplay, '无耻之徒 (2015)');
assert.ok(!/S\d{1,2}E\d{1,2}/i.test(shamelessDisplay), 'series title has no SE');
assert.equal(t.formatSE(shameless.season, shameless.episode), 'S05E03');

const shamelessDetail = await getDetailById({
  danmu_api_url: "https://api.example", animeId: 'tv-real',
  type: 'episode',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 3,
  year: 2015,
  unionId: '34307_tv_5_3'
});
const selectedCurrent = shamelessDetail.find(item => Number(item.episodeNumber) === 3);
assert.ok(selectedCurrent);
assert.equal(String(selectedCurrent.episodeNumber), '3');
assert.equal(selectedCurrent.episodeTitle,'第3集');

// Historical synthetic IDs are not real API resources. Do not fabricate a
// successful episode list when no server lookup took place.
const staleDetail=await getDetailById({danmu_api_url:'https://api.example',animeId:t.stableAnimeId(shameless)});
assert.equal(staleDetail.length,0);
assert.ok(t.compatDiagnostics().some(e=>e.code==='LEGACY_SELECTION'));


// ========== 测试3：电影 → 电视剧 → 电影，无状态残留 ==========
const a = t.resolveIdentity({
  title: '007：大战皇家赌场',
  year: 2006,
  unionId: '36557_movie_0_0',
  season: 0,
  episode: 0
});
assert.equal(a.isMovie, true);

const b = t.resolveIdentity({
  seriesName: '无耻之徒',
  year: 2015,
  unionId: '34307_tv_5_3',
  season: 5,
  episode: 3
});
assert.equal(b.isMovie, false);
assert.equal(b.season, 5);
assert.equal(b.episode, 3);

const c = t.resolveIdentity({
  title: '007：大战皇家赌场',
  year: 2006,
  unionId: '36557_movie_0_0',
  season: 0,
  episode: 0,
  // 故意残留剧集字段（模拟播放器脏数据）
  IndexNumber: 3,
  ParentIndexNumber: 5
});
assert.equal(c.isMovie, true, 'unionId movie wins over leftover IndexNumber');
assert.equal(c.season, null);
assert.equal(c.episode, null);
assert.equal(t.buildLocalDisplay(c, { year: 2006 }), '007：大战皇家赌场 (2006)');
assert.ok(!/S\d{1,2}E\d{1,2}/i.test(t.buildLocalDisplay(c, { year: 2006 })));

// 再切回剧集
const d = t.resolveIdentity({
  seriesName: '无耻之徒',
  unionId: '34307_tv_5_3',
  season: 5,
  episode: 3
});
assert.equal(d.isMovie, false);
assert.equal(d.episode, 3);

// unionId 是唯一可信身份：陈旧播放器字段不得覆盖当前集
const stalePlayerFields = t.resolveIdentity({
  seriesName: '无耻之徒',
  unionId: '34307_tv_5_3',
  season: 5,
  episode: 1,
  ParentIndexNumber: 4,
  IndexNumber: 12
});
assert.equal(stalePlayerFields.season, 5);
assert.equal(stalePlayerFields.episode, 3);
assert.equal(stalePlayerFields.seasonSource, 'unionId');
assert.equal(stalePlayerFields.episodeSource, 'unionId');

// 仅 unionId 电影（无 type 字段）
const e = t.resolveIdentity({
  title: '007：大战皇家赌场',
  season: 0,
  episode: 0,
  year: 2006,
  unionId: '36557_movie_0_0'
});
assert.equal(e.isMovie, true);
assert.equal(e.tmdb_id, '36557');

console.log('media-type split tests passed');
console.log('  movie display:', t.buildLocalDisplay(bond, { year: 2006 }));
console.log('  tv display:', t.buildLocalDisplay(shameless, { year: 2015 }), t.formatSE(5, 3));

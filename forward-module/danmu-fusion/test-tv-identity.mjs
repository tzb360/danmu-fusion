/**
 * 电视剧跨集身份：animeId / cacheKey 不得复用
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
  setTimeout,
  clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.__exp = module.exports;', sandbox);
const t = sandbox.__exp._test;
assert.ok(t, 'test exports missing');

// 类型
assert.equal(t.classifyMediaKind({ type: 'movie' }), 'movie');
assert.equal(t.classifyMediaKind({ type: 'tv' }), 'tv');
assert.equal(t.classifyMediaKind({ type: 'episode', season: 4, episode: 12 }), 'episode');
assert.equal(t.classifyMediaKind({ season: 4, episode: 12 }), 'episode');

// animeId：电影固定、电视剧含 SE
const movieId = t.stableAnimeId({
  isMovie: true,
  tmdb_id: '535167',
  season: 1,
  episode: 1,
  title: '流浪地球'
});
assert.equal(movieId, 'tmdb_535167_movie');

const e10 = t.stableAnimeId({
  isMovie: false,
  tmdb_id: '34307',
  season: 4,
  episode: 10,
  title: '无耻之徒'
});
const e11 = t.stableAnimeId({
  isMovie: false,
  tmdb_id: '34307',
  season: 4,
  episode: 11,
  title: '无耻之徒'
});
const e12 = t.stableAnimeId({
  isMovie: false,
  tmdb_id: '34307',
  season: 4,
  episode: 12,
  title: '无耻之徒'
});
assert.equal(e10, 'tmdb_34307_tv_4_10__auto');
assert.equal(e11, 'tmdb_34307_tv_4_11__auto');
assert.equal(e12, 'tmdb_34307_tv_4_12__auto');
assert.notEqual(e10, e11);
assert.notEqual(e11, e12);
// 不同版本不同 id
const e12us = t.stableAnimeId(
  { isMovie: false, tmdb_id: '34307', season: 4, episode: 12, title: '无耻之徒' },
  'us:2011:s4'
);
assert.equal(e12us, 'tmdb_34307_tv_4_12__us_2011_s4');
assert.notEqual(e12us, e12);

// 解析
const p12 = t.parseAnimeId('tmdb_34307_tv_4_12__us_2011_s4');
assert.deepEqual(
  {
    tmdb_id: p12.tmdb_id,
    season: p12.season,
    episode: p12.episode,
    isMovie: p12.isMovie,
    version_key: p12.version_key
  },
  {
    tmdb_id: '34307',
    season: 4,
    episode: 12,
    isMovie: false,
    version_key: 'us:2011:s4'
  }
);

// cacheKey 分集
const k10 = t.cacheKey({
  isMovie: false,
  tmdb_id: '34307',
  season: 4,
  episode: 10,
  title: '无耻之徒'
});
const k12 = t.cacheKey({
  isMovie: false,
  tmdb_id: '34307',
  season: 4,
  episode: 12,
  title: '无耻之徒'
});
assert.notEqual(k10, k12);
assert.ok(k12.includes(':e12'));

// resolveIdentity：带 SE 的 params
const id12 = t.resolveIdentity({
  type: 'tv',
  title: '无耻之徒',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 4,
  episode: 12,
  year: 2014
});
assert.equal(id12.isMovie, false);
assert.equal(id12.season, 4);
assert.equal(id12.episode, 12);
assert.equal(t.stableAnimeId(id12), 'tmdb_34307_tv_4_12__auto');

// 仅 animeId 恢复 SE
const idFromAid = t.resolveIdentity({
  type: 'tv',
  title: '无耻之徒',
  animeId: 'tmdb_34307_tv_4_11'
});
assert.equal(idFromAid.season, 4);
assert.equal(idFromAid.episode, 11);
assert.equal(idFromAid.tmdb_id, '34307');

// buildQuery 必须含 season/episode
const q = t.buildQuery(id12, { colorToWhite: true, forceScroll: true }, {});
assert.equal(q.season, '4');
assert.equal(q.episode, '12');
assert.equal(q.type, 'tv');
assert.equal(q.tmdb_id, '34307');

console.log('tv-identity tests passed');

/**
 * 电视剧模式：电影/剧集分离、unionId、季列表、禁止默认 E01
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

// —— 类型分离 ——
assert.equal(t.classifyMediaKind({ type: 'movie' }), 'movie');
assert.equal(t.classifyMediaKind({ type: 'tv' }), 'tv');
assert.equal(t.classifyMediaKind({ type: 'episode', season: 5, episode: 3 }), 'episode');
assert.equal(t.classifyMediaKind({ unionId: '34307_tv_5_3' }), 'episode');
assert.equal(t.classifyMediaKind({ season: 5, episode: 3 }), 'episode');

// —— unionId 解析 ——
const u = t.parseUnionOrMediaId('34307_tv_5_3');
assert.deepEqual(
  { tmdb_id: u.tmdb_id, season: u.season, episode: u.episode, isMovie: u.isMovie },
  { tmdb_id: '34307', season: 5, episode: 3, isMovie: false }
);

// —— 用户复现：播放器 S05E03 + unionId ——
const idS5E3 = t.resolveIdentity({
  type: 'episode',
  seriesName: '无耻之徒',
  title: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 3,
  unionId: '34307_tv_5_3'
});
assert.equal(idS5E3.isMovie, false);
assert.equal(idS5E3.season, 5);
assert.equal(idS5E3.episode, 3);
assert.equal(t.formatSE(idS5E3.season, idS5E3.episode), 'S05E03');
assert.notEqual(idS5E3.episodeSource, 'default_1_UNSAFE');

// 仅 unionId（无 season/episode 字段）
const idUnionOnly = t.resolveIdentity({
  type: 'tv',
  seriesName: '无耻之徒',
  unionId: '34307_tv_5_3'
});
assert.equal(idUnionOnly.season, 5);
assert.equal(idUnionOnly.episode, 3);
assert.equal(idUnionOnly.tmdb_id, '34307');

// 连续集：E1 E2 E3 E4 各自正确
for (const ep of [1, 2, 3, 4]) {
  const id = t.resolveIdentity({
    type: 'episode',
    seriesName: '无耻之徒',
    tmdbId: '34307',
    season: 5,
    episode: ep,
    unionId: '34307_tv_5_' + ep
  });
  assert.equal(id.season, 5, 'S5');
  assert.equal(id.episode, ep, 'E' + ep);
  assert.equal(t.formatSE(id.season, id.episode), 'S05E0' + ep);
}

// —— animeId 季级（不含 episode）——
const animeId = t.stableAnimeId(idS5E3, 'us:2011:s5');
assert.equal(animeId, 'tmdb_34307_tv_s5__us_2011_s5');
// 同季不同集 → 同一 animeId（集在 getDetail 列表里选）
const idS5E1 = t.resolveIdentity({
  type: 'episode',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 1
});
assert.equal(t.stableAnimeId(idS5E1, 'us:2011:s5'), animeId);

// 不同季 → 不同 animeId
const idS4 = t.resolveIdentity({
  type: 'episode',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 4,
  episode: 12
});
assert.notEqual(t.stableAnimeId(idS4, 'us:2011:s4'), animeId);

// 电影固定
const movieId = t.stableAnimeId({
  isMovie: true,
  tmdb_id: '535167',
  season: 1,
  episode: 1,
  title: '流浪地球'
});
assert.equal(movieId, 'tmdb_535167_movie');

// parseAnimeId 季级
const parsed = t.parseAnimeId('tmdb_34307_tv_s5__us_2011_s5');
assert.equal(parsed.tmdb_id, '34307');
assert.equal(parsed.season, 5);
assert.equal(parsed.episode, null); // 季级不含集
assert.equal(parsed.version_key, 'us:2011:s5');
assert.equal(parsed.seasonScoped, true);

// 播放器 SE 优先于旧 animeId 集级污染
const idPreferPlayer = t.resolveIdentity({
  type: 'episode',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 3,
  animeId: 'tmdb_34307_tv_5_1__auto' // 旧错误 E01
});
assert.equal(idPreferPlayer.episode, 3, 'player episode wins over animeId');
assert.equal(idPreferPlayer.season, 5);

// episodeCount 至少覆盖当前集
assert.ok(t.resolveSeasonEpisodeCount(idS5E3, null) >= 3);
assert.ok(t.resolveSeasonEpisodeCount(idS5E3, null) >= 12);

// cacheKey 分集
const k1 = t.cacheKey(idS5E1);
const k3 = t.cacheKey(idS5E3);
assert.notEqual(k1, k3);
assert.ok(k3.includes(':e3') || k3.includes(':e03') || k3.includes('e3'));

// buildQuery
const q = t.buildQuery(idS5E3, { colorToWhite: true, forceScroll: true }, {});
assert.equal(q.season, '5');
assert.equal(q.episode, '3');
assert.equal(q.type, 'tv');
assert.equal(q.tmdb_id, '34307');

// assertEpisodeConsistent
assert.equal(t.assertEpisodeConsistent(idS5E3, 3, 'ok'), true);
assert.equal(t.assertEpisodeConsistent(idS5E3, 1, 'bad'), false);

// getDetail 列表：当前集 ★，episodeNumber 正确
const detailFn = sandbox.__exp.getDetailById;
assert.ok(detailFn);
const detail = await detailFn({
  type: 'episode',
  seriesName: '无耻之徒',
  tmdbId: '34307',
  season: 5,
  episode: 3,
  unionId: '34307_tv_5_3'
});
assert.ok(Array.isArray(detail));
assert.ok(detail.length >= 3);
assert.equal(String(detail[2].episodeNumber), '3');
assert.ok(String(detail[2].episodeTitle).includes('S05E03'));
assert.ok(String(detail[2].episodeTitle).includes('★'));
// 第1集不是当前
assert.ok(!String(detail[0].episodeTitle).includes('当前'));

// 电影 getDetail 只有 1 条
const movieDetail = await detailFn({
  type: 'movie',
  title: '流浪地球',
  tmdbId: '535167'
});
assert.equal(movieDetail.length, 1);
assert.equal(String(movieDetail[0].episodeNumber), '1');

console.log('tv-identity tests passed');

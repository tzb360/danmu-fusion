import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInterferenceTitle,
  isPrimaryTitleMatch,
  isTypeConflict,
  filterContentCandidates,
  scoreContentCandidate
} from './aggregation/content-filter.js';

test('interference titles detected', () => {
  assert.equal(isInterferenceTitle('电影赏析《我和我的祖国》(2020)'), true);
  assert.equal(isInterferenceTitle('《我和我的祖国》电影幕后纪实(2019)'), true);
  assert.equal(isInterferenceTitle('我和我的祖国 电影幕后纪实节目(2019)'), true);
  assert.equal(isInterferenceTitle('我和我的祖国(2019)'), false);
});

test('primary title match rejects prefix junk', () => {
  assert.equal(isPrimaryTitleMatch('我和我的祖国(2019)', '我和我的祖国'), true);
  assert.equal(isPrimaryTitleMatch('时光印记-我和我的祖国(2024)', '我和我的祖国'), false);
  assert.equal(isPrimaryTitleMatch('炫舞未来广场舞蹈｜我和我的祖国-尚岩(2024)', '我和我的祖国'), false);
  assert.equal(isPrimaryTitleMatch('探究吧！我和我的祖国(2023)', '我和我的祖国'), false);
});

test('movie vs variety type conflict', () => {
  assert.equal(isTypeConflict('movie', '综艺'), true);
  assert.equal(isTypeConflict('movie', '华语电影'), false);
  assert.equal(isTypeConflict('movie', '电影'), false);
});

test('filter 我和我的祖国 candidates keeps feature film only', () => {
  const animes = [
    { animeId: 1, animeTitle: '我和我的祖国(2019)', type: '华语电影', startDate: '2019-01-01', source: 'tencent' },
    { animeId: 2, animeTitle: '我和我的祖国(2019)', type: '综艺', startDate: '2019-01-01', source: 'iqiyi' },
    { animeId: 3, animeTitle: '时光印记-我和我的祖国(2024)', type: '综艺', startDate: '2024-01-01', source: '360' },
    { animeId: 4, animeTitle: '电影赏析《我和我的祖国》(2020)', type: '电影', startDate: '2020-01-01', source: '360' },
    { animeId: 5, animeTitle: '《我和我的祖国》电影幕后纪实(2019)', type: '综艺', startDate: '2019-01-01', source: '360' },
    { animeId: 6, animeTitle: '我和我的祖国 电影幕后纪实节目(2019)', type: '综艺', startDate: '2019-01-01', source: '360' },
    { animeId: 7, animeTitle: '我和我的祖国(2011)', type: '综艺', startDate: '2011-01-01', source: '360' },
    { animeId: 8, animeTitle: '探究吧！我和我的祖国(2023)', type: '动漫', startDate: '2023-01-01', source: '360' },
    { animeId: 9, animeTitle: '我和我的祖国(2019)', type: '华语电影', startDate: '2019-01-01', source: 'youku' }
  ];

  const { kept, rejected } = filterContentCandidates(animes, {
    title: '我和我的祖国',
    type: 'movie',
    year: '2019'
  });

  const titles = kept.map((a) => a.animeTitle);
  assert.ok(titles.every((t) => t.includes('2019') && !/赏析|幕后|时光|探究/.test(t)));
  assert.ok(kept.every((a) => a.type === '华语电影' || a.type === '电影'));
  assert.ok(rejected.length >= 5);

  // 正片应保留
  assert.ok(kept.some((a) => a.animeId === 1));
  assert.ok(kept.some((a) => a.animeId === 9));
  // 干扰应剔除
  assert.ok(!kept.some((a) => a.animeId === 2));
  assert.ok(!kept.some((a) => a.animeId === 4));
  assert.ok(!kept.some((a) => a.animeId === 7));
});

test('score prefers exact feature over long junk', () => {
  const q = { title: '我和我的祖国', type: 'movie', year: '2019' };
  const a = scoreContentCandidate(
    { animeTitle: '我和我的祖国(2019)', type: '华语电影', startDate: '2019-01-01' },
    q
  );
  const b = scoreContentCandidate(
    { animeTitle: '电影赏析《我和我的祖国》(2020)', type: '电影', startDate: '2020-01-01' },
    q
  );
  assert.ok(a.score > 0);
  assert.equal(b.score, -1);
});

test('multi-season: premiere year + season must keep target season', () => {
  // Emby/Forward 常传系列首播年 2011 + season=4
  const animes = [
    { animeId: 1, animeTitle: '无耻之徒(美版) 第一季(2011)', type: '电视剧', startDate: '2011-01-01' },
    { animeId: 4, animeTitle: '无耻之徒(美版) 第四季(2014)', type: '电视剧', startDate: '2014-01-01' },
    { animeId: 8, animeTitle: '无耻之徒(英版) 第八季(2011)', type: '电视剧', startDate: '2011-01-01' },
    { animeId: 11, animeTitle: '无耻之徒(美版) 第十一季(2020)', type: '电视剧', startDate: '2020-01-01' }
  ];
  const { kept } = filterContentCandidates(animes, {
    title: '无耻之徒',
    type: 'tv',
    year: '2011',
    season: 4
  });
  assert.ok(
    kept.some((a) => a.animeId === 4),
    'S4 must survive content_score_cut even when query year is series premiere'
  );
  const s4 = scoreContentCandidate(animes[1], { title: '无耻之徒', type: 'tv', year: '2011', season: 4 });
  const ukS8 = scoreContentCandidate(animes[2], { title: '无耻之徒', type: 'tv', year: '2011', season: 4 });
  const usS1 = scoreContentCandidate(animes[0], { title: '无耻之徒', type: 'tv', year: '2011', season: 4 });
  assert.ok(s4.score > ukS8.score, 'correct season outranks same-year wrong season');
  assert.ok(s4.score > usS1.score, 'correct season outranks S1 with premiere year match');
});

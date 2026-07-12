import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVersionCandidates,
  slimCandidate,
  pickCandidate,
  buildVersionKey
} from './forward_adapter/version-candidates.js';

test('buildVersionKey format', () => {
  assert.equal(buildVersionKey({ region: 'us', year: '2011', season: 4 }), 'us:2011:s4');
});

test('buildVersionCandidates splits US/UK and keeps both', () => {
  const kept = [
    {
      animeId: 1,
      animeTitle: '无耻之徒(美版) 第四季(2014)【电视剧】from renren',
      source: 'renren',
      startDate: '2014-01-01',
      links: [
        { name: '11', title: '【renren】 第11集', url: '1061-11' },
        { name: '12', title: '【renren】 第12集', url: '1061-12' }
      ]
    },
    {
      animeId: 2,
      animeTitle: '无耻之徒(英版) 第四季(2007)【电视剧】from renren',
      source: 'renren',
      startDate: '2007-01-01',
      links: [
        { name: '12', title: '【renren】 第12集', url: 'uk-12' }
      ]
    }
  ];
  // also need S1 for series year - optional
  const { candidates, default_key } = buildVersionCandidates(kept, {
    title: '无耻之徒',
    season: 4,
    episode: 12,
    year: '2011'
  });
  assert.ok(candidates.length >= 2);
  const keys = candidates.map((c) => c.version_key);
  assert.ok(keys.some((k) => k.startsWith('us:')));
  assert.ok(keys.some((k) => k.startsWith('uk:')));
  // each has exact E12
  for (const c of candidates) {
    if (c.source_count > 0) {
      assert.ok(c._sources.every((s) => s.matched_episode === 12));
    }
  }
  assert.ok(default_key);
  const slim = candidates.map(slimCandidate);
  assert.ok(slim[0].display);
  assert.ok(!('_animes' in slim[0]));
});

test('pickCandidate respects version_key', () => {
  const list = [
    { version_key: 'us:2011:s4', source_count: 1, is_default: true, region: 'us' },
    { version_key: 'uk:2004:s4', source_count: 1, is_default: false, region: 'uk' }
  ];
  const uk = pickCandidate(list, { version_key: 'uk:2004:s4' });
  assert.equal(uk.version_key, 'uk:2004:s4');
  const def = pickCandidate(list, {});
  assert.equal(def.version_key, 'us:2011:s4');
});

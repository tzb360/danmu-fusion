/** Execute the shipped widget's actual identity functions, never a copy. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sandbox={console,module:{exports:{}},setTimeout,clearTimeout};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('./danmu-fusion.js',import.meta.url),'utf8'),sandbox);
const {resolveSeasonEpisode,decodeEpisodeFromSyntheticId}=sandbox.module.exports._test;
const project=p=>{const x=resolveSeasonEpisode(p,false);return {season:x.season,episode:x.episode};};
assert.deepEqual(project({season:4,episode:11}),{season:4,episode:11});
assert.deepEqual(project({ParentIndexNumber:4,IndexNumber:11}),{season:4,episode:11});
assert.deepEqual(project({season:4,IndexNumber:0}),{season:4,episode:1});
const animeId='tmdb_34307',baseId=34307*1000;
assert.equal(decodeEpisodeFromSyntheticId(baseId+11,animeId),11);
assert.deepEqual(project({season:4,episodeId:baseId+12,animeId}),{season:4,episode:12});
assert.deepEqual(project({season:4,episode:11,IndexNumber:10}),{season:4,episode:11});
console.log('actual identity functions passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import {strictNativePools} from './aggregation/strict-source-match.js';
const item=(source,numbers,extra={})=>({animeId:source,animeTitle:'示例剧2(2024) from '+source,type:'tvseries',source,links:numbers.map(n=>({title:'【'+source+'】 第'+n+'集',url:'https://video.example/'+source+'/'+n})),...extra});
const pool=(items,providers=items.map(i=>i.source))=>strictNativePools(items,[{primary:providers[0],secondaries:providers.slice(1)}],a=>a,()=>1000000001);
test('episode union keeps two secondary platforms when the former primary has no next episode',()=>{
 const r=pool([item('provider_a',[1]),item('provider_b',[1,2]),item('provider_c',[1,2])]);assert.equal(r.pools.length,1);
 assert.equal(r.pools[0].links[0].title,'【provider_a&provider_b&provider_c】 第1集');
 assert.equal(r.pools[0].links[1].title,'【provider_b&provider_c】 第2集');assert.ok(!r.pools[0].links[1].url.includes('provider_a:'));
});
test('new providers and sparse, reordered episodes are discovered independently without an allowlist or array alignment',()=>{
 for(const providers of [['youku','migu','bahamut','animeko'],['custom_a','custom_b','future_provider']]){
  const r=pool(providers.map((p,i)=>item(p,i===0?[9,1]:[2,9,1]))).pools[0];
  assert.equal(r.links.length,3);assert.match(r.links[1].title,/第2集/);assert.ok(!r.links[1].url.includes(providers[0]+':'));
  assert.equal(r.links[2].url.split('$$$').length,providers.length);
 }
});
test('source configuration is respected and a single available episode remains explicit rather than being lost',()=>{
 const r=pool([item('a',[1,2]),item('b',[1]),item('disabled',[1,2])],['a','b']);
 assert.equal(r.pools[0].links[1].title,'【a】 第2集');assert.equal(r.pools[0].links[1].url,'https://video.example/a/2');assert.ok(!r.pools[0].links[1].url.includes('disabled'));assert.equal(r.remaining.length,1);
});
test('different works, years, seasons, versions, specials and conflicting identities cannot enter a pool',()=>{
 for(const extra of [{animeTitle:'其他剧2(2024)'},{animeTitle:'示例剧3(2024)'},{animeTitle:'示例剧2(2023)'},{animeTitle:'示例剧2 导演剪辑版(2024)'},{type:'movie'},{tmdbId:999}])assert.equal(pool([item('a',[1],{tmdbId:42}),item('b',[1],extra)]).pools.length,0);
 const specials=pool([item('a',[1]),item('b',[1],{links:[{title:'第1集 预告',url:'x'}]})]);assert.equal(specials.pools.length,0);
});
test('duplicate episode numbers in one resource cannot be guessed by position or title similarity',()=>{
 const ambiguous=item('a',[1]);ambiguous.links.push({title:'第1集 其他版本',url:'different'});
 const r=pool([ambiguous,item('b',[1]),item('c',[1])]);assert.equal(r.pools.length,1);assert.equal(r.pools[0].links[0].title,'【b&c】 第1集');
});
test('movie pooling accepts full movies and rejects segments without inventing season or episode numbers',()=>{
 const film=(source,title='正片')=>item(source,[],{type:'movie',animeTitle:'示例电影2(2024)',links:[{title,url:'https://video.example/'+source}]});
 assert.equal(pool([film('migu'),film('future_movie')]).pools[0].links[0].title,'【migu&future_movie】 正片');
 assert.equal(pool([film('a'),film('b','第一部分')]).pools.length,0);
 assert.equal(pool([film('a','第1集 正片'),film('b','576P')]).pools[0].links[0].url.split('$$$').length,2);
 assert.equal(pool([film('a'),film('b','576P 粤语')]).pools.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { processDanmakuMerge } from '../aggregation/aggregator.js';
import { buildEpisodeIdentity } from '../aggregation/episode-identity.js';
import { parseForwardOptions, forwardOffsets, sliceForwardPayload } from './options.js';
import { parseOffsetRules } from '../utils/offset-util.js';
import { Globals } from '../configs/globals.js';
import { addAnime, setSearchCache } from '../utils/cache-util.js';
import { handleForwardDanmaku } from '../apis/episode-aggregate-api.js';
import TencentSource from '../sources/tencent.js';
import IqiyiSource from '../sources/iqiyi.js';
import { deleteEpisodeCache } from '../aggregation/episode-cache.js';

test('Forward processing preserves viewers and original traditional text while deduplicating across origins',()=>{
  const a=[{p:'10,1,16777215',m:' 這個鏡頭真的太精彩 ',cid:'a'},{p:'20,1,16777215',m:'哈哈哈',cid:'b'},{p:'20.1,1,16777215',m:'哈哈哈',cid:'c'}];
  const b=[{p:'11,1,16777215',m:'這個鏡頭真的太精彩',cid:'d'},{p:'20,1,16777215',m:'哈哈哈',cid:'e'}];
  const r=processDanmakuMerge({episode:12,output_format:'dandan',sources:[{source:'tencent',data:a},{source:'iqiyi',data:b}],rules:{forward_safe:{enabled:true,tolerance:2}}});
  assert.equal(r.total_before,5); assert.equal(r.total_after,4); assert.equal(r.result[0].m,' 這個鏡頭真的太精彩 ');
  assert.equal(r.result.filter(c=>c.m==='哈哈哈').length,3);
});
test('source offset applies before conservative merge; no blind timeline alignment',()=>{
  const r=processDanmakuMerge({sources:[{source:'tencent',data:[{time:10,content:'这个镜头真的太精彩'}]},{source:'iqiyi',data:[{time:20,content:'这个镜头真的太精彩'}]}],rules:{forward_safe:{enabled:true,offsets:{iqiyi:-10}}}});
  assert.equal(r.total_after,1); assert.equal(r.result[0].time,10);
});
test('processing profile isolates existing caches and changed configuration',()=>{
  const identity={title:'测试作品',season:2,episode:12,year:2024};
  assert.notEqual(buildEpisodeIdentity(identity).key,buildEpisodeIdentity({...identity,processing_profile:'forward-safe-v1'}).key);
  assert.notEqual(buildEpisodeIdentity({...identity,processing_profile:'a'}).key,buildEpisodeIdentity({...identity,processing_profile:'b'}).key);
});
test('actual Forward extension parsing and server/client offset ownership',()=>{
  const params={forward_safe:'1',offset_rules:'[{"title":"测试作品","source":"iqiyi","season":2,"episode":12,"seconds":-5}]',sources:'qq,qiyi',dedupe_tolerance:'3'};
  const get=(keys,fb)=>keys.map(k=>params[k]).find(v=>v!=null)??fb;
  const config=parseForwardOptions(get);
  assert.deepEqual(config.sources,['tencent','iqiyi']); assert.equal(config.tolerance,3);
  const identity={title:'测试作品',season:2,episode:12}; const sources=[{source:'iqiyi'}];
  const server=parseOffsetRules('测试作品/S02/E12@iqiyi:20');
  assert.equal(forwardOffsets(identity,sources,config,server).iqiyi,-5);
  assert.equal(forwardOffsets(identity,sources,{...config,offsets:null},server).iqiyi,20);
  assert.throws(()=>parseForwardOptions((keys,fb)=>keys[0]==='dedupe_tolerance'?-1:keys[0]==='forward_safe'?'1':fb));
});
test('server windows use half-open boundaries and leave other episodes independent',()=>{
  const payload={comments:[{p:'59.9,1,1',m:'a'},{p:'60,1,1',m:'b'},{p:'120,1,1',m:'c'}]};
  const a=sliceForwardPayload(payload,new URLSearchParams({segment_time:0}));
  const b=sliceForwardPayload(payload,new URLSearchParams({segment_time:60}));
  assert.deepEqual(a.comments.map(c=>c.m),['a']); assert.deepEqual(b.comments.map(c=>c.m),['b']);
  assert.equal(b.processing.serverDeduplicated,true);
  assert.throws(()=>sliceForwardPayload(payload,new URLSearchParams({segment_time:-1})));
});
test('dedicated API end-to-end with seeded search and mocked origins: matching → offsets → merge → window',async t=>{
  Globals.init({TOKEN:'integration-probe',SOURCE_ORDER:'tencent,iqiyi',GROUP_MINUTE:'0',DANMU_OFFSET:'Forward集成测试/S02/E12@iqiyi:-1'});
  const details=new Map(), title='Forward集成测试';
  const candidates=['tencent','iqiyi'].map((source,i)=>({animeId:910001+i,bangumiId:String(910001+i),animeTitle:title+' 第二季(2024)',type:'tvseries',source,startDate:'2024-01-01',episodeCount:12,links:[{name:'12',title:'第12集',url:i?'https://www.iqiyi.com/integration-probe.html':'https://v.qq.com/x/cover/integration-probe.html'}]}));
  candidates.forEach(a=>addAnime(a,details));
  setSearchCache(title+'_S2',candidates,details);
  t.mock.method(TencentSource.prototype,'search',async()=>{ throw new Error('Unexpected network search in deterministic fixture'); });
  t.mock.method(IqiyiSource.prototype,'search',async()=>{ throw new Error('Unexpected network search in deterministic fixture'); });
  t.mock.method(TencentSource.prototype,'getEpisodeDanmu',async()=>[{p:'59,1,16777215',m:'这个镜头真的很精彩',cid:'tx'},{p:'61,1,16777215',m:'哈哈哈',cid:'t2'}]);
  t.mock.method(IqiyiSource.prototype,'getEpisodeDanmu',async()=>[{p:'60,1,16777215',m:'这个镜头真的很精彩',cid:'qy'}]);
  t.mock.method(TencentSource.prototype,'formatComments',r=>r);
  t.mock.method(IqiyiSource.prototype,'formatComments',r=>r);
  const url=new URL('http://local/api/forward/danmaku?'+new URLSearchParams({title,season:2,episode:12,year:2024,type:'tv',forward_safe:1,segment_time:0,segment_seconds:60,debug:1,force:1}));
  const response=await handleForwardDanmaku(new Request(url),url);
  const body=await response.json();
  if(body.meta?.key) t.after(()=>deleteEpisodeCache(body.meta.key));
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.count,1,JSON.stringify(body));
  assert.equal(body.segment.segment_end,60);
  assert.equal(body.meta.sources.length,2);
  assert.equal(Number(body.comments[0].p.split(',')[0]),59);
  assert.equal(body.meta.stats.total_before,3);
  assert.equal(body.meta.stats.removed,1);
});

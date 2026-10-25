import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fusionDedupe, fusionMatch, fusionNormalize } from '../../danmu_api/aggregation/forward-core.js';

import { base, row, engineRuntime as runtime, apiFixture } from './test-support.mjs';

test('movie identity: shared ID or title + year + explicit type',()=>{
  const id={isMovie:true,title:'同名作品',year:'2024',tmdb_id:'42'};
  assert.equal(fusionMatch(id,{title:'同名作品 (2024)',type:'movie'}).reliable,true);
  assert.equal(fusionMatch(id,{title:'同名作品 (2020)',type:'movie'}).reliable,false);
  assert.equal(fusionMatch(id,{title:'同名作品 (2024)',type:'tvseries'}).reliable,false);
  assert.equal(fusionMatch(id,{title:'不同别名',type:'movie',tmdb_id:42}).reliable,true);
  assert.equal(fusionMatch(id,{title:'同名作品 (2024)',type:'movie',tmdb_id:99}).reliable,false);
});
test('TV season/year/specials/parts remain distinct',()=>{
  const id={isMovie:false,title:'测试作品',year:'2024',season:2};
  assert.equal(fusionMatch(id,{animeTitle:'测试作品 S02 (2024)',type:'tvseries'}).reliable,true);
  for (const title of ['测试作品 S01 (2024)','测试作品 S02 (2020)','测试作品 S02 SP (2024)','测试作品 S02 OVA (2024)','测试作品 下部 S02 (2024)','测试作品 (2024)']) assert.equal(fusionMatch(id,{animeTitle:title,type:'tvseries'}).reliable,false,title);
});
test('traditional/simplified titles and known aliases match without changing displayed comments',()=>{
  assert.equal(fusionMatch({isMovie:false,title:'无声的证言',season:2,year:2024},{animeTitle:'無聲的證言 第二季 (2024)',type:'tvseries'}).reliable,true);
  assert.equal(fusionMatch({isMovie:true,title:'中文名',original_title:'Example',year:2024},{animeTitle:'Example (2024)',type:'movie'}).reliable,true);
});
test('generated episodeNumber never overrides a conflicting/special/part title',()=>{
  const app=runtime(apiFixture()), f=app._test.fusionEpisodeNumber;
  assert.equal(f({episodeNumber:'12',episodeTitle:'第11集'}),11);
  assert.equal(f({episodeNumber:'12',episodeTitle:'SP 第12集'}),null);
  assert.equal(f({episodeNumber:'12',episodeTitle:'第12集（上）'}),null);
  assert.equal(f({episodeNumber:'12',episodeTitle:'没有集号的章节'}),null);
});
test('NFKC/whitespace normalize, original display stays intact',()=>{
  assert.equal(fusionNormalize(' ＡＢＣ\n 测试　'),'ABC 测试');
  const x=fusionDedupe([row('a',10,' ＡＢＣ\n 测试　'),row('b',11,'ABC 测试')]);
  assert.equal(x.items.length,1); assert.equal(x.items[0].content,' ＡＢＣ\n 测试　');
});
test('two and three origins merge one-to-one in configurable time window',()=>{
  assert.equal(fusionDedupe([row('a'),row('b',11),row('c',12)]).items.length,1);
  assert.equal(fusionDedupe([row('a'),row('b',13)]).items.length,2);
  assert.equal(fusionDedupe([row('a'),row('b',13)],{tolerance:3}).items.length,1);
  assert.equal(fusionDedupe([row('a'),row('b',10.1)],{tolerance:0}).items.length,2);
});
test('same words at different scenes or episodes survive',()=>{
  assert.equal(fusionDedupe([row('a'),row('b',30),row('b',10,undefined,{episode:'other'})]).items.length,3);
});
test('same-origin records need a true duplicate ID; audience multiplicity survives',()=>{
  const rows=[row('a'),row('a',10.1),row('b',11),row('b',11.1)];
  assert.equal(fusionDedupe(rows).items.length,2);
  assert.equal(fusionDedupe([row('a',10,undefined,{recordId:'1'}),row('a',10,undefined,{recordId:'1'})]).items.length,1);
  assert.equal(fusionDedupe([row('a'),row('a')]).items.length,2);
});
test('laughter, emoji and repeated-syllable variations are protected',()=>{
  const input=Array.from({length:1000},(_,i)=>row(i%2?'a':'b',10+i/1000,i%3?'哈哈哈':'哈哈哈哈哈'));
  assert.equal(fusionDedupe(input).items.length,1000);
  assert.equal(fusionDedupe([row('a',1,'😄😄😄'),row('b',1,'😄😄😄')]).items.length,2);
});
test('same text with different colors/modes stays distinct',()=>{
  assert.equal(fusionDedupe([row('a'),row('b',10,undefined,{color:123}),row('c',10,undefined,{position:5})]).items.length,3);
});
test('near dedupe only punctuation spacing, never letters/repeat length',()=>{
  assert.equal(fusionDedupe([row('a',10,'这个镜头 ， 拍得太好啦'),row('b',11,'这个镜头，拍得太好啦')]).items.length,1);
  assert.equal(fusionDedupe([row('a',10,'这部剧真的真的好看'),row('b',11,'这部剧真的真的很好看')]).items.length,2);
});
test('offsets run before dedupe; negative times drop; server processing prevents second offset',()=>{
  const input=[row('a',10),row('b',20)];
  assert.equal(fusionDedupe(input,{offsets:{b:-10}}).items.length,1);
  assert.equal(fusionDedupe(input,{offsets:{b:-10},serverProcessed:true}).items.length,2);
  assert.equal(fusionDedupe([row('b',1)],{offsets:{b:-10}}).items.length,0);
});
test('unknown provenance and already deduplicated server tracks keep independent viewers',()=>{
  assert.equal(fusionDedupe([row('unknown'),row('unknown')]).items.length,2);
  assert.equal(fusionDedupe([row('a'),row('b')],{serverProcessed:true}).items.length,2);
  assert.equal(fusionDedupe([row('a'),row('b')],{enabled:false}).items.length,2);
});
test('200000 comments: bounded-time merge and explicit cap diagnostics',()=>{
  const input=Array.from({length:200000},(_,i)=>row('source'+i%3,i/30,'场景内容编号'+i));
  const start=performance.now(), result=fusionDedupe(input), elapsed=performance.now()-start;
  assert.equal(result.items.length,input.length); assert.ok(elapsed<6000,'processing '+elapsed+'ms');
  assert.equal(fusionDedupe(input,{maxItems:1000}).stats.truncated,199000);
  console.log(JSON.stringify({performance_comments:input.length,processing_ms:Math.round(elapsed),heap_mb:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});
test('official metadata and globals work without Node modules',()=>{
  const app=runtime(apiFixture());
  assert.equal(app.WidgetMetadata.id,'tzb360.danmu.fusion');
  for (const id of ['searchDanmu','getDetail','getComments','getDanmuWithSegmentTime']) {
    const mod=app.WidgetMetadata.modules.find(m=>m.id===id); assert.ok(mod); assert.equal(mod.type,'danmu'); assert.equal(typeof app.sandbox[mod.functionName],'function');
  }
  assert.equal(app.WidgetMetadata.modules.find(m=>m.id==='getComments').functionName,'getCommentsById');
});
test('automatic search/detail/fetch, 2 and 3 origins; no whole-track download',async()=>{
  for (const sources of [2,3]) {
    const app=runtime(apiFixture({sources})), search=await app.searchDanmu(base);
    assert.ok(Number(search.animes[0].animeId)<0);
    const p={...base,animeId:search.animes[0].animeId};
    const details=await app.getDetailById(p); assert.equal(details.length,1); assert.equal(details[0].episodeNumber,'12');
    const result=await app.loadResult({...p,commentId:details[0].episodeId});
    assert.equal(result.count,1); assert.equal(result.sources.length,sources); assert.equal(result.stats.original,sources*2);
    // Adjacent manifest segments are fetched only as needed for the ±2s border.
    assert.ok(app.calls.filter(c=>c.method==='POST').every(c=>c.body.segment_start<=60));
  }
});
test('movie automatic search to final Forward comments through actual endpoint shapes',async()=>{
  const fixture=apiFixture({sources:1});
  const app=runtime(async(m,url,body)=>{
    if(url.includes('/search/anime')) return {data:{animes:[{animeId:1,source:'tencent',animeTitle:'同名作品 (2024)',type:'movie',startDate:'2024-01-01'}]}};
    if(url.includes('/bangumi/')) return {data:{bangumi:{episodes:[{episodeId:100,episodeTitle:'正片'}]}}};
    return fixture(m,url,body);
  });
  const params={...base,type:'movie',title:'同名作品',seriesName:undefined,season:undefined,episode:undefined};
  const search=await app.searchDanmu(params); assert.ok(Number(search.animes[0].animeId)<0);
  const details=await app.getDetailById({...params,animeId:search.animes[0].animeId});
  // Forward can provide just commentId when loading a selected track.
  const result=await app.loadResult({...params,commentId:details[0].episodeId}); assert.equal(result.count,1);
});
test('one source fails: other data survives; failure is retried later',async()=>{
  const app=runtime(apiFixture({fail:true})), result=await app.loadResult(base);
  assert.equal(result.count,1); assert.equal(result.partial,true); assert.equal(result.failedSources[0],'iqiyi');
  const before=app.calls.length; await app.loadResult(base); assert.ok(app.calls.length>before);
});
test('seek, return, concurrent request coalescing and persistent cache',async()=>{
  const app=runtime(apiFixture());
  const [a,b]=await Promise.all([app.loadResult(base),app.loadResult(base)]);
  assert.equal(a.count,b.count); assert.equal(app.calls.filter(c=>c.method==='POST').length,4);
  await app.loadResult({...base,segmentTime:135});
  assert.ok(app.calls.some(c=>c.body && c.body.segment_start===120));
  const before=app.calls.length; await app.loadResult({...base,segmentTime:10}); assert.equal(app.calls.length,before);
  const reloaded=runtime(apiFixture(),app.stored); await reloaded.loadResult(base); assert.equal(reloaded.calls.length,0);
});
test('source/config/API/season/episode/year cache isolation',async()=>{
  const app=runtime(apiFixture()); await app.loadResult(base);
  const before=app.calls.length;
  await app.loadResult({...base,episode:11}); assert.ok(app.calls.length>before);
  const key=app._test.fusionKey(app._test.fusionIdentity(base),app._test.fusionOptions(base),'x');
  for (const change of [{year:'2020'},{season:1},{danmu_api_url:'https://else.example/token'}]) assert.notEqual(app._test.fusionKey(app._test.fusionIdentity({...base,...change}),app._test.fusionOptions({...base,...change}),'x'),key);
});
test('TTL expiry recovers; obsolete cache switch cannot disable request coalescing',async()=>{
  const app=runtime(apiFixture()); await app.loadResult(base);
  for(const e of app.stored.values()) if(e && e.expires) e.expires=0;
  const reloaded=runtime(apiFixture(),app.stored); await reloaded.loadResult(base); assert.ok(reloaded.calls.length>0);
  const uncached=runtime(apiFixture()); await Promise.all([uncached.loadResult({...base,cache:'0'}),uncached.loadResult({...base,cache:'0'})]);
  assert.equal(uncached.calls.filter(c=>c.method==='POST').length,4);
});
test('caller mutation cannot corrupt cached or concurrent player results',async()=>{
  const app=runtime(apiFixture());
  const [a,b]=await Promise.all([app.loadResult(base),app.loadResult(base)]);
  a.comments[0].m='mutated'; assert.notEqual(b.comments[0].m,'mutated');
  const c=await app.loadResult(base); assert.notEqual(c.comments[0].m,'mutated');
});
test('native merged resource requested once, no second approximate dedupe',async()=>{
  const app=runtime(apiFixture({merged:true})); const r=await app.loadResult(base);
  assert.equal(r.count,1); assert.equal(app.calls.filter(c=>/comment\/\d/.test(c.url)).length,1); assert.equal(app.calls.filter(c=>c.method==='POST').length,2);
});
test('unsegmented origin returns explicit fallback flag',async()=>{
  const app=runtime(apiFixture({full:true})); const r=await app.loadResult({...base,aggregate:'0'});
  assert.equal(r.count,1); assert.equal(r.fullFallback,true);
});
test('401/403/404 stop retries; 429/5xx are bounded; invalid JSON is rejected',async()=>{
  for (const status of [401,403,404,429,500]) {
    const app=runtime(async()=>({status,data:{}})); const r=await app.loadResult({...base,retry:'1'});
    assert.equal(r.count,0); assert.equal(r.success,false); assert.equal(app.calls.length,status===401 || status===403?1:2);
  }
  const app=runtime(async()=>({data:'{broken'})); const result=await app.searchDanmu(base); assert.equal(result.animes.length,0);
});
test('stale segment URL refreshes manifest once and recovers',async()=>{
  let manifests=0;
  const fixture=apiFixture({sources:1});
  const app=runtime(async(m,u,b)=>{
    if (/comment\/100\?/.test(u)) { manifests++; const r=await fixture(m,u,b); r.data.comments.segmentList.forEach(s=>{s.url += manifests>1?'/new':'/old';}); return r; }
    if(m==='POST' && b.url.endsWith('/old')) return {status:404,data:{}};
    return fixture(m,u,b);
  });
  const result=await app.loadResult(base); assert.equal(result.count,1); assert.equal(manifests,2);
});
test('manual uncertain resource remains selectable without auto-aggregating',async()=>{
  const app=runtime(apiFixture()); const search=await app.searchDanmu({...base,year:'1990'});
  assert.equal(search.animes.length,2); assert.ok(!search.animes[0].animeId.startsWith?.('fusion-auto:'));
  const result=await app.loadResult({...base,year:'1990',animeId:1,commentId:100}); assert.equal(result.count,1);
});
test('missing episode and special season never fall back to regular E01',async()=>{
  const app=runtime(apiFixture());
  const p={...base}; delete p.episode;
  assert.equal((await app.loadResult(p)).count,0);
  assert.equal((await app.loadResult({...base,season:0})).count,0);
  assert.equal((await app.loadResult({...base,episodeName:'OVA'})).count,0);
});
test('normal styles and server timestamps survive historical client overrides',async()=>{
  const fixture=apiFixture({sources:1});
  const app=runtime(async(m,u,b)=>u.includes('/comment/')?{data:{comments:[{p:'10,5,255,user',m:'顶部彩色',cid:1},{p:'20,4,65280,user',m:'底部彩色',cid:2}]}}:fixture(m,u,b));
  const result=await app.loadResult({...base,offset_owner:'client',offset_rules:'broken JSON',color_to_white:'1',force_scroll:'1'});
  assert.equal(result.count,2);
  assert.equal(result.comments[0].p,'10,5,255');
  assert.equal(result.comments[1].p,'20,4,65280');
});
test('safe logs never expose tokens in path/query or native exception',async()=>{
  const secret='s3cr3t';
  const app=runtime(async()=>{throw new Error('https://api.example/'+secret+'/api?token='+secret);});
  const result=await app.loadResult({...base,danmu_api_url:'https://api.example/'+secret,debug:'1'});
  assert.ok(!JSON.stringify([app.logs,result]).includes(secret));
});
test('search reports API failure or malformed results without fabricated candidates',async()=>{
  const app=runtime(async()=>({status:503,data:{}}));
  const result=await app.searchDanmu({...base,api_mode:'fusion'});
  assert.equal(result.animes.length,0);
  const empty=runtime(async()=>({data:{media:{title:'测试作品'},candidates:[]}}));
  assert.equal((await empty.searchDanmu({...base,api_mode:'fusion'})).animes.length,0);
});
test('timeout protection clears in-flight state and can retry a later call',async()=>{
  const app=runtime(()=>new Promise(()=>{}));
  app.sandbox.setTimeout=fn=>setTimeout(fn,5);
  const result=await app.loadResult(base);
  assert.equal(result.success,false); assert.ok(result.error.includes('408'));
  const calls=app.calls.length; await app.loadResult(base); assert.ok(app.calls.length>calls);
});
test('storage corruption or quota failure cannot discard successful origin data',async()=>{
  const app=runtime(apiFixture());
  app.sandbox.Widget.storage.get=async()=>'{broken';
  app.sandbox.Widget.storage.set=async()=>{throw new Error('quota');};
  assert.equal((await app.loadResult(base)).count,1);
});
test('historical source/mode switches are ignored; native merged children are requested once',async()=>{
  const app=runtime(apiFixture({merged:true}));
  const p={...base,sources:'tencent',aggregate:'0',api_mode:'fusion'};
  const search=await app.searchDanmu(p);
  assert.ok(Number(search.animes[0].animeId)<0);
  const result=await app.loadResult(p);
  assert.equal(result.count,1); assert.equal(result.aggregation.mode,'server');
  assert.equal(result.aggregation.sourceCount,2);
  assert.ok(app.calls.every(c=>!c.url.includes('/forward/')));
});

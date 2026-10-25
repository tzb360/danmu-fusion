import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeRuntime,referencePaths,media,standardFixture,selectEpisode} from './native-test-support.mjs';

for(const stage of [1,2,3,4,5,6])test('Forward timer-free baseline stays usable at recovery stage '+stage,async()=>{
  const app=nativeRuntime(standardFixture(),{stage});
  for(const name of ['setTimeout','clearTimeout','URL','fetch','AbortController','Buffer','require','process'])assert.equal(typeof app.sandbox[name],'undefined',name);
  const search=await app.invoke('searchDanmu',media);
  assert.equal(search.animes[0].animeId,42);
  const selected={danmu_api_url:media.danmu_api_url,animeId:search.animes[0].animeId,title:search.animes[0].animeTitle};
  const detail=await app.invoke('getDetail',selected);
  assert.equal(detail[0].episodeId,'E12');assert.equal(detail[0].episodeNumber,'12');
  // Actual third call may have only the address and selected commentId.
  const result=await app.invoke('getComments',{danmu_api_url:media.danmu_api_url,commentId:detail[0].episodeId});
  assert.equal(result.count,3);assert.equal(result.comments.length,3);
  assert.equal(result.comments[1].p,'650,4,255,user');
  assert.ok(app.calls.every(c=>c.url.startsWith(media.danmu_api_url+'/api/v2/')));
  assert.equal(new URL(app.calls.find(c=>c.url.includes('/comment/')).url).searchParams.get('withRelated'),stage>=3?'true':'false');
});

test('metadata registrations invoke real globals, one setting, established identity',()=>{
  const app=nativeRuntime(standardFixture());
  assert.equal(app.metadata.id,'tzb360.danmu.fusion');assert.equal(app.metadata.version,'1.4.5');
  assert.equal(app.metadata.requiredVersion,'0.0.2');
  assert.equal(app.metadata.globalParams.length,1);assert.equal(app.metadata.globalParams[0].name,'danmu_api_url');
  for(const id of ['searchDanmu','getDetail','getComments','getDanmuWithSegmentTime']){
    const entry=app.metadata.modules.find(m=>m.id===id);assert.equal(entry.type,'danmu');assert.equal(typeof app.sandbox[entry.functionName],'function');assert.equal(entry.params.length,0);assert.equal(entry.cacheDuration,0);
  }
});

test('manual search title is honored and known wrong seasons or derivative works cannot be auto-selected',async()=>{
  const animes=[
    {animeId:3,animeTitle:'爱情公寓3(2012)【国产剧】from tencent',type:'国产剧',source:'tencent'},
    {animeId:4,animeTitle:'爱情公寓4(2014)【国产剧】from tencent&iqiyi',type:'国产剧',source:'tencent'},
    {animeId:1,animeTitle:'爱情公寓(2009)【国产剧】from youku',type:'国产剧',source:'youku'},
    {animeId:9,animeTitle:'爱情公寓4 解说(2014)',type:'国产剧',source:'bilibili'},
    {animeId:10,animeTitle:'爱情公寓4(2014)',type:'纪录片',source:'bilibili'},
    {animeId:11,animeTitle:'爱情公寓(2018)',type:'电影',source:'tencent'}
  ];
  const app=nativeRuntime(()=>({data:{animes}}));
  const result=await app.invoke('searchDanmu',{...media,title:'爱情公寓4',seriesName:'爱情公寓',season:4,episode:2,year:2009});
  assert.equal(new URL(app.calls[0].url).searchParams.get('keyword'),'爱情公寓4');
  assert.deepEqual(Array.from(result.animes,a=>a.animeId),[4]);
});

test('same-name movie remakes and commentary are excluded while missing-year exact candidates remain selectable',async()=>{
  const app=nativeRuntime(()=>({data:{animes:[
    {animeId:2,animeTitle:'示例电影(1990)',type:'movie'},
    {animeId:3,animeTitle:'示例电影(2024)',type:'movie'},
    {animeId:4,animeTitle:'示例电影 赏析(2024)',type:'movie'},
    {animeId:5,animeTitle:'示例电影',type:'movie'}
  ]}}));
  const result=await app.invoke('searchDanmu',{...media,type:'movie',title:'示例电影',year:2024,season:0,episode:0});
  assert.deepEqual(Array.from(result.animes,a=>a.animeId),[3,5]);
});

test('Rex, Makka and Fusion use the same standard HTTP response and final data wrapper',async t=>{
  for(const [name,path] of Object.entries({rex:referencePaths.rex,makka:referencePaths.makka,fusion:undefined})){
    if(path && !fs.existsSync(path)){t.diagnostic('Reference unavailable: '+name);continue;}
    const app=nativeRuntime(standardFixture(),{path,stage:path?undefined:3});
    const search=await app.invoke('searchDanmu',media);
    const detail=await app.invoke('getDetail',{...media,animeId:search.animes[0].animeId});
    const result=await app.invoke('getComments',{...media,commentId:detail[0].episodeId,convertMode:'none',colorMode:'none'});
    assert.equal(result.count,3,name);assert.equal(result.comments[1].p,'650,4,255,user',name);
    const request=app.calls.find(c=>c.url.includes('/comment/'));
    assert.equal(new URL(request.url).search,'?async=1&withRelated=true&chConvert=1',name);
    assert.equal(request.method,'GET');assert.ok(!Object.hasOwn(result,'data'),name);
  }
});

test('all supported URL forms preserve token/proxy bytes without probing',async()=>{
  for(const [input,expected] of [
    ['https://api.example','https://api.example'],['https://api.example/','https://api.example'],
    ['https://api.example/api/v2','https://api.example'],['https://api.example/token','https://api.example/token'],
    ['https://api.example/token/api/v2/','https://api.example/token'],['https://api.example/proxy/a%2Fb/api/v2','https://api.example/proxy/a%2Fb'],
    ['https://api.example/token/api/forward/danmaku','https://api.example/token']
  ]){
    const app=nativeRuntime(standardFixture(),{stage:6});
    await app.invoke('getComments',{danmu_api_url:input,commentId:'E12'});
    assert.equal(app.calls.length,1,input);assert.equal(app.calls[0].url,expected+'/api/v2/comment/E12?async=1&withRelated=true&chConvert=1');
  }
});

test('real animeId and server-provided bangumiId alternatives are never guessed or coerced',async()=>{
  const app=nativeRuntime(standardFixture({alternate:true}),{stage:6});
  const search=await app.invoke('searchDanmu',media);assert.equal(typeof search.animes[0].animeId,'number');
  const detail=await app.invoke('getDetail',{danmu_api_url:media.danmu_api_url,animeId:42});
  assert.equal(detail[0].episodeId,'E12');
  assert.ok(app.calls.some(c=>c.url.endsWith('/bangumi/42')));assert.ok(app.calls.some(c=>c.url.endsWith('/bangumi/A42')));
});

test('separate Widget contexts can load the chosen ID using string-only storage',async()=>{
  const storage=new Map();
  const first=nativeRuntime(standardFixture({alternate:true}),{stage:6,storage});await first.invoke('searchDanmu',media);
  assert.ok(Array.from(storage.values()).every(v=>typeof v==='string'));
  const second=nativeRuntime(standardFixture({alternate:true}),{stage:6,storage});
  const episodes=await second.invoke('getDetail',{danmu_api_url:media.danmu_api_url,animeId:42,title:'播放器替换后的标题'});
  assert.equal(episodes[0].episodeId,'E12');
});

test('movie 0/0 and title-only search do not require year or season to be usable',async()=>{
  const fixture=standardFixture();
  const app=nativeRuntime(async(m,u,b,o)=>u.includes('/search/anime')?{data:{animes:[{animeId:'movie-A',animeTitle:'同名电影',type:'movie'}]}}:u.endsWith('/bangumi/movie-A')?{data:{bangumi:{episodes:[{episodeId:'E12',episodeTitle:'正片'}]}}}:fixture(m,u,b,o),{stage:6});
  const p={danmu_api_url:media.danmu_api_url,type:'movie',title:'同名电影',season:0,episode:0};
  const s=await app.invoke('searchDanmu',p);assert.equal(s.animes[0].animeId,'movie-A');
  const d=await app.invoke('getDetail',{...p,animeId:'movie-A'});assert.equal(d[0].episodeTitle,'正片');
  assert.equal((await app.invoke('getComments',{danmu_api_url:p.danmu_api_url,commentId:d[0].episodeId})).count,3);
});

test('empty results, missing IDs and malformed data produce stage-specific diagnostics',async()=>{
  const empty=nativeRuntime(standardFixture({empty:true}),{stage:6});assert.equal((await empty.invoke('searchDanmu',media)).animes.length,0);
  const app=nativeRuntime(()=>({data:{data:{animes:[]}}}),{stage:6});await app.invoke('searchDanmu',media);await app.invoke('getDetail',media);await app.invoke('getComments',media);
  const events=app.exports._test.compatDiagnostics();
  for(const code of ['INVALID_ANIMES','MISSING_ANIME_ID','MISSING_COMMENT_ID'])assert.ok(events.some(e=>e.code===code),code);
});

test('HTTP, JSON and network errors are classified without leaking credentials',async()=>{
  for(const handler of [()=>({statusCode:404,data:{}}),()=>({data:'{bad json'}),()=>{throw new Error('https://api.example/token PRIVATE_AUTH');}]){
    const app=nativeRuntime(handler,{stage:6});const result=await app.invoke('getComments',{danmu_api_url:media.danmu_api_url,commentId:'E12'});
    assert.equal(result.count,0);assert.equal(result.success,false);
    assert.ok(!app.logs.join().includes('/token'));assert.ok(!app.logs.join().includes('PRIVATE_AUTH'));
    assert.ok(app.exports._test.compatDiagnostics().some(e=>['HTTP_STATUS','INVALID_JSON','NETWORK'].includes(e.code)));
  }
});

test('only exact replay IDs dedupe; audience multiplicity, styles and time remain intact',async()=>{
  const fixture=standardFixture({duplicates:true});const app=nativeRuntime(fixture,{stage:4});
  const result=await app.invoke('getComments',{danmu_api_url:media.danmu_api_url,commentId:'E12'});
  assert.equal(result.count,3);assert.equal(result.comments[0].cid,'a');assert.equal(result.comments[0].p,'12.34,1,16711680,user');
  const many=nativeRuntime(()=>({data:{comments:Array.from({length:1000},(_,i)=>({cid:i,p:(10+i/1000)+',1,16777215,u',m:'哈哈哈'}))}}),{stage:6});
  assert.equal((await many.invoke('getComments',{...media,commentId:7})).count,1000);
});

test('cache skips failures, invalid/empty data and pending tasks, and isolates episodes',async()=>{
  let count=0;const fixture=standardFixture();
  const app=nativeRuntime((...args)=>++count===1?{data:{comments:[{bad:true}]}}:fixture(...args),{stage:6});
  const p={danmu_api_url:media.danmu_api_url,commentId:'E12',episode:12};
  assert.equal((await app.invoke('getComments',p)).count,0);assert.equal((await app.invoke('getComments',p)).count,3);
  const calls=app.calls.length;await app.invoke('getComments',p);assert.equal(app.calls.length,calls);
  await app.invoke('getComments',{...p,episode:13});assert.equal(app.calls.length,calls+1);
  const pending=nativeRuntime(()=>({data:{taskId:'task',comments:[]}}),{stage:6});await pending.invoke('getComments',p);await pending.invoke('getComments',p);assert.equal(pending.calls.length,2);
});

test('standard full-track resume and optional progress callbacks preserve original IDs',async()=>{
  const app=nativeRuntime(standardFixture(),{stage:6});const p={danmu_api_url:media.danmu_api_url,commentId:'E12'};
  const full=await app.invoke('getComments',p);assert.equal(full.count,3);
  const window=await app.invoke('getDanmuWithSegmentTime',{...p,segmentTime:600});assert.equal(window.count,1);assert.equal(window.comments[0].cid,'b');
  const back=await app.invoke('getDanmuWithSegmentTime',{...p,segmentTime:0});assert.equal(back.comments[0].cid,'a');assert.equal(app.calls.length,1);
});

test('documented barrage_list GET segments work without post, fetch or browser timers',async()=>{
  const app=nativeRuntime((m,u)=>u.includes('/comment/')?{data:{barrage_list:[{segment_start:600,segment_end:660,segment_url:'https://segments.example/fragment'}]}}:{data:[{p:'650,5,255,u',m:'分片弹幕',cid:'seg'}]},{stage:6});
  const p={danmu_api_url:media.danmu_api_url,commentId:'E12',segmentTime:600};
  const first=await app.invoke('getComments',p);assert.equal(first.count,1);assert.equal(first.comments[0].cid,'seg');
  assert.ok(app.calls.every(c=>c.method==='GET'));assert.ok(app.calls.every(c=>!c.url.includes('segmentflag')));
});

test('removed settings cannot influence the baseline; legacy address key remains usable',async()=>{
  const p={server:media.danmu_api_url,commentId:'E12'};
  for(const name of ['api_mode','aggregate','dedupe','offset_rules','timeout','retry','debug'])Object.defineProperty(p,name,{get(){throw new Error('obsolete config read');}});
  const app=nativeRuntime(standardFixture(),{stage:6});assert.equal((await app.invoke('getComments',p)).count,3);
});

test('native rejected HTTP statuses and timeout errors are distinguished from network errors',async()=>{
  for(const [error,code]of [[{response:{status:403}},'HTTP_STATUS'],[{code:-1001},'TIMEOUT'],[{name:'AbortError'},'TIMEOUT']]){
    const app=nativeRuntime(()=>{throw error;});await app.invoke('getComments',{...media,commentId:'E12'});
    assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code===code),code);
  }
});

test('query extension rejection falls back once, without API-root probing',async()=>{
  const fixture=standardFixture();const app=nativeRuntime((m,u,b,o)=>u.includes('async=1')?{statusCode:400,data:{}}:fixture(m,u,b,o));
  assert.equal((await app.invoke('getComments',{...media,commentId:'E12'})).count,3);
  assert.equal(app.calls.length,2);assert.equal(new URL(app.calls[1].url).search,'?withRelated=true');
});

test('search/episodes inline fallback retains real episode IDs without a bangumi request',async()=>{
  const app=nativeRuntime((m,u)=>u.includes('/search/anime')?{statusCode:404,data:{}}:{data:{animes:[{animeId:'A42',animeTitle:'测试剧',episodes:[{episodeId:'inline-12',episodeNumber:'12',episodeTitle:'第12集'}]}]}});
  const s=await app.invoke('searchDanmu',media);const d=await app.invoke('getDetail',{...media,animeId:s.animes[0].animeId});
  assert.equal(d[0].episodeId,'inline-12');assert.ok(!app.calls.some(c=>c.url.includes('/bangumi/')));
});

test('a concrete API endpoint is rejected as a root without modifying token paths',async()=>{
  const app=nativeRuntime(standardFixture());await app.invoke('getComments',{danmu_api_url:'https://api.example/token/api/v2/comment/42',commentId:42});
  assert.equal(app.calls.length,0);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.stage==='Address' && e.code==='INVALID_ADDRESS'));
});

test('movie selection accepts explicitly titled platform copies without requiring the word 正片',()=>{
  const episodes=[{episodeId:'youku',episodeTitle:'【youku】 长安三万里(2023)'},{episodeId:'qq',episodeTitle:'【qq】 长安三万里(2023)'}];
  assert.equal(selectEpisode(episodes,{type:'movie',title:'长安三万里'}).episodeId,'youku');
});

test('localized movie categories stay selectable; the reference whitelist is not copied',async t=>{
  const fixture=()=>({data:{success:true,isMatched:false,matches:[],animes:[{animeId:1,animeTitle:'哪吒之魔童降世(2019)',type:'动画电影'},{animeId:2,animeTitle:'电影赏析 哪吒之魔童降世(2020)',type:'电影'}]}});
  const p={...media,title:'哪吒之魔童降世',seriesName:undefined,type:'movie',year:2019,season:0,episode:0};
  const fusion=nativeRuntime(fixture);assert.equal((await fusion.invoke('searchDanmu',p)).animes[0].animeId,1);
  if(fs.existsSync(referencePaths.rex)){
    const reference=nativeRuntime(fixture,{path:referencePaths.rex});
    assert.equal((await reference.invoke('searchDanmu',p)).animes[0].animeId,2);
  }else t.diagnostic('Optional reference file unavailable');
});

test('detail and comment responses are not unwrapped twice',async()=>{
  const app=nativeRuntime(()=>({data:{data:{bangumi:{episodes:[]},comments:[]}}}));
  await app.invoke('getDetail',{...media,animeId:42});await app.invoke('getComments',{...media,commentId:12});
  for(const code of ['INVALID_EPISODES','INVALID_COMMENTS'])assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code===code));
});

test('legitimate native merged tracks over 200k rows retain the full timeline',async()=>{
  const rows=Array.from({length:220001},(_,i)=>({cid:i,p:(i/50)+',1,16777215,u',m:'有效弹幕'+i}));
  const app=nativeRuntime(()=>({data:{comments:rows,count:rows.length}}));
  const result=await app.invoke('getComments',{...media,commentId:'large-merged'});
  assert.equal(result.count,rows.length);assert.equal(result.comments.at(-1).p,rows.at(-1).p);
});

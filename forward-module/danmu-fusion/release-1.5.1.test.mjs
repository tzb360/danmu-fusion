import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibilityRuntime as nativeRuntime,media} from './native-test-support.mjs';
const config={danmu_api_url:'https://one.example/Private%2FONE?token=SECRET1',danmu_api_url_2:'https://two.example/PrivateTWO?token=SECRET2'};
const p={...media,...config};
const hash='a'.repeat(64),tick=()=>new Promise(setImmediate);
const episode=n=>({episodeId:'E'+n,episodeTitle:'第'+n+'集',durationSeconds:2400,videoHash:hash});
function fixture({candidate={},episodes={},comment,search}={}){
  return async(method,address)=>{
    const u=new URL(address),slot=u.hostname==='one.example'?1:2;
    if(u.pathname.includes('/search/'))return search?search(slot,u):{data:{animes:[{animeId:42,animeTitle:'测试剧 S02 (2024)',type:'tvseries',startDate:'2024-01-01',...candidate[slot]}]}};
    if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:episodes[slot] || [episode(12),episode(13)]}}};
    if(u.pathname.includes('/comment/'))return comment?comment(slot,u):{data:{comments:[{cid:'c'+slot,p:'12,5,255,u',m:'来源'+slot}]}};
    return {statusCode:404,data:{}};
  };
}
async function catalog(app,params=p){await app.invoke('searchDanmu',params);await tick();return (await app.invoke('searchDanmu',params)).animes;}
async function select(app,slot=2,n=12,params=p){
  const list=await catalog(app,params),anime=list.find(a=>a.animeTitle.endsWith('API '+slot));assert.ok(anime);
  let episodes=await app.invoke('getDetail',{...params,animeId:anime.animeId});await tick();episodes=await app.invoke('getDetail',{...params,animeId:anime.animeId});
  const ep=episodes.find(e=>e.episodeTitle.startsWith('第'+n+'集'));assert.ok(ep);return ep.episodeId;
}
function decoded(id){return JSON.parse(decodeURIComponent(id.split(':').slice(2).join(':')));}
function encoded(refs){return 'df15:c:'+encodeURIComponent(JSON.stringify(refs));}

test('source preference survives a new VM and recommends API 2 for the next episode without reusing its old ID',async()=>{
  const storage=new Map(),a=nativeRuntime(fixture(),{storage}),id=await select(a);
  assert.equal((await a.invoke('getComments',{...config,commentId:id})).count,1);
  const b=nativeRuntime(fixture(),{storage}),next={...p,episode:13};
  const list=await catalog(b,next);assert.ok(list[0].animeTitle.endsWith('API 2'));assert.equal(list[0].isFavorited,true);
  const selected=await select(b,2,13,next);assert.equal(decoded(selected)[0].i,'E13');
  await b.invoke('getComments',{...config,commentId:selected});assert.ok(b.calls.at(-1).url.includes('/comment/E13?'));
  const progressStorage=new Map(),progressOnly=nativeRuntime(fixture(),{storage:progressStorage}),progressId=await select(progressOnly);
  await progressOnly.invoke('getDanmuWithSegmentTime',{...config,commentId:progressId,segmentTime:0});
  assert.ok((await catalog(nativeRuntime(fixture(),{storage:progressStorage}),next))[0].isFavorited);
  const persisted=storage.get('fusion-preference-v1');assert.ok(persisted);assert.ok(!/测试剧|Private|SECRET|https:|Authorization/.test(persisted));
});
test('movie preferences are separate from TV and survive comment-only loading',async()=>{
  const params={...p,type:'movie',title:'测试电影',seriesName:'测试电影',year:2024,season:0,episode:0},storage=new Map();
  const handler=fixture({candidate:{1:{animeTitle:'测试电影(2024)',type:'movie'},2:{animeTitle:'测试电影(2024)',type:'movie'}},episodes:{1:[{...episode(1),episodeTitle:'正片'}],2:[{...episode(1),episodeTitle:'正片'}]}});
  const a=nativeRuntime(handler,{storage}),list=await catalog(a,params),anime=list.find(a=>a.animeTitle.endsWith('API 2'));
  const eps=await a.invoke('getDetail',{...params,animeId:anime.animeId});await a.invoke('getComments',{...config,commentId:eps[0].episodeId});
  const b=nativeRuntime(handler,{storage});assert.ok((await catalog(b,params))[0].animeTitle.endsWith('API 2'));
  assert.ok(!(await catalog(nativeRuntime(fixture(),{storage})))[0].isFavorited);
});
test('changed address or token invalidates the preference and old routes; reordering slots retains the source fingerprint',async()=>{
  for(const change of ['https://changed.example/root','https://two.example/PrivateTWO?token=NEWSECRET']){
    const storage=new Map(),a=nativeRuntime(fixture(),{storage}),id=await select(a);await a.invoke('getComments',{...config,commentId:id});
    const b=nativeRuntime(fixture(),{storage}),params={...p,danmu_api_url_2:change},list=await catalog(b,params);
    assert.ok(!list.some(a=>a.isFavorited));const result=await b.invoke('getComments',{...params,commentId:id});assert.equal(result.error.code,'SOURCE_CHANGED');
  }
  const storage=new Map(),a=nativeRuntime(fixture(),{storage}),id=await select(a);await a.invoke('getComments',{...config,commentId:id});
  const swapped={...p,danmu_api_url:config.danmu_api_url_2,danmu_api_url_2:config.danmu_api_url};
  assert.ok((await catalog(nativeRuntime(fixture(),{storage}),swapped))[0].animeTitle.endsWith('API 1'));
});
test('work, release year, season, TMDB, edition and language conflicts never inherit a preference',async()=>{
  const storage=new Map(),a=nativeRuntime(fixture(),{storage}),id=await select(a);await a.invoke('getComments',{...config,commentId:id});
  for(const changes of [{title:'另一部剧',seriesName:'另一部剧'},{year:2025},{season:3},{tmdbId:'tv.999'},{version:'extended'},{language:'en'}]){
    const b=nativeRuntime(fixture(),{storage}),list=await catalog(b,{...p,...changes});assert.ok(!list.some(a=>a.isFavorited),JSON.stringify(changes));
  }
  for(const changes of [{edition:'extended'},{language:'en'},{tmdbId:'999'},{animeTitle:'测试剧 S02 (2025)',startDate:'2025-01-01'}]){
    const b=nativeRuntime(fixture({candidate:{1:changes,2:changes}}),{storage});assert.ok(!(await catalog(b)).some(a=>a.isFavorited),JSON.stringify(changes));
  }
});
test('ambiguous or missing identity does not persist source preferences; storage failure never blocks playback',async()=>{
  const storage=new Map(),a=nativeRuntime(fixture({candidate:{1:{animeTitle:'测试剧 S02',startDate:''},2:{animeTitle:'测试剧 S02',startDate:''}}}),{storage}),id=await select(a);
  await a.invoke('getComments',{...config,commentId:id});assert.equal(Object.keys(JSON.parse(storage.get('fusion-preference-v1')).items).length,0);
  const b=nativeRuntime(fixture());b.sandbox.Widget.storage={get(){throw Error('SECRET');},set(){throw Error('SECRET');}};
  assert.equal((await b.invoke('getComments',{...config,commentId:await select(b)})).count,1);assert.ok(!b.logs.join().includes('SECRET'));
});
test('preference records expire and stay bounded to 48 entries',async()=>{
  const storage=new Map(),app=nativeRuntime(fixture(),{storage});
  // Exercise the same preference implementation with independently identified works.
  for(let i=0;i<55;i++)await app.sandbox.preferenceSelect(app.sandbox.multiSources(config),{s:app.sandbox.multiSources(config)[1].s,e:{title:'work'+i,year:'2024',kind:'movie',season:null}});
  const record=JSON.parse(storage.get('fusion-preference-v1'));assert.equal(Object.keys(record.items).length,48);
  for(const v of Object.values(record.items))v.expires=1;storage.set('fusion-preference-v1',JSON.stringify(record));
  const next=nativeRuntime(fixture(),{storage});await catalog(next);assert.equal(Object.keys(JSON.parse(storage.get('fusion-preference-v1')).items).length,0);
});
test('selected independent source falls back sequentially to proven same episode in a new VM, preserving exact data and original error',async()=>{
  const discovery=nativeRuntime(fixture()),id=await select(discovery,1),row={cid:'original',p:'12.345,5,16711680,u',m:' 原始内容😄 '};
  assert.equal(decoded(id)[0].a.length,1);
  const playback=nativeRuntime(fixture({comment:slot=>slot===1?{statusCode:503,data:{message:'SECRET'}}:{data:{comments:[row]}}}));
  const r=await playback.invoke('getComments',{...config,commentId:id});assert.equal(r.count,1);assert.deepEqual(JSON.parse(JSON.stringify(r.comments[0])),row);
  assert.equal(r.fallback.original.category,'SERVER');assert.equal(r.fallback.from,1);assert.equal(r.fallback.to,2);
  assert.ok(r.diagnostics.events.some(e=>e.status===503));assert.deepEqual(playback.calls.map(c=>new URL(c.url).hostname),['one.example','two.example']);
  assert.ok(!JSON.stringify(r.diagnostics).includes('SECRET'));
});
test('different episode/cut/language/hash/duration, indexed episode numbers and ambiguous episodes never qualify as fallback',async()=>{
  for(const bad of [{episodeTitle:'第13集'},{episodeTitle:'未知',episodeNumber:12},{durationSeconds:2401},{videoHash:'b'.repeat(64)},{edition:'extended'},{language:'en'},{episodeTitle:'第12集（上）'},{videoHash:undefined}]){
    const discovery=nativeRuntime(fixture({episodes:{2:[{...episode(12),...bad}]}})),id=await select(discovery,1);
    assert.equal((decoded(id)[0].a || []).length,0,JSON.stringify(bad));
    const playback=nativeRuntime(fixture({comment:()=>({statusCode:500,data:{}})}));await playback.invoke('getComments',{...config,commentId:id});assert.equal(playback.calls.length,1);
  }
  const a=nativeRuntime(fixture({episodes:{2:[episode(12),{...episode(12),episodeId:'other'}]}})),id=await select(a,1);assert.equal((decoded(id)[0].a || []).length,0);
});
test('a faster backup detail never makes a pending selected source disappear',async()=>{
  const base=fixture();let release;const blocked=new Promise(r=>release=r);
  const a=nativeRuntime(async(m,u)=>{if(new URL(u).hostname==='one.example' && u.includes('/bangumi/'))await blocked;return base(m,u);});
  const list=await catalog(a),anime=list.find(x=>x.animeTitle.endsWith('API 1'));let done=false;
  const request=a.invoke('getDetail',{...p,animeId:anime.animeId}).then(r=>{done=true;return r;});await tick();assert.equal(done,false);release();assert.ok((await request).length);
});
test('all failed fallbacks are attempted once, tasks/empty tracks may fall back, healthy empty seek windows do not',async()=>{
  const id=await select(nativeRuntime(fixture()),1);
  const bad=nativeRuntime(fixture({comment:()=>({statusCode:401,data:{}})}));const r=await bad.invoke('getComments',{...config,commentId:id});assert.equal(r.error.category,'AUTH');assert.equal(bad.calls.length,2);
  assert.ok(r.diagnostics.events.some(e=>e.code==='FALLBACK_FAILED'));
  for(const empty of [{comments:[]},{taskId:'pending',comments:[]}]){
    const app=nativeRuntime(fixture({comment:slot=>({data:slot===1?empty:{comments:[{cid:1,p:'12,1,255,u',m:'好'}]}})}));assert.equal((await app.invoke('getComments',{...config,commentId:id})).fallback.to,2);
  }
  const app=nativeRuntime(fixture()),seek=await app.invoke('getDanmuWithSegmentTime',{...config,commentId:id,segmentTime:600});assert.equal(seek.count,0);assert.equal(seek.fallback,undefined);assert.equal(app.calls.length,1);
});
test('fallback validates comment-time version conflicts and rejects manipulated or stale alternatives',async()=>{
  const id=await select(nativeRuntime(fixture()),1);
  const app=nativeRuntime(fixture({comment:slot=>slot===1?{statusCode:500,data:{}}:{data:{comments:[{p:'12,1,255',m:'wrong'}],durationSeconds:2401}}}));
  assert.equal((await app.invoke('getComments',{...config,commentId:id})).count,0);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='TIMELINE_CHANGED'));
  const refs=decoded(id);refs[0].a[0].p.number=13;
  const reject=nativeRuntime(fixture({comment:()=>({statusCode:500,data:{}})}));await reject.invoke('getComments',{...config,commentId:encoded(refs)});assert.equal(reject.calls.length,1);
  refs[0].a[0].s=refs[0].s;const cycle=nativeRuntime(fixture());const r=await cycle.invoke('getComments',{...config,commentId:encoded(refs)});assert.equal(r.error.code,'INVALID_SELECTION');assert.equal(cycle.calls.length,0);
});
test('HTTP categories, timeout, network, invalid formats and malicious native errors produce safe Chinese diagnostics',async()=>{
  const secret='https://private.example/SECRET?token=VERY_PRIVATE Authorization: Bearer KEY';
  const cases=[...[[401,'AUTH'],[403,'AUTH'],[404,'NOT_FOUND'],[500,'SERVER'],[503,'SERVER']].map(([status,code])=>[()=>({statusCode:status,data:{message:secret}}),code]),[()=>{throw {response:{status:403},message:secret};},'AUTH'],[()=>{throw {code:-1001,message:secret};},'TIMEOUT'],[()=>{throw Error(secret);},'NETWORK'],[()=>({data:'bad '+secret}),'INVALID_JSON'],[()=>({data:{comments:'bad',message:secret}}),'INVALID_COMMENTS'],[()=>{throw {fusionSafe:true,stage:secret,code:secret,message:secret};},'NETWORK']];
  for(const [handler,category] of cases){
    const a=nativeRuntime(handler),r=await a.invoke('getComments',{danmu_api_url:config.danmu_api_url,commentId:'E12'});assert.equal(r.error.category,category);assert.match(r.message,/[\u4e00-\u9fff]/);
    assert.ok(!/SECRET|VERY_PRIVATE|Bearer|private.example/.test(JSON.stringify(r.diagnostics)+a.logs.join()));
  }
  for(const address of ['bad SECRET','https://api.example:bad','https://api.example:70000','https://api.example/token%ZZ']){
    const invalid=nativeRuntime(fixture()),r=await invalid.invoke('getComments',{danmu_api_url:address,commentId:'E12'});assert.equal(r.error.code,'NO_API');assert.equal(invalid.calls.length,0);assert.ok(invalid.exports._test.compatDiagnostics().some(e=>e.code==='INVALID_ADDRESS'));
  }
});
test('no search result, no episode comments and unsafe aggregation have separate diagnostics',async()=>{
  const a=nativeRuntime(fixture({search:()=>({data:{animes:[]}})}));assert.ok((await a.invoke('searchDanmu',p)).diagnostics);assert.ok(a.exports._test.compatDiagnostics().some(e=>e.code==='NO_RESULTS'));
  const b=nativeRuntime(()=>({data:{comments:[]}}));await b.invoke('getComments',{danmu_api_url:config.danmu_api_url,commentId:1});assert.ok(b.exports._test.compatDiagnostics().some(e=>e.code==='NO_COMMENTS'));
  const c=nativeRuntime(fixture({episodes:{1:[{...episode(12),videoHash:undefined}],2:[{...episode(12),videoHash:undefined}]}})),list=await catalog(c),group=list.find(a=>a.animeTitle.includes('跨 API'));
  await c.invoke('getDetail',{...p,animeId:group.animeId});assert.ok(c.exports._test.compatDiagnostics().some(e=>e.code==='UNPROVEN_TIMELINE'));
});
test('many concurrent full loads/seeks share one request/parse and cannot poison the cache',async()=>{
  const rows=Array.from({length:4000},(_,i)=>({cid:i,p:i/2+',1,255,u',m:'原文'+i,extra:{value:i}}));
  let release;const gate=new Promise(r=>release=r);const app=nativeRuntime(async()=>{await gate;return {data:JSON.stringify({comments:rows})};}),params={danmu_api_url:config.danmu_api_url,commentId:'E12'};
  const jobs=Array.from({length:12},(_,i)=>app.invoke(i?'getDanmuWithSegmentTime':'getComments',{...params,...(i?{segmentTime:i*60}:{})}));await tick();release();const result=await Promise.all(jobs);
  assert.equal(app.calls.length,1);assert.equal(result[0].count,4000);assert.equal(app.exports._test.compatCacheStats().validations,1);
  result[0].comments[0].m='修改';result[0].comments[0].extra.value=-1;
  const next=await app.invoke('getDanmuWithSegmentTime',{...params,segmentTime:0});assert.equal(next.comments[0].m,'原文0');assert.equal(next.comments[0].extra.value,0);
  for(let i=0;i<60;i++)assert.equal((await app.invoke('getDanmuWithSegmentTime',{...params,segmentTime:i%20*60})).count,120);
  const stats=app.exports._test.compatCacheStats();assert.ok(stats.entries<=4);assert.ok(stats.bytes<=2*1024*1024);assert.equal(stats.pending,0);assert.equal(stats.commentJobs,0);assert.equal(app.calls.length,1);
});
test('220001-row full track/resume and simultaneous seeks preserve all original records while skipping oversized cache',async()=>{
  const rows=Array.from({length:220001},(_,i)=>({cid:i,p:i/50+',5,16711680,u',m:'弹幕'+i}));
  let release;const gate=new Promise(r=>release=r),app=nativeRuntime(async()=>{await gate;return {data:JSON.stringify({comments:rows})};}),params={danmu_api_url:config.danmu_api_url,commentId:'large'};
  const full=app.invoke('getComments',params),seek=app.invoke('getDanmuWithSegmentTime',{...params,segmentTime:600});await tick();release();
  const [a,b]=await Promise.all([full,seek]);assert.equal(a.count,rows.length);assert.equal(a.comments.at(-1).p,rows.at(-1).p);assert.equal(b.count,3000);assert.equal(app.calls.length,1);assert.equal(app.exports._test.compatCacheStats().entries,0);
  await app.invoke('getComments',params);assert.equal(app.calls.length,2);
});
test('cache expires, respects four entries and total budget, isolates continuous episode IDs',async()=>{
  const app=nativeRuntime(()=>({data:{comments:[{cid:1,p:'12,1,255',m:'原文'}]}})),params={danmu_api_url:config.danmu_api_url};
  for(let i=0;i<8;i++)await app.invoke('getComments',{...params,commentId:'E'+i});assert.equal(app.exports._test.compatCacheStats().entries,4);
  await app.invoke('getComments',{...params,commentId:'E0'});assert.equal(app.calls.length,9);
  app.sandbox.DateNowBackup=app.sandbox.Date; // Advance only Widget's Date, no timers supplied.
  const now=Date.now()+181000;app.sandbox.evalNow=now;
  const vm=await import('node:vm');vm.runInContext('Date.now=()=>evalNow',app.sandbox);
  await app.invoke('getComments',{...params,commentId:'E0'});assert.equal(app.calls.length,10);assert.equal(app.exports._test.compatCacheStats().entries,1);
});

test('numeric time formats keep original Number semantics and untrusted response diagnostics cannot escape',async()=>{
  const rows=[{cid:'hex',p:'0x10,5,255,u',m:'原文'},{cid:'sci',p:'1e2,1,255,u',m:'原文2'}];
  const app=nativeRuntime(()=>({data:{comments:rows,diagnostics:{url:'SECRET'},error:{code:'SECRET'},headers:{Authorization:'SECRET'}}}));
  const p={danmu_api_url:config.danmu_api_url,commentId:'E12'};
  const first=await app.invoke('getComments',p);assert.equal(first.diagnostics,undefined);assert.equal(first.error,undefined);assert.equal(first.headers,undefined);
  assert.equal((await app.invoke('getDanmuWithSegmentTime',{...p,segmentTime:0})).comments[0].p,rows[0].p);
  assert.equal((await app.invoke('getDanmuWithSegmentTime',{...p,segmentTime:60})).comments[0].p,rows[1].p);
});

test('distinct pending loads stop at twelve without an unbounded queue; completed calls release capacity',async()=>{
  let release;const gate=new Promise(r=>release=r),app=nativeRuntime(async()=>{await gate;return {data:{comments:[{cid:1,p:'12,1,255',m:'原文'}]}};});
  const jobs=Array.from({length:18},(_,i)=>app.invoke('getComments',{danmu_api_url:config.danmu_api_url,commentId:'E'+i}));await tick();
  assert.equal(app.calls.length,12);assert.equal(app.exports._test.compatCacheStats().commentJobs,12);release();
  const results=await Promise.all(jobs);assert.equal(results.filter(r=>r.count===1).length,12);assert.equal(results.filter(r=>r.error?.code==='BUSY').length,6);
  assert.equal(app.exports._test.compatCacheStats().commentJobs,0);
  assert.equal((await app.invoke('getComments',{danmu_api_url:config.danmu_api_url,commentId:'retry'})).count,1);
});

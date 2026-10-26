import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {nativeRuntime,media,standardFixture} from './native-test-support.mjs';
const urls=['https://one.example/proxy/Secret%2FONE/api/v2','https://two.example/Token-TWO','https://three.example/Token-THREE'];
const config={danmu_api_url:urls[0],danmu_api_url_2:urls[1],danmu_api_url_3:urls[2]};
const params={...media,...config};
const hash='a'.repeat(64);
const clone=v=>JSON.parse(JSON.stringify(v));
const tick=()=>new Promise(resolve=>setImmediate(resolve)); // Test host only, never inside Widget.
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
  return async(method,address,body,request)=>{
    const u=new URL(address),index=['one.example','two.example','three.example'].indexOf(u.hostname);
    if(options.intercept){const result=await options.intercept(index,u,method,body,request);if(result!==undefined)return result;}
    if(u.pathname.endsWith('/match'))return {data:{matches:[]}};
    if(u.pathname.includes('/search/'))return {data:{animes:options.candidates?.[index] || [{animeId:42,animeTitle:'测试剧 S02 (2024)',type:'tvseries',startDate:'2024-01-01',...options.candidate?.[index]}]}};
    if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:options.episodes?.[index] || [{episodeId:'E12',episodeTitle:'第12集',durationSeconds:2400,videoHash:hash}]}}};
    if(u.pathname.includes('/comment/'))return {data:{comments:options.comments?.[index] || [{cid:7,p:'12,1,255,u',m:'API '+(index+1)}],...options.commentData?.[index]}};
    return {statusCode:404,data:{}};
  };
}
async function catalog(app,p=params){let result=await app.invoke('searchDanmu',p);await tick();result=await app.invoke('searchDanmu',p);return result.animes;}
async function details(app,id,p=config){let result=await app.invoke('getDetail',{...p,animeId:id});await tick();result=await app.invoke('getDetail',{...p,animeId:id});return result;}
async function aggregate(app,p=params){const animes=await catalog(app,p),group=animes.find(a=>a.animeTitle.includes('跨 API'));assert.ok(group,'cross-API selector');const episodes=await details(app,group.animeId,p);return {animes,episodes,selected:episodes.find(e=>e.episodeTitle.includes('安全聚合'))};}

test('public metadata exposes three address inputs and preserves upgrade key and registration',()=>{
  const app=nativeRuntime(fixture());
  assert.deepEqual(Array.from(app.metadata.globalParams,p=>p.name),['danmu_api_url','danmu_api_url_2','danmu_api_url_3']);
  assert.ok(app.metadata.globalParams.every(p=>p.type==='input'));
  assert.ok(app.metadata.modules.every(m=>m.params.length===0 && m.cacheDuration===0));
  assert.equal(app.metadata.version,'1.5.1');assert.equal(app.metadata.id,'tzb360.danmu.fusion');
  for(const key of ['setTimeout','fetch','URL','AbortController','Buffer','process'])assert.equal(app.sandbox[key],undefined);
});
test('one API, empty optional slots and legacy server alias retain real IDs and comment-only playback',async()=>{
  for(const cfg of [{danmu_api_url:urls[0]},{danmu_api_url:urls[0],danmu_api_url_2:'  ',danmu_api_url_3:''},{server:urls[0]}]){
    const app=nativeRuntime(fixture()),p={...media,danmu_api_url:undefined,...cfg};
    const s=await app.invoke('searchDanmu',p);assert.equal(s.animes[0].animeId,42);
    const d=await app.invoke('getDetail',{...cfg,animeId:42});assert.equal(d[0].episodeId,'E12');
    assert.equal((await app.invoke('getComments',{...cfg,commentId:'E12'})).count,1);
  }
});
test('two and three APIs independently search colliding IDs and return distinct routed selections',async()=>{
  for(const count of [2,3]){
    const p={...params,danmu_api_url_3:count===3?urls[2]:''},app=nativeRuntime(fixture());
    const animes=await catalog(app,p),individual=animes.filter(a=>!a.animeTitle.includes('跨 API'));
    assert.equal(individual.length,count);assert.equal(new Set(individual.map(a=>a.animeId)).size,count);
    assert.equal(new Set(app.calls.filter(c=>c.url.includes('/search/anime')).map(c=>new URL(c.url).hostname)).size,count);
    for(let i=0;i<count;i++){
      const selected=individual.find(a=>a.animeTitle.endsWith('API '+(i+1)));
      const episodes=await app.invoke('getDetail',{...p,animeId:selected.animeId});
      const playback=nativeRuntime(fixture()); // Entirely new VM, no shared storage or media context.
      const result=await playback.invoke('getComments',{...p,title:undefined,seriesName:undefined,commentId:episodes[0].episodeId});
      assert.equal(result.comments[0].m,'API '+(i+1));
      assert.equal(new URL(playback.calls[0].url).hostname,new URL(urls[i]).hostname);
    }
  }
});
test('normalization deduplicates roots and suffixes without changing proxy, token, or query encoding',async()=>{
  const app=nativeRuntime(fixture()),p={...params,danmu_api_url:'HTTPS://ONE.EXAMPLE:443/proxy/Secret%2FONE/api/v2/',danmu_api_url_2:'https://one.example/proxy/Secret%2FONE',danmu_api_url_3:''};
  const animes=await app.invoke('searchDanmu',p);assert.equal(animes.animes[0].animeId,42);assert.equal(app.calls.length,1);
  const q=nativeRuntime(fixture());await q.invoke('searchDanmu',{...params,danmu_api_url:'https://one.example/proxy/A%2fb/api/v2?token=X%2FY%2bZ&signature=a+b',danmu_api_url_2:'',danmu_api_url_3:''});
  assert.ok(q.calls[0].url.includes('/proxy/A%2fb/api/v2/search/anime?'));
  assert.ok(q.calls[0].url.endsWith('&token=X%2FY%2bZ&signature=a+b'));
  const old=nativeRuntime(fixture());await old.invoke('searchDanmu',{...params,danmu_api_url:'https://one.example/p/api/forward/danmaku?title=old&token=K%2FB',danmu_api_url_2:'',danmu_api_url_3:''});
  assert.ok(old.calls[0].url.endsWith('&token=K%2FB'));assert.ok(!old.calls[0].url.includes('title=old'));
});
test('distinct path case, query tokens and percent escapes are not accidentally deduplicated',async()=>{
  const app=nativeRuntime(fixture());await catalog(app,{...params,danmu_api_url:'https://one.example/T%2f?token=A',danmu_api_url_2:'https://one.example/T%2F?token=B',danmu_api_url_3:'https://one.example/t%2f?token=A'});
  assert.equal(app.calls.filter(c=>c.url.includes('/search/anime')).length,3);
});
test('invalid primary, empty peers and optional-only configuration isolate address failures',async()=>{
  const app=nativeRuntime(fixture()),p={...params,danmu_api_url:'not a URL',danmu_api_url_3:''};
  const s=await app.invoke('searchDanmu',p);assert.ok(s.animes.length);
  const d=await app.invoke('getDetail',{...p,animeId:s.animes[0].animeId});
  assert.equal((await app.invoke('getComments',{...p,commentId:d[0].episodeId})).comments[0].m,'API 2');
  const empty=nativeRuntime(fixture());assert.equal((await empty.invoke('searchDanmu',{})).animes.length,0);assert.equal(empty.calls.length,0);
});
test('candidate filtering remains independent: different works, years, seasons, types and derivatives never mix',async()=>{
  const app=nativeRuntime(fixture({candidates:[
    [{animeId:42,animeTitle:'测试剧 S02 (2024)',type:'tvseries'}],
    [{animeId:42,animeTitle:'另一个作品 S02 (2024)',type:'tvseries'}],
    [{animeId:42,animeTitle:'测试剧 S03 (2024)',type:'tvseries'},{animeId:43,animeTitle:'测试剧 S02 解说 (2024)',type:'tvseries'},{animeId:44,animeTitle:'测试剧 (2024)',type:'movie'}]
  ]}));
  const animes=await catalog(app);assert.equal(animes.length,1);assert.ok(animes[0].animeTitle.endsWith('API 1'));
});
test('HTTP 500, auth failure, malformed JSON, timeout and empty API cannot discard healthy peers',async()=>{
  const failures=[()=>({statusCode:500,data:{}}),()=>({statusCode:401,data:{}}),()=>({statusCode:403,data:{}}),()=>({data:'broken TOKEN'}),()=>{throw {code:-1001,message:'Secret%2FONE'};},()=>({data:{animes:[]}})];
  for(const fail of failures){
    const app=nativeRuntime(fixture({intercept:i=>i===0?fail():undefined}));const animes=await catalog(app);
    assert.ok(animes.some(a=>a.animeTitle.endsWith('API 2')));assert.ok(!app.logs.join().includes('Secret%2FONE'));
  }
});
test('all unavailable APIs return diagnostics and empty public results',async()=>{
  const app=nativeRuntime(()=>({statusCode:503,data:{}}));assert.equal((await app.invoke('searchDanmu',params)).animes.length,0);
  assert.equal(app.calls.length,3);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='HTTP_STATUS'));
});
test('a never-resolving cold search does not hold fast results; pending jobs stay bounded',async()=>{
  const never=new Promise(()=>{}),app=nativeRuntime(fixture({intercept:i=>i===1?never:undefined}));
  const result=await Promise.race([app.invoke('searchDanmu',params),new Promise((_,reject)=>setTimeout(()=>reject(Error('blocked by slow API')),300))]);
  assert.ok(result.animes.length);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='PARTIAL'));
  await app.invoke('searchDanmu',params);
  for(let i=0;i<15;i++)await app.invoke('searchDanmu',{...params,title:'不同搜索'+i});
  assert.equal(app.calls.filter(c=>new URL(c.url).hostname==='two.example').length,2);
});
test('late search responses join a later search without repeating cold requests',async()=>{
  const late=deferred(),app=nativeRuntime(fixture({intercept:(i,u)=>i===1&&u.pathname.includes('/search/')?late.promise:undefined}));
  const initial=await app.invoke('searchDanmu',params);assert.ok(!initial.animes.some(a=>a.animeTitle.endsWith('API 2')));
  late.resolve({data:{animes:[{animeId:42,animeTitle:'测试剧 S02 (2024)',type:'tvseries'}]}});await tick();
  const result=await app.invoke('searchDanmu',params);assert.ok(result.animes.some(a=>a.animeTitle.endsWith('API 2')));
  assert.equal(app.calls.filter(c=>new URL(c.url).hostname==='two.example').length,1);
});
test('source fingerprints match SHA-256 and IDs, logs and cache keys do not expose tokens',async()=>{
  const app=nativeRuntime(fixture()),animes=await catalog(app);
  for(const candidate of animes){
    assert.ok(!candidate.animeId.includes('Token'));assert.ok(!candidate.animeId.includes('Secret'));
    const refs=JSON.parse(decodeURIComponent(candidate.animeId.split(':').slice(2).join(':')));
    for(const ref of refs)assert.ok(urls.some(url=>crypto.createHash('sha256').update(url.replace(/\/api\/v2$/,'')).digest('hex')===ref.s));
  }
  const keys=Array.from(app.storage.keys()).join('\n');assert.ok(!/Secret|Token|https?:/.test(keys));
  assert.ok(!/Secret|Token|https?:/.test(app.logs.join('\n')));
});
test('reordering API slots preserves routes across VM restart, changed/removed addresses fail closed',async()=>{
  const app=nativeRuntime(fixture()),animes=await catalog(app),a=animes.find(a=>a.animeTitle.endsWith('API 2'));
  const reordered={danmu_api_url:urls[2],danmu_api_url_2:urls[0],danmu_api_url_3:urls[1]},next=nativeRuntime(fixture());
  const d=await next.invoke('getDetail',{...reordered,animeId:a.animeId});
  const last=nativeRuntime(fixture());assert.equal((await last.invoke('getComments',{...reordered,commentId:d[0].episodeId})).comments[0].m,'API 2');
  const changed=nativeRuntime(fixture());assert.equal((await changed.invoke('getComments',{...reordered,danmu_api_url_3:'https://two.example/new-token',commentId:d[0].episodeId})).count,0);assert.equal(changed.calls.length,0);
  assert.ok(changed.exports._test.compatDiagnostics().some(e=>e.code==='SOURCE_CHANGED'));
});
test('bare historical IDs are rejected in multi-API mode instead of guessing by ID or slot',async()=>{
  const app=nativeRuntime(fixture());assert.equal((await app.invoke('getDetail',{...config,animeId:42})).length,0);
  assert.equal((await app.invoke('getComments',{...config,commentId:'E12'})).count,0);assert.equal(app.calls.length,0);
  assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='AMBIGUOUS_LEGACY_ID'));
});
test('single API URL changes require fresh search/detail before old bare selections are reused',async()=>{
  const storage=new Map(),first=nativeRuntime(fixture(),{storage});await first.invoke('searchDanmu',{...media,danmu_api_url:urls[0]});
  const second=nativeRuntime(fixture(),{storage}),cfg={danmu_api_url:urls[1]};
  assert.equal((await second.invoke('getComments',{...cfg,commentId:'E12'})).count,0);assert.equal(second.calls.length,0);
  const s=await second.invoke('searchDanmu',{...media,...cfg});assert.ok(s.animes.length);
  const d=await second.invoke('getDetail',{...cfg,animeId:42});assert.ok(d.length);assert.equal((await second.invoke('getComments',{...cfg,commentId:d[0].episodeId})).count,1);
});
test('group details with proven same episode/hash/duration expose safe aggregation plus each individual source',async()=>{
  const app=nativeRuntime(fixture()),{episodes,selected}=await aggregate(app);
  assert.ok(selected);assert.equal(episodes.filter(e=>!e.episodeTitle.includes('安全聚合')).length,3);
  let result=await app.invoke('getComments',{...config,commentId:selected.episodeId});await tick();result=await app.invoke('getComments',{...config,commentId:selected.episodeId});
  assert.equal(result.count,3);assert.deepEqual(Array.from(result.comments,c=>c.m).sort(),['API 1','API 2','API 3']);
  assert.equal(new Set(result.comments.map(c=>c.cid)).size,3);assert.ok(result.comments.every(c=>c.p==='12,1,255,u'));
});
test('fresh VM end-to-end: multi search → group choice → episodes → only commentId → three correct APIs',async()=>{
  const a=nativeRuntime(fixture()),animes=await catalog(a),id=animes.find(v=>v.animeTitle.includes('跨 API')).animeId;
  const b=nativeRuntime(fixture()),episodes=await details(b,id),episode=episodes.find(e=>e.episodeTitle.includes('安全聚合'));assert.ok(episode);
  const c=nativeRuntime(fixture());let result=await c.invoke('getComments',{...config,commentId:episode.episodeId});await tick();result=await c.invoke('getComments',{...config,commentId:episode.episodeId});
  assert.equal(result.count,3);assert.equal(new Set(c.calls.map(c=>new URL(c.url).hostname)).size,3);
  assert.ok(c.calls.every(c=>c.url.includes('/comment/E12?async=1&withRelated=true')));
});
test('movies require the same release, cut, language, duration and timeline evidence',async()=>{
  const p={...params,title:'测试电影',seriesName:'测试电影',type:'movie',year:2024,season:0,episode:0};
  const candidate=urls.map(()=>({animeTitle:'测试电影(2024)',type:'movie'}));
  const good={episodeId:'film',episodeTitle:'正片',durationSeconds:7200,videoHash:hash};
  const app=nativeRuntime(fixture({candidate,episodes:[[good],[good],[good]]}));assert.ok((await aggregate(app,p)).selected);
  for(const bad of [{durationSeconds:7201},{videoHash:'b'.repeat(64)},{edition:'导演剪辑版'},{language:'en'},{durationSeconds:undefined},{videoHash:undefined,timelineId:'default'},{episodeTitle:'预告片'}]){
    const a=nativeRuntime(fixture({candidate,episodes:[[good],[{...good,...bad}],[]]}));
    const {episodes}=await aggregate(a,{...p,danmu_api_url_3:''});
    assert.ok(!episodes.some(e=>e.episodeTitle.includes('安全聚合')),JSON.stringify(bad));assert.equal(episodes.length,2);
  }
});
test('TV episode number, season, specials and unknown timeline evidence prevent aggregation',async()=>{
  const good={episodeId:'E12',episodeTitle:'第12集',durationSeconds:2400,videoHash:hash};
  for(const bad of [{episodeTitle:'第13集'},{episodeTitle:'S03 第12集'},{season:3},{episodeTitle:'SP 第12集'},{episodeTitle:'第12集 上篇'},{episodeTitle:'未知标题',episodeNumber:12},{durationSeconds:undefined},{videoHash:undefined}]){
    const app=nativeRuntime(fixture({episodes:[[good],[{...good,...bad}],[]]})),p={...params,danmu_api_url_3:''};
    const {episodes}=await aggregate(app,p);assert.ok(!episodes.some(e=>e.episodeTitle.includes('安全聚合')),JSON.stringify(bad));assert.equal(episodes.length,2);
  }
});
test('official identical video URLs plus duration can prove a timeline, generic API/catalog URLs cannot',async()=>{
  for(const [url,allowed]of [['https://v.qq.com/x/cover/abc/def.html',true],['https://unrelated.example/123',false],['https://v.qq.com.evil.example/video',false]]){
    const e={episodeId:'E12',episodeTitle:'第12集',duration:2400,url};
    const app=nativeRuntime(fixture({episodes:[[e],[e],[]]})),group=await aggregate(app,{...params,danmu_api_url_3:''});
    assert.equal(Boolean(group.selected),allowed,url);
  }
});
test('conflicting TMDB IDs, missing years/types, editions or languages do not create cross-API work groups',async()=>{
  for(const changes of [{tmdbId:'999'},{animeTitle:'测试剧 S02',startDate:undefined},{type:undefined},{edition:'extended'},{language:'en'}]){
    const app=nativeRuntime(fixture({candidate:[{tmdbId:'123'},changes,{}]}));
    const animes=await catalog(app,{...params,danmu_api_url_3:''});assert.ok(!animes.some(a=>a.animeTitle.includes('跨 API')),JSON.stringify(changes));
  }
});
test('cross-API dedupe uses proven upstream IDs and exact p/m; independent audience and styles survive',async()=>{
  const record={source:'tencent',sourceCommentId:'upstream-123',cid:1,p:'12,1,255,u',m:'哈哈哈'};
  const app=nativeRuntime(fixture({comments:[
    [record,{...record,sourceCommentId:'viewer-2',cid:2}],
    [{...record,cid:999},{...record,sourceCommentId:'viewer-3',cid:3},{...record,p:'13,1,255,u',cid:4},{...record,p:'12,5,255,u',cid:5}],
    [{cid:1,p:record.p,m:record.m}]
  ]}));
  const {selected}=await aggregate(app);let result=await app.invoke('getComments',{...config,commentId:selected.episodeId});await tick();result=await app.invoke('getComments',{...config,commentId:selected.episodeId});
  assert.equal(result.count,6);assert.equal(result.comments.filter(c=>c.p==='12,1,255,u').length,4);
});
test('native aggregated records with namespaced upstream IDs are not imported twice',async()=>{
  const r={cid:'tencent:42',p:'12,1,255,u',m:'同一个上游记录'},q={cid:'iqiyi:42',p:'12,1,255,u',m:'不同观众'};
  const app=nativeRuntime(fixture({comments:[[r,q],[r],[q]]})),{selected}=await aggregate(app);
  await app.invoke('getComments',{...config,commentId:selected.episodeId});await tick();const result=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.equal(result.count,2);
});
test('unknown-provenance equal IDs and equal text across APIs are retained',async()=>{
  const r={cid:7,p:'12,1,255,u',m:'哈哈哈哈'};
  const app=nativeRuntime(fixture({comments:[[r],[r],[r]]})),{selected}=await aggregate(app);
  await app.invoke('getComments',{...config,commentId:selected.episodeId});await tick();assert.equal((await app.invoke('getComments',{...config,commentId:selected.episodeId})).count,3);
});
test('comment timeout/auth/invalid JSON and changed timeline degrade to a proven healthy member',async()=>{
  for(const response of [()=>({statusCode:500,data:{}}),()=>{throw {name:'TimeoutError'};},()=>({data:'bad'}),()=>({data:{comments:[],durationSeconds:999}})]){
    const app=nativeRuntime(fixture({intercept:(i,u)=>i===1&&u.pathname.includes('/comment/')?response():undefined})),{selected}=await aggregate(app);
    const result=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.ok(result.count>=1);assert.ok(!result.comments.some(c=>c.m==='API 2'));
  }
});
test('a pending comment peer cannot delay playback; seek callbacks route and preserve original times',async()=>{
  let block=false;const app=nativeRuntime(fixture({intercept:(i,u)=>block&&i===1&&u.pathname.includes('/comment/')?new Promise(()=>{}):undefined})),{selected}=await aggregate(app);block=true;
  const result=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.ok(result.count>=1);
  const seek=await app.invoke('getDanmuWithSegmentTime',{...config,commentId:selected.episodeId,segmentTime:0});assert.ok(seek.count>=1);assert.ok(seek.comments.every(c=>c.p==='12,1,255,u'));
});
test('malformed/stale/legacy aggregate IDs fail safely without probing an API',async()=>{
  for(const id of ['df15:c:%invalid','df15:a:%5B%5D','fusion-track:old',-1500000001]){
    const app=nativeRuntime(fixture());const r=await app.invoke('getComments',{...config,commentId:id});assert.equal(r.count,0);assert.equal(app.calls.length,0);
  }
});
test('large API tracks retain 220001 valid rows through an independent routed source and skip large caching',async()=>{
  const rows=Array.from({length:220001},(_,i)=>({cid:i,p:(i/50)+',1,255,u',m:'弹幕'+i}));
  const app=nativeRuntime(fixture({comments:[rows,[{cid:1,p:'12,5,255,u',m:'API 2'}],[]]})),{episodes}=await aggregate(app,{...params,danmu_api_url_3:''});
  const selected=episodes.find(e=>e.episodeTitle.endsWith('API 1'));
  const result=await app.invoke('getComments',{...config,commentId:selected.episodeId});
  assert.equal(result.count,220001);assert.equal(result.comments.at(-1).p,rows.at(-1).p);
  const calls=app.calls.length;await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.equal(app.calls.length,calls+1);
});
test('50万 per-track capacity and aggregate overflow preserve one complete healthy source',async()=>{
  const rows=Array.from({length:250001},(_,i)=>({cid:i,p:'12,1,255,u',m:'a'+i}));
  const app=nativeRuntime(fixture({comments:[rows,rows,[]]})),{selected}=await aggregate(app,{...params,danmu_api_url_3:''});
  await app.invoke('getComments',{...config,commentId:selected.episodeId});await tick();const r=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.equal(r.count,250001);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='MERGE_CAPACITY'));
});


test('multi-API search, details and comments never read retired technical parameters',async()=>{
  const p={...params};
  for(const key of ['api_mode','aggregate','sources','source_priority','dedupe','dedupe_tolerance','offset_owner','offset_rules','cache_ttl','timeout','retry','cache','color_to_white','force_scroll','debug'])Object.defineProperty(p,key,{get(){throw Error('obsolete');}});
  const app=nativeRuntime(fixture()),s=await app.invoke('searchDanmu',p);assert.ok(s.animes.length);
  const a=s.animes.find(a=>a.animeTitle.endsWith('API 1')),d=await app.invoke('getDetail',Object.defineProperties({animeId:a.animeId},Object.getOwnPropertyDescriptors(p)));
  const c=Object.defineProperties({commentId:d[0].episodeId},Object.getOwnPropertyDescriptors(p));assert.equal((await app.invoke('getComments',c)).count,1);
});
test('aggregate cid stays stable between a partial first load and complete progress load',async()=>{
  const late=deferred();let delay=false;
  const app=nativeRuntime(fixture({intercept:(i,u)=>delay&&i===1&&u.pathname.includes('/comment/')?late.promise:undefined}));
  const {selected}=await aggregate(app,{...params,danmu_api_url_3:''});delay=true;
  const first=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.equal(first.count,1);
  late.resolve({data:{comments:[{cid:7,p:'12,1,255,u',m:'API 2'}]}});await tick();
  const next=await app.invoke('getDanmuWithSegmentTime',{...config,commentId:selected.episodeId,segmentTime:0});
  assert.equal(next.count,2);assert.equal(next.comments.find(c=>c.m==='API 1').cid,first.comments[0].cid);
});
test('parallel persisted lookup writes keep a bounded manifest without token-bearing keys',async()=>{
  const storage=new Map(),app=nativeRuntime(fixture({candidates:urls.map(()=>Array.from({length:32},(_,i)=>({animeId:i,animeTitle:'测试剧 S02 (2024)',type:'tvseries'})))}),{storage});
  await catalog(app);await tick();
  const lookups=Array.from(storage.keys()).filter(k=>k.startsWith('fusion-compat-v1:lookup:'));
  assert.ok(lookups.length<=32);assert.ok(lookups.every(k=>!k.includes('Token')));
});

test('a valid empty seek window returns without waiting on a stalled peer',async()=>{
  let delay=false;const app=nativeRuntime(fixture({intercept:(i,u)=>delay&&i===1&&u.pathname.includes('/comment/')?new Promise(()=>{}):undefined}));
  const {selected}=await aggregate(app,{...params,danmu_api_url_3:''});delay=true;
  const r=await app.invoke('getDanmuWithSegmentTime',{...config,commentId:selected.episodeId,segmentTime:600});assert.equal(r.count,0);assert.notEqual(r.success,false);
});
test('an over-capacity API response is isolated while another source remains playable',async()=>{
  const app=nativeRuntime(fixture({comments:[new Array(500001),[{cid:1,p:'12,1,255,u',m:'健康来源'}],[]]}));
  const {selected}=await aggregate(app,{...params,danmu_api_url_3:''});const r=await app.invoke('getComments',{...config,commentId:selected.episodeId});assert.equal(r.count,1);assert.equal(r.comments[0].m,'健康来源');
  assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='TOO_MANY_COMMENTS'));
});

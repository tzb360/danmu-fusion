import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRuntime,media} from './native-test-support.mjs';
const url='https://api.example/private-token';
const config={danmu_api_url:url};
const work={animeId:42,animeTitle:'测试剧 S02 (2024) from tencent&iqiyi&custom_provider',type:'tvseries',startDate:'2024-01-01',source:'tencent',mergedChildren:[{source:'iqiyi'},{source:'custom_provider'}]};
const episodes=[
 {episodeId:'one',episodeTitle:'【tencent&iqiyi&custom_provider】 第1集'},
 {episodeId:'two',episodeTitle:'【iqiyi&custom_provider】 第2集'},
 {episodeId:'three',episodeTitle:'【custom_provider】 第3集'},
 {episodeId:'four',episodeTitle:'【youku&migu&animeko&new_platform】 第4集'}
];
const codes={one:['tencent','iqiyi','custom_provider'],two:['iqiyi','custom_provider'],three:['custom_provider'],four:['youku','migu','animeko','new_platform']};
function fixture({candidate=work,detail=episodes,actual=codes,intercept}={}){
 return async(method,address)=>{
  const u=new URL(address);if(intercept){const r=await intercept(u);if(r!==undefined)return r;}
  if(u.pathname.includes('/search/'))return {data:{animes:[candidate,{...candidate,animeId:43,animeTitle:'测试剧 S02 (2024) from iqiyi',source:'iqiyi',mergedChildren:[]}]}};
  if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:detail}}};
  if(u.pathname.includes('/comment/')){
   const id=decodeURIComponent(u.pathname.split('/').at(-1));
   return {data:{comments:(actual[id] || []).map((source,i)=>({cid:source+':'+id,p:'12.34,5,16711680,['+source+']',m:'原样弹幕 '+i}))}};
  }
  return {statusCode:404,data:{}};
 };
}
const params=(episode=1)=>({...media,...config,episode});
test('public selection offers aggregation only, with platforms for the current episode',async()=>{
 const app=nativeRuntime(fixture()),s=await app.invoke('searchDanmu',params());
 assert.equal(s.animes.length,1);assert.equal(s.animes[0].source,'聚合');assert.equal(s.animes[0].platformLabel,'腾讯&爱奇艺&custom_provider');assert.ok(!s.animes.some(a=>a.animeTitle.includes('from iqiyi')));
 assert.ok(app.calls.some(c=>c.url.includes('/comment/one?async=1&withRelated=true')));
});
test('changing episodes recomputes the platform subset, including a missing previous primary, one provider, and new providers',async()=>{
 const storage=new Map();
 for(const [number,expected] of [[1,codes.one],[2,codes.two],[3,codes.three],[4,codes.four]]){
  const app=nativeRuntime(fixture(),{storage}),s=await app.invoke('searchDanmu',params(number));
  assert.equal(s.animes.length,1);assert.deepEqual(Array.from(s.animes[0].platforms),expected);
  if(number===2)assert.ok(!s.animes[0].platformLabel.includes('腾讯'));
  if(number===3)assert.match(s.animes[0].animeTitle,/本集仅1个平台/);
 }
});
test('each detail row shows its own platform combination without single-platform source choices',async()=>{
 const app=nativeRuntime(fixture());await app.invoke('searchDanmu',params());
 const rows=await app.invoke('getDetail',{...config,animeId:42});
 assert.equal(rows.length,4);assert.ok(rows.every(e=>e.source==='聚合'));
 assert.equal(rows[1].platformLabel,'爱奇艺&custom_provider');assert.equal(rows[3].platformLabel,'优酷&咪咕&Animeko&new_platform');
 assert.deepEqual(Array.from(rows,e=>e.episodeId),['one','two','three','four']);
});
test('failed or empty provider does not remain in the displayed successful platform list',async()=>{
 const app=nativeRuntime(fixture({actual:{...codes,one:['iqiyi','custom_provider']}})),s=await app.invoke('searchDanmu',params());
 assert.equal(s.animes[0].platformLabel,'爱奇艺&custom_provider');
 const d=await app.invoke('getDetail',{...config,animeId:42});assert.equal(d[0].platformLabel,'爱奇艺&custom_provider');
});
test('same-minute seeks reuse prepared comments and never alter time, style or original text',async()=>{
 const app=nativeRuntime(fixture());const s=await app.invoke('searchDanmu',params());
 const d=await app.invoke('getDetail',{...params(),animeId:s.animes[0].animeId});
 const r=await app.invoke('getComments',{...config,commentId:d[0].episodeId});
 for(let i=0;i<30;i++){const window=await app.invoke('getDanmuWithSegmentTime',{...params(),commentId:d[0].episodeId,segmentTime:0});assert.deepEqual(JSON.parse(JSON.stringify(window.comments)),JSON.parse(JSON.stringify(r.comments)));}
 assert.equal(app.calls.filter(c=>c.url.includes('/comment/one')).length,1);
 assert.ok(r.comments.every(c=>c.p.startsWith('12.34,5,16711680,') && c.m.startsWith('原样弹幕 ')));
});
test('a fresh VM restores bounded per-episode platform metadata without borrowing another episode',async()=>{
 const storage=new Map(),first=nativeRuntime(fixture(),{storage});await first.invoke('searchDanmu',params(1));
 const second=nativeRuntime(fixture(),{storage}),d=await second.invoke('getDetail',{...config,animeId:42});
 assert.equal(d[0].platformLabel,'腾讯&爱奇艺&custom_provider');assert.equal(d[1].platformLabel,'爱奇艺&custom_provider');
 const text=storage.get('fusion-aggregate-v1:manifests');assert.ok(!text.includes('private-token'));assert.ok(text.length<=48000);
});
test('empty current episode is not advertised as a successful aggregation',async()=>{
 const app=nativeRuntime(fixture({actual:{...codes,two:[]}})),s=await app.invoke('searchDanmu',params(2));assert.equal(s.animes.length,0);assert.match(s.message,/当前集/);
});
test('movie platforms are dynamic and never inherit TV episode state',async()=>{
 const candidate={...work,animeTitle:'测试电影(2024) from migu&custom_movie',type:'movie',source:'migu',mergedChildren:[{source:'custom_movie'}]};
 const app=nativeRuntime(fixture({candidate,detail:[{episodeId:'film',episodeTitle:'【migu&custom_movie】 正片'}],actual:{film:['migu','custom_movie']}}));
 const s=await app.invoke('searchDanmu',{...params(),title:'测试电影',seriesName:'测试电影',type:'movie',season:0,episode:0});
 assert.equal(s.animes.length,1);assert.equal(s.animes[0].platformLabel,'咪咕&custom_movie');
});
test('changing source credentials invalidates old platform manifests and routing',async()=>{
 const storage=new Map(),a=nativeRuntime(fixture(),{storage});await a.invoke('searchDanmu',params());
 const b=nativeRuntime(fixture({actual:{...codes,one:['new_provider','other_provider']}}),{storage});
 const s=await b.invoke('searchDanmu',{...params(),danmu_api_url:'https://api.example/new-credentials'});assert.equal(s.animes[0].platformLabel,'new_provider&other_provider');
});
test('a fast single-platform API cannot hide a slower API providing native aggregation',async()=>{
 let release;const delayed=new Promise(r=>release=r),app=nativeRuntime(fixture({intercept:u=>u.hostname==='api.example' && u.pathname.includes('/search/')?delayed:u.hostname==='fast.example' && u.pathname.includes('/search/')?{data:{animes:[{...work,mergedChildren:[],animeTitle:'测试剧 S02 (2024) from youku',source:'youku'}]}}:undefined}));
 const p={...params(),danmu_api_url_2:'https://fast.example/private-two'},pending=app.invoke('searchDanmu',p);await new Promise(setImmediate);release({data:{animes:[work]}});
 const s=await pending;assert.ok(s.animes.length);assert.ok(s.animes.every(a=>a.source==='聚合' && !a.animeTitle.includes('from youku')));
});
test('proven cross-API aggregation waits for all current contributors, exposes no member choices and lists successful platforms',async()=>{
 let release;const gate=new Promise(r=>release=r),proof={episodeId:'E1',episodeTitle:'第1集',durationSeconds:2400,videoHash:'a'.repeat(64)};
 const app=nativeRuntime(async(method,address)=>{
  const u=new URL(address),source=u.hostname==='api.example'?'tencent':'future_api';
  if(u.pathname.includes('/search/'))return {data:{animes:[{...work,source,animeTitle:'测试剧 S02 (2024) from '+source,mergedChildren:[]}]}};
  if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:[proof]}}};
  if(source==='future_api')await gate;
  return {data:{comments:[{cid:source,p:'10,1,255,['+source+']',m:source}]}};
 });
 let complete=false;const pending=app.invoke('searchDanmu',{...params(),danmu_api_url_2:'https://two.example/token'}).then(r=>{complete=true;return r;});
 for(let i=0;i<8;i++)await new Promise(setImmediate);assert.equal(complete,false);release();
 const result=await pending;assert.equal(result.animes.length,1);assert.equal(result.animes[0].platformLabel,'腾讯&future_api');
 const detail=await app.invoke('getDetail',{...config,danmu_api_url_2:'https://two.example/token',animeId:result.animes[0].animeId});assert.equal(detail.length,1);assert.equal(detail[0].source,'聚合');
});
test('unproven cross-API episodes are rejected without exposing individual-platform choices',async()=>{
 const app=nativeRuntime(async(method,address)=>{const u=new URL(address);return u.pathname.includes('/search/')?{data:{animes:[{...work,animeTitle:'测试剧 S02 (2024)',mergedChildren:[]}]}}:{data:{bangumi:{episodes:[{episodeId:'E1',episodeTitle:'第1集'}]}}};});
 const result=await app.invoke('searchDanmu',{...params(),danmu_api_url_2:'https://two.example/token'});assert.equal(result.animes.length,0);assert.match(result.message,/可验证/);
});
test('platform manifests are bounded, expire and cannot replace newly observed per-episode providers',async()=>{
 const storage=new Map(),detail=Array.from({length:38},(_,i)=>({episodeId:'n'+i,episodeTitle:'【a&b】 第'+(i+1)+'集'})),actual=Object.fromEntries(detail.map(e=>[e.episodeId,['a','b']]));
 const app=nativeRuntime(fixture({detail,actual}),{storage});
 for(let i=1;i<=38;i++)await app.invoke('searchDanmu',params(i));
 const saved=JSON.parse(storage.get('fusion-aggregate-v1:manifests'));assert.ok(saved.length<=32);assert.ok(JSON.stringify(saved).length<=48000);
 for(const pair of saved)pair[1].expires=1;storage.set('fusion-aggregate-v1:manifests',JSON.stringify(saved));
 const next=nativeRuntime(fixture({detail,actual:{...actual,n37:['future_x','future_y']}}),{storage});const s=await next.invoke('searchDanmu',params(38));assert.equal(s.animes[0].platformLabel,'future_x&future_y');
});
test('public callbacks retain historical real-ID playback without requiring an aggregate search record',async()=>{
 const app=nativeRuntime(fixture()),d=await app.invoke('getDetail',{...config,animeId:42});assert.ok(d.length);assert.equal((await app.invoke('getComments',{...config,commentId:'two'})).count,2);
 for(const key of ['fetch','URL','setTimeout','AbortController','Buffer','process'])assert.equal(app.sandbox[key],undefined);
});
test('preflight HTTP failures remain diagnosable and do not advertise a usable aggregate',async()=>{
 const app=nativeRuntime(fixture({intercept:u=>u.pathname.includes('/comment/')?{statusCode:403,data:{}}:undefined}));
 const result=await app.invoke('searchDanmu',params());assert.equal(result.animes.length,0);assert.ok(app.exports._test.compatDiagnostics().some(e=>e.category==='AUTH'));
});
test('an empty segmented preflight window cannot hide a nonempty episode or replace whole-episode platform evidence',async()=>{
 for(const start of [0,60]){
 const app=nativeRuntime(fixture({intercept:u=>u.pathname.includes('/comment/')?{data:{comments:[],barrage_list:[{segment_start:start,segment_end:start+60,segment_url:'https://segments.example/first'}]}}:u.hostname==='segments.example'?{data:{comments:[]}}:undefined}));
 const result=await app.invoke('searchDanmu',params());assert.equal(result.animes.length,1);assert.equal(result.animes[0].platformLabel,'腾讯&爱奇艺&custom_provider');assert.match(result.animes[0].animeTitle,/平台待确认/);
 }
});

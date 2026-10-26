import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRuntime,media} from './native-test-support.mjs';
const config={danmu_api_url:'https://one.example/private-one',danmu_api_url_2:'https://two.example/private-two'};
const params={...media,...config},tick=()=>new Promise(setImmediate);
const candidate={animeId:42,animeTitle:'测试剧 S02 (2024) from tencent&iqiyi&aiyifan',type:'tvseries',source:'tencent',startDate:'2024-01-01',mergedChildren:[{source:'iqiyi',animeId:2},{source:'aiyifan',animeId:3}]};
const episodes=[{episodeId:'E12',episodeTitle:'【qq&qiyi&aiyifan】 第12集'},{episodeId:'E13',episodeTitle:'【qq】 第13集'}];
const row={cid:'real-id',p:'12.34,5,16711680,[tencent]',m:'原始弹幕😄'};
function fixture({native=candidate,detail=episodes,intercept}={}){
 return async(method,address)=>{
  const u=new URL(address),slot=u.hostname==='one.example'?1:2;
  if(intercept){const value=await intercept(slot,u);if(value!==undefined)return value;}
  if(u.pathname.includes('/search/'))return {data:{animes:[slot===1?native:{...native,animeTitle:'测试剧 S02 (2024) from youku',source:'youku',mergedChildren:[]}]}};
  if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:detail}}};
  if(u.pathname.includes('/comment/'))return {data:{comments:[row]}};
  return {statusCode:404,data:{}};
 };
}
async function warm(app,p=params){await app.invoke('searchDanmu',p);await tick();return app.invoke('searchDanmu',p);}

test('single API native aggregation is visibly marked while real protocol IDs, provider data and comments stay unchanged',async()=>{
 const app=nativeRuntime(fixture()),p={...media,danmu_api_url:config.danmu_api_url};
 const search=await app.invoke('searchDanmu',p),selected=search.animes[0];
 assert.equal(selected.source,'聚合');assert.equal(selected.originalSource,'tencent');assert.match(selected.animeTitle,/^【聚合】.*tencent&iqiyi&aiyifan/);assert.equal(selected.animeId,42);
 assert.equal(candidate.source,'tencent');assert.ok(!candidate.animeTitle.startsWith('【聚合】'));
 const detail=await app.invoke('getDetail',{...p,animeId:selected.animeId});assert.match(detail[0].episodeTitle,/^【聚合】/);assert.equal(detail[0].source,'聚合');assert.equal(detail[0].episodeId,'E12');
 assert.ok(!detail[1].episodeTitle.includes('聚合'));
 const comments=await app.invoke('getComments',{danmu_api_url:p.danmu_api_url,commentId:detail[0].episodeId});assert.deepEqual(JSON.parse(JSON.stringify(comments.comments)),[row]);
 assert.ok(app.calls.some(c=>c.url.includes('/comment/E12?async=1&withRelated=true')));
});
test('movie native labels follow arbitrary returned platform combinations rather than a fixed three-provider list',async()=>{
 for(const platforms of [['youku','bilibili','imgo'],['migu','bahamut','animeko','custom_provider']]){
  const movie={...candidate,animeTitle:'测试电影 (2024) from '+platforms.join('&'),type:'movie',source:platforms[0],mergedChildren:platforms.slice(1).map(source=>({source}))};
  const app=nativeRuntime(fixture({native:movie,detail:[{episodeId:'film',episodeTitle:'【'+platforms.join('&')+'】 正片'}]}));
  const p={...media,danmu_api_url:config.danmu_api_url,type:'movie',title:'测试电影',seriesName:'测试电影',year:2024,season:0,episode:0};
  const result=await app.invoke('searchDanmu',p);assert.equal(result.animes[0].source,'聚合');assert.ok(result.animes[0].animeTitle.includes(platforms.join('&')));
  const detail=await app.invoke('getDetail',{...p,animeId:42});assert.equal(detail[0].source,'聚合');assert.equal(detail[0].episodeId,'film');
 }
});
test('single platform, repeated platform aliases and unverified selection groups are never mislabeled as aggregation',async()=>{
 const native={...candidate,animeTitle:'测试剧 S02 (2024) from iqiyi',source:'iqiyi',mergedChildren:[]};
 const app=nativeRuntime(fixture({native,detail:[{episodeId:'E12',episodeTitle:'【qiyi&iqiyi】 第12集'}]}));
 const search=await warm(app),group=search.animes.find(a=>a.animeTitle.includes('跨 API'));assert.ok(group);assert.equal(group.source,'跨 API 选源');assert.ok(!group.animeTitle.startsWith('【聚合】'));
 const independent=search.animes.find(a=>a.animeTitle.endsWith('API 1'));assert.equal(independent.source,'iqiyi');assert.ok(!independent.animeTitle.includes('【聚合】'));
 const detail=await app.invoke('getDetail',{...config,animeId:independent.animeId});assert.ok(detail.every(e=>!e.episodeTitle.startsWith('【聚合】')));
});
test('multi-API native labels survive a new VM without changing source-bound real-ID routing',async()=>{
 const app=nativeRuntime(fixture()),search=await warm(app),selected=search.animes.find(a=>a.animeTitle.endsWith('API 1') && !a.animeTitle.includes('跨 API'));
 assert.equal(selected.source,'聚合');assert.match(selected.animeTitle,/【聚合】/);
 const next=nativeRuntime(fixture()),detail=await next.invoke('getDetail',{...config,animeId:selected.animeId});assert.equal(detail[0].source,'聚合');
 const player=nativeRuntime(fixture()),comments=await player.invoke('getComments',{...config,commentId:detail[0].episodeId});assert.equal(comments.count,1);assert.ok(player.calls.every(c=>new URL(c.url).hostname==='one.example'));
});
test('proven cross-API episode aggregation has an aggregation source label while independent tracks remain separate',async()=>{
 const proof={episodeId:'E12',episodeTitle:'第12集',durationSeconds:2400,videoHash:'a'.repeat(64)};
 const app=nativeRuntime(fixture({native:{...candidate,animeTitle:'测试剧 S02 (2024)',mergedChildren:[]},detail:[proof]})),search=await warm(app),group=search.animes.find(a=>a.animeTitle.includes('跨 API'));
 await app.invoke('getDetail',{...config,animeId:group.animeId});await tick();const detail=await app.invoke('getDetail',{...config,animeId:group.animeId});
 const merged=detail.find(e=>e.episodeTitle.includes('安全聚合'));assert.ok(merged);assert.equal(merged.source,'聚合');assert.match(merged.episodeTitle,/^【聚合】/);assert.equal(detail.filter(e=>!e.episodeTitle.includes('安全聚合')).length,2);
});
async function lateNativeStorage(){
 const storage=new Map();let release;const gate=new Promise(r=>release=r);
 const app=nativeRuntime(fixture({intercept:(slot,u)=>slot===1 && u.pathname.includes('/search/')?gate:undefined}),{storage});
 const initial=await app.invoke('searchDanmu',params);assert.ok(!initial.animes.some(a=>a.animeTitle.endsWith('API 1')));
 release({data:{animes:[candidate]}});await tick();return storage;
}
test('late native aggregation stays discoverable from existing bounded lookup storage in a fresh VM with a slow API 1',async()=>{
 const storage=await lateNativeStorage();
 const app=nativeRuntime(fixture({intercept:(slot,u)=>slot===1 && u.pathname.includes('/search/')?new Promise(()=>{}):undefined}),{storage});
 const result=await app.invoke('searchDanmu',params),native=result.animes.find(a=>a.animeTitle.endsWith('API 1') && !a.animeTitle.includes('跨 API'));
 assert.ok(native);assert.equal(native.source,'聚合');assert.equal(app.calls.filter(c=>c.url.includes('/search/')).length,2);
 assert.ok(app.exports._test.compatDiagnostics().some(e=>e.code==='NATIVE_REUSED'));
 assert.ok(!JSON.stringify(result).includes('private-one'));
});
test('native lookup reuse rejects changed credentials, work, season, release, edition and expired metadata',async()=>{
 const storage=await lateNativeStorage();
 for(const changes of [{danmu_api_url:'https://one.example/changed-token'},{title:'其他作品',seriesName:'其他作品'},{season:3},{airDate:'2025-01-01'},{version:'extended'},{language:'en'}]){
  const name=changes.title || '测试剧',season=changes.season || 2,year=changes.airDate?2025:2024;
  const app=nativeRuntime(fixture({intercept:(slot,u)=>!u.pathname.includes('/search/')?undefined:slot===1?new Promise(()=>{}):{data:{animes:[{animeId:99,animeTitle:name+' S0'+season+' ('+year+')',startDate:year+'-01-01',type:'tvseries'}]}}}),{storage});
  const result=await app.invoke('searchDanmu',{...params,...changes});assert.ok(!result.animes.some(a=>a.animeTitle.endsWith('API 1')),JSON.stringify(changes));
 }
 const expired=new Map(storage);for(const [key,value] of expired)if(key.startsWith('fusion-compat-v1:lookup:')){const record=JSON.parse(value);record.expires=1;expired.set(key,JSON.stringify(record));}
 const app=nativeRuntime(fixture({intercept:(slot,u)=>slot===1 && u.pathname.includes('/search/')?new Promise(()=>{}):undefined}),{storage:expired});assert.ok(!(await app.invoke('searchDanmu',params)).animes.some(a=>a.animeTitle.endsWith('API 1')));
});
test('a completed fresh empty native API response overrides an older native lookup hint',async()=>{
 const storage=await lateNativeStorage();let release;const gate=new Promise(r=>release=r);
 const app=nativeRuntime(fixture({intercept:(slot,u)=>u.pathname.includes('/search/')?slot===1?{data:{animes:[]}}:gate:undefined}),{storage});
 const task=app.invoke('searchDanmu',params);await tick();release({data:{animes:[{...candidate,animeTitle:'测试剧 S02 (2024)',mergedChildren:[]}]}});
 const result=await task;assert.ok(!result.animes.some(a=>a.animeTitle.endsWith('API 1')));
});

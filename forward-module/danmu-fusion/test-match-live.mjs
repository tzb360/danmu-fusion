/** Real optional year matching + unchanged standard detail/comment flow. */
import fs from 'node:fs';import assert from 'node:assert/strict';
import {nativeRuntime,selectEpisode} from './native-test-support.mjs';
const api=process.env.DANMU_API_URL;if(!api)throw new Error('Set DANMU_API_URL');
const cases=process.env.DANMU_LIVE_CASES?JSON.parse(process.env.DANMU_LIVE_CASES):[
 {title:'爱情公寓',type:'movie',year:2018},
 {title:'倚天屠龙记',type:'tv',year:2019,season:1,episode:2,airDate:'2019-02-27'}
];
const report={startedAt:new Date().toISOString(),cases:[]};
for(const item of cases){
 const app=nativeRuntime(async(method,url,body,options)=>{
  const response=await fetch(url,{method,headers:options.headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  return {statusCode:response.status,data:await response.text()};
 });report.version=app.metadata.version;const start=Date.now();let result={...item,status:'failed'};
 try{
  const params={...item,seriesName:item.title,danmu_api_url:api},search=await app.invoke('searchDanmu',params);
  const chosen=search.animes[0];assert.ok(chosen,'no same-year search candidate');
  result.selectedTitle=chosen.animeTitle;result.candidates=search.animes.length;
  result.matchRequests=app.calls.filter(c=>c.method==='POST' && c.url.endsWith('/match')).map(c=>c.data.fileName);
  result.matchVerified=app.exports._test.compatDiagnostics().some(e=>e.stage==='Match' && e.code==='YEAR_VERIFIED');
  assert.ok(result.matchRequests.length,'year disambiguation not exercised');assert.ok(result.matchVerified,'year match was not independently confirmed');
  const detail=await app.invoke('getDetail',{...params,animeId:chosen.animeId}),episode=selectEpisode(detail,item);assert.ok(episode);
  result.episodeTitle=episode.episodeTitle;
  const comments=await app.invoke('getComments',{danmu_api_url:api,commentId:episode.episodeId});assert.ok(comments.count>0);
  result.comments=comments.count;result.status='passed';
 }catch(e){result.error=e.name==='AssertionError'?e.message:'network or interface failure';}
 result.diagnostics=app.exports._test.compatDiagnostics().filter(e=>e.stage==='Match');result.elapsedMs=Date.now()-start;report.cases.push(result);
 if(process.env.DANMU_LIVE_REPORT)fs.writeFileSync(process.env.DANMU_LIVE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(result));
}
report.finishedAt=new Date().toISOString();report.totals={cases:cases.length,passed:report.cases.filter(c=>c.status==='passed').length,failed:report.cases.filter(c=>c.status!=='passed').length};
if(process.env.DANMU_LIVE_REPORT)fs.writeFileSync(process.env.DANMU_LIVE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.totals));if(report.totals.failed)process.exitCode=1;

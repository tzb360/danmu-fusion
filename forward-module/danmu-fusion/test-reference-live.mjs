/** Actual API comparison. Timers/fetch exist ONLY in the host HTTP bridge,
 * never in any Widget VM. Reports omit API URLs, tokens and native errors.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {nativeRuntime,referencePaths,fusionPath,selectEpisode} from './native-test-support.mjs';
const api=process.env.DANMU_API_URL;if(!api)throw new Error('Set DANMU_API_URL (not printed)');
const cases=process.env.DANMU_LIVE_CASES?JSON.parse(process.env.DANMU_LIVE_CASES):[
  {title:'爱情公寓4',type:'tv',year:2014,season:4,episode:2},
  {title:'唐朝诡事录',type:'tv',year:2022,season:1,episode:2},
  {title:'哪吒之魔童降世',type:'movie',year:2019},
  {title:'长安三万里',type:'movie',year:2023}
];
const reportPath=process.env.DANMU_LIVE_REPORT || 'artifacts/compatibility-20261025/reference-live.json';
const report={startedAt:new Date().toISOString(),moduleVersion:nativeRuntime(()=>({})).metadata.version,moduleSha256:crypto.createHash('sha256').update(fs.readFileSync(fusionPath)).digest('hex'),widgetTimers:false,widgetStorage:'strings only',cases:[]};
function save(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
const bridge=async(method,url,body,options)=>{
  const response=await fetch(url,{method,headers:options.headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(100000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {statusCode:response.status,headers:Object.fromEntries(response.headers),data};
};
function requests(app){return app.calls.map(c=>{
  const u=new URL(c.url),tail=u.pathname.split('/api/v2/').pop();
  return {method:c.method,endpoint:'/api/v2/'+tail.replace(/^(bangumi|comment)\/.*$/,'$1/{id}'),queryKeys:Array.from(u.searchParams.keys()),matchMode:c.data?.matchMode || null};
});}
function list(data){return Array.isArray(data)?data:data?.comments;}
function hash(comments){return crypto.createHash('sha256').update(JSON.stringify(comments.map(c=>[c.cid,c.p,c.m]))).digest('hex');}
for(const item of cases){
  const result={...item,status:'failed',modules:[]};const start=Date.now();let fusionEpisode;
  for(const [name,path]of [['rex',referencePaths.rex],['fusion',fusionPath]]){
    const app=nativeRuntime(bridge,{path}),params={...item,seriesName:item.title,server:api,danmu_api_url:api};
    const part={name,status:'failed'};
    try{
      const search=await app.invoke('searchDanmu',params);assert.ok(search.animes.length,'search returned no candidate');
      const selected=search.animes[0];part.searchCount=search.animes.length;part.selectedAnimeTitle=selected.animeTitle;part.selectedAnimeType=selected.type;
      // Simulate the player replacing title with the selected provider title.
      const detail=await app.invoke('getDetail',{...params,animeId:selected.animeId,title:selected.animeTitle});assert.ok(Array.isArray(detail));
      part.detailCount=detail.length;part.detailSamples=detail.slice(0,5).map(e=>({title:e.episodeTitle,number:e.episodeNumber}));
      const selectedEpisode=selectEpisode(detail,item);assert.ok(selectedEpisode,'requested episode missing');
      part.detailCount=detail.length;part.selectedEpisodeTitle=selectedEpisode.episodeTitle;
      // No title/year/season is needed for the final selected-ID request.
      const comments=await app.invoke('getComments',{server:api,danmu_api_url:api,commentId:selectedEpisode.episodeId});
      part.responseKeys=Object.keys(comments || {});part.pendingTask=!!comments?.taskId;
      assert.ok(Array.isArray(list(comments)));assert.ok(list(comments).length,'empty comments');
      part.commentCount=list(comments).length;part.responseType=Array.isArray(comments)?'array':'data wrapper';
      part.timestampSample=list(comments).slice(0,3).map(c=>c.p);part.status='passed';
      if(name==='fusion')fusionEpisode=selectedEpisode;
    }catch(e){part.error=e.name==='AssertionError'?e.message.replace(/https?:\/\/\S+/g,'[URL hidden]'):'network/interface/runtime failure';}
    part.requests=requests(app);if(name==='fusion')part.diagnostics=app.exports._test.compatDiagnostics();result.modules.push(part);
  }
  if(fusionEpisode){
    const outputs=[];
    for(const [name,path]of [['rex',referencePaths.rex],['fusion',fusionPath]]){
      try{
        const app=nativeRuntime(bridge,{path});const value=await app.invoke('getComments',{server:api,danmu_api_url:api,commentId:fusionEpisode.episodeId});
        assert.ok(Array.isArray(list(value)) && list(value).length);
        outputs.push({name,count:list(value).length,hash:hash(list(value)),comments:list(value)});
      }catch(e){outputs.push({name,error:'pinned comment comparison failed'});}
    }
    result.pinnedSameEpisode=outputs.map(({comments,...rest})=>rest);
    result.identicalOutput=outputs.length===2 && outputs[0].hash && outputs[0].hash===outputs[1].hash;
    result.status=result.modules.every(m=>m.status==='passed') && result.identicalOutput?'passed':'failed';
  }
  result.elapsedMs=Date.now()-start;report.cases.push(result);save();
  console.log(JSON.stringify({title:item.title,status:result.status,counts:result.modules.map(m=>({name:m.name,count:m.commentCount,status:m.status})),identicalOutput:!!result.identicalOutput,elapsedMs:result.elapsedMs}));
}
report.finishedAt=new Date().toISOString();report.totals={cases:report.cases.length,passed:report.cases.filter(c=>c.status==='passed').length,failed:report.cases.filter(c=>c.status!=='passed').length};save();console.log(JSON.stringify(report.totals));
if(report.totals.failed)process.exitCode=1;

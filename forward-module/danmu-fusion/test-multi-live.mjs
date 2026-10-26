/** Real HTTP only. Credentials come from existing environment, never reports.
 * Host-side fetch/AbortSignal stay outside the timer-free Widget VM.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {nativeRuntime,selectEpisode} from './native-test-support.mjs';
const urls=[process.env.DANMU_API_URL,process.env.DANMU_API_URL_2,process.env.DANMU_API_URL_3].filter(Boolean);
if(!urls.length)throw Error('Set DANMU_API_URL');
const report={version:'1.5.1',startedAt:new Date().toISOString(),kind:'real configured APIs, no mocks',cases:[]};
const item={title:'爱情公寓4',seriesName:'爱情公寓4',type:'tv',year:2014,season:4,episode:2};
const save=()=>{if(process.env.DANMU_MULTI_REPORT)fs.writeFileSync(process.env.DANMU_MULTI_REPORT,JSON.stringify(report,null,2)+'\n');};
const counts=process.env.DANMU_MULTI_COUNTS?process.env.DANMU_MULTI_COUNTS.split(',').map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=urls.length):urls.map((_,i)=>i+1);
for(const count of counts){
  const calls=[],active=new Set(),timings=[];
  const p={...item,danmu_api_url:urls[0],danmu_api_url_2:count>=2?urls[1]:'',danmu_api_url_3:count>=3?urls[2]:''};
  const bridge=async(method,url,body,options)=>{
    const started=Date.now(),stage=url.includes('/search/')?'search':url.includes('/bangumi/')?'detail':url.includes('/comment/')?'comments':'match';
    const source=urls.findIndex(root=>{
      const base=new URL(root),request=new URL(url);
      const path=base.pathname.replace(/\/api\/v2\/?$/i,'').replace(/\/+$/,'');
      return base.origin===request.origin && request.pathname.startsWith(path+'/') && Array.from(base.searchParams).every(([key,value])=>request.searchParams.get(key)===value);
    })+1;
    const task=(async()=>{
      try{const response=await fetch(url,{method,headers:options.headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const data=await response.text();timings.push({source,stage,status:response.status,ms:Date.now()-started});return {statusCode:response.status,data};}
      catch(e){timings.push({source,stage,status:e.name==='TimeoutError'?'host-timeout':'network-error',ms:Date.now()-started});throw e;}
    })();
    active.add(task);try{return await task;}finally{active.delete(task);}
  };
  const app=nativeRuntime(bridge),result={configured:count,firstSearchMs:null,candidates:0,sources:[],timings};
  const started=Date.now();let search=await app.invoke('searchDanmu',p);result.firstSearchMs=Date.now()-started;result.firstCandidates=search.animes.length;
  // Observe actual late responses in the external test host, not fake VM timers.
  await Promise.allSettled(Array.from(active));await new Promise(setImmediate);
  if(count>1)search=await app.invoke('searchDanmu',p);
  result.candidates=search.animes.length;
  for(let source=1;source<=count;source++){
    const selected=count===1?search.animes[0]:search.animes.find(a=>a.animeTitle.endsWith(' · API '+source));
    if(!selected){result.sources.push({source,status:'no-usable-candidate'});continue;}
    const row={source,title:selected.animeTitle,status:'failed'};
    const episodes=await app.invoke('getDetail',{...p,animeId:selected.animeId}),episode=selectEpisode(episodes,item);
    if(!episode){row.status='no-requested-episode';result.sources.push(row);continue;}
    const before=Date.now(),comments=await app.invoke('getComments',{danmu_api_url:p.danmu_api_url,danmu_api_url_2:p.danmu_api_url_2,danmu_api_url_3:p.danmu_api_url_3,commentId:episode.episodeId});
    row.count=comments.count;row.commentMs=Date.now()-before;row.status=comments.count>0?'passed':'empty-or-error';
    row.sequenceSha256=crypto.createHash('sha256').update(JSON.stringify(comments.comments.map(c=>[c.cid,c.p,c.m]))).digest('hex');
    result.sources.push(row);
  }
  result.firstReturnWasPartial=app.exports._test.compatDiagnostics().some(e=>e.code==='PARTIAL');
  result.elapsedMs=Date.now()-started;result.requests=app.calls.length;
  report.cases.push(result);save();console.log(JSON.stringify(result));
}
report.finishedAt=new Date().toISOString();save();
if(!report.cases[0].sources.some(s=>s.status==='passed'))process.exitCode=1;

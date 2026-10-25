/** Reproducible real-server acceptance sample. No API credentials in reports.
 * DANMU_API_URL=... node forward-module/danmu-fusion/test-live-matrix.mjs
 * Optional DANMU_LIVE_REPORT=/absolute/report.json, DANMU_SAMPLE_SEED=20261025.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {nativeRuntime,selectEpisode} from './native-test-support.mjs';

const api=process.env.DANMU_API_URL;
if(!api) throw new Error('Set DANMU_API_URL (never printed)');
const seed=Number(process.env.DANMU_SAMPLE_SEED || 20261025);
const tvCount=Math.max(1,Math.min(5,Number(process.env.DANMU_SAMPLE_TV_COUNT)||5));
const movieCount=Math.max(1,Math.min(4,Number(process.env.DANMU_SAMPLE_MOVIE_COUNT)||4));
let randomState=seed>>>0;
function random(){randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;}
function draw(pool,count){const copy=[...pool];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy.slice(0,count);}
const tvPool=[
  ['狂飙',2023],['漫长的季节',2023],['去有风的地方',2023],['琅琊榜',2015],
  ['隐秘的角落',2020],['甄嬛传',2011],['唐朝诡事录',2022],['三体',2023],
  ['庆余年',2019],['开端',2022],['繁花',2023],['武林外传',2006]
];
const moviePool=[
  ['流浪地球',2019],['流浪地球2',2023],['让子弹飞',2010],['哪吒之魔童降世',2019],
  ['独行月球',2022],['飞驰人生',2019],['飞驰人生2',2024],['你好，李焕英',2021],
  ['夏洛特烦恼',2015],['我不是药神',2018],['满江红',2023],['长安三万里',2023]
];
const cases=[
  {title:'爱情公寓4',type:'tv',year:2014,season:4,episode:1,regression:true},
  {title:'爱情公寓4',type:'tv',year:2014,season:4,episode:2,regression:true},
  {title:'爱情公寓',type:'tv',year:2009,season:4,episode:2,regression:true},
  ...draw(tvPool,tvCount).map(([title,year])=>({title,year,type:'tv',season:1,episode:1+Math.floor(random()*3)})),
  ...draw(moviePool,movieCount).map(([title,year])=>({title,year,type:'movie'}))
];
const report={seed,startedAt:new Date().toISOString(),server:'configured production API (credentials omitted)',moduleVersion:null,cases:[]};
const timings=[];
const app=nativeRuntime(async(method,url,body,options)=>{
  const started=Date.now();
  try{
    const response=await fetch(url,{method,headers:options.headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(100000)});
    return {status:response.status,data:await response.text()};
  }finally{
    timings.push({endpoint:url.includes('/api/v2/')?method+' /api/v2/'+url.split('/api/v2/').pop().split('?')[0]:method+' [external segment]',ms:Date.now()-started});
  }
});
report.moduleVersion=app.metadata.version;
function save(){if(process.env.DANMU_LIVE_REPORT)fs.writeFileSync(process.env.DANMU_LIVE_REPORT,JSON.stringify(report,null,2)+'\n');}
for(const item of cases){
  const started=Date.now(),requestStart=app.calls.length,timingStart=timings.length;
  const result={...item,status:'failed'};
  try{
    const params={...item,seriesName:item.title,danmu_api_url:api};
    const search=await app.invoke('searchDanmu',params);
    result.candidates=search.animes.length;
    const selected=search.animes[0];
    if(!selected)throw new Error('no_search_result');
    result.selectedTitle=selected.animeTitle;
    const detail=await app.invoke('getDetail',{...params,animeId:selected.animeId,title:selected.animeTitle});
    const target=selectEpisode(detail,item);
    assert.ok(target,'requested episode missing');
    const playback={...params,animeId:selected.animeId,commentId:target.episodeId};
    const response=await app.invoke('getComments',playback),comments=response.comments;
    assert.ok(Array.isArray(comments));
    result.initialCount=comments.length;
    result.aggregation='server-provided; no client aggregation claim';
    const seek=(await app.invoke('getDanmuWithSegmentTime',{...playback,segmentTime:600})).comments;
    result.seek600Count=seek.length;
    assert.ok(seek.every(c=>Number(c.p.split(',')[0])>=600 && Number(c.p.split(',')[0])<660));
    assert.ok(comments.every(c=>typeof c.m==='string' && Number.isFinite(Number(c.p.split(',')[0]))));
    const requestCount=app.calls.length;
    const cached=(await app.invoke('getDanmuWithSegmentTime',{...playback,segmentTime:600})).comments;
    result.cacheHit=app.calls.length===requestCount && cached.length===seek.length;
    result.cacheMayBeSkipped=JSON.stringify(response).length*2>2*1024*1024;
    assert.ok(comments.length>0 || seek.length>0,'real API returned no playable comments');
    result.status='passed';
  }catch(error){result.error=String(error.message || error).replace(/https?:\/\/\S+/g,'[URL hidden]');}
  result.requests=app.calls.length-requestStart;result.elapsedMs=Date.now()-started;
  result.slowestRequests=timings.slice(timingStart).sort((a,b)=>b.ms-a.ms).slice(0,3);
  report.cases.push(result);save();
  console.log(JSON.stringify(result));
}
report.finishedAt=new Date().toISOString();
report.totals={cases:report.cases.length,passed:report.cases.filter(r=>r.status==='passed').length,partial:report.cases.filter(r=>r.status==='partial').length,failed:report.cases.filter(r=>r.status==='failed').length};
save();console.log(JSON.stringify(report.totals));
if(report.totals.failed)process.exitCode=1;

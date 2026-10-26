/** Real strict native multi-source aggregation through the public Widget API. */
import fs from 'node:fs';import assert from 'node:assert/strict';
import {nativeRuntime,selectEpisode} from './native-test-support.mjs';
const api=process.env.DANMU_API_URL;if(!api)throw new Error('Set DANMU_API_URL');
const cases=process.env.DANMU_LIVE_CASES?JSON.parse(process.env.DANMU_LIVE_CASES):[
 {title:'爱情公寓4',type:'tv',year:2014,season:4,episode:2},
 {title:'哪吒之魔童降世',type:'movie',year:2019},
 {title:'长安三万里',type:'movie',year:2023}
];
const report={startedAt:new Date().toISOString(),cases:[]};
const app=nativeRuntime(async(method,url,body,options)=>{
 const response=await fetch(url,{method,headers:options.headers,signal:AbortSignal.timeout(150000)});
 return {statusCode:response.status,data:await response.text()};
});report.version=app.metadata.version;
for(const item of cases){const start=Date.now();const result={...item,status:'failed'};
 try{
  const p={...item,seriesName:item.title,danmu_api_url:api};
  const search=await app.invoke('searchDanmu',p),candidate=search.animes.find(a=>a.mergedChildren?.length);
  assert.ok(candidate,'no native merged candidate');
  result.mergedTitle=candidate.animeTitle;result.candidateSources=[...new Set([(candidate.originalSource || candidate.source),...candidate.mergedChildren.map(c=>c.source)])];
  result.children=candidate.mergedChildren.map(c=>c.animeTitle);
  assert.ok(result.children.every(t=>!/纪录|解说|赏析|影评|预告|花絮/.test(t)));
  const detail=await app.invoke('getDetail',{...p,animeId:candidate.animeId}),selected=selectEpisode(detail,item);assert.ok(selected);
  result.episodes=detail.length;result.selectedEpisode=selected.episodeTitle;
  const playback={...p,animeId:candidate.animeId,commentId:selected.episodeId};
  const response=await app.invoke('getComments',playback);assert.ok(response.count>0,'merged comment list empty');
  const tags={},sources=new Set();for(const c of response.comments){const tag=String(c.p).split(',')[3] || 'unknown';tags[tag]=(tags[tag]||0)+1;tag.replace(/[\[\]]/g,'').split(/[&＆]/).forEach(s=>{if(s!=='unknown')sources.add(s);});}
  result.count=response.count;result.sourceTags=tags;result.actualSources=[...sources];assert.ok(sources.size>=2,'fewer than two actual source tags');
  const seek=await app.invoke('getDanmuWithSegmentTime',{...playback,segmentTime:600});result.seekCount=seek.count;
  assert.ok(seek.comments.every(c=>Number(c.p.split(',')[0])>=600 && Number(c.p.split(',')[0])<660));
  result.status='passed';
 }catch(e){result.error=e.name==='AssertionError'?e.message:'network/interface failure';result.diagnostics=app.exports._test.compatDiagnostics().slice(-16);}
 result.elapsedMs=Date.now()-start;report.cases.push(result);if(process.env.DANMU_LIVE_REPORT)fs.writeFileSync(process.env.DANMU_LIVE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(result));
}
report.finishedAt=new Date().toISOString();report.totals={cases:cases.length,passed:report.cases.filter(c=>c.status==='passed').length,failed:report.cases.filter(c=>c.status!=='passed').length};
if(process.env.DANMU_LIVE_REPORT)fs.writeFileSync(process.env.DANMU_LIVE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.totals));if(report.totals.failed)process.exitCode=1;

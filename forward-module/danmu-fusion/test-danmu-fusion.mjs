/** Real API smoke test through native, timer-free Widget globals. */
import assert from 'node:assert/strict';
import {nativeRuntime,selectEpisode} from './native-test-support.mjs';
const api=process.env.DANMU_API_URL || 'http://127.0.0.1:9321';
const item=process.env.DANMU_TEST_MEDIA?JSON.parse(process.env.DANMU_TEST_MEDIA):{title:'爱情公寓4',type:'tv',year:2014,season:4,episode:2};
const app=nativeRuntime(async(method,url,body,options)=>{
  const response=await fetch(url,{method,headers:options.headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(100000)});
  return {statusCode:response.status,data:await response.text()};
});
try{
  const params={...item,seriesName:item.title,danmu_api_url:api};
  const search=await app.invoke('searchDanmu',params);assert.ok(search.animes.length,'empty search');
  const chosen=search.animes[0],detail=await app.invoke('getDetail',{...params,animeId:chosen.animeId,title:chosen.animeTitle});
  const episode=selectEpisode(detail,item);
  assert.ok(episode,'missing requested episode');
  const result=await app.invoke('getComments',{danmu_api_url:api,commentId:episode.episodeId});
  assert.ok(Array.isArray(result.comments) && result.comments.length,'empty comment list');
  console.log(JSON.stringify({version:app.metadata.version,title:item.title,count:result.comments.length,widgetTimers:false,requests:app.calls.length,status:'passed'}));
}catch(e){console.error('FAIL: inspect stage diagnostics',JSON.stringify(app.exports._test.compatDiagnostics()));process.exitCode=1;}

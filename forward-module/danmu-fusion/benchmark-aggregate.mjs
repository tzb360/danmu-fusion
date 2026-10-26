/** Public aggregation UI cost, deterministic Mock VM, not real-device timing. */
import {nativeRuntime,media} from './native-test-support.mjs';
import os from 'node:os';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const results=[];
if(process.argv.includes('--worker')){
for(const count of [Number(process.argv.at(-1))]){
 const payload=JSON.stringify({comments:Array.from({length:count},(_,i)=>({cid:i,p:(i/100)+',5,16711680,['+(i%2?'future_b':'future_a')+']',m:'原样弹幕'+i}))});
 let requests=0;
 const app=nativeRuntime(async(method,address)=>{
  const u=new URL(address);
  if(u.pathname.includes('/search/'))return {data:{animes:[{animeId:42,animeTitle:'测试剧 S02 (2024) from future_a&future_b',source:'future_a',type:'tvseries',startDate:'2024-01-01',mergedChildren:[{source:'future_b'}]}]}};
  if(u.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:[{episodeId:'E12',episodeTitle:'【future_a&future_b】 第12集'}]}}};
  requests++;await new Promise(setImmediate);return {data:payload};
 });
 await new Promise(setImmediate);global.gc?.();const before=process.memoryUsage(),start=performance.now();
 const search=await app.invoke('searchDanmu',media);assert.equal(search.animes.length,1);const searchMs=performance.now()-start,afterSearch=process.memoryUsage();
 const detail=await app.invoke('getDetail',{...media,animeId:search.animes[0].animeId});
 let comments=await app.invoke('getComments',{...media,commentId:detail[0].episodeId});assert.equal(comments.count,count);comments=null;
 for(const segmentTime of [0,60,120]){let r=await app.invoke('getDanmuWithSegmentTime',{...media,commentId:detail[0].episodeId,segmentTime});assert.ok(r.comments.every(c=>Number(c.p.split(',')[0])>=segmentTime && Number(c.p.split(',')[0])<segmentTime+60));r=null;}
 const totalMs=performance.now()-start,after=process.memoryUsage();global.gc?.();const retained=process.memoryUsage();
 assert.equal(requests,count===4000?1:5);const cache=app.exports._test.compatCacheStats();assert.ok(cache.entries<=4 && cache.bytes<=2*1024*1024);
 results.push({version:app.metadata.version,mock:true,rows:count,searchIncludingPreflightMs:+searchMs.toFixed(2),totalIncludingPlaybackAndThreeSeeksMs:+totalMs.toFixed(2),commentRequests:requests,observedHeapMiB:+(Math.max(afterSearch.heapUsed,after.heapUsed)/1048576).toFixed(2),retainedHeapDeltaMiB:+((retained.heapUsed-before.heapUsed)/1048576).toFixed(2),cache});
}
}else{for(const count of [4000,220001]){const run=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--worker',String(count)],{encoding:'utf8',maxBuffer:2000000});if(run.status!==0)throw Error(run.stderr || run.stdout);results.push(...JSON.parse(run.stdout).results);}}
const report={environment:{runtime:process.version,cpu:os.cpus()[0].model},method:'Fresh process per size, one sample; fixed Mock JSON; public metadata entry points; sampled memory after callbacks, not allocation peak. Includes current-episode preflight. Not iPhone performance.',results};
console.log(JSON.stringify(report,null,2));if(process.env.DANMU_AGGREGATE_REPORT)fs.writeFileSync(process.env.DANMU_AGGREGATE_REPORT,JSON.stringify(report,null,2)+'\n');

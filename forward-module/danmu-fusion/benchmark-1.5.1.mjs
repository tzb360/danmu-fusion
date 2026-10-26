/** Reproducible Node/Widget VM benchmark, not iPhone measurements.
 * node --expose-gc forward-module/danmu-fusion/benchmark-1.5.1.mjs
 * Each sample runs in a fresh process. All fixture HTTP is deterministic.
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeRuntime,media} from './native-test-support.mjs';
const scenarios=['cacheable-seeks','large-track','concurrent-seeks','continuous-episodes'];
const versions=['1.5.0',nativeRuntime(()=>({data:{}})).metadata.version];
if(process.argv.includes('--worker')){
  const [version,scenario]=process.argv.slice(-2),large=scenario==='large-track',count=large?220001:4000;
  const rows=Array.from({length:count},(_,i)=>({cid:i,p:(i/50)+',5,16711680,u',m:'弹幕'+i})),payload=JSON.stringify({comments:rows});
  const app=nativeRuntime(async()=>{await new Promise(setImmediate);return {data:payload};},{path:version==='1.5.0'?new URL('./fixtures/danmu-fusion-1.5.0.js',import.meta.url):undefined});
  const params={...media,commentId:'E12'};
  global.gc();const initial=process.memoryUsage(),start=performance.now();let peakHeap=initial.heapUsed,peakRss=initial.rss;
  const sample=()=>{const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRss=Math.max(peakRss,m.rss);};
  let result=await app.invoke('getComments',params);assert.equal(result.count,count);const firstMs=performance.now()-start;sample();result=null;
  const later=performance.now();let expectedRequests=1;
  if(scenario==='concurrent-seeks'){
    // A cold episode, twelve different callbacks, identical raw HTTP request.
    expectedRequests=2;
    const results=await Promise.all(Array.from({length:12},(_,i)=>app.invoke('getDanmuWithSegmentTime',{...params,commentId:'E13',segmentTime:i%2*60})));
    for(let i=0;i<results.length;i++)assert.equal(results[i].count,i%2?1000:3000);sample();
  }else if(scenario==='continuous-episodes'){
    expectedRequests=7;for(let i=0;i<6;i++){let r=await app.invoke('getComments',{...params,commentId:'E'+(13+i),episode:13+i});assert.equal(r.count,count);sample();r=null;}
  }else{
    const positions=large?[600,1200,0]:Array.from({length:80},(_,i)=>i%2*60);
    expectedRequests=large?4:1;
    for(const segmentTime of positions){let r=await app.invoke('getDanmuWithSegmentTime',{...params,segmentTime});assert.equal(r.count,segmentTime===0?3000:large?3000:1000);sample();r=null;}
  }
  const repeatMs=performance.now()-later;global.gc();const final=process.memoryUsage();
  // Larger cache footprint accounting may reduce cacheable record counts; this
  // fixture is below both budgets. Duplicate network calls must still be zero.
  assert.equal(app.calls.length,expectedRequests);
  console.log(JSON.stringify({version,scenario,rows:count,firstMs,repeatMs,requests:app.calls.length,duplicateRequests:app.calls.length-expectedRequests,observedPeakHeapMiB:peakHeap/1048576,retainedHeapDeltaMiB:(final.heapUsed-initial.heapUsed)/1048576,observedPeakRssMiB:peakRss/1048576,cache:app.exports._test.compatCacheStats?.()}));
}else{
  const samples=Number(process.env.DANMU_BENCH_SAMPLES || 3),results=[];
  for(const scenario of scenarios)for(const version of versions){
    const runs=[];
    for(let i=0;i<samples;i++){
      const run=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--worker',version,scenario],{encoding:'utf8',maxBuffer:2*1024*1024});
      if(run.status!==0)throw Error(run.stderr || run.stdout);runs.push(JSON.parse(run.stdout));
    }
    const median=key=>+runs.map(r=>r[key]).sort((a,b)=>a-b)[Math.floor(runs.length/2)].toFixed(2);
    results.push({version,scenario,mock:true,rows:runs[0].rows,samples,firstMs:median('firstMs'),repeatMs:median('repeatMs'),requests:runs[0].requests,duplicateRequests:runs[0].duplicateRequests,observedPeakHeapMiB:median('observedPeakHeapMiB'),retainedHeapDeltaMiB:median('retainedHeapDeltaMiB'),observedPeakRssMiB:median('observedPeakRssMiB'),runs});
  }
  const report={environment:{runtime:process.version,platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0].model},method:'Fresh Node process per sample; deterministic JSON HTTP; median of 3 by default; observed memory samples after each callback, not allocation peak; GC retained heap includes VM and cache. Mock VM, not real device.',baseline:'v1.5.0 d7815cc',bundles:Object.fromEntries(versions.map(version=>[version,crypto.createHash('sha256').update(fs.readFileSync(new URL(version==='1.5.0'?'./fixtures/danmu-fusion-1.5.0.js':'./danmu-fusion.js',import.meta.url))).digest('hex')])),results};
  console.log(JSON.stringify(report,null,2));
  if(process.env.DANMU_BENCH_REPORT)fs.writeFileSync(process.env.DANMU_BENCH_REPORT,JSON.stringify(report,null,2)+'\n');
}

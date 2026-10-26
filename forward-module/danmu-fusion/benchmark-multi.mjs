/** Deterministic latency comparison; all values below are MOCK host latency. */
import fs from 'node:fs';
import {nativeRuntime,media} from './native-test-support.mjs';
// Preserve the audited single-API bundle as an explicit comparison fixture.
const baseline=new URL('./fixtures/danmu-fusion-1.4.5.js',import.meta.url);
const p={...media,danmu_api_url:'https://one.example/token'};
const handler=async(m,u)=>{const host=new URL(u).hostname,ms=host==='two.example'?150:host==='three.example'?60:25;await new Promise(r=>setTimeout(r,ms));return {data:{animes:[{animeId:42,animeTitle:'测试剧 S02 (2024)',type:'tvseries'}]}};};
const results=[];
for(const [name,path,count]of [['1.4.5 single',baseline,1],['1.5.3 single',undefined,1],['1.5.3 two',undefined,2],['1.5.3 three',undefined,3]]){
  const samples=[];let requests=0;
  for(let i=0;i<5;i++){
    const app=nativeRuntime(handler,{path}),start=performance.now();
    const response=await app.invoke('searchDanmu',{...p,danmu_api_url_2:count>=2?'https://two.example/token':'',danmu_api_url_3:count>=3?'https://three.example/token':''});
    samples.push(performance.now()-start);requests=app.calls.length;
    if(!response.animes.length)throw Error('empty benchmark result');
    await new Promise(r=>setTimeout(r,160));
  }
  results.push({name,mock:true,samplesMs:samples.map(n=>+n.toFixed(2)),meanFirstResultMs:+(samples.reduce((a,b)=>a+b)/samples.length).toFixed(2),requests});
}
console.log(JSON.stringify(results,null,2));
if(process.env.DANMU_BENCH_REPORT)fs.writeFileSync(process.env.DANMU_BENCH_REPORT,JSON.stringify(results,null,2)+'\n');

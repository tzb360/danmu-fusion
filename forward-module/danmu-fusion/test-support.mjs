import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./danmu-fusion.js',import.meta.url),'utf8');
export const base={danmu_api_url:'https://api.example/token',type:'tv',title:'测试作品',seriesName:'测试作品',season:2,episode:12,year:'2024'};
export const row=(source,time=10,content='这个镜头真的很精彩',extra={})=>({source,time,content,episode:'s2e12',color:16777215,position:1,...extra});
export function runtime(handler,stored=new Map()) {
  const calls=[], logs=[];
  const call=async(method,url,body,options)=>{ calls.push({method,url,body,options}); return handler(method,url,body,options); };
  const sandbox={console:{log:(...args)=>logs.push(args.join(' '))},setTimeout,clearTimeout,module:{exports:{}},Widget:{
    http:{get:(u,o)=>call('GET',u,undefined,o),post:(u,b,o)=>call('POST',u,b,o)},
    storage:{get:async k=>stored.get(k),set:async(k,v)=>{stored.set(k,structuredClone(v));},remove:async k=>stored.delete(k)}
  }};
  vm.createContext(sandbox); vm.runInContext(code,sandbox);
  return {...sandbox.module.exports,calls,logs,stored,sandbox,loadResult:p=>sandbox.module.exports._test.fusionLoad(p)};
}
// Explicitly exercise the retained experimental engine. These tests are NOT
// evidence that the public Forward adapter works; nativeRuntime covers that.
export function engineRuntime(handler,stored=new Map()) {
  const app=runtime(handler,stored), engine=app._test;
  app.logs.length=0;
  return {...app,searchDanmu:async p=>{try{return await engine.fusionSearch(p);}catch(e){return {animes:[],error:e.message};}},getDetailById:async p=>{try{return await engine.fusionDetail(p);}catch(e){return [];}},
    getCommentsById:async p=>(await engine.fusionLoad(p,true)).comments,
    getDanmuWithSegmentTime:async p=>(await engine.fusionLoad(p)).comments};
}
export function apiFixture(options={}) {
  const candidates=['tencent','iqiyi','bilibili'].slice(0,options.sources || 2).map((source,i)=>({animeId:i+1,source,animeTitle:'测试作品 S02 (2024)',type:'tvseries',startDate:'2024-01-01',links:[{id:100+i,title:'第12集',url:'https://video.example/'+i}]}));
  if (options.merged) { candidates[0].mergedChildren=[{animeId:2,source:'iqiyi'}]; candidates[0].links[0].url='tencent:x$$$iqiyi:y'; }
  return async(method,address,body)=>{
    const u=new URL(address);
    if (u.pathname.endsWith('/search/anime')) return {data:{animes:candidates}};
    const bangumi=u.pathname.match(/bangumi\/(\d+)/);
    if (bangumi) return {data:{bangumi:{episodes:[{episodeId:99+Number(bangumi[1]),episodeTitle:'第12集'}]}}};
    const comment=u.pathname.match(/comment\/(\d+)/);
    if (comment) {
      if (options.full) return {data:{comments:[{p:'10,1,16777215',m:'这个镜头真的很精彩',cid:'full'}]}};
      return {data:{comments:{segmentList:[0,60,120,180].map(start=>({type:Number(comment[1])===100?'qq':Number(comment[1])===101?'qiyi':'bilibili1',segment_start:start,segment_end:start+60,url:'https://segments.example/'+comment[1]+'/'+start}))}}};
    }
    if (method==='POST' && u.pathname.endsWith('/segmentcomment')) {
      if (options.fail && body.type==='qiyi') return {status:503,data:{}};
      const t=body.segment_start+10+(body.type==='qq'?0:1);
      return {data:{comments:[{p:t+',1,16777215',m:'这个镜头真的很精彩',cid:body.type+'-'+t}]}};
    }
    throw new Error('Unexpected request');
  };
}


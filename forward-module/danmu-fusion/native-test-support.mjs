import fs from 'node:fs';
import vm from 'node:vm';
export const fusionPath=new URL('./danmu-fusion.js',import.meta.url);
export const referencePaths={rex:process.env.DANMU_REFERENCE_REX || new URL('./references/rex.danmu.js',import.meta.url).pathname,makka:process.env.DANMU_REFERENCE_MAKKA || new URL('./references/rex.danmu.makka.js',import.meta.url).pathname,universal:process.env.DANMU_REFERENCE_UNIVERSAL || new URL('./references/baranwang.danmu.universal.js',import.meta.url).pathname};
export function nativeRuntime(handler,{path=fusionPath,storage=new Map(),stage,post=false}={}){
  const calls=[],logs=[];
  const call=async(method,url,data,options={})=>{calls.push({method,url,data,options});return handler(method,url,data,options);};
  const sandbox={console:Object.fromEntries(['log','warn','error','debug'].map(method=>[method,(...args)=>logs.push(args.map(String).join(' '))])),module:{exports:{}},Widget:{
    http:{get:(u,o)=>call('GET',u,undefined,o),request:o=>call(o.method || 'GET',o.url,o.data,{headers:o.headers})},
    storage:{get:k=>storage.get(k),set:(k,v)=>{if(typeof v!=='string')throw new TypeError('Widget.storage expects strings');storage.set(k,v);},remove:k=>storage.delete(k)}
  }};
  if(post)sandbox.Widget.http.post=(u,b,o)=>call('POST',u,b,o);
  // Intentionally NO browser/Node helpers or timers inside the Widget VM.
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path,'utf8'),sandbox);
  if(stage!=null)sandbox.module.exports._test.compatSetStage(stage);
  return {sandbox,calls,logs,storage,exports:sandbox.module.exports,metadata:sandbox.WidgetMetadata,
    invoke:async(id,params)=>{
      const registration=sandbox.WidgetMetadata.modules.find(m=>m.id===id);
      if(!registration || typeof sandbox[registration.functionName]!=='function')throw new Error('Invalid registered function: '+id);
      return sandbox[registration.functionName](params);
    }
  };
}
export const media={danmu_api_url:'https://api.example/token',server:'https://api.example/token',type:'tv',title:'测试剧',seriesName:'测试剧',season:'2',episode:'12',year:'2024'};
export function selectEpisode(episodes,item){
  if(item.type==='movie'){
    if(episodes.length===1)return episodes[0];
    const clean=s=>String(s || '').replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/,'').replace(/[（(](?:19|20)\d{2}[)）]/g,'').replace(/\s+/g,'').trim();
    return episodes.find(e=>/正片|全片/.test(e.episodeTitle || '') || clean(e.episodeTitle)===clean(item.title));
  }
  return episodes.find(e=>{const t=String(e.episodeTitle || '').replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/,'');const m=t.match(/第\s*(\d+)\s*[集话話]|^\s*(\d+)\s*$/);return Number(m?m[1] || m[2]:e.episodeNumber)===Number(item.episode);});
}
export function standardFixture({empty=false,duplicates=false,alternate=false}={}){
  return async(method,address)=>{
    const u=new URL(address);
    if(u.pathname.endsWith('/match'))return {data:{success:true,isMatched:false,matches:[]}};
    if(u.pathname.endsWith('/search/anime') || u.pathname.endsWith('/search/episodes'))return {data:{success:true,animes:empty?[]:[{animeId:42,bangumiId:alternate?'A42':undefined,animeTitle:'测试剧 S02 (2024)',type:'tvseries',startDate:'2024-01-01'}]}};
    if(u.pathname.endsWith('/bangumi/42') && alternate)return {statusCode:404,data:{}};
    if(/\/bangumi\/(42|A42)$/.test(u.pathname))return {data:{success:true,bangumi:{episodes:[{episodeId:'E12',episodeTitle:'第12集',episodeNumber:'12'},{episodeId:'E13',episodeTitle:'第13集',episodeNumber:'13'}]}}};
    if(u.pathname.endsWith('/comment/E12')){
      const list=[{cid:'a',p:'12.34,1,16711680,user',m:'红色滚动'},{cid:'b',p:'650,4,255,user',m:'蓝色底部'},{cid:'c',p:'1250,5,65280,user',m:'绿色顶部'}];
      if(duplicates)list.splice(1,0,{...list[0]});
      return {data:{success:true,count:list.length,comments:list}};
    }
    return {statusCode:404,data:{success:false}};
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { base, engineRuntime as runtime, apiFixture } from './test-support.mjs';

const retired=['api_mode','aggregate','sources','source_priority','dedupe','dedupe_tolerance','offset_owner','offset_rules','cache_ttl','timeout','retry','cache','color_to_white','force_scroll','debug'];
const standardParams={...base,animeId:42,commentId:420012};
function standardApi(options={}) {
  return async(method,address)=>{
    const url=new URL(address);
    if(url.pathname.endsWith('/search/anime')) return {data:{animes:[{animeId:42,animeTitle:'测试作品 S02',type:'tvseries'}]}};
    if(url.pathname.endsWith('/bangumi/42')) return {data:{bangumi:{animeId:42,animeTitle:'测试作品 S02',episodes:[{episodeId:420012,episodeNumber:'12',episodeTitle:'第12集'}]}}};
    if(url.pathname.endsWith('/comment/420012')) {
      if(options.rejectExtension && url.searchParams.has('segmentflag')) return {status:400,data:{}};
      return {data:{count:3,comments:[{cid:1,p:'12.34,1,16711680,100',m:'红色滚动'},{cid:2,p:'14,4,255,101',m:'蓝色底部'},{cid:3,p:'16,5,65280,102',m:'绿色顶部'}]}};
    }
    return {status:404,data:{}};
  };
}

test('settings expose exactly three API addresses, including all module-level params',()=>{
  const app=runtime(standardApi()), meta=app.WidgetMetadata;
  assert.equal(meta.id,'tzb360.danmu.fusion');
  assert.equal(meta.version,'1.5.1');
  assert.equal(meta.globalParams.length,3);
  assert.equal(meta.globalParams[0].name,'danmu_api_url');
  assert.equal(meta.globalParams[0].title,'弹幕 API 1（主要接口）');
  assert.equal(meta.globalParams[0].type,'input');
  assert.ok(meta.modules.every(m=>m.params.length===0));
});

test('bare, token, proxy and api/v2 addresses normalize without changing token bytes',async()=>{
  const cases=[
    ['https://api.example','https://api.example'],
    ['https://api.example/','https://api.example'],
    ['https://api.example/api/v2/','https://api.example'],
    ['https://api.example/T0','https://api.example/T0'],
    ['https://api.example/T0/api/v2','https://api.example/T0'],
    ['https://api.example/proxy/a%2Fb%3Fc%23d/api/v2/','https://api.example/proxy/a%2Fb%3Fc%23d'],
    ['https://api.example/token/api/forward/danmaku?title=old','https://api.example/token'],
    ['https://api.example/token/api/v2/forward/danmaku','https://api.example/token'],
    ['https://api.example/my/api/v2/token','https://api.example/my/api/v2/token']
  ];
  for(const [address,prefix] of cases) {
    const app=runtime(standardApi());
    assert.equal(app._test.parseDanmuApiUrl(address).requestBase,prefix);
    const result=await app.searchDanmu({...base,danmu_api_url:address});
    assert.equal(result.animes.length,1,address);
    assert.equal(app.calls[0].url,prefix+'/api/v2/search/anime?keyword='+encodeURIComponent(base.title));
  }
});

test('standard Dandan API works with only API address and media context, without any extension metadata',async()=>{
  const app=runtime(standardApi());
  const search=await app.searchDanmu(base); assert.equal(search.animes[0].animeId,42);
  const detail=await app.getDetailById({...base,animeId:42}); assert.equal(detail[0].episodeId,420012);
  const result=await app.loadResult(standardParams);
  assert.equal(result.count,3); assert.equal(result.fullFallback,true);
  assert.equal(result.aggregation.mode,'single'); assert.equal(result.aggregation.sourceCount,null);
  assert.deepEqual(Array.from(result.comments,c=>c.p),['12.34,1,16711680','14,4,255','16,5,65280']);
  assert.equal(result.finalDanmuStats.top,1); assert.equal(result.finalDanmuStats.bottom,1);
  assert.ok(app.calls.filter(c=>c.url.includes('/comment/')).every(c=>new URL(c.url).searchParams.get('withRelated')==='true'));
});

test('unsupported extension query falls back to canonical comments and is negatively cached',async()=>{
  const app=runtime(standardApi({rejectExtension:true}));
  assert.equal((await app.loadResult(standardParams)).count,3);
  assert.equal(app.calls.filter(c=>c.url.includes('segmentflag')).length,1);
  const fallback=app.calls.find(c=>c.url.includes('/comment/')&&!c.url.includes('segmentflag'));
  assert.ok(fallback); assert.equal(new URL(fallback.url).search,'?withRelated=true');
  await app.loadResult({...standardParams,segmentTime:75});
  assert.equal(app.calls.filter(c=>c.url.includes('segmentflag')).length,1);
});

test('unavailable POST extension or missing Widget.http.post falls back to a standard full track',async()=>{
  for(const status of [404,405,501,'missing']) {
    const fixture=apiFixture({sources:1});
    const app=runtime(async(m,u,b)=>{
      if(m==='POST') return {status:status,data:{}};
      if(u.includes('/comment/')&&!u.includes('segmentflag')) return {data:{comments:[{p:'10,5,255,u',m:'保留标准弹幕',cid:1}]}};
      return fixture(m,u,b);
    });
    if(status==='missing') delete app.sandbox.Widget.http.post;
    const result=await app.loadResult(base);
    assert.equal(result.count,1,String(status)); assert.equal(result.fullFallback,true);
  }
});

test('removed setting properties are never read, even when accessing one would throw',async()=>{
  const app=runtime(apiFixture({sources:3})), params={...base};
  retired.forEach(name=>Object.defineProperty(params,name,{get(){throw new Error('obsolete config accessed: '+name);}}));
  const search=await app.searchDanmu(params); assert.ok(Number(search.animes[0].animeId)<0);
  const result=await app.loadResult(params);
  assert.equal(result.count,1); assert.equal(result.aggregation.mode,'client'); assert.equal(result.aggregation.sourceCount,3);
  assert.equal(app.logs.length,0);
});

test('malformed retired settings cannot change defaults, disable cache or corrupt matching',async()=>{
  const app=runtime(apiFixture());
  const dirty={...base,api_mode:'fusion',aggregate:'0',sources:'none',source_priority:123,dedupe:'0',dedupe_tolerance:-999,offset_owner:'client',offset_rules:'{broken',cache_ttl:-1,timeout:1,retry:999,cache:'0',color_to_white:'1',force_scroll:'1',debug:'1'};
  assert.equal(app._test.fusionOptions(dirty).signature,app._test.fusionOptions(base).signature);
  const result=await app.loadResult(dirty); assert.equal(result.count,1);
  const count=app.calls.length; await app.loadResult(dirty); assert.equal(app.calls.length,count);
  assert.equal(app.logs.length,0);
});

test('old full endpoint URLs and synthetic selections migrate without sending synthetic IDs to standard API',async()=>{
  const app=runtime(apiFixture());
  const params={...base,danmu_api_url:'https://api.example/token/api/forward/danmaku',animeId:'tmdb_34307_tv_s2__auto',commentId:343072012};
  assert.equal((await app.loadResult(params)).count,1);
  assert.ok(app.calls.every(c=>c.url.startsWith('https://api.example/token/api/v2/')));
  assert.ok(app.calls.every(c=>!c.url.includes(String(params.commentId))));
});

test('documented search/episodes fallback supplies real episode IDs without a bangumi endpoint',async()=>{
  const fixture=apiFixture({sources:1});
  const app=runtime(async(m,u,b)=>{
    if(u.includes('/search/anime')) return {status:404,data:{}};
    if(u.includes('/search/episodes')) return {data:{animes:[{animeId:1,animeTitle:'测试作品 S02 (2024)',type:'tvseries',startDate:'2024-01-01',source:'tencent',episodes:[{episodeId:100,episodeTitle:'第12集'}]}]}};
    return fixture(m,u,b);
  });
  const search=await app.searchDanmu(base); assert.ok(Number(search.animes[0].animeId)<0);
  assert.equal((await app.loadResult(base)).count,1);
  assert.ok(!app.calls.some(c=>c.url.includes('/bangumi/')));
  const request=app.calls.find(c=>c.url.includes('/search/episodes'));
  assert.equal(new URL(request.url).searchParams.get('episode'),'12');
});

test('TMDB-scoped standard bangumi respects explicit season names and never mixes E12 across seasons',async()=>{
  const fixture=apiFixture({sources:1});
  const app=runtime(async(m,u,b)=>{
    if(u.includes('/search/anime')) return {data:{animes:[{animeId:42,bangumiId:'tmdb-tv-123',animeTitle:'测试作品',type:'tmdbtv'}]}};
    if(u.includes('/bangumi/')) return {data:{bangumi:{seasons:[{id:'a',name:'Season 1'},{id:'b',name:'Season 2'}],episodes:[{seasonId:'a',episodeId:999,episodeTitle:'第12集'},{seasonId:'b',episodeId:100,episodeTitle:'第12集'}]}}};
    return fixture(m,u,b);
  });
  const result=await app.loadResult({...base,tmdbId:'123'});
  assert.equal(result.count,1); assert.ok(app.calls.some(c=>c.url.includes('/comment/100?')));
  assert.ok(!app.calls.some(c=>c.url.includes('/comment/999?')));
});

test('unsupported visual modes degrade to scroll while preserving color and server timestamps',async()=>{
  const fixture=standardApi();
  const app=runtime(async(m,u,b)=>u.includes('/comment/')?{data:{comments:[{p:'20,7,123,u',m:'高级类型降级',cid:1},{p:'30,5,25,456,0,0,u,2',m:'B站八字段',cid:2}]}}:fixture(m,u,b));
  const result=await app.loadResult(standardParams);
  assert.deepEqual(Array.from(result.comments,c=>c.p),['20,1,123','30,5,456']);
});

test('global HTTP concurrency stays within three even with nested source/segment pools',async()=>{
  let active=0,max=0;
  const fixture=apiFixture({sources:3});
  const app=runtime(async(...args)=>{active++;max=Math.max(max,active);try{await new Promise(r=>setTimeout(r,3));return await fixture(...args);}finally{active--;}});
  const results=await Promise.all([0,60,120].map(segmentTime=>app.loadResult({...base,segmentTime})));
  assert.ok(results.every(r=>r.comments)); assert.ok(max<=3,String(max));
});

test('changing only API suffix uses the same cache but changing token isolates it',async()=>{
  const app=runtime(apiFixture());
  await app.loadResult(base); const count=app.calls.length;
  await app.loadResult({...base,danmu_api_url:base.danmu_api_url+'/api/v2/'}); assert.equal(app.calls.length,count);
  await app.loadResult({...base,danmu_api_url:'https://api.example/another-token'}); assert.ok(app.calls.length>count);
});

test('single-source service never claims cross-platform aggregation',async()=>{
  const app=runtime(apiFixture({sources:1}));
  const result=await app.loadResult(base);
  assert.equal(result.aggregation.mode,'single'); assert.equal(result.aggregation.sourceCount,1);
});

test('no legacy mode/config readers or dedicated API requests remain in the shipped module',()=>{
  const source=fs.readFileSync(new URL('./danmu-fusion.js',import.meta.url),'utf8');
  for(const name of retired) assert.ok(!new RegExp('(?:params|p)\\.'+name+'\\b').test(source),name);
  assert.ok(!source.includes('/api/forward/danmaku?'));
  assert.ok(!/\b(?:require\(|from ['"]node:)/.test(source));
});

test('official Forward barrage_list uses GET segments without requiring the POST extension',async()=>{
  const fixture=standardApi();
  const app=runtime(async(m,u,b)=>{
    if(u.includes('/comment/')) return {data:{barrage_list:[{segment_start:0,segment_end:60,segment_url:'https://segments.example/signed-fragment'}]}};
    if(u==='https://segments.example/signed-fragment') return {data:[{p:'15,5,255,u',m:'官方分片格式',cid:1}]};
    return fixture(m,u,b);
  });
  delete app.sandbox.Widget.http.post;
  const result=await app.loadResult(standardParams);
  assert.equal(result.count,1); assert.equal(result.fullFallback,false);
  assert.equal(result.comments[0].p,'15,5,255');
  assert.ok(app.calls.every(c=>c.method==='GET'));
});

test('actual HTTP transport against an isolated standard-protocol fixture, including token path',async t=>{
  const paths=[], fixture=standardApi({rejectExtension:true});
  const server=http.createServer(async(req,res)=>{
    paths.push(req.url);
    if(!req.url.startsWith('/private-token/api/v2/')) {res.writeHead(403).end();return;}
    const result=await fixture(req.method,'http://localhost'+req.url);
    res.writeHead(result.status || 200,{'Content-Type':'application/json'}).end(JSON.stringify(result.data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const app=runtime(async(method,url,body,options)=>{
    const response=await fetch(url,{method,headers:options.headers,body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.text()};
  });
  const params={...base,danmu_api_url:'http://127.0.0.1:'+server.address().port+'/private-token/api/v2'};
  const search=await app.searchDanmu(params);
  const detail=await app.getDetailById({...params,animeId:search.animes[0].animeId});
  const result=await app.loadResult({...params,animeId:search.animes[0].animeId,commentId:detail[0].episodeId});
  assert.equal(result.count,3); assert.equal(result.fullFallback,true);
  assert.ok(paths.every(path=>path.startsWith('/private-token/api/v2/')));
  assert.ok(!JSON.stringify([app.logs,result]).includes('private-token'));
});

test('release indices match the complete importable module and preserve the established ID',()=>{
  const app=runtime(standardApi());
  for(const name of ['widget.fwd','danmu-fusion.fwd']) {
    const index=JSON.parse(fs.readFileSync(new URL('./'+name,import.meta.url),'utf8'));
    assert.equal(index.widgets[0].id,app.WidgetMetadata.id);
    assert.equal(index.widgets[0].version,app.WidgetMetadata.version);
    assert.equal(index.widgets[0].url,'./danmu-fusion.js');
  }
});

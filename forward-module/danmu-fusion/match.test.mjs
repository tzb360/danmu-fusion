import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRuntime} from './native-test-support.mjs';
const params={danmu_api_url:'https://api.example/token/api/v2',type:'movie',title:'同名作品',year:2024,season:0,episode:0};
const catalog=[{animeId:1,animeTitle:'同名作品(1990)',type:'movie'}, {animeId:2,animeTitle:'同名作品(2024)',type:'movie'}, {animeId:3,animeTitle:'同名作品(2024)',type:'movie'}];
function fixture({animes=catalog,match,fail}={}){
  return async(method,url,body)=>{
    if(url.includes('/match')){if(fail)return fail();return {data:match || {isMatched:true,matches:[{...animes[2],episodeId:'match-episode',episodeTitle:'正片',shift:90}]}};}
    if(url.includes('/search/'))return {data:{animes}};
    if(url.includes('/bangumi/'))return {data:{bangumi:{episodes:[{episodeId:'real-comment',episodeTitle:'正片'}]}}};
    return {data:{comments:[{cid:1,p:'12,1,255,[tencent]',m:'原时间和颜色'}],count:1}};
  };
}
test('year-disambiguation uses only official MatchRequest fields and retains the real ID baseline',async()=>{
  const app=nativeRuntime(fixture());const result=await app.invoke('searchDanmu',params);
  assert.deepEqual(Array.from(result.animes,a=>a.animeId),[3,2]);
  const request=app.calls.find(c=>c.method==='POST');assert.equal(request.url,'https://api.example/token/api/v2/match');
  assert.deepEqual(JSON.parse(JSON.stringify(request.data)),{fileName:'同名作品.2024',fileHash:null,fileSize:0,videoDuration:0,matchMode:'fileNameOnly'});
  assert.ok(!('year' in request.data));assert.ok(!('episodes' in result.animes[0]));
  const detail=await app.invoke('getDetail',{...params,animeId:3});
  assert.equal(detail[0].episodeId,'real-comment');
  const comments=await app.invoke('getComments',{danmu_api_url:params.danmu_api_url,commentId:detail[0].episodeId});
  assert.equal(comments.comments[0].p,'12,1,255,[tencent]'); // match shift is advisory and never applied twice
});
test('same-year or missing-year searches add no match request',async()=>{
  for(const animes of [catalog.slice(1),[{animeId:4,animeTitle:'同名作品',type:'movie'}]]){
    const app=nativeRuntime(fixture({animes}));assert.ok((await app.invoke('searchDanmu',params)).animes.length);
    assert.equal(app.calls.filter(c=>c.method==='POST').length,0);
  }
});
test('isMatched true cannot promote conflicting years, types, derivative names or unknown IDs',async()=>{
  for(const match of [
    {...catalog[0],episodeId:'wrong'},
    {...catalog[2],type:'tvseries',episodeId:'wrong'},
    {...catalog[2],animeTitle:'同名作品 解说(2024)',episodeId:'wrong'},
    {...catalog[2],animeId:999,episodeId:'wrong'},
    {...catalog[2],animeTitle:'同名作品(1990)',episodeId:'wrong'}
  ]){
    const app=nativeRuntime(fixture({match:{isMatched:true,matches:[match]}}));
    assert.deepEqual(Array.from((await app.invoke('searchDanmu',params)).animes,a=>a.animeId),[2,3]);
    assert.ok(app.exports._test.compatDiagnostics().some(e=>e.stage==='Match' && e.code==='UNVERIFIED'));
  }
});
test('native merged candidates stay ahead of a matched single-source candidate',async()=>{
  const animes=catalog.map(c=>c.animeId===2?{...c,mergedChildren:[{source:'iqiyi'}]}:c);
  const app=nativeRuntime(fixture({animes}));assert.equal((await app.invoke('searchDanmu',params)).animes[0].animeId,2);
});
test('unsupported match is remembered and GET-only Widgets retain standard search',async()=>{
  const app=nativeRuntime(fixture({fail:()=>({statusCode:404,data:{}})}));
  for(let i=0;i<2;i++)assert.equal((await app.invoke('searchDanmu',params)).animes.length,2);
  assert.equal(app.calls.filter(c=>c.method==='POST').length,1);
  const getOnly=nativeRuntime(fixture());delete getOnly.sandbox.Widget.http.request;
  assert.equal((await getOnly.invoke('searchDanmu',params)).animes.length,2);assert.equal(getOnly.calls.length,1);
});
test('optional POST failures and corrupt bodies cannot discard successful search results or leak tokens',async()=>{
  for(const fail of [()=>{throw {name:'TimeoutError',message:'https://api.example/private-token'};},()=>({data:'corrupt private-token JSON'}),()=>({data:{matches:{}}})]){
    const app=nativeRuntime(fixture({fail}));assert.equal((await app.invoke('searchDanmu',params)).animes.length,2);
    assert.ok(!app.logs.join('\n').includes('private-token'));assert.ok(app.logs.join('\n').includes('keeping standard search results'));
  }
});
test('later-season premiere years are not sent as episode years; real airDate can disambiguate',async()=>{
  const animes=[{animeId:4,animeTitle:'同名剧4(2014)',type:'tvseries'},{animeId:5,animeTitle:'同名剧4(2024)',type:'tvseries'}];
  const base={...params,title:'同名剧',seriesName:'同名剧',type:'tv',season:4,episode:2,year:2009};
  const noAir=nativeRuntime(fixture({animes}));await noAir.invoke('searchDanmu',base);assert.equal(noAir.calls.length,1);
  for(const episodeTitle of ['第2集','第2集 第一季','第3集','SP 第2集']){
    const app=nativeRuntime(fixture({animes,match:{isMatched:true,matches:[{...animes[0],episodeId:'E2',episodeTitle}]}}));
    const result=await app.invoke('searchDanmu',{...base,airDate:'2014-01-17'});
    assert.deepEqual(Array.from(result.animes,a=>a.animeId),[4]);
    assert.equal(app.calls.find(c=>c.method==='POST').data.fileName,'同名剧.2014.S04E02');
    const verified=app.exports._test.compatDiagnostics().some(e=>e.stage==='Match' && e.code==='YEAR_VERIFIED');
    assert.equal(verified,episodeTitle==='第2集');
  }
});
test('a number in the film title is not its release year',async()=>{
  const animes=[{animeId:1,animeTitle:'2001太空漫游(1968)',type:'movie'},{animeId:2,animeTitle:'2001太空漫游(2024)',type:'movie'}];
  const app=nativeRuntime(fixture({animes,match:{matches:[{...animes[0],episodeId:1,episodeTitle:'正片'}]}}));
  const result=await app.invoke('searchDanmu',{...params,title:'2001太空漫游',year:1968});
  assert.equal(app.calls.find(c=>c.method==='POST').data.fileName,'2001太空漫游.1968');assert.equal(result.animes[0].animeId,1);
});

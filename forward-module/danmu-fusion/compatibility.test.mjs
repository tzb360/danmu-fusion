import test from 'node:test';
import assert from 'node:assert/strict';
import {base,engineRuntime as runtime,apiFixture} from './test-support.mjs';

function seriesApi(candidates,episodes=[{episodeId:22,episodeTitle:'【qq】 第2集'}]) {
  return async(method,address)=>{
    const url=new URL(address);
    if(url.pathname.endsWith('/search/anime'))return {data:{animes:candidates}};
    if(url.pathname.includes('/bangumi/'))return {data:{bangumi:{episodes:episodes.map(e=>({...e}))}}};
    if(url.pathname.includes('/comment/'))return {data:{comments:[{cid:1,p:'10,1,16777215,u',m:'开场弹幕'},{cid:2,p:'650,5,255,u',m:'续播弹幕'}]}};
    throw new Error('unexpected fixture request');
  };
}
const numbered={...base,title:'示例喜剧4',seriesName:'示例喜剧4',year:2014,season:4,episode:2};
const listing=(animeId,title,year,source='tencent',type='国产剧')=>({animeId,bangumiId:'platform-video-'+animeId,animeTitle:title+'('+year+')【'+type+'】from '+source,source,type});

test('numeric season suffix and localized television categories match generically',async()=>{
  for(const type of ['国产剧','日剧','港劇','电视剧','tvseries']){
    const app=runtime(seriesApi([listing(1,'示例喜剧4',2014,'tencent',type),listing(2,'示例喜剧3',2012,'tencent',type)]));
    const search=await app.searchDanmu(numbered);
    assert.ok(search.animes.some(a=>Number(a.animeId)<0),type);
    const result=await app.loadResult(numbered);assert.equal(result.count,1,type);
    assert.ok(app.calls.some(c=>c.url.includes('/bangumi/1')));
    assert.ok(!app.calls.some(c=>c.url.includes('/bangumi/platform-video-')));
    assert.ok(!app.calls.some(c=>c.url.includes('/bangumi/2')));
  }
});

test('unlabelled exact first season is supported with year and explicit television type',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧',2009)]));
  const p={...numbered,title:'示例喜剧',seriesName:'示例喜剧',year:2009,season:1};
  assert.equal((await app.loadResult(p)).count,1);
  assert.equal((await app.loadResult({...p,season:2})).count,0);
});

test('series premiere year is accepted only with corroborating first-season evidence',async()=>{
  const candidates=[listing(1,'示例喜剧',2009),listing(4,'示例喜剧4',2014),listing(5,'示例喜剧5',2020),listing(6,'示例喜剧',2018,'tencent','电影')];
  const app=runtime(seriesApi(candidates));
  assert.equal((await app.loadResult({...numbered,year:2009})).count,1);
  assert.equal((await app.loadResult({...numbered,year:2010})).count,0);
  assert.ok(!app.calls.some(c=>/bangumi\/(5|6)(?:$|\?)/.test(c.url)));
});

test('cross-platform premiere evidence needs independent agreement and unique target-season year',async()=>{
  const p={...numbered,title:'示例喜剧',seriesName:'示例喜剧',year:2009};
  const target=listing(4,'示例喜剧4',2014,'tencent');
  for(const [evidence,expected] of [
    [[listing(1,'示例喜剧',2009,'youku')],0],
    [[listing(1,'示例喜剧',2009,'youku'),listing(2,'示例喜剧1',2009,'iqiyi')],1],
    [[listing(1,'示例喜剧',2009,'youku'),listing(2,'示例喜剧1',2010,'iqiyi')],0],
    [[listing(1,'示例喜剧',2009,'youku'),listing(2,'示例喜剧1',2009,'iqiyi'),listing(8,'示例喜剧4',2024,'bilibili')],0]
  ]){
    const app=runtime(seriesApi([target,...evidence]));
    assert.equal((await app.loadResult(p)).count,expected);
  }
});

test('conflicting remake years never override the requested year automatically',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧',2009),listing(2,'示例喜剧',2020),listing(4,'示例喜剧4',2014)]));
  assert.equal((await app.loadResult({...numbered,year:2009})).count,0);
  const ambiguous=runtime(seriesApi([listing(1,'示例喜剧',2009),listing(4,'示例喜剧4',2014),listing(5,'示例喜剧4',2024)]));
  assert.equal((await ambiguous.loadResult({...numbered,year:2009})).count,0);
});

test('numeric film titles, specials, sequel numbers and wrong seasons remain distinct',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧4',2014),listing(2,'示例喜剧4 SP',2014),listing(3,'示例喜剧4',2014,'iqiyi','电影')]));
  assert.equal((await app.loadResult({...numbered,season:3})).count,0);
  const movie=runtime(seriesApi([listing(4,'示例电影2',2023,'tencent','华语电影'),listing(5,'示例电影',2019,'tencent','华语电影')]));
  assert.equal((await movie.loadResult({...numbered,title:'示例电影2',seriesName:'示例电影2',type:'movie',year:2023})).count,1);
  assert.ok(!movie.calls.some(c=>c.url.includes('/bangumi/5')));
});

test('source-labelled numeric episodes are parsed but specials and duplicated platform numbers are rejected',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧4',2014)],[{episodeId:22,episodeTitle:'【qq】 02'}]));
  assert.equal((await app.loadResult(numbered)).count,1);
  assert.equal(app._test.fusionEpisodeNumber({episodeTitle:'【SP】 02'}),null);
  assert.equal(app._test.fusionEpisodeNumber({episodeTitle:'【qq】 02（上）'}),null);
  const ambiguous=runtime(seriesApi([listing(1,'示例喜剧4',2014)],[{episodeId:22,episodeTitle:'【qq】 第2集'},{episodeId:23,episodeTitle:'【qiyi】 第2集'}]));
  assert.equal((await ambiguous.loadResult(numbered)).count,0);
});

test('native public methods return comment arrays and serializable numeric IDs',async()=>{
  const app=runtime(apiFixture());
  const search=JSON.parse(JSON.stringify(await app.searchDanmu(base)));
  const animeId=search.animes[0].animeId;assert.equal(typeof animeId,'number');assert.ok(animeId<0 && animeId>=-2147483648);
  const detail=JSON.parse(JSON.stringify(await app.getDetailById({...base,animeId})));
  const commentId=detail[0].episodeId;assert.equal(typeof commentId,'number');
  const comments=await app.getCommentsById({...base,animeId,commentId});assert.ok(Array.isArray(comments));assert.equal(comments.length,1);
  assert.ok(Array.isArray(await app.getDanmuWithSegmentTime({...base,animeId,commentId,segmentTime:120})));
  assert.ok(!app.calls.some(c=>/comment\/-/.test(c.url)));
});

test('standard full-track initial load preserves later comments; seek returns only the target window',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧4',2014)]));
  const comments=await app.getCommentsById(numbered);
  assert.ok(Array.isArray(comments));assert.equal(comments.length,2);assert.equal(comments[1].p,'650,5,255');
  const seek=await app.getDanmuWithSegmentTime({...numbered,segmentTime:600});
  assert.equal(seek.length,1);assert.equal(seek[0].m,'续播弹幕');
  const count=app.calls.length;await app.getCommentsById(numbered);assert.equal(app.calls.length,count);
});

test('native segmented initial load stays lazy and progresses independently of full-track fallback',async()=>{
  const app=runtime(apiFixture({sources:1}));
  assert.equal((await app.getCommentsById(base)).length,1);
  assert.ok(!app.calls.some(c=>c.body?.segment_start>=120));
  await app.getDanmuWithSegmentTime({...base,segmentTime:120});
  assert.ok(app.calls.some(c=>c.body?.segment_start===120));
});

test('comment IDs stay stable across initial/seek callbacks and distinct across windows',async()=>{
  const app=runtime(seriesApi([listing(1,'示例喜剧4',2014)]));
  const full=await app.getCommentsById(numbered);
  const first=await app.getDanmuWithSegmentTime(numbered);
  const later=await app.getDanmuWithSegmentTime({...numbered,segmentTime:600});
  assert.equal(first[0].cid,full[0].cid);assert.equal(later[0].cid,full[1].cid);
  assert.notEqual(first[0].cid,later[0].cid);
  assert.ok(full.every(c=>Number.isSafeInteger(c.cid) && c.cid>=0));
});

test('catalog aliases pointing at one platform do not fetch or claim a second platform',async()=>{
  const candidates=[listing(1,'示例喜剧4',2014,'iqiyi'),listing(2,'示例喜剧4',2014,'360')];
  const fixture=seriesApi(candidates,[{episodeId:22,episodeTitle:'【qiyi】 第2集',url:'https://www.iqiyi.com/v_example.html'}]);
  const app=runtime(async(m,u)=>{
    const result=await fixture(m,u);
    if(u.includes('/bangumi/2'))result.data.bangumi.episodes[0].episodeId=23;
    return result;
  });
  const result=await app.loadResult(numbered);
  assert.equal(result.aggregation.mode,'single');assert.equal(result.aggregation.sourceCount,1);
  assert.ok(!app.calls.some(c=>c.url.includes('/comment/23')));
});

test('cold search has a separate bounded wait and never repeats an expired discovery',async()=>{
  const app=runtime(()=>new Promise(()=>{}));
  app.sandbox.setTimeout=fn=>setTimeout(fn,5);
  const search=await app.searchDanmu(numbered);
  assert.equal(search.animes.length,0);assert.equal(app.calls.length,1);
  assert.equal(app.calls[0].options.timeout,90000);
  const playback=runtime(seriesApi([listing(1,'示例喜剧4',2014)]));
  await playback.getCommentsById(numbered);
  assert.ok(playback.calls.filter(c=>c.url.includes('/comment/')).every(c=>c.options.timeout===30000));
});

test('full-track fallback preserves resume comments even if another source fails',async()=>{
  const fixture=seriesApi([listing(1,'示例喜剧4',2014),listing(2,'示例喜剧4',2014,'iqiyi')]);
  const app=runtime(async(m,u)=>{
    if(u.includes('/bangumi/2'))return {data:{bangumi:{episodes:[{episodeId:23,episodeTitle:'第2集'}]}}};
    if(u.includes('/comment/23'))return {status:403,data:{}};
    return fixture(m,u);
  });
  const comments=await app.getCommentsById(numbered);
  assert.equal(comments.length,2);assert.equal(comments[1].m,'续播弹幕');
});

test('explicit season labels also look up unnumbered premiere evidence',async()=>{
  const candidates=[listing(1,'示例喜剧',2009),listing(4,'示例喜剧 第四季',2014)];
  const app=runtime(seriesApi(candidates));
  const p={...numbered,title:'示例喜剧 第四季',seriesName:'示例喜剧 第四季',year:2009};
  assert.equal((await app.getCommentsById(p)).length,2);
  assert.ok(app.calls.some(c=>new URL(c.url).searchParams.get('keyword')==='示例喜剧'));
});

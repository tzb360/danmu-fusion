import test from 'node:test';
import assert from 'node:assert/strict';
import {strictNativeMergeMatch as match,strictMergeEpisodeAllowed as episodeAllowed,strictMergeEpisodePairAllowed as pair} from './aggregation/strict-source-match.js';
const tv=(title='示例剧4',year=2024,type='国产剧')=>({animeTitle:title+'('+year+')【'+type+'】from tencent',startDate:year+'-01-01',type});
test('strict cross-source identity accepts exact names, punctuation and simplified/traditional seasons',()=>{
  assert.ok(match(tv(),tv('示例剧 第四季')));
  assert.ok(match(tv('無聲的證言 第二季'),tv('无声的证言 S02')));
  assert.ok(match(tv('示例剧'),tv('示例剧 第一季')));
});
test('all configured sources use the same identity guard rather than a two-platform allowlist',()=>{
  for(const source of ['tencent','iqiyi','youku','imgo','bilibili','migu','renren','aiyifan','xigua','dandan','bahamut','animeko'])assert.ok(match({...tv(),source:'tencent'},{...tv(),source}));
});
test('same or similar titles with conflicting years, seasons, media type or TMDB IDs cannot merge',()=>{
  for(const item of [tv('示例剧3'),tv('示例剧4',2020),tv('示例剧4',2024,'电影'),tv('示例剧前传4'),tv('示例剧后传4'),{...tv(),tmdbId:99}])assert.equal(match({...tv(),tmdbId:42},item),false);
});
test('documentaries, commentary, reviews, recaps, trailers and behind-the-scenes are excluded even with equal year/name',()=>{
  for(const label of ['纪录片','解说','赏析','影评','速看','预告','花絮','特辑','幕后制作','documentary','commentary','review','recap']){
    assert.equal(match(tv(),tv('示例剧4 '+label)),false,label);
    assert.equal(match(tv(),tv('示例剧4',2024,label)),false,label);
    assert.equal(episodeAllowed({title:'【bilibili】 第12集 '+label}),false,label);
  }
});
test('specials, collections, parts and cuts never receive inferred season slicing',()=>{
  for(const title of ['示例剧4 SP','示例剧4 OVA','示例剧4 番外','示例剧4 上部','示例剧4 下部','示例剧 全四季合集','示例剧4 导演剪辑版'])assert.equal(match(tv(),tv(title)),false,title);
});
test('movie sequel numbers are not stripped and unknown years/types remain manual',()=>{
  assert.ok(match(tv('示例电影2',2023,'动画电影'),tv('示例电影2',2023,'电影')));
  assert.equal(match(tv('示例电影2',2023,'电影'),tv('示例电影',2023,'电影')),false);
  assert.equal(match(tv(),{animeTitle:'示例剧4',type:'tvseries'}),false);
  assert.equal(match(tv(),{animeTitle:'示例剧4(2024)',type:'unknown'}),false);
});
test('episode proof uses actual titles and never generated array positions or offsets',()=>{
  assert.ok(pair({title:'【qq】 第12集'},{title:'【qiyi】 12'},tv()));
  assert.ok(pair({title:'第十二集'},{title:'EP12'},tv()));
  assert.equal(pair({title:'第12集'},{title:'第13集'},tv()),false);
  assert.equal(pair({title:'无编号章节',episodeNumber:12},{title:'第12集'},tv()),false);
  assert.equal(pair({title:'第12集'},{title:'第12集（上）'},tv()),false);
  assert.equal(pair({title:'第12集'},{title:'SP 第12集'},tv()),false);
});

test('media type comes from metadata, not words appearing inside the work title',()=>{
  assert.equal(match(tv('电影少女 第一季'),tv('电影少女 第二季')),false);
  assert.equal(match(tv('电影少女',2024,'国产剧'),tv('电影少女',2024,'电影')),false);
  assert.ok(match(tv('示例电影',2024,'动作片'),tv('示例电影',2024,'电影')));
});

test('numbers in the title cannot disguise conflicting or missing release years',()=>{
  assert.equal(match({animeTitle:'2001太空漫游(1968)',type:'movie'},{animeTitle:'2001太空漫游(2024)',type:'movie'}),false);
  assert.equal(match({animeTitle:'1984',type:'movie'},{animeTitle:'1984',type:'movie'}),false);
  assert.ok(match({animeTitle:'2001太空漫游(1968)',type:'movie'},{animeTitle:'2001太空漫游(1968)',type:'movie'}));
});

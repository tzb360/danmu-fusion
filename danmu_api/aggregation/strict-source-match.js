/* AGPL-3.0-only. Conservative guard for native source merging.
 * No fuzzy titles, inferred episode offsets, or collection slicing.
 */
import {simplized} from '../utils/zh-util.js';

const derivative=/纪录|紀錄|纪实|紀實|documentary|docuseries|解说|解說|赏析|賞析|影评|影評|剧评|劇評|速看|剧情解析|剧情解读|影视解析|预告|預告|花絮|特辑|特輯|访谈|訪談|采访|採訪|幕后制作|幕後製作|幕后故事|幕後故事|制作纪录|製作紀錄|trailer|behind.the.scenes|making.of|commentary|recap|review/i;
const collection=/合集|全[一二三四五六七八九十\d]+季|第.+至.+季|\bS\d+\s*[-~]\s*S?\d+/i;
function text(value){let t=String(value || '');if(t.normalize)t=t.normalize('NFKC');return simplized(t).trim();}
function number(value){
  if(/^\d+$/.test(value))return Number(value);
  const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  let result=0,current=0;for(const c of value){if(c==='十'){result+=(current || 1)*10;current=0;}else if(digits[c]!=null)current=digits[c];else return null;}return result+current;
}
function category(candidate){
  const t=text([candidate.type,candidate.typeDescription,candidate.mediaType].join(' '));
  const movie=/movie|film|电影|剧场版/i.test(t);
  const tv=/tv|series|drama|episode|番剧|动漫|剧集|电视剧|国产剧|欧美剧|[日韩港台英美泰]剧/i.test(t);
  if(movie && tv)return null;
  if(movie)return 'movie';if(tv)return 'tv';
  if(/(?:动作|喜剧|爱情|科幻|恐怖|惊悚|剧情|战争|冒险|悬疑|犯罪|奇幻|家庭|传记)片/.test(t))return 'movie';
  return null;
}
function special(value){const t=text(value);const m=t.match(/\b(OVA|OAD|SP)\b|特别篇|番外|特典|总集篇/i);return m?String(m[0]).toUpperCase():'regular';}
function versions(value){return (text(value).match(/导演剪辑版|导演版|加长版|未删减版|删减版|国语版|普通话版|粤语版|日语版|英语版|配音版/g) || []).sort().join('|');}
function titleShape(candidate){
  const raw=text(candidate.animeTitle || candidate.title),kind=category(candidate);
  let title=raw.replace(/\s*from\s+[a-z0-9&_-]+.*$/i,'').replace(/^[【\[][^】\]]*[】\]]\s*/,'');
  let season=candidate.season==null?null:Number(candidate.season);
  const marker=title.match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*季|\bS(\d{1,2})(?:E\d+)?\b|season\s*(\d+)/i);
  if(marker){const parsed=number(marker[1] || marker[2] || marker[3]);if(season!=null && season!==parsed)return null;season=parsed;}
  title=title.replace(/[【\[][^】\]]*[】\]]/g,'').replace(/\((?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\)/g,'').replace(/第\s*[零〇一二两三四五六七八九十\d]+\s*季|\bS\d{1,2}(?:E\d+)?\b|season\s*\d+/gi,'');
  title=title.replace(/[\s.,，。:：;；!?！？、'"《》()·_\-]/g,'').toLowerCase();
  if(kind==='tv'){
    const suffix=title.match(/^(.+?[^\d])(\d{1,2})$/);
    if(suffix && Number(suffix[2])>0 && Number(suffix[2])<=30){if(season!=null && season!==Number(suffix[2]))return null;season=Number(suffix[2]);title=suffix[1];}
    if(season==null)season=1;
  }
  const declared=text(candidate.startDate || candidate.year).match(/\b(?:19|20)\d{2}\b/);
  const annotated=raw.match(/\(((?:19|20)\d{2})(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\)/);
  // A number inside the work name (e.g. 2001: A Space Odyssey) is not a year.
  const year=declared?declared[0]:annotated?annotated[1]:null;
  return {title,season:kind==='tv'?season:null,year,kind,special:special(raw),version:versions(raw)};
}
export function strictNativeMergeMatch(primary,secondary){
  if(!primary || !secondary)return false;
  const rawA=[primary.animeTitle,primary.type,primary.typeDescription].join(' '),rawB=[secondary.animeTitle,secondary.type,secondary.typeDescription].join(' ');
  if(derivative.test(text(rawA)) || derivative.test(text(rawB)) || collection.test(text(rawA)) || collection.test(text(rawB)))return false;
  const a=titleShape(primary),b=titleShape(secondary);
  if(!a || !b || !a.kind || !b.kind || !a.title || a.title!==b.title || a.kind!==b.kind || a.season!==b.season || a.special!==b.special || a.version!==b.version)return false;
  if(!a.year || !b.year || a.year!==b.year)return false;
  const idA=primary.tmdbId || primary.tmdb_id,idB=secondary.tmdbId || secondary.tmdb_id;
  return !(idA && idB && String(idA)!==String(idB));
}
export function strictMergeEpisodeAllowed(link){
  const title=text(link && (link.title || link.name));
  return !!title && !derivative.test(title) && special(title)==='regular' && !/上集|下集|上篇|下篇|\(上\)|\(下\)/.test(title);
}
function episodeNumber(link){
  for(const value of [link.title,link.name]){
    const title=text(value).replace(/^[【\[][^】\]]*[】\]]\s*/,'');
    const m=title.match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*[集话]|\bE(?:P)?\s*(\d+)\b|^\s*(\d+)(?:\s|[:：]|$)/i);
    if(m)return number(m[1] || m[2] || m[3]);
  }
  return null;
}
export function strictMergeEpisodePairAllowed(primary,secondary,parent){
  if(!strictMergeEpisodeAllowed(primary) || !strictMergeEpisodeAllowed(secondary))return false;
  if(category(parent)==='movie')return true; // exact film title/year already proven
  const a=episodeNumber(primary),b=episodeNumber(secondary);
  return a!=null && b!=null && a===b && a>0;
}

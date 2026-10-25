/* AGPL-3.0-only. Small Forward adapter; no browser/Node globals required.
 * Reference behavior: real API IDs -> episodes[] -> response.data.
 * Keep the experimental client aggregation engine separate from this path.
 */
// Recovery stages 1..6 are exercised independently by the timer-free harness.
// This is an internal build default, never a user-visible/configurable option.
let compatStage=6;
const compatEvents=[];
const compatLookups=new Map();
const compatResponses=new Map();
const compatPending=new Map();
const compatYearMatches=new Map();
const compatMatchUnsupported=new Set();

function compatLog(stage,code,message) {
  const event={stage:stage,code:code,message:message};
  compatEvents.push(event);if(compatEvents.length>64)compatEvents.shift();
  // Callers supply fixed messages or numeric counts, never native exceptions,
  // parameters, URLs, IDs, response text, headers or token-bearing cache keys.
  if(typeof console!=='undefined' && typeof console.log==='function')console.log('[Danmu Fusion]['+stage+'] '+message);
}
function compatDiagnostics(){return JSON.parse(JSON.stringify(compatEvents));}
function compatSetStage(stage){compatStage=Math.max(1,Math.min(6,Number(stage)||1));compatLookups.clear();compatResponses.clear();compatPending.clear();compatYearMatches.clear();compatMatchUnsupported.clear();}
function compatError(stage,code,message,status){const e=new Error(message);e.fusionSafe=true;e.stage=stage;e.code=code;e.status=status;return e;}
function compatFailure(stage,error){
  if(error && error.fusionSafe)compatLog(error.stage,error.code,error.message);
  else compatLog(stage,'RUNTIME_ERROR','Unexpected module runtime error');
}
function compatConfig(params){
  try{
    const cfg=parseDanmuApiUrl(firstPresent(params,['danmu_api_url','server']) || '');
    if(/\/api\/v2\/(?:search\/(?:anime|episodes)|bangumi\/[^/]+|comment\/[^/]+|match|segmentcomment)\/?$/i.test(cfg.requestBase))throw new Error('endpoint');
    compatLog('Address','OK','API address normalized');return cfg;
  }catch(e){throw compatError('Address','INVALID_ADDRESS','Invalid API address; use an HTTP(S) server root or /api/v2 suffix');}
}
function compatPresent(id){return id!==undefined && id!==null && String(id).trim()!=='';}
function compatLegacyId(id){return /^(?:fusion-auto:|fusion-track:|tmdb_|fusion_(?:tv|movie)_)/i.test(String(id)) || Number(id)<=-1000000000 && Number(id)>-2000000000;}
function compatKey(cfg,id){return JSON.stringify([cfg.requestBase,String(id)]);}
function compatPlaybackKey(cfg,params,id){return compatKey(cfg,[id,params.tmdbId,params.type,params.seriesName,params.title,params.season,params.episode].join('|'));}

async function compatHttp(cfg,path,stage,body){
  const key=JSON.stringify([cfg.requestBase,path,body || null]);
  if(compatPending.has(key))return JSON.parse(JSON.stringify(await compatPending.get(key)));
  const task=(async()=>{
    compatLog(stage,'REQUEST','Request started');
    if(typeof Widget==='undefined' || !Widget.http || typeof Widget.http.get!=='function')throw compatError('Init','HTTP_UNAVAILABLE','Widget.http.get unavailable');
    let response;
    try{
      const url=/^https?:\/\//i.test(path)?path:cfg.requestBase+path;
      if(body){
        if(typeof Widget.http.request==='function')response=await Widget.http.request({url:url,method:'POST',data:body,headers:headers()});
        else if(typeof Widget.http.post==='function')response=await Widget.http.post(url,body,{headers:headers()});
        else throw compatError('Match','POST_UNAVAILABLE','Optional match POST unavailable');
      }else response=await Widget.http.get(url,{headers:headers()});
    }
    catch(e){
      if(e && e.fusionSafe)throw e;
      const status=Number(e && (e.statusCode || e.status || e.response && (e.response.statusCode || e.response.status)));
      if(status>=400 && status<=599)throw compatError('HTTP','HTTP_STATUS','Request failed: '+status,status);
      const timeout=e && (e.name==='AbortError' || e.name==='TimeoutError' || e.code==='ETIMEDOUT' || e.code===-1001);
      throw compatError('HTTP',timeout?'TIMEOUT':'NETWORK',timeout?'Request timed out in native HTTP':'Request failed: network or native HTTP error');
    }
    if(!response)throw compatError('HTTP','EMPTY_RESPONSE','Empty HTTP response');
    const status=Number(response.statusCode || response.status || 200);
    if(status>=400)throw compatError('HTTP','HTTP_STATUS','Request failed: '+status,status);
    // Exactly one response.data unwrap, as in the working Rex modules.
    let data=response.data!==undefined?response.data:response;
    if(typeof data==='string'){
      if(data.length>64000000)throw compatError(stage,'TOO_LARGE','Response exceeds 64 MB size limit');
      try{data=JSON.parse(data);}catch(e){throw compatError(stage,'INVALID_JSON','Invalid JSON response');}
    }
    if(!data || typeof data!=='object')throw compatError(stage,'INVALID_RESPONSE','Invalid response structure');
    if(data.success===false || Number(data.errorCode)>0)throw compatError(stage,'API_ERROR','API reported failure');
    compatLog(stage,'RESPONSE','Response parsed');return data;
  })();
  compatPending.set(key,task);
  try{return await task;}finally{compatPending.delete(key);}
}

async function compatRemember(cfg,candidate){
  const id=candidate.animeId,key=compatKey(cfg,id);
  const record={expires:Date.now()+300000,candidate:candidate};
  compatLookups.set(key,record);
  while(compatLookups.size>32)compatLookups.delete(compatLookups.keys().next().value);
  if(compatStage<5 || typeof Widget==='undefined' || !Widget.storage)return;
  // Only lightweight lookup metadata is persisted, always as JSON strings.
  // Full comments are memory-only; storage failure never blocks playback.
  const storeKey='fusion-compat-v1:lookup:'+key;
  try{
    const value=JSON.stringify(record);if(value.length>200000)return;
    await Widget.storage.set(storeKey,value);
    const indexKey='fusion-compat-v1:lookup-index';
    let list=await Widget.storage.get(indexKey);try{list=typeof list==='string'?JSON.parse(list):list;}catch(e){list=[];}
    if(!Array.isArray(list))list=[];
    list=list.filter(k=>k!==storeKey);list.push(storeKey);
    while(list.length>32){const old=list.shift();if(Widget.storage.remove)await Widget.storage.remove(old);}
    await Widget.storage.set(indexKey,JSON.stringify(list));
  }catch(e){compatLog('Cache','STORAGE_UNAVAILABLE','Optional lookup storage unavailable');}
}
async function compatRecall(cfg,id){
  const key=compatKey(cfg,id);let record=compatLookups.get(key);
  if(!record && compatStage>=5 && typeof Widget!=='undefined' && Widget.storage){
    try{record=await Widget.storage.get('fusion-compat-v1:lookup:'+key);if(typeof record==='string')record=JSON.parse(record);}catch(e){}
  }
  return record && record.expires>Date.now()?record.candidate:null;
}
function compatDeclaredSeason(value){
  const m=String(value || '').match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*季|\bS(\d{1,2})(?:E\d+)?\b|season\s*(\d+)/i);
  if(!m)return null;
  const valueString=m[1] || m[2] || m[3],digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if(/^\d+$/.test(valueString))return Number(valueString);
  const parts=valueString.split('十');return parts.length>1?(digits[parts[0]] || 1)*10+(digits[parts[1]] || 0):digits[valueString];
}
function compatRank(candidates,params){
  if(compatStage<2)return candidates;
  const identity=fusionIdentity(params), evidence=fusionSeriesEvidence(candidates.map(fusionCandidate),identity);
  return evidence.map((a,index)=>{
    const pair=fusionSeasonCandidate(identity,a), match=fusionMatch(pair.identity,pair.candidate);
    // Ranking is advisory: uncertain candidates remain selectable. Never insert
    // a synthetic automatic track that depends on missing playback metadata.
    const title=String(a.animeTitle || ''),kind=String(a.type || '')+' '+String(a.typeDescription || '')+' '+String(a.mediaType || '');
    const derivative=/纪录|紀錄|纪实|紀實|documentary|docuseries|解说|解說|赏析|賞析|影评|影評|剧评|劇評|速看|预告|預告|花絮|特辑|特輯|剧情解析|剧情解读|commentary|review|recap|trailer/i.test(title+' '+kind);
    const names=[identity.title,identity.original_title].concat(identity.aliases || []).filter(Boolean).map(n=>identity.isMovie?fusionTitle(n):fusionSeriesName(n,identity.season));
    const name=identity.isMovie?fusionTitle(title):fusionSeriesName(title,pair.candidate.season || identity.season);
    const movie=/movie|film|电影|電影|剧场版|劇場版/i.test(kind),tv=fusionTvType(a);
    const explicitSeason=pair.candidate.season!=null?Number(pair.candidate.season):compatDeclaredSeason(title);
    // Rex may automatically explore the first candidate. Keeping a known
    // conflicting season/name here can silently load another work's comments.
    let allowed=!derivative && names.includes(name) && !(movie && !identity.isMovie || tv && identity.isMovie);
    if(!identity.isMovie && explicitSeason!=null && Number(explicitSeason)!==Number(identity.season))allowed=false;
    if(!identity.isMovie && tv && identity.reliableSE && Number(identity.season)>1 && explicitSeason==null)allowed=false;
    if(match.reason==='special_conflict' || match.reason==='id_conflict')allowed=false;
    const airYear=!identity.isMovie && yearFrom(params.airDate),candidateYear=compatReleaseYear(a);
    if(candidateYear && identity.year && candidateYear!==String(identity.year) && (identity.isMovie || Number(identity.season)<=1))allowed=false;
    if(airYear && candidateYear && airYear!==candidateYear)allowed=false;
    return {candidate:candidates[index],index:index,score:match.reliable?100:0,allowed:allowed};
  }).filter(a=>a.allowed).sort((a,b)=>b.score-a.score || a.index-b.index).map(a=>a.candidate);
}

function compatReleaseYear(candidate){
  const explicit=String(candidate.startDate || candidate.year || '').match(/\b(?:19|20)\d{2}\b/);
  const title=fusionNormalize(candidate.animeTitle || candidate.title || '');
  const annotated=title.match(/\(((?:19|20)\d{2})(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\)/);
  return explicit?explicit[0]:annotated?annotated[1]:null;
}
function compatYearMatchPlan(params,raw){
  const identity=fusionIdentity(params);
  // A later season's year is not the series premiere year. Only its episode
  // airDate is independent evidence; never turn the series year into S04's year.
  const year=identity.isMovie?identity.year:yearFrom(params.airDate) || (Number(identity.season)===1?identity.year:null);
  if(!year || identity.special || !identity.isMovie && !identity.reliableSE)return null;
  const name=identity.isMovie?fusionTitle(identity.title):fusionSeriesName(identity.title,identity.season);
  const years=new Set(raw.filter(c=>{
    const pair=fusionSeasonCandidate(identity,fusionCandidate(c));
    const candidateName=identity.isMovie?fusionTitle(c.animeTitle):fusionSeriesName(c.animeTitle,pair.candidate.season || identity.season);
    if(candidateName!==name)return false;
    const kind=String(c.type || '')+' '+String(c.typeDescription || '');
    if(identity.isMovie?fusionTvType(c):/movie|film|电影|電影|剧场版|劇場版/i.test(kind))return false;
    if(!identity.isMovie && pair.candidate.season!=null && Number(pair.candidate.season)!==Number(identity.season))return false;
    return true;
  }).map(compatReleaseYear).filter(Boolean));
  // Only disambiguate actual year conflicts; normal playback adds no POST.
  if(years.size<2)return null;
  let title=String(identity.title || '').replace(/\s*from\s+[a-z0-9&_-]+.*$/i,'').replace(/[【\[][^】\]]*[】\]]/g,'').replace(/[（(](?:19|20)\d{2}[）)]/g,'').trim();
  if(!identity.isMovie){
    title=title.replace(/第\s*[一二三四五六七八九十\d]+\s*季|\bS\d{1,2}(?:E\d+)?\b|season\s*\d+/gi,'').trim();
    if(/[\u4e00-\u9fff]/.test(title) && Number(identity.season)>1)title=title.replace(new RegExp(String(identity.season)+'$'),'').trim();
  }
  if(!title || /^https?:/i.test(title))return null;
  return {identity:identity,year:String(year),fileName:title+'.'+year+(identity.isMovie?'':'.S'+String(identity.season).padStart(2,'0')+'E'+String(identity.episode).padStart(2,'0'))};
}
async function compatVerifyYear(cfg,params,raw,candidates){
  if(compatStage<2 || !candidates.length || compatMatchUnsupported.has(cfg.requestBase))return candidates;
  const plan=compatYearMatchPlan(params,raw);
  if(!plan || !Widget.http || typeof Widget.http.request!=='function' && typeof Widget.http.post!=='function')return candidates;
  const key=compatKey(cfg,plan.fileName);let data,saved=compatYearMatches.get(key);
  try{
    if(saved && saved.expires>Date.now())data=saved.data;
    else{
      // Official MatchRequest has no year property. danmu_api extracts the
      // year from fileName; filename-only mode needs neither file bytes nor MD5.
      data=await compatHttp(cfg,'/api/v2/match','Match',{fileName:plan.fileName,fileHash:null,fileSize:0,videoDuration:0,matchMode:'fileNameOnly'});
      if(!Array.isArray(data.matches))throw compatError('Match','INVALID_MATCHES','Invalid match response; keeping standard search results');
      compatYearMatches.set(key,{expires:Date.now()+300000,data:data});
      while(compatYearMatches.size>16)compatYearMatches.delete(compatYearMatches.keys().next().value);
    }
    const confirmed=new Set();
    for(const match of data.matches.slice(0,32)){
      if(!match || !compatPresent(match.animeId) || !compatPresent(match.episodeId))continue;
      const candidate=candidates.find(c=>String(c.animeId)===String(match.animeId));
      // A filename match is advisory, even when isMatched=true. It may apply
      // a server mapping/preference or incorrectly return S01 for S04.
      if(!candidate || compatReleaseYear(candidate)!==plan.year)continue;
      const returnedYear=compatReleaseYear(match);if(returnedYear && returnedYear!==plan.year)continue;
      const checked=Object.assign({},candidate,{animeTitle:match.animeTitle || candidate.animeTitle,type:match.type || candidate.type,typeDescription:match.typeDescription || candidate.typeDescription});
      if(!compatRank([checked],Object.assign({},params,{year:plan.year})).length)continue;
      if(!plan.identity.isMovie && fusionEpisodeNumber(match)!==Number(plan.identity.episode))continue;
      const episodeSeason=compatDeclaredSeason(match.episodeTitle);
      if(!plan.identity.isMovie && episodeSeason!=null && episodeSeason!==Number(plan.identity.season))continue;
      confirmed.add(String(candidate.animeId));
    }
    compatLog('Match',confirmed.size?'YEAR_VERIFIED':'UNVERIFIED','Year match verified candidates: '+confirmed.size+'; unverified results ignored');
    // Keep a reliable native multi-source resource ahead of a single source.
    return candidates.map((c,index)=>({c:c,index:index,score:(Array.isArray(c.mergedChildren)&&c.mergedChildren.length?2:0)+(confirmed.has(String(c.animeId))?1:0)})).sort((a,b)=>b.score-a.score || a.index-b.index).map(v=>v.c);
  }catch(e){
    if([401,403,404,405,501].includes(e.status))compatMatchUnsupported.add(cfg.requestBase);
    compatFailure('Match',e);compatLog('Match','FALLBACK','Optional year match unavailable; keeping standard search results');return candidates;
  }
}
async function fusionCompatSearch(params){
  try{
    const cfg=compatConfig(params);
    // Rex passes the user's manual search term in title; seriesName continues
    // to describe the video and must not replace that explicit search term.
    const title=String(params.title || params.keyword || params.seriesName || '').trim();
    if(!title){compatLog('Search','MISSING_TITLE','Missing title');return {animes:[]};}
    let data;
    try{data=await compatHttp(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(title),'Search');}
    catch(e){if(![404,405,501].includes(e.status))throw e;}
    if(!data || Array.isArray(data.animes) && !data.animes.length)data=await compatHttp(cfg,'/api/v2/search/episodes?anime='+encodeURIComponent(title),'Search');
    if(!Array.isArray(data.animes))throw compatError('Search','INVALID_ANIMES','Invalid response structure: animes must be an array');
    const raw=data.animes.filter(a=>a && compatPresent(a.animeId) && typeof a.animeTitle==='string');
    const animes=await compatVerifyYear(cfg,params,raw,compatRank(raw,params));
    for(const candidate of animes.slice(0,32))await compatRemember(cfg,candidate);
    compatLog('Search','RETURN','Returning animes: '+animes.length);
    return {animes:animes};
  }catch(e){compatFailure('Search',e);return {animes:[]};}
}

function compatEpisodes(data){
  if(!data || !data.bangumi || !Array.isArray(data.bangumi.episodes))throw compatError('Detail','INVALID_EPISODES','Invalid response structure: bangumi.episodes must be an array');
  const episodes=data.bangumi.episodes.filter(e=>e && compatPresent(e.episodeId)).map(e=>{
    const copy=Object.assign({},e);
    if(copy.episodeNumber==null){const number=fusionEpisodeNumber(e);if(number!=null)copy.episodeNumber=String(number);}
    return copy;
  });
  if(data.bangumi.episodes.length && !episodes.length)throw compatError('Detail','MISSING_EPISODE_ID','Episode entries missing episodeId');
  return episodes;
}
async function fusionCompatDetail(params){
  try{
    if(!compatPresent(params.animeId))throw compatError('Detail','MISSING_ANIME_ID','Missing animeId');
    if(compatLegacyId(params.animeId))throw compatError('Detail','LEGACY_SELECTION','Legacy automatic selection; select a real search result again');
    const cfg=compatConfig(params), selected=await compatRecall(cfg,params.animeId);
    if(selected && Array.isArray(selected.episodes)){
      const result=compatEpisodes({bangumi:{episodes:selected.episodes}});compatLog('Detail','RETURN','Returning episodes: '+result.length);return result;
    }
    let data;
    try{data=await compatHttp(cfg,'/api/v2/bangumi/'+encodeURIComponent(String(params.animeId)),'Detail');}
    catch(e){
      // Try only an alternate ID explicitly supplied for this selected record.
      // danmu_api normally uses numeric animeId; some compatible services use A….
      if(![400,404,422].includes(e.status) || !selected || !compatPresent(selected.bangumiId) || String(selected.bangumiId)===String(params.animeId))throw e;
      compatLog('Detail','ALTERNATE_ID','Retrying server-provided alternate ID');
      data=await compatHttp(cfg,'/api/v2/bangumi/'+encodeURIComponent(String(selected.bangumiId)),'Detail');
    }
    const episodes=compatEpisodes(data);compatLog('Detail','RETURN','Returning episodes: '+episodes.length);return episodes;
  }catch(e){compatFailure('Detail',e);return [];}
}

function compatSave(key,data){
  if(compatStage<5 || !data || data.taskId || Array.isArray(data.comments) && !data.comments.length)return;
  const serialized=JSON.stringify(data),bytes=serialized.length*2;if(bytes>2*1024*1024)return;
  compatResponses.delete(key);compatResponses.set(key,{expires:Date.now()+180000,value:serialized,bytes:bytes});
  let size=0;compatResponses.forEach(v=>{size+=v.bytes;});
  while(compatResponses.size>4 || size>2*1024*1024){const first=compatResponses.keys().next().value;size-=compatResponses.get(first).bytes;compatResponses.delete(first);}
}
function compatRead(key){
  if(compatStage<5)return null;
  const saved=compatResponses.get(key);if(!saved || saved.expires<=Date.now()){compatResponses.delete(key);return null;}
  compatLog('Cache','HIT','Comment cache hit');return JSON.parse(saved.value);
}
function compatCommentsResult(data,progress,params){
  if(!Array.isArray(data.comments))throw compatError('Comments','INVALID_COMMENTS','Invalid response structure: comments must be an array');
  // Verified native multi-source movies exceed 200k rows. The old limit made
  // an otherwise valid merged track empty; keep the full verified-size track.
  if(data.comments.length>500000)throw compatError('Comments','TOO_MANY_COMMENTS','Comment count exceeds 500000 safety limit');
  const seen=new Set();let invalid=0,removed=0;
  let list=data.comments.filter(c=>{
    const fields=c && typeof c.p==='string'?c.p.split(','):[];
    if(!c || fields.length<3 || !fields[0].trim() || c.m==null || !Number.isFinite(Number(fields[0])) || Number(fields[0])<0 || !Number.isFinite(Number(fields[1])) || !Number.isFinite(Number(fields.length>=8?fields[3]:fields[2]))){invalid++;return false;}
    if(compatStage<4 || !compatPresent(c.cid))return true;
    const key=JSON.stringify([c.cid,c.p,c.m]);if(seen.has(key)){removed++;return false;}seen.add(key);return true;
  });
  if(invalid && !list.length)throw compatError('Comments','INVALID_RECORDS','Invalid comment records: expected p and m');
  if(progress && compatStage>=6){
    const time=Number(params.segmentTime);if(!Number.isFinite(time) || time<0)throw compatError('Comments','INVALID_PROGRESS','Invalid segmentTime');
    const start=Math.floor(time/60)*60;list=list.filter(c=>Number(c.p.split(',')[0])>=start && Number(c.p.split(',')[0])<start+60);
  }
  compatLog('Parse','COUNTS','Comments parsed: '+data.comments.length+'; invalid: '+invalid+'; duplicates: '+removed+'; returned: '+list.length);
  return Object.assign({},data,{comments:list,count:list.length});
}
async function fusionCompatComments(params,progress){
  try{
    const id=firstPresent(params,['commentId','episodeId']);
    if(!compatPresent(id))throw compatError('Comments','MISSING_COMMENT_ID','Missing commentId');
    if(compatLegacyId(id))throw compatError('Comments','LEGACY_SELECTION','Legacy automatic selection; select an episode again');
    const cfg=compatConfig(params),key=compatPlaybackKey(cfg,params,id);
    let data=compatRead(key);
    if(!data){
      const related=compatStage>=3?'true':'false';
      try{data=await compatHttp(cfg,'/api/v2/comment/'+encodeURIComponent(String(id))+'?async=1&withRelated='+related+'&chConvert=1','Comments');}
      catch(e){
        if(![400,422].includes(e.status))throw e;
        compatLog('Comments','STANDARD_FALLBACK','Optional comment parameters rejected; using standard request');
        data=await compatHttp(cfg,'/api/v2/comment/'+encodeURIComponent(String(id))+'?withRelated='+related,'Comments');
      }
      // Empty/task responses never enter the cache: next call must retry.
      if(data.taskId && (!Array.isArray(data.comments) || !data.comments.length)){
        compatLog('Comments','PENDING_TASK','Server download pending; retry playback later');return Object.assign({},data,{comments:[],count:0});
      }
      if(Array.isArray(data))data={comments:data};
      if(Array.isArray(data.comments)){
        data=compatCommentsResult(data,false,params);
        compatSave(key,data);
      }
    }
    if(compatStage>=6 && Array.isArray(data.barrage_list) && data.barrage_list.length && (!Array.isArray(data.comments) || !data.comments.length)){
      const time=Number(params.segmentTime || 0);
      if(!Number.isFinite(time) || time<0)throw compatError('Comments','INVALID_PROGRESS','Invalid segmentTime');
      const segment=data.barrage_list.find(s=>s && time>=Number(s.segment_start) && time<Number(s.segment_end));
      if(!segment){compatLog('Segment','EMPTY','No segment at requested time');return {comments:[],count:0};}
      if(!/^https?:\/\//i.test(String(segment.segment_url || '')))throw compatError('Segment','INVALID_URL','Invalid segment URL');
      const segmentKey=key+':segment:'+JSON.stringify(segment);
      let fragment=compatRead(segmentKey);
      if(!fragment){fragment=await compatHttp(cfg,segment.segment_url,'Segment');if(Array.isArray(fragment))fragment={comments:fragment};fragment=compatCommentsResult(fragment,false,params);compatSave(segmentKey,fragment);}
      data=fragment;
    }
    const result=compatCommentsResult(data,!!progress && params.segmentTime!=null,params);
    compatLog('Comments','RETURN','Returning response.data comments: '+result.count);return result;
  }catch(e){compatFailure('Comments',e);return {comments:[],count:0,success:false};}
}

compatLog('Init','READY','Adapter ready; browser timers '+(typeof setTimeout==='function'?'available':'unavailable'));

/* AGPL-3.0-only. Incremental orchestration around the verified 1.4.5 adapter.
 * No timers, fetch, URL, Node APIs, or background polling. IDs contain only
 * SHA-256 source fingerprints and real protocol IDs, never configured URLs.
 */
const multiPrefix='df15:';
const multiJobs=new Map();
let multiStorageQueue=Promise.resolve();

// SHA-256 over UTF-8, implemented here because Widget has no crypto global.
function fusionDigest(value){
  const bytes=unescape(encodeURIComponent(String(value))),words=[];
  for(let i=0;i<bytes.length;i++)words[i>>2]=(words[i>>2] || 0)|bytes.charCodeAt(i)<<(24-i%4*8);
  words[bytes.length>>2]=(words[bytes.length>>2] || 0)|0x80<<(24-bytes.length%4*8);
  words[((bytes.length+8>>6)+1)*16-1]=bytes.length*8;
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=[];
  const r=(x,n)=>x>>>n|x<<(32-n);
  for(let offset=0;offset<words.length;offset+=16){
    for(let j=0;j<64;j++){
      if(j<16)w[j]=words[offset+j] || 0;
      else{const a=w[j-15],b=w[j-2];w[j]=((r(a,7)^r(a,18)^a>>>3)+w[j-16]+(r(b,17)^r(b,19)^b>>>10)+w[j-7])|0;}
    }
    let [a,b,c,d,e,f,g,z]=h;
    for(let j=0;j<64;j++){
      const t=(z+(r(e,6)^r(e,11)^r(e,25))+(e&f^~e&g)+k[j]+w[j])|0;
      const t2=((r(a,2)^r(a,13)^r(a,22))+(a&b^a&c^b&c))|0;
      z=g;g=f;f=e;e=d+t|0;d=c;c=b;b=a;a=t+t2|0;
    }
    [a,b,c,d,e,f,g,z].forEach((v,j)=>{h[j]=h[j]+v|0;});
  }
  return h.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
function multiBase(cfg){return cfg.requestBase+(cfg.query?'?'+cfg.query:'');}
function multiSources(params){
  const values=[firstPresent(params,['danmu_api_url','server']),params.danmu_api_url_2,params.danmu_api_url_3],result=[];
  for(let i=0;i<3;i++){
    if(!String(values[i] || '').trim())continue;
    try{
      const cfg=compatConfig({danmu_api_url:values[i]}),fingerprint=fusionDigest(multiBase(cfg));
      if(result.some(c=>c.s===fingerprint)){compatLog('Address','DUPLICATE','Duplicate API ignored');continue;}
      result.push(Object.assign(cfg,{s:fingerprint,slot:i+1}));
    }catch(e){compatFailure('Address',e);}
  }
  if(!result.length)throw compatError('Address','NO_API','No valid API configured');
  return result;
}
function multiParams(params,cfg){
  const descriptors=Object.getOwnPropertyDescriptors(params);
  for(const key of ['api_mode','aggregate','sources','source_priority','dedupe','dedupe_tolerance','offset_owner','offset_rules','cache_ttl','timeout','retry','cache','color_to_white','force_scroll','debug'])delete descriptors[key];
  const copy=Object.defineProperties({},descriptors);
  Object.defineProperty(copy,'danmu_api_url',{value:multiBase(cfg),writable:true,enumerable:true,configurable:true});return copy;
}
function multiRawId(id){return (typeof id==='string' && id.length>0 && id.length<=512 && !/^https?:\/\//i.test(id) || typeof id==='number' && Number.isSafeInteger(id)) && !String(id).startsWith(multiPrefix);}
function multiId(kind,refs){
  const id=multiPrefix+kind+':'+encodeURIComponent(JSON.stringify(refs));
  if(id.length>12000)throw compatError('Route','ID_TOO_LARGE','Selection too large; choose an individual source');
  return id;
}
function multiDecode(id,kind,sources){
  if(!String(id).startsWith(multiPrefix))return null;
  try{
    const text=String(id);if(text.length>12000 || !text.startsWith(multiPrefix+kind+':'))throw 0;
    const refs=JSON.parse(decodeURIComponent(text.slice((multiPrefix+kind+':').length)));
    if(!Array.isArray(refs) || refs.length<1 || refs.length>3 || new Set(refs.map(r=>r.s)).size!==refs.length)throw 0;
    for(const ref of refs){
      if(!ref || !/^[a-f0-9]{64}$/.test(ref.s) || !multiRawId(ref.i) || ref.b!=null && !multiRawId(ref.b))throw 0;
      if(!sources.some(s=>s.s===ref.s))throw compatError('Route','SOURCE_CHANGED','Selected API changed or was removed; search and select again');
      if(ref.a!=null){
        if(!Array.isArray(ref.a) || ref.a.length>2 || new Set([ref.s].concat(ref.a.map(r=>r && r.s))).size!==ref.a.length+1)throw 0;
        for(const alt of ref.a){
          if(!alt || !/^[a-f0-9]{64}$/.test(alt.s) || !multiRawId(alt.i) || alt.b!=null && !multiRawId(alt.b) || alt.a!=null)throw 0;
          if(!sources.some(s=>s.s===alt.s))throw compatError('Route','SOURCE_CHANGED','Backup API changed; search and select again');
        }
      }
    }
    return refs;
  }catch(e){if(e && compatSafeErrors.has(e))throw e;throw compatError('Route','INVALID_SELECTION','Invalid historical selection; search and select again');}
}
function multiRef(cfg,candidate,evidence){
  if(!multiRawId(candidate.animeId))throw compatError('Route','INVALID_ID','Unsupported server resource ID');
  const ref={s:cfg.s,i:candidate.animeId};
  if(multiNative(candidate))ref.n=1;
  if(multiRawId(candidate.bangumiId))ref.b=candidate.bangumiId;
  if(evidence)ref.e=evidence;
  return ref;
}

// Bare 1.4.5 IDs retain their original single-API path. Once observed, the
// primary fingerprint and a bounded set of fresh selections guard URL changes.
// This registry contains no URLs or credentials and uses string-only storage.
const multiBareMemory={};
async function multiBare(sources,kind,id,fresh){
  if(sources.length!==1 || sources[0].slot!==1)throw compatError('Route','AMBIGUOUS_LEGACY_ID','Unbound ID with multiple APIs; search and select again');
  const cfg=sources[0],keys=(Array.isArray(id)?id:[id]).map(value=>fusionDigest(kind+':'+String(value)));
  const operation=multiStorageQueue.then(async()=>{
    let record=multiBareMemory.record;
    if(!record){
      try{const saved=Widget.storage && await Widget.storage.get('fusion-multi-v1:bare');if(typeof saved==='string')record=JSON.parse(saved);}catch(e){}
      if(!record || typeof record.origin!=='string' || !record.ids || typeof record.ids!=='object')record={origin:cfg.s,ids:{}};
    }
    if(!fresh && record.origin!==cfg.s && keys.some(key=>record.ids[key]!==cfg.s))throw compatError('Route','SOURCE_CHANGED','Primary API changed; search and select again');
    if(fresh){for(const key of keys){delete record.ids[key];record.ids[key]=cfg.s;}while(Object.keys(record.ids).length>128)delete record.ids[Object.keys(record.ids)[0]];}
    multiBareMemory.record=record;
    try{if(Widget.storage)await Widget.storage.set('fusion-multi-v1:bare',JSON.stringify(record));}catch(e){compatLog('Route','MEMORY_ONLY','Optional historical selection storage unavailable');}
  });
  multiStorageQueue=operation.catch(()=>{});await operation;
}

// Resolution driven by actual completions. A successful API never waits for a
// slow peer. Late results populate the same bounded cache for the next call.
async function multiFirst(tasks,usable){
  if(!tasks.length)return {values:[],partial:false};
  const states=tasks.map(()=>({done:false,value:null}));let remaining=tasks.length,finish,accepting=true;
  const ready=new Promise(resolve=>{finish=resolve;});
  tasks.forEach((task,index)=>Promise.resolve(task).then(value=>{
    if(accepting)states[index]={done:true,value:value};remaining--;if(usable(value) || !remaining)finish();
  },error=>{if(accepting)states[index]={done:true,value:null};remaining--;compatFailure('MultiAPI',error);if(!remaining)finish();}));
  await ready;
  // Drain already-queued completions; this never waits for a network event.
  await Promise.resolve();
  const values=states.filter(s=>s.done && s.value).map(s=>s.value);
  accepting=false;states.length=0;tasks.length=0;
  return {values:values,partial:remaining>0};
}
async function multiComplete(tasks){
  const values=[];
  await Promise.all(tasks.map(async task=>{try{const value=await task;if(value)values.push(value);}catch(e){compatFailure('MultiAPI',e);}}));
  return {values:values,partial:false};
}
async function multiJob(cfg,key,loader){
  const cacheKey=compatKey(cfg,'multi:'+key),cached=compatRead(cacheKey);
  if(cached)return cached;
  const jobKey=cfg.s+':'+key;
  if(multiJobs.has(jobKey))return multiJobs.get(jobKey);
  // Rex retries the series keyword with a season-specific keyword. Allow two
  // independent lookups per API, without an unbounded waiter queue.
  if(Array.from(multiJobs.keys()).filter(k=>k.startsWith(cfg.s+':')).length>=2)throw compatError('MultiAPI','BUSY','API has a pending lookup; retry later');
  const task=(async()=>{try{const value=await loader();if(value && (Array.isArray(value.animes)?value.animes.length:Array.isArray(value.episodes)&&value.episodes.length))compatSave(cacheKey,value);return value;}finally{multiJobs.delete(jobKey);}})();
  multiJobs.set(jobKey,task);return task;
}
function multiNative(candidate){return Array.isArray(candidate.mergedChildren)&&candidate.mergedChildren.length || /\bfrom\s+[a-z0-9_-]+&[a-z0-9_-]+/i.test(candidate.animeTitle || '')?1:0;}
function multiNativeEpisode(episode){
  const tag=String(episode.episodeTitle || '').match(/^\s*(?:【([^】]+)】|\[([^\]]+)\])/);
  const value=tag && (tag[1] || tag[2]);
  if(!value || !/^[a-z0-9_-]+(?:[&＆][a-z0-9_-]+)+$/i.test(value))return false;
  return new Set(value.split(/[&＆]/).map(fusionSource)).size>1;
}
function multiAggregateDisplay(value,field){
  const copy=Object.assign({},value,{source:'聚合'});
  if(value.source && value.source!=='聚合')copy.originalSource=value.source;
  const title=String(value[field] || '');copy[field]=/^【聚合】/.test(title)?title:'【聚合】'+title;
  return copy;
}
// Reuse only unexpired, source-bound native candidates already stored by the
// stable adapter. This keeps late native aggregation discoverable across VMs;
// no new cache, background task, timer or provider allowlist is introduced.
async function multiNativeHints(sources,params){
  const records=new Map();
  for(const [key,record] of compatLookups)records.set('fusion-compat-v1:lookup:'+key,record);
  try{
    if(typeof Widget!=='undefined' && Widget.storage){
      const text=await Widget.storage.get('fusion-compat-v1:lookup-index');
      const index=typeof text==='string' && text.length<5000?JSON.parse(text):[];
      if(Array.isArray(index))for(const key of index.slice(-32)){
        if(typeof key!=='string' || !/^fusion-compat-v1:lookup:[a-f0-9]{64}$/.test(key) || records.has(key))continue;
        const value=await Widget.storage.get(key);
        if(typeof value==='string' && value.length<=200000){try{records.set(key,JSON.parse(value));}catch(e){}}
      }
    }
  }catch(e){compatLog('Cache','NATIVE_HINT_UNAVAILABLE','Optional native candidate lookup unavailable');}
  const result=[];
  for(const [key,record] of records){
    const candidate=record && record.candidate;
    if(!record || !(record.expires>Date.now()) || !candidate || !multiRawId(candidate.animeId) || !multiNative(candidate))continue;
    const cfg=sources.find(c=>key==='fusion-compat-v1:lookup:'+compatKey(c,candidate.animeId));
    if(!cfg || !multiEvidence(candidate,params) || !compatRank([candidate],params).length)continue;
    // Explicit playback versions/languages must not inherit an unknown or
    // conflicting cached edition, even though independent manual search works.
    if(multiEdition(params) && multiEdition(params)!==multiEdition(candidate) || multiLanguage(params) && multiLanguage(params)!==multiLanguage(candidate))continue;
    result.push({s:cfg.s,candidate:candidate});
    if(result.length>=32)break;
  }
  return result;
}
function multiEvidence(candidate,params){
  const identity=fusionIdentity(params),pair=fusionSeasonCandidate(identity,fusionCandidate(candidate)),c=pair.candidate;
  const title=identity.isMovie?fusionTitle(candidate.animeTitle):fusionSeriesName(candidate.animeTitle,c.season);
  const year=compatReleaseYear(candidate),movie=/movie|film|电影|電影|剧场版|劇場版/i.test([candidate.type,candidate.typeDescription,candidate.mediaType].join(' '));
  const season=identity.isMovie?null:c.season!=null?Number(c.season):compatDeclaredSeason(candidate.animeTitle);
  if(!title || !year || identity.special || fusionSpecial(candidate.animeTitle)!=='regular' || (identity.isMovie?!movie:!fusionTvType(candidate) || !(season>0)))return null;
  return {title:title,year:year,kind:identity.isMovie?'movie':'tv',season:season,tmdb:String(c.tmdb_id || c.tmdbId || ''),edition:multiEdition(candidate),language:multiLanguage(candidate),context:fusionDigest(JSON.stringify([identity.tmdb_id || '',identity.year || '',identity.version_key || '',multiEdition(params),multiLanguage(params)]))};
}
function multiSameWork(a,b){return a && b && a.title===b.title && a.year===b.year && a.kind===b.kind && a.season===b.season && !(a.tmdb && b.tmdb && a.tmdb!==b.tmdb) && a.edition===b.edition && a.language===b.language;}
function multiEdition(value){
  const explicit=value.edition || value.version || value.cut;
  const tag=String(value.animeTitle || value.episodeTitle || '').match(/导演剪辑版|導演剪輯版|加长版|加長版|院线版|院線版|未删减版|未刪減版|重映版|修复版|修復版|director.?s?\s*cut|extended(?:\s*cut)?|theatrical(?:\s*cut)?|uncut/i);
  return fusionNormalize(explicit || tag && tag[0] || '').toLowerCase();
}
function multiLanguage(value){return fusionNormalize(value.language || value.audioLanguage || '').toLowerCase();}
async function fusionMultiSearch(params,preferNative){
  try{
    const sources=multiSources(params);
    if(sources.length===1 && sources[0].slot===1){
      const result=await fusionCompatSearch(multiParams(params,sources[0]));
      if(result.animes.length)await multiBare(sources,'a',result.animes.slice(0,32).map(c=>c.animeId),true);
      return Object.assign({},result,{animes:result.animes.map(c=>multiNative(c)?multiAggregateDisplay(c,'animeTitle'):c)});
    }
    const query=fusionDigest(JSON.stringify([fusionIdentity(params),params.title,params.keyword,params.seriesName]));
    const pending=multiFirst(sources.map(cfg=>multiJob(cfg,'search:'+query,async()=>{
      const result=await fusionCompatSearch(multiParams(params,cfg));return {s:cfg.s,animes:result.animes.slice(0,32)};
    })),v=>preferNative?v.animes.some(multiNative):v.animes.length>0);
    const [batch,hints]=await Promise.all([pending,multiNativeHints(sources,params)]);
    // A completed fresh response is authoritative, including a valid empty one.
    // Hints fill only APIs absent from this first batch, never override it.
    let reused=0;
    for(const cfg of sources){
      if(batch.values.some(v=>v.s===cfg.s))continue;
      const animes=hints.filter(h=>h.s===cfg.s).map(h=>h.candidate);
      if(animes.length){batch.values.push({s:cfg.s,animes:animes});reused+=animes.length;}
    }
    if(reused)compatLog('Cache','NATIVE_REUSED','Verified recent native candidates reused: '+reused);
    const entries=[];
    for(const cfg of sources){
      const result=batch.values.find(v=>v.s===cfg.s);if(!result)continue;
      for(const c of result.animes){
        if(!multiRawId(c.animeId)){compatLog('Route','INVALID_ID','Unsupported server resource ID skipped');continue;}
        entries.push({cfg:cfg,c:c,e:multiEvidence(c,params)});
      }
    }
    const preferences=await preferenceAccess(sources);
    entries.sort((a,b)=>Number(preferenceMatches(preferences,b.e,b.cfg.s))-Number(preferenceMatches(preferences,a.e,a.cfg.s)) || multiNative(b.c)-multiNative(a.c) || a.cfg.slot-b.cfg.slot);
    const animes=entries.map(v=>{
      const ref=multiRef(v.cfg,v.c,v.e),alternatives=entries.filter(a=>a.cfg.s!==v.cfg.s && multiSameWork(v.e,a.e));
      ref.a=alternatives.filter((a,i)=>alternatives.findIndex(b=>b.cfg.s===a.cfg.s)===i).slice(0,2).map(a=>multiRef(a.cfg,a.c,a.e));
      const id=multiId('a',[ref]),preferred=preferenceMatches(preferences,v.e,v.cfg.s);
      const display=multiNative(v.c)?multiAggregateDisplay(v.c,'animeTitle'):v.c;
      return Object.assign({},display,{animeId:id,bangumiId:id,isFavorited:preferred || v.c.isFavorited,animeTitle:(preferred?'上次来源 · ':'')+display.animeTitle+' · API '+v.cfg.slot});
    });
    // One best (preferably native merged) candidate from each API per identity.
    // Details decide whether episodes actually have sufficient timeline proof.
    const grouped=new Set();let groups=0;
    for(let i=0;i<entries.length && groups<8;i++){
      const root=entries[i];if(!root.e || grouped.has(i))continue;
      const members=[root];
      for(let j=i+1;j<entries.length;j++){
        const v=entries[j];if(members.some(m=>m.cfg.s===v.cfg.s) || !members.every(m=>multiSameWork(m.e,v.e)))continue;
        members.push(v);grouped.add(j);
      }
      if(members.length<2)continue;groups++;
      const id=multiId('a',members.map(v=>multiRef(v.cfg,v.c,v.e)));
      animes.unshift(Object.assign({},root.c,{animeId:id,bangumiId:id,source:'跨 API 选源',originalSource:root.c.source,animeTitle:root.c.animeTitle+' · 跨 API 选源（'+members.map(v=>v.cfg.slot).join('+')+'）'}));
    }
    animes.sort((a,b)=>Number(!!b.isFavorited)-Number(!!a.isFavorited));
    compatLog('MultiAPI',batch.partial?'PARTIAL':'COMPLETE','Search APIs available: '+batch.values.filter(v=>v.animes.length).length+'; candidates: '+animes.length+(batch.partial?'; slow peers continue in bounded cache':''));
    return animes.length?{animes:animes}:{animes:[],message:'未取得可用作品，请查看诊断后重试或手动搜索',diagnostics:compatSummary()};
  }catch(e){compatFailure('Search',e);const failure=compatEmpty(e);return {animes:[],message:failure.message,error:failure.error,diagnostics:failure.diagnostics};}
}
async function multiDetailOne(ref,cfg,params){
  const selected=await compatRecall(cfg,ref.i);
  if(!selected && ref.b!=null)await compatRemember(cfg,{animeId:ref.i,bangumiId:ref.b});
  return fusionCompatDetail(Object.assign(multiParams(params,cfg),{animeId:ref.i}));
}
function multiDuration(episode){
  const value=firstPresent(episode,['durationSeconds','videoDuration','runtimeSeconds','duration']);
  const n=Number(value);return Number.isFinite(n)&&n>0?n:null;
}
function multiTimeline(episode){
  const hash=String(episode.videoHash || episode.fileHash || '').toLowerCase();
  if(/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash))return 'hash:'+hash;
  const url=String(episode.videoUrl || episode.url || '');
  // Public official video URLs establish content identity. Generic API URLs,
  // catalog IDs and unqualified timelineId strings are not timeline evidence.
  const official=/^https?:\/\/v\.qq\.com\/x\/(?:cover\/[a-z0-9]+\/[a-z0-9]+|page\/[a-z0-9]+)\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?iqiyi\.com\/v_[a-z0-9]+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/v\.youku\.com\/v_show\/id_[a-z0-9=]+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?mgtv\.com\/b\/\d+\/\d+\.html(?:[?#]|$)/i.test(url)
    || /^https?:\/\/(?:www\.)?bilibili\.com\/(?:video\/(?:BV[a-z0-9]+|av\d+)|bangumi\/play\/ep\d+)\/?(?:[?#]|$)/i.test(url);
  if(official)return 'video:'+fusionDigest(url.replace(/^http:/i,'https:').split('#')[0]);
  return null;
}
function multiEpisodeProof(episode,evidence){
  if(!evidence || fusionSpecial(episode.episodeTitle)!=='regular' || /预告|預告|花絮|解说|解說|赏析|上下集|上集|下集|上篇|下篇|[（(][上下][）)]/i.test(episode.episodeTitle || ''))return null;
  const duration=multiDuration(episode),timeline=multiTimeline(episode);
  if(!duration || !timeline)return null;
  const explicit=firstPresent(episode,['season','seasonNumber','_season']),declared=compatDeclaredSeason(episode.episodeTitle);
  if(evidence.kind==='tv' && (explicit!=null && Number(explicit)!==evidence.season || declared!=null && declared!==evidence.season))return null;
  if(evidence.kind==='movie' && !/^(?:【[^】]*】|\[[^\]]*\])?\s*(?:正片|全片)(?:\s|$)/.test(episode.episodeTitle || '') && fusionTitle(episode.episodeTitle)!==evidence.title)return null;
  const number=evidence.kind==='movie'?null:fusionEpisodeNumber(episode);
  if(evidence.kind==='tv' && !(number>0))return null;
  if(multiEdition(episode) && evidence.edition && multiEdition(episode)!==evidence.edition || multiLanguage(episode) && evidence.language && multiLanguage(episode)!==evidence.language)return null;
  const edition=multiEdition(episode)||evidence.edition,language=multiLanguage(episode)||evidence.language;
  return {work:evidence,number:number,duration:duration,timeline:timeline,edition:edition,language:language};
}
function multiSameEpisode(a,b){return a && b && multiSameWork(a.work,b.work) && a.number===b.number && a.duration===b.duration && a.timeline===b.timeline && a.edition===b.edition && a.language===b.language;}
async function fusionMultiDetail(params,complete){
  try{
    const sources=multiSources(params),refs=multiDecode(params.animeId,'a',sources);
    if(!refs){
      if(compatPresent(params.animeId))await multiBare(sources,'a',params.animeId,false);
      const episodes=await fusionCompatDetail(multiParams(params,sources[0]));
      if(episodes.length)await multiBare(sources,'c',episodes.slice(0,2000).map(e=>e.episodeId),true);
      return episodes.map(e=>multiNativeEpisode(e)?multiAggregateDisplay(e,'episodeTitle'):e);
    }
    const requested=refs.slice();
    if(refs.length===1 && refs[0].a)for(const alt of refs[0].a)if(multiSameWork(refs[0].e,alt.e))requested.push(alt);
    const collect=complete && refs.length>1?multiComplete:multiFirst;
    const batch=await collect(requested.map(ref=>{
      const cfg=sources.find(c=>c.s===ref.s);
      return multiJob(cfg,'detail:'+fusionDigest(JSON.stringify(ref)),async()=>({ref:ref,episodes:(await multiDetailOne(ref,cfg,params)).slice(0,2000)}));
    }),v=>v.episodes.length>0 && refs.some(r=>r.s===v.ref.s));
    const entries=[];
    for(const ref of requested){
      const result=batch.values.find(v=>v.ref.s===ref.s);if(!result)continue;
      const cfg=sources.find(c=>c.s===ref.s);
      for(const e of result.episodes){
        if(!multiRawId(e.episodeId))continue;
        entries.push({cfg:cfg,e:e,work:ref.e,proof:multiEpisodeProof(e,ref.e)});
      }
    }
    // Index exact proof buckets once. TMDB conflicts are still checked below;
    // duplicate episode numbers per API are counted before recommending backups.
    const proofBuckets=new Map();
    const proofKey=p=>p && JSON.stringify([p.work.title,p.work.year,p.work.kind,p.work.season,p.work.edition,p.work.language,p.number,p.duration,p.timeline,p.edition,p.language]);
    for(const entry of entries){
      const key=proofKey(entry.proof);if(!key)continue;
      if(!proofBuckets.has(key))proofBuckets.set(key,{members:[],counts:new Map()});
      const bucket=proofBuckets.get(key);bucket.members.push(entry);bucket.counts.set(entry.cfg.s,(bucket.counts.get(entry.cfg.s) || 0)+1);
    }
    const episodes=entries.filter(v=>refs.some(r=>r.s===v.cfg.s)).map(v=>{
      const ref={s:v.cfg.s,i:v.e.episodeId,e:v.work,p:v.proof,u:aggregateEpisodeCodes(v.e)};
      // Duplicate episode numbers within an API are ambiguous, even if hashes
      // happen to agree. Never pick an alternative by array position.
      const bucket=proofBuckets.get(proofKey(v.proof));
      if(bucket && bucket.counts.get(v.cfg.s)===1){
        ref.a=bucket.members.filter(a=>a.cfg.s!==v.cfg.s && bucket.counts.get(a.cfg.s)===1 && multiSameEpisode(v.proof,a.proof)).slice(0,2).map(a=>({s:a.cfg.s,i:a.e.episodeId,p:a.proof}));
      }
      const display=multiNativeEpisode(v.e)?multiAggregateDisplay(v.e,'episodeTitle'):v.e;
      return Object.assign({},display,{episodeId:multiId('c',[ref]),episodeTitle:display.episodeTitle+' · API '+v.cfg.slot});
    });
    const used=new Set();
    for(let i=0;refs.length>1 && i<entries.length;i++){
      if(used.has(i))continue;const root=entries[i],members=[root];
      for(let j=i+1;j<entries.length;j++){
        const v=entries[j];if(members.some(m=>m.cfg.s===v.cfg.s) || !members.every(m=>multiSameEpisode(m.proof,v.proof)))continue;
        members.push(v);used.add(j);
      }
      if(members.length<2)continue;
      episodes.unshift(Object.assign({},multiAggregateDisplay(root.e,'episodeTitle'),{episodeId:multiId('c',members.map(v=>({s:v.cfg.s,i:v.e.episodeId,p:v.proof,u:aggregateEpisodeCodes(v.e)}))),episodeTitle:'【聚合】'+root.e.episodeTitle+' · 安全聚合 API '+members.map(v=>v.cfg.slot).join('+')}));
    }
    if(refs.length>1 && !episodes.some(e=>e.episodeTitle.includes('安全聚合')))compatLog('Route','UNPROVEN_TIMELINE','Choose independent source');
    compatLog('MultiAPI',batch.partial?'PARTIAL':'COMPLETE','Returning routed episodes: '+episodes.length);
    return episodes;
  }catch(e){compatFailure('Detail',e);return [];}
}
function multiRecordOrigin(c){
  const source=fusionSource(c.source),known=['tencent','iqiyi','youku','imgo','bilibili','migu','aiyifan','dandan','renren','sohu','leshi','bahamut','animeko'];
  const origin=firstPresent(c,['sourceCommentId','originId','originalId']);
  if(known.includes(source) && origin!=null)return [source,String(origin)];
  const cid=String(c.cid || ''),m=cid.match(/^(tencent|iqiyi|youku|imgo|bilibili|migu|aiyifan|dandan|renren|sohu|leshi|bahamut|animeko):(.+)$/i);
  return m?[fusionSource(m[1]),m[2]]:null;
}
function multiMerge(values){
  // Maps keyed by exact source record/time/style/text; no fuzzy text matching.
  // Only cross-API replays are removed. Same-text independent viewers survive.
  const seen=new Map(),comments=[];let removed=0,size=32;
  for(const value of values){
    for(const c of value.data.comments){
      const origin=multiRecordOrigin(c),key=origin?JSON.stringify([origin,c.p,c.m]):null;
      if(key && seen.has(key) && seen.get(key)!==value.s){removed++;continue;}
      if(key && !seen.has(key))seen.set(key,value.s);
      const copy=Object.assign({},c,{cid:multiPrefix+value.s+':'+encodeURIComponent(String(c.cid==null?comments.length:c.cid))});
      size+=JSON.stringify(copy).length+1;
      if(values.length>1 && (comments.length>=500000 || size>64000000)){compatLog('MultiAPI','MERGE_CAPACITY','Combined track exceeds capacity; returning one complete source');return multiMerge([values[0]]);}
      comments.push(copy);
    }
  }
  compatLog('MultiAPI','MERGED','Merged APIs: '+values.length+'; exact upstream replays removed: '+removed+'; returned: '+comments.length);
  comments.sort((a,b)=>parseFloat(a.p)-parseFloat(b.p));
  const result={comments:comments,count:comments.length};
  if(values.some(v=>compatSegmentOutputs.has(v.data)))compatSegmentOutputs.add(result);
  return result;
}
async function fusionMultiComments(params,progress){
  try{
    const id=firstPresent(params,['commentId','episodeId']),sources=multiSources(params),refs=multiDecode(id,'c',sources);
    if(!refs){
      if(compatPresent(id))await multiBare(sources,'c',id,false);
      return fusionCompatComments(multiParams(params,sources[0]),progress);
    }
    if(refs.length===1)return await multiSelectedComments(params,progress,sources,refs[0]);
    if(refs.length>1 && (!refs[0].p || !refs.every(r=>multiSameEpisode(refs[0].p,r.p))))throw compatError('Route','UNPROVEN_TIMELINE','Historical aggregate lacks timeline evidence; select an individual source');
    const collect=refs.every(r=>r.g===1)?multiComplete:multiFirst;
    const batch=await collect(refs.map(async ref=>{
      const cfg=sources.find(c=>c.s===ref.s),data=await fusionCompatComments(Object.assign(multiParams(params,cfg),{commentId:ref.i,episodeId:ref.i}),progress);
      // A server which now explicitly reports another duration/hash/version
      // invalidates the earlier proof. Never apply offsets or silently mix it.
      if(ref.p && (multiDuration(data)!=null && multiDuration(data)!==ref.p.duration || multiTimeline(data)!=null && multiTimeline(data)!==ref.p.timeline || multiEdition(data) && multiEdition(data)!==ref.p.edition || multiLanguage(data) && multiLanguage(data)!==ref.p.language)){
        compatLog('MultiAPI','TIMELINE_CHANGED','Server timeline changed; select an individual source');return null;
      }
      return {s:ref.s,data:data};
    }),v=>v && Array.isArray(v.data.comments) && (v.data.comments.length>0 || progress && v.data.success!==false && !v.data.taskId));
    const values=batch.values.filter(v=>v.data && Array.isArray(v.data.comments) && v.data.success!==false);
    const usable=values.filter(v=>v.data.comments.length);
    if(batch.partial)compatLog('MultiAPI','PARTIAL','Returning available comments without waiting for slow peers');
    if(usable.length>1)return multiMerge(usable);
    if(usable.length===1)return refs.length>1?multiMerge(usable):usable[0].data;
    return values.length?values[0].data:{comments:[],count:0,success:false};
  }catch(e){compatFailure('Comments',e);return compatEmpty(e);}
}

function multiResponseMatches(data,proof){
  return !proof || !(multiDuration(data)!=null && multiDuration(data)!==proof.duration || multiTimeline(data)!=null && multiTimeline(data)!==proof.timeline || multiEdition(data) && multiEdition(data)!==proof.edition || multiLanguage(data) && multiLanguage(data)!==proof.language);
}
async function multiSelectedComments(params,progress,sources,ref){
  const load=async member=>{
    const cfg=sources.find(c=>c.s===member.s);
    const data=await fusionCompatComments(Object.assign(multiParams(params,cfg),{commentId:member.i,episodeId:member.i}),progress);
    if(!multiResponseMatches(data,member.p)){
      const error=compatError('Route','TIMELINE_CHANGED','Server video version changed');compatFailure('Route',error);return compatEmpty(error);
    }
    return data;
  };
  const primary=await load(ref);
  // A valid empty progress window is success, not evidence that a track failed.
  if(primary.success!==false && !primary.taskId && (primary.count>0 || progress || compatSegmentOutputs.has(primary))){
    if(primary.count>0)await preferenceSelect(sources,ref);
    return primary;
  }
  const alternatives=(ref.a || []).filter(a=>multiSameEpisode(ref.p,a.p));
  if(!alternatives.length){
    if(ref.a && ref.a.length)compatLog('Fallback','UNPROVEN_TIMELINE','Unverified fallback rejected');
    return primary;
  }
  const original=primary.error || {code:primary.taskId?'PENDING_TASK':'NO_COMMENTS',category:primary.taskId?'PENDING_TASK':'NO_COMMENTS'};
  // At most two, each attempted once. No recursion, cycles, offsets or merging.
  for(const alternative of alternatives){
    const data=await load(alternative);
    if(data.success===false || data.taskId || !data.count && !progress)continue;
    compatLog('Fallback','FALLBACK_USED','Verified fallback used');
    return Object.assign({},data,{message:compatMessage('FALLBACK_USED'),fallback:{original:original,from:sources.find(c=>c.s===ref.s).slot,to:sources.find(c=>c.s===alternative.s).slot},diagnostics:compatSummary()});
  }
  compatLog('Fallback','FALLBACK_FAILED','No healthy verified fallback');
  return Object.assign({},primary,{diagnostics:compatSummary()});
}

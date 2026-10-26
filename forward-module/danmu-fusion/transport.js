/* Forward runtime only. Embedded in danmu-fusion.js by the reproducible build. */
const fusionMemory = new Map();
const fusionPending = new Map();
const fusionCapabilities = new Map();
const fusionHttpWaiters = [];
let fusionHttpActive = 0;
let fusionStorageQueue = Promise.resolve();
const fusionSchema = 'fusion-v8';

function fusionOptions(params) {
  const p=params || {};
  // Keep the established address key so upgrades retain saved configuration.
  // All other parameters are media context; historical technical settings are
  // deliberately not read, validated or incorporated into cache signatures.
  const cfg={
    requestBase:parseDanmuApiUrl(p.danmu_api_url || p.server || "").requestBase,
    timeoutMs:30000, retry:1, cacheEnabled:true, ttl:300000, chunk:60,
    tolerance:2, maxSources:8,
    order:['tencent','iqiyi','youku','imgo','bilibili','dandan']
  };
  cfg.signature=JSON.stringify([fusionSchema,cfg.requestBase]);
  return cfg;
}

function fusionIdentity(params) {
  const identity=resolveIdentity(params);
  identity.episodeName=String(params.episodeName || params.episodeTitle || '');
  identity.runtime=Number(params.runtime) || null;
  identity.airDate=params.airDate || null;
  identity.premiereDate=params.premiereDate || null;
  identity.link=params.link || null;
  identity.videoUrl=params.videoUrl || null;
  identity.aliases=Array.isArray(params.aliases) ? params.aliases : [];
  // Prefer series premiere year to the currently playing episode's air date.
  identity.year=yearFrom(params.year) || yearFrom(params.ProductionYear) || yearFrom(params.premiereDate) || identity.year;
  if (params.tmdbId && /^(tv|movie)\.\d+$/.test(String(params.tmdbId))) identity.tmdb_id=String(params.tmdbId).split('.')[1];
  const explicitSeason=firstPresent(params,['season','seasonNumber','ParentIndexNumber']);
  const union=parseUnionOrMediaId(params.unionId || params.union_id);
  if (union && union.tmdb_id) identity.tmdb_id=union.tmdb_id;
  if (!identity.isMovie && (Number(explicitSeason)===0 && explicitSeason!=null || union && !union.isMovie && union.season===0)) identity.specialSeason=true;
  identity.special=fusionSpecial(identity.title+' '+identity.episodeName)!=='regular' || !!identity.specialSeason;
  if (identity.specialSeason) identity.season=0;
  identity.reliableSE=identity.isMovie || identity.seasonSource!=='default_1_UNSAFE' && identity.episodeSource!=='default_1_UNSAFE';
  return identity;
}

function fusionKey(identity,cfg,extra) {
  // Full signature comparison protects even the unlikely 32-bit hash collision.
  return fusionSchema+':'+fusionHash(cfg.signature)+':'+JSON.stringify([identity.isMovie?'movie':'tv',identity.tmdb_id,identity.imdb_id,identity.title,identity.year,identity.season,identity.episode,identity.special,identity.version_key,extra]);
}

async function fusionCached(key,cfg,loader,ttl) {
  const now=Date.now();
  let entry=fusionMemory.get(key);
  if (!entry && cfg.cacheEnabled && Widget.storage) {
    try { entry=await Widget.storage.get(key); if (typeof entry==='string') entry=JSON.parse(entry); } catch(e) {}
  }
  if (cfg.cacheEnabled && entry && entry.signature===cfg.signature && entry.expires>now) return JSON.parse(JSON.stringify(entry.value));
  // In-flight entries disappear on success and failure; failed requests never cache.
  if (fusionPending.has(key)) return JSON.parse(JSON.stringify(await fusionPending.get(key)));
  const work=(async()=>{
    const value=await loader();
    if (cfg.cacheEnabled && !(value && value.partial)) {
      entry={ signature:cfg.signature, expires:Date.now()+(ttl || cfg.ttl), value:value };
      fusionMemory.set(key,entry);
      // Storage holds only a bounded manifest of our own schema keys. Old user data
      // and settings are never removed. Large source payloads stay memory-only.
      entry._bytes=JSON.stringify(entry).length*2;
      const persist=entry._bytes<3000000;
      let bytes=0; fusionMemory.forEach(e=>{bytes+=e._bytes || 0;});
      while (fusionMemory.size>32 || bytes>8*1024*1024) {
        const old=fusionMemory.keys().next().value;
        bytes-=fusionMemory.get(old)._bytes || 0; fusionMemory.delete(old);
      }
      if (persist && Widget.storage && Widget.storage.set) {
        const persistWork=fusionStorageQueue.then(async()=>{
          await Widget.storage.set(key,entry);
          let list=await Widget.storage.get(fusionSchema+':keys');
          if (!Array.isArray(list)) list=[];
          list=list.filter(k=>k!==key); list.push(key);
          while (list.length>32) { const old=list.shift(); if (Widget.storage.remove) await Widget.storage.remove(old); }
          await Widget.storage.set(fusionSchema+':keys',list);
        });
        fusionStorageQueue=persistWork.catch(()=>{});
        await fusionStorageQueue; // optional storage failure cannot discard data
      }
    }
    return value;
  })();
  fusionPending.set(key,work);
  try { return JSON.parse(JSON.stringify(await work)); } finally { fusionPending.delete(key); }
}

async function fusionRequest(cfg,path,body) {
  const isSearch=/\/api\/v2\/search\//.test(path);
  // danmu_api's first search waits for all source discovery pipelines, which
  // can legitimately exceed a comment request's budget. Do not launch another
  // expensive discovery when the first one times out.
  const requestTimeout=isSearch?90000:cfg.timeoutMs;
  let last;
  for (let attempt=0;attempt<=cfg.retry;attempt++) {
    let timer;
    if (fusionHttpActive>=3) await new Promise(resolve=>fusionHttpWaiters.push(resolve));
    else fusionHttpActive++;
    try {
      const url=/^https?:\/\//i.test(path) ? path : cfg.requestBase+path;
      const options={headers:headers(cfg),timeout:requestTimeout};
      if (body!==undefined && !Widget.http.post) { const e=new Error('分片扩展不可用'); e.status=501; throw e; }
      const request=body===undefined ? Widget.http.get(url,options) : Widget.http.post(url,body,options);
      const response=typeof setTimeout==='function' ? await Promise.race([request,new Promise((_,reject)=>{ timer=setTimeout(()=>{ const e=new Error('弹幕请求超时'); e.status=408; reject(e); },requestTimeout); })]) : await request;
      const status=Number(response && (response.status || response.statusCode)) || 200;
      if (status>=400) { const e=new Error('弹幕 API HTTP '+status); e.status=status; throw e; }
      let data=response && response.data!==undefined ? response.data : response;
      if (typeof data==='string') { if (data.length>24000000) throw new Error('弹幕响应过大'); try { data=JSON.parse(data); } catch(e) { throw new Error('弹幕 API JSON 无效'); } }
      if (!data || typeof data!=='object') throw new Error('弹幕 API 响应无效');
      if (data.success===false || Number(data.errorCode)>0) { const e=new Error('弹幕 API 返回失败'); e.status=Number(data.errorCode)||502; throw e; }
      return data;
    } catch(e) {
      last=e;
      // No URL, token, response text or native exception is logged.
      if (isSearch && (!e.status || Number(e.status)===408) || Number(e.status)===501 || e.status && ![408,429].includes(e.status) && e.status<500) break;
      if (attempt<cfg.retry && typeof setTimeout==='function') await new Promise(resolve=>setTimeout(resolve,Math.min(1500,200*(attempt+1))));
    } finally {
      if (timer && typeof clearTimeout==='function') clearTimeout(timer);
      if (fusionHttpWaiters.length) fusionHttpWaiters.shift()();
      else fusionHttpActive--;
    }
  }
  // Never propagate a native transport error containing a credentialed URL.
  const error=new Error(last && last.status ? '弹幕 API HTTP '+last.status : '弹幕 API 请求或数据解析失败');
  error.status=last && last.status; throw error;
}

async function fusionPool(items,fn) {
  let cursor=0; const results=new Array(items.length);
  await Promise.all([0,1,2].map(async()=>{ while(cursor<items.length) { const i=cursor++; try { results[i]={value:await fn(items[i],i)}; } catch(e) { results[i]={error:e}; } } }));
  return results;
}

function fusionUnsupported(error) { return [400,404,405,415,422,501].includes(Number(error && error.status)); }

function fusionCapability(cfg,feature,value) {
  const key=cfg.signature+':'+feature;
  if (value!==undefined) {
    fusionCapabilities.set(key,{value:value,expires:Date.now()+cfg.ttl});
    while (fusionCapabilities.size>32) fusionCapabilities.delete(fusionCapabilities.keys().next().value);
  }
  const entry=fusionCapabilities.get(key);
  return entry && entry.expires>Date.now() ? entry.value : undefined;
}

async function fusionCatalog(identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,'catalog'),cfg,async()=>{
    const title=identity.title || identity.original_title || '';
    if (!title && !identity.tmdb_id) return [];
    let raw;
    try { raw=await fusionRequest(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(title)); }
    catch(e) { if (!fusionUnsupported(e)) throw e; }
    if (!raw || Array.isArray(raw.animes) && !raw.animes.length) {
      try {
        const query='anime='+encodeURIComponent(title)+(identity.tmdb_id?'&tmdbId='+encodeURIComponent(identity.tmdb_id)+'&tmdbIdType='+(identity.isMovie?'1':'0'):'')+(!identity.isMovie && identity.reliableSE?'&episode='+identity.episode:'');
        raw=await fusionRequest(cfg,'/api/v2/search/episodes?'+query);
      } catch(e) { if (!fusionUnsupported(e)) throw e; }
    }
    if (!raw || !Array.isArray(raw.animes)) throw new Error('弹幕搜索结构发生变化');
    let candidates=raw.animes.slice(0,80).filter(a=>a && (a.animeId!=null || a.bangumiId)).map(fusionCandidate);
    const baseName=fusionSeriesName(identity.title,identity.season);
    // A player can supply the series premiere year with a numbered season
    // title. Retrieve the base series once so that a first-season record can
    // prove that year, rather than relaxing year checks for every show.
    if (!identity.isMovie && baseName && (baseName!==fusionTitle(identity.title) || Number(identity.season)>1 && /第.+季|\bS\d+\b|season\s*\d+/i.test(identity.title))) {
      try {
        const base=await fusionRequest(cfg,'/api/v2/search/anime?keyword='+encodeURIComponent(baseName));
        if (Array.isArray(base.animes)) {
          const seen=new Set(candidates.map(a=>String(a.source)+'|'+a.animeId));
          base.animes.slice(0,80).map(fusionCandidate).forEach(a=>{const k=String(a.source)+'|'+a.animeId;if(!seen.has(k)){seen.add(k);candidates.push(a);}});
        }
      } catch(e) { /* keep the valid original search if the auxiliary one fails */ }
    }
    return fusionSeriesEvidence(candidates,identity);
  });
}

function fusionTvType(candidate) {
  const type=String(candidate.type || '')+' '+String(candidate.typeDescription || '');
  return /tv|series|episode|drama|番[剧劇]|[电電][视視][剧劇]|[剧劇]集|[剧劇](?:\s|$)/i.test(type) && !/movie|电影|電影|[剧劇][场場]版/i.test(type);
}

function fusionSeriesName(title,season) {
  const normalized=fusionTitle(title);
  const suffix=normalized.match(/^(.+?[^\d])(\d{1,2})$/);
  return suffix && Number(suffix[2])===Number(season) && suffix[1].length>=2 ? suffix[1] : normalized;
}

function fusionSeasonCandidate(identity,candidate) {
  if (identity.isMovie || !fusionTvType(candidate)) return {identity:identity,candidate:candidate};
  const copy=Object.assign({},candidate,{type:'tvseries',typeDescription:'tvseries'});
  const desired=Number(identity.season), name=fusionTitle(candidate.animeTitle || candidate.title || '');
  const base=fusionSeriesName(identity.title,desired);
  const suffix=name.match(/^(.+?[^\d])(\d{1,2})$/);
  // A numeric suffix is a season only when its base matches this exact work
  // and the requested season supplies corroborating evidence.
  if (suffix && suffix[1]===base) {
    copy.season=Number(suffix[2]);
    copy.animeTitle=suffix[1]+' S'+suffix[2];
    const year=yearFrom(candidate.startDate || candidate.year || candidate.animeTitle);
    if (year) copy.startDate=year+'-01-01';
  } else if (desired===1 && name===base && !/第.+季|\bS\d+\b|season\s*\d+/i.test(String(candidate.animeTitle || ''))) {
    copy.season=1;
  }
  const context=Object.assign({},identity,{title:base});
  if (candidate._fusionSeriesYear && String(candidate._fusionSeriesYear)===String(identity.year)) {
    context.year=yearFrom(candidate.startDate || candidate.year || candidate.animeTitle) || identity.year;
  }
  return {identity:context,candidate:copy};
}

function fusionSeriesEvidence(candidates,identity) {
  if (identity.isMovie || !identity.year) return candidates;
  const base=fusionSeriesName(identity.title,identity.season), bySource=new Map(), seasonYears=new Map();
  candidates.forEach(a=>{
    if (!a.source || !fusionTvType(a)) return;
    const normalized=fusionSeasonCandidate(identity,a), year=yearFrom(a.startDate || a.year || a.animeTitle);
    if (!year || !fusionMatch(Object.assign({},normalized.identity,{year:year}),normalized.candidate).reliable) return;
    const key=fusionSource(a.source); if(!seasonYears.has(key))seasonYears.set(key,new Set());seasonYears.get(key).add(year);
  });
  candidates.forEach(a=>{
    if (!a.source || !fusionTvType(a)) return;
    const title=fusionTitle(a.animeTitle || '');
    // Only an unnumbered exact base title or explicit season 1 can establish
    // the series premiere. Multiple competing years stay ambiguous.
    const explicit=String(a.animeTitle || '').match(/第\s*([一1])\s*季|\bS0?1\b|season\s*1\b/i);
    if (fusionSeriesName(a.animeTitle || '',1)!==base || (/第.+季|\bS\d+\b|season\s*\d+/i.test(String(a.animeTitle || ''))&&!explicit)) return;
    const year=yearFrom(a.startDate || a.year || a.animeTitle);
    if (!year) return;
    const key=fusionSource(a.source); if(!bySource.has(key))bySource.set(key,new Set());bySource.get(key).add(year);
  });
  const premiereYears=new Set(), targetYears=new Set();
  bySource.forEach(years=>years.forEach(year=>premiereYears.add(year)));
  seasonYears.forEach(years=>years.forEach(year=>targetYears.add(year)));
  // Cross-platform evidence needs two independent first-season listings and
  // one unambiguous year for the requested season. A single unrelated listing
  // cannot override the player's year. Competing remakes remain manual.
  const consensus=bySource.size>=2 && premiereYears.size===1 && premiereYears.has(String(identity.year)) && targetYears.size===1;
  return candidates.map(a=>{
    const years=bySource.get(fusionSource(a.source));
    const target=seasonYears.get(fusionSource(a.source)), year=yearFrom(a.startDate || a.year || a.animeTitle);
    const own=years && years.size===1 && years.has(String(identity.year));
    return fusionTvType(a) && (own || consensus) && target && target.size===1 && Number(year)>=Number(identity.year) ? Object.assign({},a,{_fusionSeriesYear:String(identity.year)}) : a;
  });
}

function fusionCandidate(candidate) {
  const item=Object.assign({},candidate);
  if (item.animeId==null) item.animeId=item.bangumiId;
  if (item.type==='jpdrama') item.type='tvseries';
  const id=String(item.bangumiId || '').match(/^tmdb-(tv|movie)-(\d+)$/);
  if (id) { item.tmdb_id=id[2]; item.type=id[1]==='movie'?'movie':'tvseries'; item._multiSeason=id[1]==='tv'; }
  return item;
}

function fusionReliable(identity,candidate) {
  if (/^(?:tvspecial|ova|oad)$/i.test(String(candidate.type || ''))) return false;
  const normalized=fusionSeasonCandidate(identity,candidate);
  if (fusionMatch(normalized.identity,normalized.candidate).reliable) return true;
  // A shared series ID needs per-episode season proof in the actual detail.
  return !!(candidate._multiSeason && fusionMatch(identity,Object.assign({},candidate,{season:identity.season})).reliable);
}

async function fusionSearch(params) {
  const cfg=fusionOptions(params), identity=fusionIdentity(params);
  const list=await fusionCatalog(identity,cfg);
  const reliable=list.filter(a=>fusionReliable(identity,a));
  // Include uncertain candidates for explicit user selection, without secretly
  // including them in the automatic merged track.
  const manual=list.map(a=>Object.assign({},a,{isFavorited:false}));
  if (reliable.length && identity.reliableSE && !identity.special) {
    const id=fusionAutoId(identity,cfg,'anime');
    manual.unshift({animeId:id,bangumiId:String(id),animeTitle:identity.title+' · 自动匹配',type:identity.isMovie?'movie':'tvseries',episodeCount:Math.max(1,Number(identity.episode)||1),isFavorited:true});
  }
  return {animes:manual};
}

async function fusionEpisodes(candidate,identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,['detail',candidate.animeId]),cfg,async()=>{
    if (Array.isArray(candidate.episodes)) return candidate.episodes.slice(0,2000);
    const id=/^tmdb-(?:tv|movie)-\d+$/.test(String(candidate.bangumiId || '')) ? candidate.bangumiId : candidate.animeId;
    const raw=await fusionRequest(cfg,'/api/v2/bangumi/'+encodeURIComponent(id));
    if (!raw.bangumi || !Array.isArray(raw.bangumi.episodes)) throw new Error('弹幕详情结构发生变化');
    const seasons=new Map((raw.bangumi.seasons || []).map(s=>{
      const m=String(s.name || '').match(/(?:season\s*|\bS)(\d+)\b|第([一二三四五六七八九十\d]+)季/i);
      const cn={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
      return [String(s.id),m?Number(m[1]||cn[m[2]]||m[2]):null];
    }));
    return raw.bangumi.episodes.slice(0,2000).map(e=>Object.assign({},e,{_season:seasons.get(String(e.seasonId))}));
  });
}

function fusionLegacySelection(params) {
  const id=String(params.animeId || '');
  return /^(?:tmdb_|fusion_(?:tv|movie)_)/i.test(id) || !!parseUnionOrMediaId(id);
}

function fusionAutoId(identity,cfg,kind) {
  return -(Number.parseInt(fusionHash(fusionKey(identity,cfg,kind)),36)%500000000+(kind==='anime'?1000000000:1500000000));
}

function fusionAutomatic(params) {
  const a=Number(params.animeId), c=Number(params.commentId);
  return a<=-1000000000 && a>-1500000000 || c<=-1500000000 && c>-2000000000 || String(params.animeId || '').startsWith('fusion-auto:') || String(params.commentId || '').startsWith('fusion-track:') || fusionLegacySelection(params);
}

function fusionEpisodeNumber(ep) {
  // danmu_api generates episodeNumber from the array index (and renumbers it
  // after filtering). Only the original episode title proves a platform number.
  const raw=String(ep.episodeTitle || '');
  const title=raw.replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/, '');
  if (fusionSpecial(raw)!=='regular' || /预告|預告|花絮|解说|解說|上集|下集|上篇|下篇|\(上\)|\(下\)|（上）|（下）/.test(raw)) return null;
  const m=title.match(/第\s*(\d+)\s*[集话話]|(?:^|\b)E(?:P)?\s*(\d+)\b|^\s*(\d+)\s*$/i);
  return m ? Number(m[1]||m[2]||m[3]) : null;
}

function fusionEpisodeSource(ep,candidate) {
  const tag=String(ep.episodeTitle || '').match(/^\s*(?:【([^】]+)】|\[([^\]]+)\])/);
  const source=tag && fusionSource(tag[1] || tag[2]);
  const known=['tencent','iqiyi','youku','imgo','bilibili','migu','renren','aiyifan','dandan'];
  const host=(String(ep.url || '').match(/^https?:\/\/([^/:?#]+)/i) || [])[1] || '';
  const domains=[['qq.com','tencent'],['iqiyi.com','iqiyi'],['youku.com','youku'],['mgtv.com','imgo'],['bilibili.com','bilibili'],['migu.cn','migu']];
  const domain=domains.find(d=>host.toLowerCase()===d[0] || host.toLowerCase().endsWith('.'+d[0]));
  if(known.includes(source) && domain && source!==domain[1]) return 'unknown';
  if(domain)return domain[1];
  if(known.includes(source))return source;
  const fallback=fusionSource(candidate.source);
  // 360 is a catalog, not an independent video platform. Its actual platform
  // must be established by the episode tag or official video URL.
  return fallback==='360'?'unknown':fallback;
}

function fusionCommentId(key) {
  // A stable, exactly representable 53-bit ID avoids reusing 1..N at every
  // progress callback. Forward may use cid to recognize already-loaded rows.
  return Number.parseInt(fusionHash(key),36)*2097152+Number.parseInt(fusionHash('cid:'+key),36)%2097152;
}

async function fusionDetail(params) {
  const cfg=fusionOptions(params), identity=fusionIdentity(params);
  if (fusionAutomatic(params)) {
    // Only expose the proven current episode; do not invent a 40-episode season.
    return [{episodeId:fusionAutoId(identity,cfg,'episode'),episodeTitle:identity.isMovie?'正片':formatSE(identity.season,identity.episode),episodeNumber:String(identity.isMovie?1:identity.episode)}];
  }
  const selected=(await fusionCatalog(identity,cfg)).find(a=>String(a.animeId)===String(params.animeId) || String(a.bangumiId)===String(params.animeId));
  return fusionEpisodes(selected || {animeId:params.animeId},identity,cfg);
}

async function fusionTracks(params,identity,cfg) {
  const auto=fusionAutomatic(params) || !params.animeId && !params.commentId;
  if (!auto && params.commentId!=null) {
    let selected;
    try { selected=(await fusionCatalog(identity,cfg)).find(a=>String(a.animeId)===String(params.animeId)); } catch(e) {}
    const merged=selected && ((selected.mergedChildren || []).length || (selected.links || []).some(l=>String(l.url).includes('$$$')));
    return [{commentId:params.commentId,source:selected?fusionSource(selected.source):'unknown',serverMerged:!!merged,serverSources:selected?[selected.source].concat((selected.mergedChildren || []).map(c=>c.source)).filter(Boolean).map(fusionSource):[]}];
  }
  if (!identity.reliableSE || identity.special) throw new Error('当前季集或特别篇身份不明确，请手动选择资源');
  const catalog=await fusionCatalog(identity,cfg);
  let reliable=catalog.filter(a=>fusionReliable(identity,a) && !a.isHiddenChild);
  reliable.sort((a,b)=>{ const rank=s=>{ const n=cfg.order.indexOf(fusionSource(s)); return n<0?999:n; }; return rank(a.source)-rank(b.source); });
  const composite=reliable.find(a=>(a.mergedChildren || []).length || (a.links || []).some(l=>String(l.url).includes('$$$')));
  // Native merges contain all children: request that entry once.
  if (composite) reliable=[composite];
  const platforms=new Set();
  reliable=reliable.filter(a=>{const source=fusionSource(a.source); if(platforms.has(source))return false; platforms.add(source); return true;});
  if (reliable.some(a=>fusionSource(a.source)!=='unknown')) reliable=reliable.filter(a=>fusionSource(a.source)!=='unknown');
  const details=await fusionPool(reliable.slice(0,cfg.maxSources),async a=>{
    const eps=await fusionEpisodes(a,identity,cfg);
    let hits;
    if (identity.isMovie) hits=eps.length===1 ? eps : eps.filter(e=>/正片|全片/.test(String(e.episodeTitle)));
    else hits=eps.filter(e=>fusionEpisodeNumber(e)===Number(identity.episode) && (!a._multiSeason || e._season===Number(identity.season)));
    if (hits.length!==1) return null; // Never use array index as platform episode.
    const ep=hits[0], link=(a.links || []).find(l=>String(l.id)===String(ep.episodeId));
    const source=fusionEpisodeSource(ep,a);
    return {commentId:ep.episodeId,source:source,serverMerged:!!composite || String(ep.url || '').includes('$$$') || !!(link && String(link.url).includes('$$$')),serverSources:[source].concat((a.mergedChildren || []).map(c=>c.source)).filter(Boolean).map(fusionSource)};
  });
  const seen=new Set(), origins=new Set();
  return details.filter(r=>r.value).map(r=>r.value).filter(r=>{
    const k=String(r.commentId); if(seen.has(k) || r.source!=='unknown' && origins.has(r.source)) return false;
    seen.add(k); origins.add(r.source); return true;
  });
}

function fusionParse(payload,track,identity) {
  const list=Array.isArray(payload) ? payload : payload.comments;
  if (!Array.isArray(list)) throw new Error('弹幕数据结构发生变化');
  if (list.length>200000) throw new Error('单源弹幕超过 200000 条限制');
  const episodeKey=fusionKey(identity,{signature:'',requestBase:''},'episode');
  const parsed=list.map(c=>{
    const p=String(c && c.p || '').split(',');
    if (!c || !c.p || p.length<3 || c.m==null || !p[0].trim()) return null;
    const time=Number(p[0]), position=Number(p[1]), color=Number(p.length>=8?p[3]:p[2]);
    if (!Number.isFinite(time) || !Number.isFinite(position) || !Number.isFinite(color) || color<0 || color>16777215) return null;
    // Bilibili 8-field p: time,mode,fontSize,color,...; Dandan: time,mode,color.
    return {time:time,position:position,color:color,content:String(c.m),recordId:c.cid,source:track.serverMerged?'unknown':track.source,episode:episodeKey};
  }).filter(Boolean);
  if (list.length && !parsed.length) throw new Error('API 弹幕记录均无效');
  return parsed;
}

async function fusionFullTrack(track,identity,cfg) {
  return fusionCached(fusionKey(identity,cfg,['full',track.commentId]),cfg,async()=>{
    const raw=await fusionRequest(cfg,'/api/v2/comment/'+encodeURIComponent(track.commentId)+'?withRelated=true');
    if (!Array.isArray(raw.comments)) throw new Error('标准弹幕接口未返回 comments 数组');
    return {comments:raw.comments};
  });
}

async function fusionManifest(track,identity,cfg,refresh) {
  const key=fusionKey(identity,cfg,['manifest',track.commentId]);
  if (refresh) {
    fusionMemory.delete(key);
    if (Widget.storage && Widget.storage.remove) { try { await Widget.storage.remove(key); } catch(e) {} }
  }
  return fusionCached(key,cfg,async()=>{
    if (fusionCapability(cfg,'segments')===false) return fusionFullTrack(track,identity,cfg);
    let raw;
    try { raw=await fusionRequest(cfg,'/api/v2/comment/'+encodeURIComponent(track.commentId)+'?withRelated=true&segmentflag=true'); }
    catch(e) {
      if (!fusionUnsupported(e)) throw e;
      fusionCapability(cfg,'segments',false);
      return fusionFullTrack(track,identity,cfg);
    }
    const list=raw.comments && raw.comments.segmentList || raw.barrage_list;
    if (Array.isArray(list)) {
      const direct=Array.isArray(raw.barrage_list);
      if (list.length>10000 || list.some(s=>!s || !Number.isFinite(s.segment_start) || !Number.isFinite(s.segment_end) || s.segment_end<=s.segment_start || (direct?!/^https?:\/\//i.test(String(s.segment_url || '')):!s.type || typeof s.url!=='string'))) return fusionFullTrack(track,identity,cfg);
      return {segments:list,direct:direct};
    }
    // A standard Dandan endpoint ignores segmentflag and already returns the
    // canonical timeline. Cache it once, and don't probe that extension again.
    if (Array.isArray(raw.comments)) {
      // Do not disable segmentation globally: another origin on the same server
      // may implement it. This manifest itself is cached per selected episode.
      return {comments:raw.comments};
    }
    return fusionFullTrack(track,identity,cfg);
  });
}

async function fusionWindow(params,identity,cfg,start,end,initial) {
  const tracks=await fusionTracks(params,identity,cfg);
  if (!tracks.length) return {count:0,comments:[],error:'no_reliable_source'};

  const margin=cfg.tolerance;
  const fetched=await fusionPool(tracks,async track=>{
    async function load(refresh) {
      const manifest=await fusionManifest(track,identity,cfg,refresh);
      if (manifest.comments) return {items:fusionParse(manifest,track,identity),full:true};
      const offset=0; // Preserve the server timeline; no client platform shifts.
      const segments=manifest.segments.filter(s=>s.segment_start<end-offset+margin && s.segment_end>start-offset-margin);
      if (!manifest.direct && fusionCapability(cfg,'segmentPost')===false) {
        const full=await fusionFullTrack(track,identity,cfg);
        return {items:fusionParse(full,track,identity),full:true};
      }
      const batches=await fusionPool(segments,seg=>fusionCached(fusionKey(identity,cfg,['segment',track.commentId,seg]),cfg,()=>manifest.direct?fusionRequest(cfg,seg.segment_url):fusionRequest(cfg,'/api/v2/segmentcomment?format=json',seg)));
      const ok=batches.filter(r=>r.value), failed=batches.filter(r=>r.error);
      if (failed.length && !manifest.direct && failed.some(r=>[400,405,415,422,501].includes(Number(r.error.status)))) {
        fusionCapability(cfg,'segmentPost',false);
        try {
          const full=await fusionFullTrack(track,identity,cfg);
          return {items:fusionParse(full,track,identity),full:true};
        } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && !refresh) {
        try { return await load(true); } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && refresh && failed.some(r=>fusionUnsupported(r.error))) {
        try {
          const full=await fusionFullTrack(track,identity,cfg);
          return {items:fusionParse(full,track,identity),full:true};
        } catch(e) { if (!ok.length) throw e; }
      }
      if (failed.length && !ok.length) throw failed[0].error;
      const items=[];
      ok.forEach(r=>{ fusionParse(r.value,track,identity).forEach(c=>items.push(c)); });
      // Repeated records across overlapping manifests have identical upstream IDs.
      return {items:items,partial:failed.length>0};
    }
    return load(false);
  });
  const input=[], errors=[];
  fetched.forEach((r,i)=>{ if (r.error) errors.push(tracks[i].source); else r.value.items.forEach(c=>input.push(c)); });
  const processed=fusionDedupe(input,{enabled:true,tolerance:cfg.tolerance,serverProcessed:false});
  // Official Forward behavior for a standard/full-track response is to return
  // the full comments array. Otherwise a resume beyond minute 1 can stay empty
  // in clients that do not issue progress callbacks for a non-segmented track.
  const available=fetched.filter(r=>r.value);
  const fullTrack=!!initial && available.length>0 && available.every(r=>r.value.full);
  const occurrences=new Map();let occurrenceTime=null;
  const comments=processed.items.filter(c=>fullTrack || c.time>=start && c.time<end).map(c=>{
    if(c.time!==occurrenceTime){occurrences.clear();occurrenceTime=c.time;}
    const key=JSON.stringify([c.episode,c.source,c.recordId,c.time,c.position,c.color,c.content]);
    const ordinal=occurrences.get(key) || 0;occurrences.set(key,ordinal+1);
    return {p:[c.time,[1,4,5].includes(c.position)?c.position:1,c.color].join(','),m:c.content,cid:fusionCommentId(key+':'+ordinal)};
  });
  const successful=tracks.filter((track,i)=>fetched[i].value && fetched[i].value.items.length);
  const proven=new Set();
  successful.forEach(track=>(track.serverSources || [track.source]).forEach(source=>{if(source && source!=='unknown') proven.add(source);}));
  const aggregation={mode:successful.some(track=>track.serverMerged)?'server':proven.size>1?'client':'single',sourceCount:proven.size || null,successfulTrackCount:successful.length};
  return Object.assign(adaptComments({comments:comments}),{fullTrack:fullTrack,aggregation:aggregation,partial:errors.length>0 || fetched.some(r=>r.value && r.value.partial),error:errors.length===tracks.length?'all_sources_failed':undefined,stats:processed.stats,sources:tracks.map(t=>t.source),failedSources:errors,fullFallback:fetched.some(r=>r.value && r.value.full),segment:{segment_start:start,segment_end:end}});
}

async function fusionLoad(params,initial) {
  try {
    const cfg=fusionOptions(params), identity=fusionIdentity(params);
    const time=params.segmentTime==null || params.segmentTime==='' ? 0 : Number(params.segmentTime);
    if (!Number.isFinite(time) || time<0) throw new Error('播放时间无效');
    const start=Math.floor(time/cfg.chunk)*cfg.chunk, end=start+cfg.chunk;
    return await fusionCached(fusionKey(identity,cfg,[initial?'initial':'window',params.animeId,params.commentId,start]),cfg,
      ()=>fusionWindow(params,identity,cfg,start,end,initial));
  } catch(e) {
    return {count:0,comments:[],error:String(e.message || '弹幕加载失败'),success:false};
  }
}

async function getDanmuWithSegmentTime(params) { return fusionAggregateComments(params || {},true); }

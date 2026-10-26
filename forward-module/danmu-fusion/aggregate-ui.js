/* AGPL-3.0-only. Public aggregation presentation, scoped to each real episode.
 * The compatibility router remains available for saved historical selections.
 * Provider names are data, never a fetch allowlist or merge authority.
 */
const aggregateManifests=new Map();
let aggregateManifestLoaded=false;
async function aggregateManifestAccess(key,update){
  if(!aggregateManifestLoaded){
    aggregateManifestLoaded=true;
    try{const value=Widget.storage && await Widget.storage.get('fusion-aggregate-v1:manifests');
      if(typeof value==='string' && value.length<=48000){const saved=JSON.parse(value);if(Array.isArray(saved))for(const item of saved.slice(-32)){const v=Array.isArray(item) && item[1];if(v && /^[a-f0-9]{64}$/.test(item[0]) && Number.isFinite(v.expires) && v.expires<=Date.now()+180000 && Number.isSafeInteger(v.count) && v.count>=0 && v.count<=500000 && Array.isArray(v.codes) && v.codes.length<=128 && v.codes.every(c=>typeof c==='string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(c)))aggregateManifests.set(item[0],v);}}
    }catch(e){}
  }
  for(const [k,v] of aggregateManifests)if(!v || !(v.expires>Date.now()))aggregateManifests.delete(k);
  if(update){
    aggregateManifests.delete(key);aggregateManifests.set(key,{...update,expires:Date.now()+180000});
    while(aggregateManifests.size>32 || JSON.stringify(Array.from(aggregateManifests)).length>48000)aggregateManifests.delete(aggregateManifests.keys().next().value);
    try{if(Widget.storage)await Widget.storage.set('fusion-aggregate-v1:manifests',JSON.stringify(Array.from(aggregateManifests)));}catch(e){}
  }
  return aggregateManifests.get(key);
}
function aggregateActualCodes(data){
  const codes=new Set(),seen=new Set();
  for(const comment of data.comments || []){
    const p=String(comment.p || '');let start=0;
    for(let i=0;i<3;i++){const next=p.indexOf(',',start);if(next<0){start=p.length;break;}start=next+1;}
    const end=p.indexOf(',',start),tag=p.slice(start,end<0?p.length:end),marked=tag.match(/^\[([^\]]+)\]$/);
    if(!marked && !comment.source)continue;
    const key=tag+'|'+(comment.source || '');if(seen.has(key))continue;seen.add(key);
    const providers=marked?aggregateCodes(marked[1]):aggregateCodes(comment.source);
    for(const code of providers){codes.add(code);if(codes.size>128)throw compatError('Comments','INVALID_PROVIDERS','Provider metadata exceeds capacity');}
  }
  return Array.from(codes);
}
function aggregateCodes(value){
  const values=Array.isArray(value)?value:String(value || '').split(/[&＆]/);
  return Array.from(new Set(values.filter(v=>v!=null).map(v=>fusionSource(String(v).trim())).filter(v=>/^[a-z][a-z0-9_-]{0,47}$/i.test(v) && !['unknown','聚合'].includes(v))));
}
function aggregateEpisodeCodes(episode){
  let title=String(episode.episodeTitle || ''),codes=[];
  while(/^\s*[【\[]/.test(title)){
    const m=title.match(/^\s*(?:【([^】]*)】|\[([^\]]*)\])\s*/);if(!m)break;
    const tag=m[1] || m[2];if(/^[a-z][a-z0-9_-]*(?:[&＆][a-z][a-z0-9_-]*)*$/i.test(tag))codes=codes.concat(aggregateCodes(tag));
    title=title.slice(m[0].length);
  }
  return Array.from(new Set(codes));
}
function aggregateProviderText(codes){
  // Display aliases only. Unknown/new provider codes remain visible unchanged.
  const names={tencent:'腾讯',iqiyi:'爱奇艺',youku:'优酷',imgo:'芒果TV',bilibili:'哔哩哔哩',migu:'咪咕',aiyifan:'爱一帆',dandan:'弹弹play',bahamut:'巴哈姆特',animeko:'Animeko'};
  return aggregateCodes(codes).map(c=>names[c] || c).join('&');
}
function aggregateCleanTitle(value,providers){
  let title=String(value || '').replace(/^(?:上次来源 · )?【聚合】/,'').replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/,'');
  title=title.replace(/([】)\]）])\s*from\s+[a-z0-9&_-]+(?=\s*(?:·|$))/i,'$1');
  const suffix=title.match(/\s*from\s+([a-z0-9&_-]+)(?=\s*(?:·|$))/i);
  if(suffix){const codes=aggregateCodes(suffix[1]);if(codes.length && codes.every(c=>(providers || []).includes(c)))title=title.slice(0,suffix.index)+title.slice(suffix.index+suffix[0].length);}
  return title.replace(/\s*·\s*(?:API \d|跨 API 选源|安全聚合 API).*$/,'').trim();
}
function aggregateDisplay(value,field,codes){
  const platforms=aggregateCodes(codes),label=aggregateProviderText(platforms);
  const known=aggregateCodes([value.originalSource,value.source].concat((value.mergedChildren || []).map(c=>c.source),platforms));
  return Object.assign({},value,{source:'聚合',platforms:platforms,platformLabel:label,[field]:'【聚合】'+(label || '平台信息待服务器确认')+(platforms.length===1?'（本集仅1个平台）':'')+' · '+aggregateCleanTitle(value[field],known)});
}
async function aggregateIsNativeSelection(params,sources){
  const refs=multiDecode(params.animeId,'a',sources);
  if(refs)return refs.length===1 && !!refs[0].n;
  const selected=await compatRecall(sources[0],params.animeId);return !!(selected && multiNative(selected));
}
async function fusionAggregateDetail(params){
  try{
    const sources=multiSources(params),refs=multiDecode(params.animeId,'a',sources),native=await aggregateIsNativeSelection(params,sources);
    const episodes=await fusionMultiDetail(params,true),result=[],identity=fusionIdentity(params);
    const current=identity.isMovie?null:identity.reliableSE?Number(identity.episode):null;
    const signature=sources.map(s=>s.s).sort().join(':');
    const historical=refs && refs.length===1?await compatRecall(sources.find(s=>s.s===refs[0].s),refs[0].i):!refs?await compatRecall(sources[0],params.animeId):null;
    if(!native && (!refs || refs.length===1) && !historical && !episodes.some(e=>aggregateEpisodeCodes(e).length>1))return episodes;
    for(const episode of episodes){
      const route=multiDecode(episode.episodeId,'c',sources),cross=route && route.length>1;
      // A grouped cross-API selector never exposes its individual member tracks.
      if(refs && refs.length>1 && !cross)continue;
      let codes=aggregateEpisodeCodes(episode);
      if(cross)codes=aggregateCodes(route.reduce((all,r)=>all.concat(r.u || []),codes));
      if(!native && !cross && codes.length<2){
        const selected=refs && refs[0]?await compatRecall(sources.find(s=>s.s===refs[0].s),refs[0].i):await compatRecall(sources[0],params.animeId);
        if(!selected || multiNative(selected))continue;
        // A single available resource stays inside the aggregation workflow;
        // it is explicitly identified as one platform, never as a multi-source merge.
        codes=aggregateCodes(selected.source);
      }
      let item=episode;
      if(cross){item=Object.assign({},episode,{episodeId:multiId('c',route.map(r=>Object.assign({},r,{g:1})))});}
      const key=fusionDigest(signature+':'+item.episodeId);
      let manifest=await aggregateManifestAccess(key),unavailable=false,pending=false;
      const isCurrent=identity.isMovie?episodes.length===1:current>0 && fusionEpisodeNumber(episode)===current;
      if(isCurrent && !manifest){
        const data=await fusionAggregateComments(aggregatePlaybackParams(params,item.episodeId),false);
        unavailable=data.success===false;pending=!!data.taskId;
        if(!unavailable && !pending && !compatSegmentOutputs.has(data)){
          let actual=aggregateActualCodes(data);
          if(!actual.length && codes.length===1 && data.count>0)actual=codes;
          if(actual.length || !data.count)manifest=await aggregateManifestAccess(key,{codes:actual,count:data.count});
        }
      }
      if(manifest)codes=aggregateCodes(manifest.codes);
      const display=aggregateDisplay(item,'episodeTitle',codes);
      display.platformsConfirmed=!!manifest;
      if(manifest)display.actualCount=manifest.count;
      else if(isCurrent && !pending && !unavailable)display.episodeTitle+='（平台待确认）';
      if(unavailable)display.unavailable=true;
      if(pending){display.pending=true;display.episodeTitle+='（弹幕准备中）';}
      result.push(display);
    }
    return result;
  }catch(e){compatFailure('Detail',e);return [];}
}
async function fusionAggregateSearch(params){
  try{
    const result=await fusionMultiSearch(params,true),sources=multiSources(params);
    if(!result.animes.length)return result;
    const native=result.animes.filter(a=>{const refs=multiDecode(a.animeId,'a',sources);return multiNative(a) && (!refs || refs.length===1);}),groups=result.animes.filter(a=>{const refs=multiDecode(a.animeId,'a',sources);return refs && refs.length>1;});
    // Native server aggregation already covers its platforms. Do not add its
    // individual children or an unproven cross-API selector to the public UI.
    let candidates=native.length?native:groups;
    if(!candidates.length && result.animes.length===1)candidates=result.animes;
    const identity=fusionIdentity(params),current=identity.isMovie?null:identity.reliableSE?Number(identity.episode):null;
    const visible=[];
    for(const candidate of candidates.slice(0,8)){
      const episodes=await fusionAggregateDetail(Object.assign({},params,{animeId:candidate.animeId}));
      if(!episodes.length)continue;
      const selected=identity.isMovie?episodes.length===1?episodes[0]:episodes.find(e=>/正片|全片/.test(e.episodeTitle)):current>0?episodes.find(e=>fusionEpisodeNumber(e)===current):null;
      if(current>0 && !selected || selected && (selected.actualCount===0 || selected.unavailable))continue;
      const display=selected?aggregateDisplay(candidate,'animeTitle',selected.platforms):Object.assign({},candidate,{source:'聚合',animeTitle:'【聚合】'+aggregateCleanTitle(candidate.animeTitle)+' · 按集显示平台'});
      if(selected && selected.platformsConfirmed===false)display.animeTitle+='（平台待确认）';
      visible.push(display);
    }
    return visible.length?Object.assign({},result,{animes:visible}):{animes:[],message:'当前集没有取得可验证的聚合资源，请稍后重新搜索；不会展示单平台选源或拼接未经验证的资源',diagnostics:compatSummary()};
  }catch(e){compatFailure('Search',e);const failure=compatEmpty(e);return {animes:[],message:failure.message,error:failure.error,diagnostics:failure.diagnostics};}
}

function aggregatePlaybackParams(params,id){
  const copy={commentId:id,episodeId:id};
  for(const key of ['danmu_api_url','danmu_api_url_2','danmu_api_url_3','server','segmentTime'])if(params[key]!==undefined)copy[key]=params[key];
  return copy;
}
async function fusionAggregateComments(params,progress){
  return fusionMultiComments(aggregatePlaybackParams(params,firstPresent(params,['commentId','episodeId'])),progress);
}

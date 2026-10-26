/* AGPL-3.0-only. Advisory source preferences, never routing/merge authority.
 * String-only Widget storage; bounded records, TTL, no credentials or titles.
 */
let preferenceState=null;
let preferenceOperations=0;
const preferenceStorageKey='fusion-preference-v1';
function preferenceKey(e){
  if(!e || !e.title || !e.year || !['tv','movie'].includes(e.kind) || e.kind==='tv' && !(e.season>0))return null;
  return fusionDigest(JSON.stringify([e.title,e.year,e.kind,e.season,e.tmdb || '',e.edition || '',e.language || '',e.context || '']));
}
async function preferenceAccess(sources,update){
  // Preference storage is optional; saturation never delays playback in a queue.
  if(preferenceOperations>=8)return {};
  preferenceOperations++;
  const signature=fusionDigest(sources.map(c=>c.s).sort().join(':'));
  const task=multiStorageQueue.then(async()=>{
    if(!preferenceState){
      try{const saved=Widget.storage && await Widget.storage.get(preferenceStorageKey);if(typeof saved==='string' && saved.length<=20000)preferenceState=JSON.parse(saved);}catch(e){}
    }
    if(!preferenceState || preferenceState.config!==signature || !preferenceState.items || typeof preferenceState.items!=='object' || Array.isArray(preferenceState.items)){
      if(preferenceState)compatLog('Memory','PREFERENCE_EXPIRED','Source preference invalidated');
      preferenceState={config:signature,items:{}};
    }
    const items=preferenceState.items,now=Date.now();
    for(const key of Object.keys(items)){
      const r=items[key];
      if(!/^[a-f0-9]{64}$/.test(key) || !r || !sources.some(c=>c.s===r.source) || !Number.isFinite(r.expires) || r.expires<=now)delete items[key];
    }
    if(update && update.key && sources.some(c=>c.s===update.source)){
      delete items[update.key];items[update.key]={source:update.source,expires:now+30*86400000};
    }
    while(Object.keys(items).length>48)delete items[Object.keys(items)[0]];
    try{if(Widget.storage)await Widget.storage.set(preferenceStorageKey,JSON.stringify(preferenceState));}catch(e){compatLog('Memory','MEMORY_ONLY','Optional preference storage unavailable');}
    return Object.assign({},items);
  });
  multiStorageQueue=task.catch(()=>{});
  try{return await task;}finally{preferenceOperations--;}
}
async function preferenceSelect(sources,ref){
  const key=preferenceKey(ref.e || ref.p && ref.p.work);
  if(!key)return;
  const signature=fusionDigest(sources.map(c=>c.s).sort().join(':'));
  const saved=preferenceState && preferenceState.config===signature && preferenceState.items[key];
  if(saved && saved.source===ref.s && saved.expires>Date.now())return;
  await preferenceAccess(sources,{key:key,source:ref.s});
}
function preferenceMatches(items,e,source){const key=preferenceKey(e);return !!(key && items[key] && items[key].source===source);}

/** Pure Forward matching/deduplication. AGPL-3.0-only.
 * Also embedded by scripts/build-danmu-fusion.mjs; no Node API in this file.
 */
import { simplized } from '../utils/zh-util.js';
export function fusionNormalize(value) {
  var text = String(value == null ? '' : value);
  if (text.normalize) text = text.normalize('NFKC');
  return text.replace(/\s+/g, ' ').trim();
}

export function fusionHash(value) {
  var h = 2166136261, s = String(value);
  for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function fusionSource(value) {
  var s = String(value || 'unknown').toLowerCase();
  return ({ qq: 'tencent', qiyi: 'iqiyi', mango: 'imgo', bilibili1: 'bilibili' })[s] || s;
}

export function fusionSpecial(title) {
  var s = fusionNormalize(title).toLowerCase();
  var m = s.match(/(?:^|[^a-z])(ova|oad|sp)(?:[^a-z]|$)|特别篇|特別篇|番外|特典|总集篇|總集篇|特别节目|特別節目/);
  return m ? (m[1] || 'special') : 'regular';
}

function fusionTitle(title) {
  return simplized(fusionNormalize(title)).toLowerCase()
    .replace(/\bfrom\s+[a-z0-9&_-]+.*$/i, '')
    .replace(/[【\[][^】\]]*[】\]]/g, '')
    .replace(/\((?:19|20)\d{2}\)/g, '')
    .replace(/第[一二三四五六七八九十\d]+季|\bs\d{1,2}(?:e\d+)?\b|season\s*\d+/gi, '')
    .replace(/[\s.,:;!?，。；：！？、'"()（）·_\-]/g, '');
}

export function fusionMatch(identity, candidate) {
  var title = candidate.animeTitle || candidate.title || '';
  var type = [candidate.type,candidate.mediaType,candidate.typeDescription].filter(Boolean).join(' ').toLowerCase();
  var movie = /movie|film|电影|電影|剧场版|劇場版/.test(type + ' ' + title);
  var tv = /tv|series|episode|剧集|電視|电视剧|番剧/.test(type);
  var id = candidate.tmdb_id || candidate.tmdbId;
  var sameId = !!(id && identity.tmdb_id && String(id) === String(identity.tmdb_id));
  var year = String(candidate.startDate || candidate.year || title).match(/(?:19|20)\d{2}/);
  var season = title.match(/第([一二三四五六七八九十\d]+)季|\bs(\d{1,2})(?:e\d+)?\b|season\s*(\d+)/i);
  var nums = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  var sn = candidate.season != null ? Number(candidate.season) : season ? Number(nums[season[1]] || season[1] || season[2] || season[3]) : null;
  var special = fusionSpecial((identity.title || '') + ' ' + (identity.episodeName || ''));
  if (id && identity.tmdb_id && !sameId) return { reliable:false, reason:'id_conflict' };
  if (movie && !identity.isMovie || tv && identity.isMovie) return { reliable:false, reason:'type_conflict' };
  if (fusionSpecial(title) !== special) return { reliable:false, reason:'special_conflict' };
  if (!identity.isMovie && sn != null && sn !== Number(identity.season)) return { reliable:false, reason:'season_conflict' };
  // A season's premiere year differs from the series premiere year. Without an
  // explicit shared ID this is ambiguous and remains a manual selection.
  if (year && identity.year && year[0] !== String(identity.year) && !sameId) return { reliable:false, reason:'year_conflict' };
  var names = [identity.title, identity.original_title].concat(identity.aliases || []).filter(Boolean).map(fusionTitle);
  var aliases = [title].concat(candidate.aliases || []).map(fusionTitle);
  var titleHit = names.some(function(n) { return aliases.indexOf(n) >= 0; });
  var knownType = identity.isMovie ? movie : tv;
  var knownSeason = identity.isMovie || sn === Number(identity.season);
  return { reliable: !!((sameId && knownType || titleHit && year && identity.year && knownType) && knownSeason), reason: sameId ? 'id' : 'title_year_type_season' };
}

/** O(n log n) sorting + bounded hash buckets. Keeps source multiplicity:
 * one A record may consume at most one matching record from each other source.
 * Unknown provenance / already processed data never receives fuzzy dedupe.
 */
export function fusionDedupe(input, options) {
  var o = options || {}, tolerance = Number(o.tolerance == null ? 2 : o.tolerance);
  tolerance = Number.isFinite(tolerance) ? Math.max(0, Math.min(10, tolerance)) : 2;
  var stats = { original:input.length, invalid:0, exact:0, near:0, retained:0, truncated:0 };
  var items = [], cap = Math.max(1, Number(o.maxItems) || 200000);
  for (var i=0; i<Math.min(input.length, cap); i++) {
    var c = input[i], t = Number(c.time), text = fusionNormalize(c.content);
    var source = fusionSource(c.source);
    var shift = !o.serverProcessed && o.offsets ? Number(o.offsets[source] || 0) : 0;
    t += shift;
    if (!Number.isFinite(t) || t < 0 || !text || text.length > 4000) { stats.invalid++; continue; }
    items.push(Object.assign({}, c, { time:t, timestamp:t, _norm:text, source:source, _index:i }));
  }
  stats.truncated = Math.max(0, input.length-cap);
  items.sort(function(a,b) { return a.time-b.time || a._index-b._index; });
  var buckets = new Map(), ids = new Map(), kept = [];
  var width = Math.max(tolerance, 0.001), lastBucket = null;
  for (var j=0; j<items.length; j++) {
    var item = items[j], ep = String(item.episode == null ? '' : item.episode);
    var known = item.source !== 'unknown';
    var recordId = item.recordId; // Only true upstream IDs, never generated indexes.
    var idKey = JSON.stringify([ep,item.source,recordId,item.time,item._norm,item.color,item.position]);
    if (o.enabled !== false && recordId != null && ids.has(idKey)) { stats.exact++; continue; }
    if (recordId != null) ids.set(idKey, true);
    var b = Math.floor(item.time/width);
    if (lastBucket !== b) {
      for (var old of buckets.keys()) if (old < b-1) buckets.delete(old);
      lastBucket = b;
    }
    // Near dedupe only removes optional spacing around punctuation. Letters,
    // emoji, repeated syllables, punctuation counts and case remain meaningful.
    var norm = o.near === false ? item._norm : item._norm.replace(/\s*([,，。.!！?？:：;；])\s*/g, '$1');
    var key = JSON.stringify([ep,norm,item.color,item.position]);
    var duplicate = false;
    var lowInfo = item._norm.length < 6 || new Set(item._norm).size <= 2;
    if (o.enabled !== false && !o.serverProcessed && known && !lowInfo) {
      for (var bi=b-1; bi<=b && !duplicate; bi++) {
        var index = buckets.get(bi), group = index && index.get(key);
        if (!group) continue;
        // A bounded list prevents dense identical comments from becoming n².
        for (var k=0; k<group.length; k++) {
          var cluster = group[k];
          if (!cluster.sources.has(item.source) && Math.abs(item.time-cluster.item.time) <= tolerance) {
            cluster.sources.add(item.source);
            stats[item._norm === cluster.item._norm ? 'exact' : 'near']++;
            duplicate = true; break;
          }
        }
      }
    }
    if (duplicate) continue;
    kept.push(item);
    if (known && !lowInfo) {
      if (!buckets.has(b)) buckets.set(b,new Map());
      var ix=buckets.get(b), q=ix.get(key) || [];
      q.push({item:item,sources:new Set([item.source])});
      if (q.length>64) q.shift();
      ix.set(key,q);
    }
  }
  var result=kept.map(function(c) { var copy=Object.assign({},c); delete copy._norm; delete copy._index; return copy; });
  stats.retained=result.length;
  stats.removed=stats.original-stats.retained;
  return { items:result, stats:stats };
}

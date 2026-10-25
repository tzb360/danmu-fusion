import { fusionHash, fusionSource, fusionNormalize } from '../aggregation/forward-core.js';
import { resolveOffsetRule } from '../utils/offset-util.js';

export function parseForwardOptions(get, globals = {}) {
  if (String(get(['forward_safe'], '0')) !== '1') return null;
  const tolerance = Number(get(['dedupe_tolerance'], 2));
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10) throw new TypeError('dedupe_tolerance must be 0..10');
  const split = value => String(value || '').split(',').filter(Boolean).map(fusionSource);
  let offsets = null;
  const raw = get(['offset_rules'], null);
  if (raw != null) {
    if (String(raw).length > 20000) throw new TypeError('offset_rules too large');
    try { offsets = JSON.parse(raw); } catch { throw new TypeError('invalid offset_rules JSON'); }
    if (!Array.isArray(offsets) || offsets.length > 100 || offsets.some(r => !r || (!r.title && !r.tmdbId) || !Number.isFinite(Number(r.seconds)) || Math.abs(Number(r.seconds)) > 3600)) throw new TypeError('invalid offset_rules');
  }
  const result = { dedupe:String(get(['dedupe'], '1')) !== '0', tolerance,
    aggregate:String(get(['aggregate'], '1')) !== '0', sources:split(get(['sources'], '')),
    order:split(get(['source_priority'], '')), offsets };
  result.profile = 'forward-safe-v1-' + fusionHash(JSON.stringify([result,globals.danmuOffsetRules,globals.sourceOrderArr]));
  return result;
}

export function forwardOffsets(identity, sources, options, serverRules = []) {
  const offsets = {};
  for (const entry of sources) {
    const source = fusionSource(entry.source);
    if (options.offsets) {
      let rank = -1;
      for (const r of options.offsets) {
        if (fusionSource(r.source) !== source) continue;
        if (r.tmdbId ? String(r.tmdbId) !== String(identity.tmdb_id) : fusionNormalize(r.title) !== fusionNormalize(identity.title)) continue;
        if (r.season != null && Number(r.season) !== Number(identity.season) || r.episode != null && Number(r.episode) !== Number(identity.episode)) continue;
        const score = (r.tmdbId ? 4 : 0) + (r.season != null ? 1 : 0) + (r.episode != null ? 2 : 0);
        if (score >= rank) { rank = score; offsets[source] = Number(r.seconds); }
      }
    } else {
      const rule = resolveOffsetRule(serverRules, { anime:identity.title, season:`S${String(identity.season || 1).padStart(2,'0')}`, episode:`E${String(identity.episode || 1).padStart(2,'0')}`, source });
      // Time scaling needs a verified origin duration; do not estimate it from comments.
      if (rule?.usePercent) throw new TypeError('Forward conservative mode requires second offsets; percent offsets need a verified video duration');
      if (rule) offsets[source] = rule.offset;
    }
  }
  return offsets;
}

export function sliceForwardPayload(payload, searchParams) {
  if (!searchParams.has('segment_time')) return payload;
  const time = Number(searchParams.get('segment_time'));
  const seconds = Number(searchParams.get('segment_seconds') || 60);
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(seconds) || seconds < 10 || seconds > 600) throw new TypeError('invalid segment range');
  const start = Math.floor(time / seconds) * seconds, end = start + seconds;
  const comments = (payload.comments || []).filter(c => { const t=Number(String(c.p).split(',')[0]); return Number.isFinite(t) && t>=start && t<end; });
  return { ...payload, comments, count:comments.length, segment:{segment_start:start,segment_end:end}, processing:{serverDeduplicated:true,serverOffsetApplied:true,stats:payload.meta?.stats || null} };
}

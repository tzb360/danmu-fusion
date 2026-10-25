/**
 * 版本候选构建（架构层）
 *
 * 职责：在 content 过滤之后，按 地区/年份/季 拆成多个「版本」，
 * 每版本再绑定严格 episode 源。不在此做「最近集」猜测。
 *
 * 模块侧只展示候选 + 默认最佳；最终版本由用户或自动策略选择。
 */
import {
  inferRegionFromTitle,
  normalizeRegion,
  regionLabel,
  extractYearValue,
  formatVersionDisplay
} from '../aggregation/episode-identity.js';
import { extractSeasonNumberFromAnimeTitle } from '../utils/common-util.js';
import { collectEpisodeSourcesFromAnimes } from '../aggregation/episode-service.js';
import { log } from '../utils/log-util.js';

function toSeasonNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function toEpisodeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function animeYear(anime) {
  const d = String(anime?.startDate || '');
  const m1 = d.match(/(19|20)\d{2}/);
  if (m1) return m1[0];
  const t = String(anime?.animeTitle || '');
  const m2 = t.match(/\(((?:19|20)\d{2})\)/);
  return m2 ? m2[1] : null;
}

function animeEpisodeCapacity(anime) {
  if (Array.isArray(anime?.links) && anime.links.length) return anime.links.length;
  const n = Number(anime?.episodeCount);
  return Number.isFinite(n) ? n : 0;
}

function findSeriesYearForRegion(animes, region) {
  const r = normalizeRegion(region);
  for (const a of animes || []) {
    const ar = inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region;
    if (r && ar && ar !== r) continue;
    if (r && !ar) continue;
    const { season } = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
    if (Number(season) === 1) {
      const y = animeYear(a);
      if (y) return y;
    }
  }
  return null;
}

/**
 * 版本键：region + seriesYear + season
 * 例：us:2011:s4
 */
export function buildVersionKey({ region, year, season }) {
  const r = normalizeRegion(region) || 'unk';
  const y = extractYearValue(year) || '0';
  const s = toSeasonNum(season);
  return `${r}:${y}:s${s}`;
}

export function parseVersionKey(key) {
  const m = String(key || '').match(/^([a-z0-9]+):(\d{4}|0):s(\d+)$/i);
  if (!m) return null;
  return {
    region: m[1] === 'unk' ? null : m[1],
    year: m[2] === '0' ? null : m[2],
    season: Number(m[3])
  };
}

function scoreVersionCandidate(cand, query) {
  let score = 40;
  // 有精确 episode 源
  if (cand.source_count > 0) score += 30;
  score += Math.min(20, cand.source_count * 8);

  const wantRegion = normalizeRegion(query.region);
  if (wantRegion && cand.region === wantRegion) score += 25;
  else if (wantRegion && cand.region && cand.region !== wantRegion) score -= 40;

  const qy = extractYearValue(query.year);
  if (qy && cand.year === qy) score += 15;
  else if (qy && cand.year && Math.abs(Number(cand.year) - Number(qy)) <= 1) score += 5;

  // 美版在未指定 region 时略优先（源通常更全）——仅排序启发，不删除其它版本
  if (!wantRegion && cand.region === 'us') score += 5;

  // 有标题
  if (cand.matched_anime_titles?.length) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * 从 content 过滤后的条目构建版本候选列表
 * @param {Array} contentKept - 已过 content-filter
 * @param {object} query - { title, season, episode, year, region, type }
 * @returns {{ candidates: Array, default_key: string|null, steps: Array }}
 */
export function buildVersionCandidates(contentKept = [], query = {}) {
  const season = toSeasonNum(query.season);
  const episode = toEpisodeNum(query.episode);
  const steps = [];
  let list = Array.isArray(contentKept) ? [...contentKept] : [];
  steps.push({ step: 'input', count: list.length });

  // 1) 严格季号
  const strictSeason = list.filter((a) => {
    const extracted = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
    return Number(extracted.season) === season;
  });
  if (strictSeason.length) {
    list = strictSeason;
    steps.push({ step: 'season_strict', season, count: list.length });
  } else {
    const loose = list.filter((a) => {
      const extracted = extractSeasonNumberFromAnimeTitle(a.animeTitle || '');
      return extracted.season == null;
    });
    list = loose;
    steps.push({ step: 'season_unspecified_only', season, count: list.length });
  }

  // 2) 集数容量（有 links 时）
  const withCap = list.filter((a) => {
    const cap = animeEpisodeCapacity(a);
    return cap === 0 || cap >= episode;
  });
  if (withCap.length) {
    list = withCap;
    steps.push({ step: 'episode_capacity', episode, count: list.length });
  } else {
    steps.push({ step: 'episode_capacity', episode, count: 0, note: 'none' });
  }

  // 3) 按 region 分组（不折叠！）
  const byReg = new Map();
  for (const a of list) {
    const reg =
      inferRegionFromTitle(a.animeTitle || '', (a.aliases || []).join(' ')).region || 'unk';
    if (!byReg.has(reg)) byReg.set(reg, []);
    byReg.get(reg).push(a);
  }
  steps.push({ step: 'region_groups', regions: [...byReg.keys()], count: byReg.size });

  const candidates = [];
  for (const [reg, arr] of byReg.entries()) {
    const seriesYear =
      findSeriesYearForRegion(contentKept, reg === 'unk' ? null : reg) ||
      findSeriesYearForRegion(arr, reg === 'unk' ? null : reg) ||
      extractYearValue(query.year) ||
      animeYear(arr[0]);

    // 该版本下严格收集 episode 源
    const episodeMatchDebug = {};
    const sources = collectEpisodeSourcesFromAnimes(arr, episode, {}, {
      strict: true,
      debugOut: episodeMatchDebug
    });

    const version_key = buildVersionKey({
      region: reg === 'unk' ? null : reg,
      year: seriesYear,
      season
    });

    const titleCn =
      String(query.title || '')
        .trim() ||
      String(arr[0]?.animeTitle || '')
        .replace(/【[^】]*】/g, ' ')
        .replace(/\s*from\s+[\w.-]+/gi, ' ')
        .replace(/\(\d{4}\)/g, ' ')
        .replace(/第\s*[0-9一二三四五六七八九十百千万]+\s*[季期部].*$/u, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const rNorm = reg === 'unk' ? null : reg;
    const display = formatVersionDisplay({
      title: titleCn,
      region: rNorm,
      region_label: regionLabel(rNorm),
      year: seriesYear,
      season,
      episode,
      withEpisode: true
    });

    const platforms = [...new Set(sources.map((s) => s.source).filter(Boolean))];
    const cand = {
      version_key,
      display,
      title: titleCn,
      region: rNorm,
      region_label: regionLabel(rNorm),
      year: seriesYear || null,
      season,
      episode,
      source_count: sources.length,
      sources_preview: platforms,
      matched_anime_titles: arr.map((a) => a.animeTitle).filter(Boolean).slice(0, 8),
      anime_ids: arr.map((a) => a.animeId || a.bangumiId).filter(Boolean).slice(0, 12),
      // 内部用：聚合时的 anime 子集与已收集 sources
      _animes: arr,
      _sources: sources,
      _episode_match: episodeMatchDebug
    };
    cand.score = scoreVersionCandidate(cand, query);
    candidates.push(cand);
  }

  // 有源的排前面，再按 score
  candidates.sort((a, b) => {
    if (a.source_count > 0 && b.source_count === 0) return -1;
    if (a.source_count === 0 && b.source_count > 0) return 1;
    return (b.score || 0) - (a.score || 0);
  });

  // 默认：第一个有源的；否则第一个
  let default_key = null;
  const withSrc = candidates.find((c) => c.source_count > 0);
  if (withSrc) default_key = withSrc.version_key;
  else if (candidates[0]) default_key = candidates[0].version_key;

  for (const c of candidates) {
    c.is_default = c.version_key === default_key;
  }

  log(
    'info',
    `[VersionCandidates] S${season}E${episode} n=${candidates.length} default=${default_key || '-'} ` +
      `[${candidates.map((c) => `${c.version_key}(src=${c.source_count},score=${c.score})`).join(' | ')}]`
  );

  return { candidates, default_key, steps };
}

/**
 * 对外安全的候选（去掉内部 _animes/_sources）
 */
export function slimCandidate(c) {
  if (!c) return null;
  return {
    version_key: c.version_key,
    display: c.display,
    title: c.title,
    region: c.region,
    region_label: c.region_label,
    year: c.year,
    season: c.season,
    episode: c.episode,
    score: c.score,
    source_count: c.source_count,
    sources_preview: c.sources_preview || [],
    matched_anime_titles: c.matched_anime_titles || [],
    is_default: Boolean(c.is_default)
  };
}

/**
 * 按 version_key / region 选择候选
 */
export function pickCandidate(candidates, { version_key, region } = {}) {
  if (!candidates?.length) return null;
  if (version_key) {
    const hit = candidates.find((c) => c.version_key === version_key);
    if (hit) return hit;
  }
  const r = normalizeRegion(region);
  if (r) {
    const hit = candidates.find((c) => c.region === r && c.source_count > 0);
    if (hit) return hit;
  }
  return candidates.find((c) => c.is_default) || candidates[0] || null;
}

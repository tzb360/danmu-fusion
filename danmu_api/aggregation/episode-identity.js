import { simplized } from '../utils/zh-util.js';

/**
 * 剧集身份与缓存键
 * 唯一身份至少包含：title / original_title / region / year / season / episode
 * 避免：美版 S04E10 与 英版 S04E10 落入同一缓存
 */

export function normalizeTitle(title) {
  return simplized(String(title || ''))
    .toLowerCase()
    .replace(/[\s\-_.·:：|/\\（）()【】\[\]「」『』"'“”]/g, '')
    .trim();
}

export function normalizeSeasonEpisode(season, episode) {
  const s = season === undefined || season === null || season === '' ? 1 : Number(season);
  const e = episode === undefined || episode === null || episode === '' ? 1 : Number(episode);
  return {
    season: Number.isFinite(s) && s > 0 ? Math.floor(s) : 1,
    episode: Number.isFinite(e) && e > 0 ? Math.floor(e) : 1
  };
}

/**
 * 从标题/别名推断地区标签（仅用于身份拆分与展示，匹配优先级仍以 ID/年份为准）
 * @returns {{ region: string|null, region_label: string|null }}
 */
export function inferRegionFromTitle(title = '', originalTitle = '') {
  const blob = `${title} ${originalTitle}`;
  const t = String(blob);

  if (/\bUS\b|U\.S\.|美版|美国|北美|Showtime/i.test(t)) {
    return { region: 'us', region_label: '美版' };
  }
  if (/\bUK\b|U\.K\.|英版|英国|BBC|Channel\s*4/i.test(t)) {
    return { region: 'uk', region_label: '英版' };
  }
  if (/日版|日本|JP\b/i.test(t)) {
    return { region: 'jp', region_label: '日版' };
  }
  if (/韩版|韩国|KR\b/i.test(t)) {
    return { region: 'kr', region_label: '韩版' };
  }
  if (/国配|中配|大陆|中国|CN\b/i.test(t)) {
    return { region: 'cn', region_label: '国版' };
  }
  if (/港版|香港|HK\b/i.test(t)) {
    return { region: 'hk', region_label: '港版' };
  }
  if (/台版|台湾|TW\b/i.test(t)) {
    return { region: 'tw', region_label: '台版' };
  }
  return { region: null, region_label: null };
}

export function normalizeRegion(region) {
  if (region == null || String(region).trim() === '') return null;
  const r = String(region).trim().toLowerCase();
  const map = {
    us: 'us', usa: 'us', 'u.s.': 'us', 'u.s': 'us', american: 'us', 美: 'us', 美版: 'us', 美国: 'us',
    uk: 'uk', gb: 'uk', 'u.k.': 'uk', 'u.k': 'uk', british: 'uk', 英: 'uk', 英版: 'uk', 英国: 'uk',
    jp: 'jp', japan: 'jp', 日: 'jp', 日版: 'jp', 日本: 'jp',
    kr: 'kr', korea: 'kr', 韩: 'kr', 韩版: 'kr', 韩国: 'kr',
    cn: 'cn', china: 'cn', 国: 'cn', 国版: 'cn', 大陆: 'cn',
    hk: 'hk', 港: 'hk', 港版: 'hk',
    tw: 'tw', 台: 'tw', 台版: 'tw'
  };
  return map[r] || r.replace(/[^a-z0-9]/g, '').slice(0, 12) || null;
}

export function regionLabel(region) {
  const r = normalizeRegion(region);
  const labels = {
    us: '美版', uk: '英版', jp: '日版', kr: '韩版', cn: '国版', hk: '港版', tw: '台版'
  };
  return r ? (labels[r] || r.toUpperCase()) : null;
}

export function extractYearValue(v) {
  if (v == null || v === '') return null;
  const m = String(v).match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

/**
 * 构造可落盘文件名风格的「原始弹幕文件」展示名
 * 例：Shameless.US.2011.S04E10.xml
 */
export function buildSourceFileLabel({
  source,
  original_title,
  title,
  region,
  year,
  season,
  episode,
  url
} = {}) {
  const se = `S${String(season || 1).padStart(2, '0')}E${String(episode || 1).padStart(2, '0')}`;
  const base =
    (original_title && String(original_title).trim()) ||
    (title && String(title).trim()) ||
    'episode';
  const safeBase = String(base)
    .replace(/[^\w\u4e00-\u9fa5.\-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 80) || 'episode';
  const reg = normalizeRegion(region);
  const y = extractYearValue(year);
  const parts = [safeBase];
  if (reg) parts.push(reg.toUpperCase());
  if (y) parts.push(y);
  parts.push(se);
  let name = parts.join('.') + '.xml';
  // 若有真实 url 短 id 可附带
  if (url && String(url).length < 40 && !String(url).includes('://')) {
    name = `${parts.join('.')}.${String(url).replace(/[^\w.-]/g, '_')}.xml`;
  }
  return name;
}

/**
 * 版本后缀：缓存必须绑定 version，禁止 title/tmdb 固定唯一结果后跨版串弹幕。
 * 优先 version_key（如 us:2011:s4），否则 region+year。
 */
export function buildVersionSuffix(identity = {}, region = null, year = null) {
  const vk = identity.version_key || identity.versionKey || null;
  if (vk != null && String(vk).trim() !== '') {
    const safe = String(vk)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:._-]+/g, '_')
      .slice(0, 64);
    return `:v${safe}`;
  }
  const regPart = normalizeRegion(region) || null;
  const yearPart = extractYearValue(year) || null;
  if (regPart || yearPart) {
    return `:r${regPart || 'unk'}:y${yearPart || '0000'}`;
  }
  return '';
}

/**
 * @param {object} identity
 * 缓存键绑定：id + season + episode + version
 * - 电影：可无 version 后缀（唯一匹配）
 * - 电视剧：有 region/year/version_key 时必须写入，防止美/英同集串缓存
 */
export function buildEpisodeIdentity(identity = {}) {
  const { season, episode } = normalizeSeasonEpisode(identity.season, identity.episode);
  const tmdbId = identity.tmdb_id != null && String(identity.tmdb_id).trim() !== ''
    ? String(identity.tmdb_id).trim()
    : null;
  const imdbId = identity.imdb_id != null && String(identity.imdb_id).trim() !== ''
    ? String(identity.imdb_id).trim()
    : null;
  const title = identity.title ? String(identity.title).trim() : '';
  const originalTitle = identity.original_title
    ? String(identity.original_title).trim()
    : (identity.originalTitle ? String(identity.originalTitle).trim() : '');
  const titleKey = normalizeTitle(title || originalTitle);
  const episodeId = identity.episode_id != null ? String(identity.episode_id) : null;

  let region = normalizeRegion(identity.region);
  if (!region) {
    const inferred = inferRegionFromTitle(title, originalTitle);
    region = inferred.region;
  }
  const region_label = identity.region_label || regionLabel(region);
  const year = extractYearValue(identity.year || identity.series_year || identity.seriesYear);
  const version_key =
    identity.version_key != null && String(identity.version_key).trim() !== ''
      ? String(identity.version_key).trim()
      : null;
  const verSuffix = buildVersionSuffix(
    { version_key },
    region,
    year
  );

  let key;
  if (tmdbId) {
    // tmdb + s/e + version（同 tmdb 下也可能有多版本候选时靠 version 拆开）
    key = `tmdb:${tmdbId}:s${season}:e${episode}${verSuffix}`;
  } else if (imdbId) {
    key = `imdb:${imdbId}:s${season}:e${episode}${verSuffix}`;
  } else if (titleKey) {
    // 必须含 region + year / version_key，防止美/英同名同季同集串缓存
    const regPart = region || 'unk';
    const yearPart = year || '0000';
    if (version_key) {
      key = `title:${titleKey}:s${season}:e${episode}${verSuffix}`;
    } else {
      key = `title:${titleKey}:r${regPart}:y${yearPart}:s${season}:e${episode}`;
    }
  } else if (episodeId) {
    key = `epid:${episodeId}`;
  } else {
    throw new TypeError('identity requires title, tmdb_id, imdb_id, or episode_id');
  }

  return {
    key,
    title: title || titleKey || '',
    original_title: originalTitle || null,
    title_key: titleKey,
    region: region || null,
    region_label: region_label || null,
    year: year || null,
    version_key: version_key || null,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    season,
    episode,
    episode_id: episodeId
  };
}

/** 文件安全 key */
export function toSafeCacheFileName(key) {
  return String(key)
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .replace(/:/g, '_')
    .slice(0, 180);
}

/**
 * 来源权重：SOURCE_ORDER 越靠前越高
 */
export function resolveSourceWeight(source, sourceOrder = [], override = {}) {
  const name = String(source || 'unknown').toLowerCase();
  if (override && typeof override[name] === 'number') return override[name];
  if (override && typeof override[source] === 'number') return override[source];

  const order = (sourceOrder || []).map(s => String(s).toLowerCase());
  const idx = order.indexOf(name);
  if (idx === -1) return 1;
  return Math.max(1, order.length - idx);
}

/**
 * 展示用完整版本标题
 * 例：无耻之徒 (美版 2011) S04
 */
export function formatVersionDisplay({
  title,
  region,
  region_label,
  year,
  season,
  episode,
  withEpisode = false
} = {}) {
  const name = String(title || '').trim() || '未知剧集';
  const rl = region_label || regionLabel(region);
  const y = extractYearValue(year);
  const segs = [];
  if (rl) segs.push(rl);
  if (y) segs.push(y);
  const version = segs.length ? ` (${segs.join(' ')})` : '';
  const s = season != null ? Number(season) : null;
  const e = episode != null ? Number(episode) : null;
  let se = '';
  if (Number.isFinite(s) && s > 0) {
    se = withEpisode && Number.isFinite(e) && e > 0
      ? ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
      : ` S${String(s).padStart(2, '0')}`;
  }
  return `${name}${version}${se}`;
}

/**
 * 剧集级弹幕聚合缓存：内存 + .cache/episodes/*.json
 *
 * 保护：
 * - cache_version 不匹配自动失效
 * - TTL 过期失效
 * - 禁止缓存空结果
 * - 超大结果拒绝落盘（防污染）
 */
import { log } from '../utils/log-util.js';
import { toSafeCacheFileName } from './episode-identity.js';
import {
  getGuardConfig,
  isCacheEntryValid,
  shouldPersistCache,
  EPISODE_CACHE_VERSION
} from './source-guard.js';

const memoryIndex = new Map();
let fsModule = null;
let pathModule = null;
let cacheDirResolved = null;

function canUseFs() {
  try {
    return typeof process !== 'undefined' && Boolean(process.versions?.node);
  } catch {
    return false;
  }
}

function loadFs() {
  if (!canUseFs()) return null;
  if (fsModule && pathModule) return { fs: fsModule, path: pathModule };
  try {
    // 同步动态 import 不可用；用 createRequire 风格在 ESM 下直接 import 顶层
    return null;
  } catch {
    return null;
  }
}

async function ensureFs() {
  if (!canUseFs()) return null;
  if (fsModule && pathModule) {
    return { fs: fsModule, path: pathModule };
  }
  try {
    fsModule = await import('node:fs');
    pathModule = await import('node:path');
    return { fs: fsModule, path: pathModule };
  } catch (error) {
    log('warn', `[EpisodeCache] fs unavailable: ${error.message}`);
    return null;
  }
}

export async function getEpisodeCacheDir() {
  const mods = await ensureFs();
  if (!mods) return null;
  const { path } = mods;
  const custom = typeof process !== 'undefined' ? process.env.EPISODE_CACHE_DIR : '';
  if (custom && String(custom).trim()) {
    return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  }
  return path.join(process.cwd(), '.cache', 'episodes');
}

async function ensureDir() {
  const mods = await ensureFs();
  if (!mods) return null;
  const dir = await getEpisodeCacheDir();
  if (!dir) return null;
  const { fs } = mods;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  cacheDirResolved = dir;
  return dir;
}

function filePathForKey(dir, key) {
  return `${dir}/${toSafeCacheFileName(key)}.json`;
}

/**
 * @returns {object|null}
 */
export function getEpisodeCacheMemory(key) {
  return memoryIndex.get(key) || null;
}

export function setEpisodeCacheMemory(entry) {
  if (!entry?.key) return;
  memoryIndex.set(entry.key, entry);
  // 简单上限
  if (memoryIndex.size > 300) {
    const first = memoryIndex.keys().next().value;
    memoryIndex.delete(first);
  }
}

export async function loadEpisodeCache(key) {
  const cfg = getGuardConfig();
  const mem = getEpisodeCacheMemory(key);
  if (mem) {
    const v = isCacheEntryValid(mem, cfg);
    if (v.ok) return mem;
    memoryIndex.delete(key);
    log('info', `[EpisodeCache] memory miss ${key}: ${v.reason}`);
  }

  const mods = await ensureFs();
  const dir = await ensureDir();
  if (!mods || !dir) return null;

  const { fs } = mods;
  const file = filePathForKey(dir, key);
  try {
    if (!fs.existsSync(file)) return null;
    // 超大文件直接丢弃，避免读入 OOM
    const st = fs.statSync(file);
    if (st.size > cfg.cacheMaxBytes) {
      log('warn', `[EpisodeCache] drop oversized file ${key} size=${st.size}`);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      return null;
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.key) return null;
    const v = isCacheEntryValid(parsed, cfg);
    if (!v.ok) {
      log('info', `[EpisodeCache] disk invalid ${key}: ${v.reason}`);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      return null;
    }
    setEpisodeCacheMemory(parsed);
    return parsed;
  } catch (error) {
    log('warn', `[EpisodeCache] load failed ${key}: ${error.message}`);
  }
  return null;
}

export async function saveEpisodeCache(entry) {
  if (!entry?.key) throw new TypeError('episode cache entry requires key');
  const cfg = getGuardConfig();
  const gate = shouldPersistCache(entry, cfg);
  if (!gate.ok) {
    log('info', `[EpisodeCache] skip persist ${entry.key}: ${gate.reason}`);
    return { ...entry, persisted: false, skip_reason: gate.reason };
  }

  const now = new Date().toISOString();
  const payload = {
    ...entry,
    cache_version: EPISODE_CACHE_VERSION,
    updated_at: now,
    created_at: entry.created_at || now
  };
  setEpisodeCacheMemory(payload);

  const mods = await ensureFs();
  const dir = await ensureDir();
  if (!mods || !dir) {
    return { ...payload, persisted: false };
  }

  const { fs } = mods;
  const file = filePathForKey(dir, entry.key);
  try {
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json, 'utf8') > cfg.cacheMaxBytes) {
      log('warn', `[EpisodeCache] skip persist oversized payload ${entry.key}`);
      return { ...payload, persisted: false, skip_reason: 'payload_too_large' };
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file);
    return { ...payload, persisted: true, path: file };
  } catch (error) {
    log('warn', `[EpisodeCache] save failed: ${error.message}`);
    return { ...payload, persisted: false, error: error.message };
  }
}

export async function deleteEpisodeCache(key) {
  if (key) memoryIndex.delete(key);
  else memoryIndex.clear();

  const mods = await ensureFs();
  const dir = await ensureDir();
  if (!mods || !dir) return { success: true, disk: false };

  const { fs, path } = mods;
  try {
    if (key) {
      const file = filePathForKey(dir, key);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
    return { success: true, disk: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listEpisodeCaches() {
  const list = [];
  const seen = new Set();

  for (const entry of memoryIndex.values()) {
    seen.add(entry.key);
    list.push(summarizeEntry(entry));
  }

  const mods = await ensureFs();
  const dir = await ensureDir();
  if (mods && dir) {
    const { fs, path } = mods;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf8');
          const entry = JSON.parse(raw);
          if (entry?.key && !seen.has(entry.key)) {
            seen.add(entry.key);
            setEpisodeCacheMemory(entry);
            list.push(summarizeEntry(entry));
          }
        } catch { /* ignore bad file */ }
      }
    } catch { /* ignore */ }
  }

  list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return list;
}

function summarizeEntry(entry) {
  const sources = entry.sources || entry.sources_detail || entry.sources_summary || [];
  return {
    key: entry.key,
    identity: entry.identity || null,
    display: entry.display || entry.identity?.display || null,
    type: entry.identity?.is_movie === true || entry.identity?.type === 'movie'
      ? 'movie'
      : (entry.identity?.type || null),
    source_count: Array.isArray(sources) ? sources.length : 0,
    total_before: entry.stats?.total_before ?? null,
    total_after: entry.stats?.total_after ?? entry.comments?.length ?? null,
    removed: entry.stats?.removed ?? null,
    updated_at: entry.updated_at || entry.created_at || null,
    cached: true,
    has_comments: Array.isArray(entry.comments) && entry.comments.length > 0,
    // web 面板列表预览：每个来源的原始文件名 + provider + 数量
    sources_summary: Array.isArray(sources)
      ? sources.map((s) => ({
          source: s.source || s.provider || 'unknown',
          provider: s.provider || s.source || 'unknown',
          file_name: s.file_name || s.fileName || s.raw_file || null,
          matched_title: s.matched_title || s.anime_title || null,
          count_raw: s.count_raw ?? s.count ?? null,
          count_used: s.count_used ?? null,
          status: s.status || null
        }))
      : []
  };
}

export async function getEpisodeCacheDetail(key) {
  const entry = await loadEpisodeCache(key);
  if (!entry) return null;
  const sources = entry.sources || entry.sources_detail || [];
  // 详情：完整来源 metadata（文件名 / provider / 数量 / 聚合关系）
  const sources_detail = sources.map((s) => ({
    source: s.source || s.provider || 'unknown',
    provider: s.provider || s.source || 'unknown',
    file_name: s.file_name || s.fileName || s.raw_file || null,
    fileName: s.file_name || s.fileName || s.raw_file || null,
    raw_file: s.raw_file || s.file_name || s.fileName || null,
    matched_title: s.matched_title || s.anime_title || null,
    anime_title: s.anime_title || s.matched_title || null,
    episode_title: s.episode_title || null,
    original_title: s.original_title || null,
    region: s.region || null,
    region_label: s.region_label || null,
    year: s.year || null,
    season: s.season ?? null,
    episode: s.episode ?? null,
    type: s.type || entry.identity?.type || null,
    count_raw: s.count_raw ?? s.count ?? 0,
    count_sampled: s.count_sampled ?? null,
    count_used: s.count_used ?? s.count_sampled ?? s.count_raw ?? 0,
    match_reason: s.match_reason || null,
    status: s.status || null,
    error: s.error || null,
    url: s.url || null,
    weight: s.weight ?? null
  }));
  return {
    ...summarizeEntry(entry),
    sources: sources_detail,
    sources_detail,
    media: entry.media || null,
    stats: entry.stats || {},
    removed_by_reason: entry.stats?.removed_by_reason || {},
    sample_comments: (entry.comments || []).slice(0, 10)
  };
}

/**
 * 弹幕源数据保护层（通用，非单片特例）
 *
 * Provider 返回
 *   → 检测 / 评估
 *   → 时间桶采样 + 质量优先
 *   → 单源/总量上限
 *   → 才进入清洗与聚合
 *
 * 目标：任意热门片单源 10 万~百万级弹幕时，不 OOM、不全局失败。
 */
import { log } from '../utils/log-util.js';
import { globals } from '../configs/globals.js';

/** 缓存协议版本：结构变化时抬升，旧缓存自动失效 */
export const EPISODE_CACHE_VERSION = 3;

/**
 * 运行时保护参数（可用环境变量覆盖）
 */
export function getGuardConfig() {
  const danmuLimitK = Number(globals.danmuLimit) || 0;
  const perSourceFromLimit = danmuLimitK > 0 ? danmuLimitK * 1000 : 0;

  const perSourceMax = positiveInt(
    process.env.AGGREGATE_MAX_PER_SOURCE || process.env.EPISODE_AGGREGATE_MAX_RAW,
    perSourceFromLimit || 35000
  );
  const totalMax = positiveInt(
    process.env.AGGREGATE_MAX_TOTAL,
    Math.max(perSourceMax, perSourceFromLimit || 60000)
  );
  const finalMax = positiveInt(
    process.env.AGGREGATE_FINAL_MAX || (danmuLimitK > 0 ? danmuLimitK * 1000 : 0),
    Math.min(totalMax, 50000)
  );
  const bucketCount = positiveInt(process.env.AGGREGATE_TIME_BUCKETS, 120);
  const fetchTimeoutMs = positiveInt(process.env.AGGREGATE_SOURCE_TIMEOUT_MS, 45000);
  const cacheTtlMinutes = positiveInt(process.env.EPISODE_CACHE_TTL_MINUTES, 180);
  const cacheMaxComments = positiveInt(process.env.EPISODE_CACHE_MAX_COMMENTS, finalMax);
  const cacheMaxBytes = positiveInt(process.env.EPISODE_CACHE_MAX_BYTES, 8 * 1024 * 1024);
  const heapSoftMb = positiveInt(process.env.AGGREGATE_HEAP_SOFT_MB, 280);

  return {
    perSourceMax,
    totalMax,
    finalMax,
    bucketCount,
    fetchTimeoutMs,
    cacheTtlMinutes,
    cacheMaxComments,
    cacheMaxBytes,
    heapSoftMb,
    cacheVersion: EPISODE_CACHE_VERSION
  };
}

function positiveInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getMemorySnapshot() {
  try {
    if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return null;
    const u = process.memoryUsage();
    return {
      rss_mb: roundMb(u.rss),
      heap_used_mb: roundMb(u.heapUsed),
      heap_total_mb: roundMb(u.heapTotal)
    };
  } catch {
    return null;
  }
}

function roundMb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

/** 堆压力：超过 soft 阈值时收紧采样上限 */
export function adaptiveCaps(config, memory = getMemorySnapshot()) {
  let { perSourceMax, totalMax, finalMax } = config;
  const heap = memory?.heap_used_mb || 0;
  if (heap >= config.heapSoftMb * 1.2) {
    perSourceMax = Math.min(perSourceMax, 12000);
    totalMax = Math.min(totalMax, 25000);
    finalMax = Math.min(finalMax, 20000);
  } else if (heap >= config.heapSoftMb) {
    perSourceMax = Math.min(perSourceMax, 20000);
    totalMax = Math.min(totalMax, 40000);
    finalMax = Math.min(finalMax, 30000);
  }
  return { ...config, perSourceMax, totalMax, finalMax, memory };
}

/**
 * 从弹幕项提取时间（秒）
 */
export function extractItemTime(item) {
  if (!item || typeof item !== 'object') return 0;
  if (Number.isFinite(item.time)) return Math.max(0, Number(item.time));
  if (Number.isFinite(item.t)) return Math.max(0, Number(item.t));
  if (Number.isFinite(item.timepoint)) return Math.max(0, Number(item.timepoint));
  if (typeof item.p === 'string' && item.p.length) {
    const first = item.p.split(',')[0];
    const n = Number(first);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

/**
 * 轻量弹幕有效性分（采样时优先保留）
 * 不替代正式清洗，只做保护层预筛
 */
export function scoreItemForSampling(item) {
  const text = String(item?.m ?? item?.content ?? item?.text ?? '').trim();
  if (!text) return -1;
  if (text.length <= 1) return 5;
  let score = 40 + Math.min(30, text.length);
  // 纯数字/纯符号降权
  if (/^[\d\s.]+$/.test(text)) score -= 25;
  if (/^[\W_]+$/u.test(text)) score -= 30;
  // 明显刷屏
  if (/(.)\1{6,}/.test(text)) score -= 20;
  // 有时间更优
  if (extractItemTime(item) > 0) score += 5;
  return score;
}

/**
 * 时间桶 + 质量优先采样
 * - 覆盖整片时间轴（非截取前 N 条）
 * - 每桶按质量排序后均匀保留
 * - 桶内不足时不跨桶灌满（保持密度比例）
 */
export function sampleByTimeBuckets(items, maxN, bucketCount = 120) {
  if (!Array.isArray(items) || items.length <= maxN) {
    return {
      items: Array.isArray(items) ? items : [],
      raw: Array.isArray(items) ? items.length : 0,
      sampled: Array.isArray(items) ? items.length : 0,
      method: 'passthrough'
    };
  }

  const n = items.length;
  const buckets = Math.max(8, Math.min(bucketCount, maxN));
  // 先扫时间范围
  let tMin = Infinity;
  let tMax = -Infinity;
  const times = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = extractItemTime(items[i]);
    times[i] = t;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin) {
    // 无有效时间：退化为等间隔 + 质量过滤
    return sampleEvenlyWithQuality(items, maxN);
  }

  const span = tMax - tMin || 1;
  const bins = Array.from({ length: buckets }, () => []);
  for (let i = 0; i < n; i++) {
    let bi = Math.floor(((times[i] - tMin) / span) * buckets);
    if (bi < 0) bi = 0;
    if (bi >= buckets) bi = buckets - 1;
    bins[bi].push(i);
  }

  // 每桶配额按桶内占比分配，至少 0
  const selectedIdx = [];
  const baseQuota = maxN / n;
  let allocated = 0;
  const quotas = bins.map((bin) => {
    const q = Math.floor(bin.length * baseQuota);
    return q;
  });
  // 补齐到 maxN：优先给弹幕更密的桶
  allocated = quotas.reduce((a, b) => a + b, 0);
  const order = bins
    .map((bin, i) => ({ i, len: bin.length }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len);
  let cursor = 0;
  while (allocated < maxN && order.length) {
    const slot = order[cursor % order.length];
    if (quotas[slot.i] < bins[slot.i].length) {
      quotas[slot.i] += 1;
      allocated += 1;
    }
    cursor += 1;
    if (cursor > maxN * 2) break;
  }

  for (let b = 0; b < buckets; b++) {
    const bin = bins[b];
    const q = quotas[b];
    if (!bin.length || q <= 0) continue;
    // 桶内按质量排序，再等间隔取，兼顾质量与均匀
    const ranked = bin
      .map((idx) => ({ idx, score: scoreItemForSampling(items[idx]) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) continue;
    if (ranked.length <= q) {
      for (const r of ranked) selectedIdx.push(r.idx);
    } else {
      // 前 30% 名额给高质量，其余等间隔
      const topN = Math.max(1, Math.floor(q * 0.3));
      const restN = q - topN;
      for (let i = 0; i < topN; i++) selectedIdx.push(ranked[i].idx);
      if (restN > 0) {
        const pool = ranked.slice(topN);
        const interval = pool.length / restN;
        for (let i = 0; i < restN; i++) {
          selectedIdx.push(pool[Math.floor(i * interval)].idx);
        }
      }
    }
  }

  // 去重并按时间排序
  const uniq = [...new Set(selectedIdx)];
  uniq.sort((a, b) => times[a] - times[b] || a - b);
  let out = uniq.map((i) => items[i]);
  if (out.length > maxN) {
    out = sampleEvenlyWithQuality(out, maxN).items;
  }
  // 不足时用全局等间隔补齐（极少发生）
  if (out.length < maxN * 0.9 && out.length < n) {
    const have = new Set(uniq);
    const fillers = [];
    const interval = n / maxN;
    for (let i = 0; i < maxN && fillers.length + out.length < maxN; i++) {
      const idx = Math.floor(i * interval);
      if (!have.has(idx) && scoreItemForSampling(items[idx]) >= 0) {
        have.add(idx);
        fillers.push(items[idx]);
      }
    }
    out = out.concat(fillers).slice(0, maxN);
  }

  return {
    items: out,
    raw: n,
    sampled: out.length,
    method: 'time_bucket_quality',
    t_min: tMin,
    t_max: tMax,
    buckets
  };
}

function sampleEvenlyWithQuality(items, maxN) {
  const scored = items
    .map((item, idx) => ({ item, idx, score: scoreItemForSampling(item) }))
    .filter((x) => x.score >= 0);
  if (scored.length <= maxN) {
    return { items: scored.map((x) => x.item), raw: items.length, sampled: scored.length, method: 'quality_filter' };
  }
  // 等间隔索引 + 轻微质量偏向
  const interval = scored.length / maxN;
  const out = [];
  for (let i = 0; i < maxN; i++) {
    const center = Math.floor(i * interval);
    let best = center;
    let bestScore = scored[center]?.score ?? -1;
    for (let d = -2; d <= 2; d++) {
      const j = center + d;
      if (j >= 0 && j < scored.length && scored[j].score > bestScore) {
        best = j;
        bestScore = scored[j].score;
      }
    }
    out.push(scored[best].item);
  }
  return { items: out, raw: items.length, sampled: out.length, method: 'even_quality' };
}

/**
 * 单源保护：检测 → 评估 → 采样
 */
export function protectSourcePayload(sourceName, items, config) {
  const cfg = adaptiveCaps(config || getGuardConfig());
  const list = Array.isArray(items) ? items : [];
  const raw = list.length;
  const mem = getMemorySnapshot();

  if (raw === 0) {
    return {
      source: sourceName,
      items: [],
      raw: 0,
      sampled: 0,
      filtered_invalid: 0,
      used: 0,
      method: 'empty',
      status: 'empty',
      memory: mem
    };
  }

  // 去掉明显无效
  const valid = [];
  let invalid = 0;
  for (const it of list) {
    if (scoreItemForSampling(it) < 0) {
      invalid += 1;
      continue;
    }
    valid.push(it);
  }

  const cap = cfg.perSourceMax;
  const sampled = sampleByTimeBuckets(valid, cap, cfg.bucketCount);

  return {
    source: sourceName,
    items: sampled.items,
    raw,
    sampled: sampled.sampled,
    filtered_invalid: invalid,
    used: sampled.sampled,
    method: sampled.method,
    t_min: sampled.t_min,
    t_max: sampled.t_max,
    status: sampled.sampled < raw ? 'sampled' : 'full',
    memory: mem
  };
}

/**
 * 多源总量保护：按源质量评分分配名额，再二次采样
 */
export function protectMultiSource(fetchResults, config) {
  const cfg = adaptiveCaps(config || getGuardConfig());
  const protectedList = [];

  for (const fr of fetchResults || []) {
    const name = fr.source || 'unknown';
    if (fr.error && !fr.items?.length) {
      protectedList.push({
        ...fr,
        items: [],
        raw: fr.count_raw || 0,
        sampled: 0,
        used: 0,
        status: 'failed',
        fail_reason: fr.error,
        quality_score: 0
      });
      continue;
    }
    const guard = protectSourcePayload(name, fr.items || [], cfg);
    const quality = scoreSourceQuality({
      source: name,
      raw: guard.raw,
      sampled: guard.sampled,
      items: guard.items,
      error: fr.error,
      weight: fr.weight || 1
    });
    protectedList.push({
      ...fr,
      items: guard.items,
      count_raw: guard.raw,
      count_sampled: guard.sampled,
      count_used: guard.sampled,
      filtered_invalid: guard.filtered_invalid,
      sample_method: guard.method,
      status: fr.error ? 'failed' : guard.status,
      fail_reason: fr.error || null,
      quality_score: quality.score,
      quality_detail: quality,
      t_min: guard.t_min,
      t_max: guard.t_max
    });
  }

  // 总量超限：按质量降权缩减各源
  let total = protectedList.reduce((s, x) => s + (x.items?.length || 0), 0);
  if (total > cfg.totalMax) {
    const ratio = cfg.totalMax / total;
    for (const fr of protectedList) {
      if (!fr.items?.length) continue;
      const newCap = Math.max(500, Math.floor(fr.items.length * ratio * (0.7 + 0.3 * (fr.quality_score || 50) / 100)));
      if (fr.items.length > newCap) {
        const again = sampleByTimeBuckets(fr.items, newCap, cfg.bucketCount);
        fr.items = again.items;
        fr.count_used = again.sampled;
        fr.count_sampled = again.sampled;
        fr.status = 'sampled_total_cap';
      }
    }
    total = protectedList.reduce((s, x) => s + (x.items?.length || 0), 0);
  }

  // 合并顺序：质量分 × 权重
  protectedList.sort((a, b) => {
    const sa = (a.quality_score || 0) * (a.weight || 1);
    const sb = (b.quality_score || 0) * (b.weight || 1);
    return sb - sa;
  });

  return {
    sources: protectedList,
    config: cfg,
    total_before_protect: (fetchResults || []).reduce((s, x) => s + (x.count_raw || x.items?.length || 0), 0),
    total_after_protect: total,
    memory: getMemorySnapshot()
  };
}

/**
 * 来源质量评分（智能聚合用）
 * - 数量（饱和）
 * - 时间覆盖
 * - 有效比例
 * - 源权重 / 稳定性
 */
export function scoreSourceQuality({ source, raw, sampled, items, error, weight = 1 }) {
  if (error) {
    return { score: 0, reason: 'error', factors: { error: String(error) } };
  }
  const n = Array.isArray(items) ? items.length : sampled || 0;
  if (!n) {
    return { score: 0, reason: 'empty', factors: { raw: raw || 0 } };
  }

  // 数量：log 饱和，避免 50 万碾压一切
  const countFactor = Math.min(40, Math.log10(n + 1) * 18);

  let tMin = Infinity;
  let tMax = -Infinity;
  let valid = 0;
  for (const it of items) {
    const t = extractItemTime(it);
    if (t > 0) {
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    if (scoreItemForSampling(it) >= 20) valid += 1;
  }
  const coverage = Number.isFinite(tMin) && tMax > tMin ? Math.min(30, Math.log10(tMax - tMin + 1) * 12) : 8;
  const validRatio = valid / n;
  const validFactor = validRatio * 20;
  const weightFactor = Math.min(15, (weight || 1) * 3);
  // 过大 raw 且采样比极低：稳定性略降（抓取成本高）
  let stability = 10;
  if (raw > 200000) stability -= 3;
  if (error) stability = 0;

  const score = Math.max(0, Math.min(100, countFactor + coverage + validFactor + weightFactor + stability));
  return {
    score: Number(score.toFixed(2)),
    factors: {
      count: Number(countFactor.toFixed(2)),
      coverage: Number(coverage.toFixed(2)),
      valid_ratio: Number(validRatio.toFixed(3)),
      weight: Number(weightFactor.toFixed(2)),
      stability,
      raw: raw || n,
      used: n,
      t_span: Number.isFinite(tMin) && tMax > tMin ? Number((tMax - tMin).toFixed(1)) : null
    }
  };
}

/**
 * 最终输出上限（等间隔）
 */
export function capFinalComments(comments, maxN) {
  if (!Array.isArray(comments) || comments.length <= maxN) {
    return { comments: comments || [], before: comments?.length || 0, after: comments?.length || 0 };
  }
  const interval = comments.length / maxN;
  const out = [];
  for (let i = 0; i < maxN; i++) {
    out.push(comments[Math.floor(i * interval)]);
  }
  return { comments: out, before: comments.length, after: out.length };
}

/**
 * 诊断日志：单片全链路
 */
export function logEpisodeDiagnostics(identity, sourceReports, aggregateStats = {}) {
  const media = {
    title: identity?.title || null,
    original_title: identity?.original_title || null,
    year: identity?.year || null,
    season: identity?.season ?? null,
    episode: identity?.episode ?? null,
    tmdb_id: identity?.tmdb_id || null,
    imdb_id: identity?.imdb_id || null,
    key: identity?.key || null
  };
  log('info', `[DanmuGuard] media ${JSON.stringify(media)}`);
  for (const s of sourceReports || []) {
    log(
      'info',
      `[DanmuGuard] source=${s.source} status=${s.status || '-'} raw=${s.count_raw ?? s.raw ?? 0} sampled=${s.count_sampled ?? s.sampled ?? 0} used=${s.count_used ?? s.used ?? s.count_sampled ?? 0} quality=${s.quality_score ?? '-'} err=${s.fail_reason || s.error || '-'}`
    );
  }
  log(
    'info',
    `[DanmuGuard] aggregate total_before=${aggregateStats.total_before ?? '-'} total_after=${aggregateStats.total_after ?? '-'} removed=${aggregateStats.removed ?? '-'} mem=${JSON.stringify(getMemorySnapshot())}`
  );
}

/**
 * 带超时的 Promise
 */
export function withTimeout(promise, ms, label = 'operation') {
  const timeout = Math.max(1000, Number(ms) || 45000);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timeout after ${timeout}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * 缓存是否可写入
 */
export function shouldPersistCache(entry, config) {
  const cfg = config || getGuardConfig();
  const comments = entry?.comments;
  if (!Array.isArray(comments) || comments.length === 0) {
    return { ok: false, reason: 'empty_comments' };
  }
  if (comments.length > cfg.cacheMaxComments) {
    return { ok: false, reason: 'too_many_comments', count: comments.length, max: cfg.cacheMaxComments };
  }
  return { ok: true };
}

/**
 * 缓存是否仍有效
 */
export function isCacheEntryValid(entry, config) {
  const cfg = config || getGuardConfig();
  if (!entry) return { ok: false, reason: 'missing' };
  if (Number(entry.cache_version) !== cfg.cacheVersion) {
    return { ok: false, reason: 'version_mismatch', got: entry.cache_version, want: cfg.cacheVersion };
  }
  if (!Array.isArray(entry.comments) || entry.comments.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const updated = Date.parse(entry.updated_at || entry.created_at || 0);
  if (Number.isFinite(updated)) {
    const ageMin = (Date.now() - updated) / 60000;
    if (ageMin > cfg.cacheTtlMinutes) {
      return { ok: false, reason: 'ttl_expired', age_min: Number(ageMin.toFixed(1)) };
    }
  }
  return { ok: true };
}

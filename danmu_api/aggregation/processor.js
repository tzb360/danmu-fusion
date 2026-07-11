import { simplized } from '../utils/zh-util.js';

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function normalizeStrictText(text) {
  return simplized(String(text || ''))
    .toLowerCase()
    .replace(/[\s.,!?"'(){}\[\]<>;:，。！？、""''（）【】《》；：~～\-_/\\|@#$%^&*=+`·…￥]/g, '');
}

export function normalizeSemanticText(text) {
  return normalizeStrictText(text)
    .replace(/(这部|这个|这番|这剧|这片|这一部|这一集)/g, '这')
    .replace(/(动漫|动画片|动画|番剧|番|剧集|剧|片子|作品)/g, '作品')
    .replace(/(真的|真是|真|太|很|非常|特别|挺|也|超级|巨|好)/g, '')
    .replace(/(好+看|精彩|优秀|神作|不错|棒|绝了|绝)/g, '好看')
    .replace(/[的了啊呀呢吧吗喔哦啦]/g, '');
}

/** 稳定 32-bit 字符串 hash（FNV-1a 变体） */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 64-bit SimHash（用两个 32-bit 向量拼接模拟）
 * 特征：字符 + bigram，适合中文短句快速相似判断
 */
export function computeSimHash(text) {
  const features = [];
  if (!text) return { hi: 0, lo: 0 };

  for (let i = 0; i < text.length; i++) {
    features.push(text[i]);
    if (i + 1 < text.length) features.push(text.slice(i, i + 2));
  }

  const bitsHi = new Int16Array(32);
  const bitsLo = new Int16Array(32);

  for (const feature of features) {
    const h1 = hash32(feature);
    const h2 = hash32(`#${feature}`);
    for (let b = 0; b < 32; b++) {
      bitsHi[b] += (h1 >>> b) & 1 ? 1 : -1;
      bitsLo[b] += (h2 >>> b) & 1 ? 1 : -1;
    }
  }

  let hi = 0;
  let lo = 0;
  for (let b = 0; b < 32; b++) {
    if (bitsHi[b] >= 0) hi |= (1 << b) >>> 0;
    if (bitsLo[b] >= 0) lo |= (1 << b) >>> 0;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

export function hammingDistance64(a, b) {
  let x = (a.hi ^ b.hi) >>> 0;
  let y = (a.lo ^ b.lo) >>> 0;
  let count = 0;
  while (x) {
    x &= x - 1;
    count++;
  }
  while (y) {
    y &= y - 1;
    count++;
  }
  return count;
}

function maxRepeatedCharRatio(text) {
  const normalized = text || '';
  if (!normalized) return 1;

  const counts = new Map();
  let max = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = (counts.get(char) || 0) + 1;
    counts.set(char, next);
    if (next > max) max = next;
  }
  return max / normalized.length;
}

function symbolRatio(raw) {
  if (!raw) return 1;
  const symbols = raw.replace(/[\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
  return symbols / raw.length;
}

function uniqueCharRatio(normalized) {
  if (!normalized) return 0;
  return new Set(normalized).size / normalized.length;
}

function compileRegexes(regexes = []) {
  return regexes
    .map((raw) => {
      try {
        return new RegExp(raw, 'i');
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function containsKeyword(text, keywords = []) {
  if (!text || !keywords.length) return false;
  const lower = text.toLowerCase();
  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    if (keyword && lower.includes(String(keyword).toLowerCase())) return true;
  }
  return false;
}

function matchesRegex(text, regexes = []) {
  for (let i = 0; i < regexes.length; i++) {
    if (regexes[i].test(text)) return true;
  }
  return false;
}

/**
 * 预计算每条弹幕的归一化字段，避免 O(n*m) 重复简繁转换
 */
export function prepareDanmakuItem(item) {
  const content = item.content || '';
  const strict = normalizeStrictText(content);
  const semantic = normalizeSemanticText(content);
  return {
    ...item,
    content,
    _strict: strict,
    _semantic: semantic,
    _simhash: computeSimHash(semantic || strict),
    _len: strict.length,
    _semanticLen: semantic.length,
    _repeated: maxRepeatedCharRatio(strict),
    _diversity: uniqueCharRatio(strict),
    _symbol: symbolRatio(content)
  };
}

function isMeaningless(item, rules) {
  const config = rules.meaningless || {};
  if (config.enabled === false || rules.garbage_filter?.meaningless === false) return false;

  const text = normalizeWhitespace(item.content);
  const strict = item._strict ?? normalizeStrictText(text);
  if (!strict || strict.length < (config.min_text_length ?? 1)) return true;

  // 纯数字（排除时间码原文，如 1:30 / 00:01，交由时间提示规则处理）
  if (/^\d+$/.test(strict) && !/\d{1,2}[:：]\d{2}/.test(text)) return true;

  // 纯符号 / 无汉字字母数字（时间码除外）
  if (!/[\u4e00-\u9fa5a-z0-9]/i.test(text) && !/\d{1,2}[:：]\d{2}/.test(text)) return true;

  const commonTokens = rules._commonTokenSet
    || new Set((config.common_tokens || []).map(token => normalizeStrictText(token)));
  if (commonTokens.has(strict)) return true;

  const repeatedRatio = item._repeated ?? maxRepeatedCharRatio(strict);
  const maxLength = config.max_repeated_text_length ?? 20;
  const ratioThreshold = config.repeated_char_ratio ?? 0.65;
  if (strict.length <= maxLength && repeatedRatio >= ratioThreshold) return true;

  // 单字符/双字符刷屏：哈哈哈哈、啊啊啊、666、???、...
  if (/^(.)\1{2,}$/u.test(strict)) return true;
  if (/^(..)\1{2,}$/u.test(strict) && strict.length >= 6) return true;
  if (/^(哈|呵|嘿|嘻|哇|嗷|呜|啊|哦|噢|额|呃|嘿|h|w|a|e|6|2|3|\?|？|!|！|。|\.|～|~)+$/i.test(strict) && strict.length >= 3) {
    return true;
  }

  return false;
}

function createRuleRuntime(rules) {
  const commonTokens = new Set((rules.meaningless?.common_tokens || []).map(token => normalizeStrictText(token)));
  // 挂到 rules 的浅拷贝字段，供 isMeaningless 复用（不修改 defaults 冻结对象字段语义）
  rules._commonTokenSet = commonTokens;

  return {
    allowlistRegexes: compileRegexes(rules.allowlist?.regexes || []),
    customBlacklistRegexes: compileRegexes(rules.custom_blacklist?.regexes || []),
    advertisementRegexes: compileRegexes(rules.advertisement?.regexes || []),
    timelineHintRegexes: compileRegexes(rules.timeline_hint?.regexes || []),
    spoilerRegexes: compileRegexes(rules.spoiler?.regexes || []),
    adKeywordsLower: (rules.advertisement?.keywords || []).map(k => String(k).toLowerCase()),
    timelineKeywordsLower: (rules.timeline_hint?.keywords || []).map(k => String(k).toLowerCase()),
    spoilerKeywordsLower: (rules.spoiler?.keywords || []).map(k => String(k).toLowerCase()),
    blacklistKeywordsLower: (rules.custom_blacklist?.keywords || []).map(k => String(k).toLowerCase()),
    allowlistKeywordsLower: (rules.allowlist?.keywords || []).map(k => String(k).toLowerCase()),
    emotionWords: rules.quality?.emotion_words || []
  };
}

function containsKeywordLower(textLower, keywordsLower = []) {
  for (let i = 0; i < keywordsLower.length; i++) {
    if (keywordsLower[i] && textLower.includes(keywordsLower[i])) return true;
  }
  return false;
}

function isAllowlisted(item, rules, runtime = null) {
  const config = rules.allowlist || {};
  if (config.enabled === false) return false;
  const text = item.content || '';
  const lower = text.toLowerCase();
  return containsKeywordLower(lower, runtime?.allowlistKeywordsLower || [])
    || matchesRegex(text, runtime?.allowlistRegexes || []);
}

function isCustomBlacklisted(item, rules, runtime = null) {
  const config = rules.custom_blacklist || {};
  if (config.enabled === false || rules.garbage_filter?.custom_blacklist === false) return false;
  const text = item.content || '';
  const lower = text.toLowerCase();
  return containsKeywordLower(lower, runtime?.blacklistKeywordsLower || [])
    || matchesRegex(text, runtime?.customBlacklistRegexes || []);
}

function isAdvertisement(item, rules, runtime = null) {
  const config = rules.advertisement || {};
  if (config.enabled === false || rules.garbage_filter?.advertisement === false) return false;
  const text = item.content || '';
  const lower = text.toLowerCase();
  return containsKeywordLower(lower, runtime?.adKeywordsLower || [])
    || matchesRegex(text, runtime?.advertisementRegexes || []);
}

function isTimelineHint(item, rules, runtime = null) {
  const config = rules.timeline_hint || {};
  if (config.enabled === false || rules.garbage_filter?.timeline_hint === false) return false;
  const text = item.content || '';
  const lower = text.toLowerCase();
  return containsKeywordLower(lower, runtime?.timelineKeywordsLower || [])
    || matchesRegex(text, runtime?.timelineHintRegexes || []);
}

function isSpoiler(item, rules, runtime = null) {
  const config = rules.spoiler || {};
  const enabled = config.enabled === true || rules.garbage_filter?.spoiler === true;
  if (!enabled) return false;
  const text = item.content || '';
  const lower = text.toLowerCase();
  return containsKeywordLower(lower, runtime?.spoilerKeywordsLower || [])
    || matchesRegex(text, runtime?.spoilerRegexes || []);
}

export function scoreDanmakuQuality(item, rules, runtime = null) {
  const config = rules.quality || {};
  const strict = item._strict ?? normalizeStrictText(item.content);
  const length = item._len ?? strict.length;
  if (length === 0) return 0;

  const repeated = item._repeated ?? maxRepeatedCharRatio(strict);
  const diversity = item._diversity ?? uniqueCharRatio(strict);
  const symbol = item._symbol ?? symbolRatio(item.content || '');
  const infoChars = strict.replace(/[0-9a-z]/gi, '').length;
  const infoRatio = Math.min(1, infoChars / Math.max(1, length));

  let keywordPenalty = 0;
  if (isAdvertisement(item, rules, runtime) || isTimelineHint(item, rules, runtime) || isSpoiler(item, rules, runtime)) {
    keywordPenalty = config.garbage_keyword_penalty ?? 32;
  }

  const text = item.content || '';
  const emotionWords = runtime?.emotionWords || config.emotion_words || [];
  let emotionCount = 0;
  for (let i = 0; i < emotionWords.length; i++) {
    if (emotionWords[i] && text.includes(emotionWords[i])) emotionCount++;
  }
  const emotionRatio = Math.min(1, emotionCount / Math.max(1, length / 4));

  // 纯数字/极短句额外降分
  let shortPenalty = 0;
  if (length <= 2) shortPenalty = 25;
  else if (length <= 3) shortPenalty = 12;
  if (/^\d+$/.test(strict)) shortPenalty += 30;

  const score = 12
    + Math.min(length, 20) * (config.length_weight ?? 2.6)
    + infoRatio * (config.information_weight ?? 34)
    + diversity * (config.diversity_weight ?? 20)
    - repeated * (config.repeated_penalty ?? 40)
    - symbol * (config.symbol_penalty ?? 18)
    - keywordPenalty
    - emotionRatio * (config.emotion_keyword_penalty ?? 14)
    - shortPenalty;

  return Math.max(0, Math.min(100, Number(score.toFixed(2))));
}

function evaluateGarbage(item, rules, runtime) {
  if (!rules.garbage_filter?.enabled) return { removed: false, score: scoreDanmakuQuality(item, rules, runtime) };
  if (isAllowlisted(item, rules, runtime)) {
    return { removed: false, score: Math.max(60, scoreDanmakuQuality(item, rules, runtime)) };
  }

  if (isCustomBlacklisted(item, rules, runtime)) {
    return { removed: true, reason: 'custom_blacklist', score: scoreDanmakuQuality(item, rules, runtime) };
  }
  if (isMeaningless(item, rules)) return { removed: true, reason: 'low_quality', score: 0 };
  if (isAdvertisement(item, rules, runtime)) {
    return { removed: true, reason: 'advertisement', score: scoreDanmakuQuality(item, rules, runtime) };
  }
  if (isTimelineHint(item, rules, runtime)) {
    return { removed: true, reason: 'timeline_hint', score: scoreDanmakuQuality(item, rules, runtime) };
  }
  if (isSpoiler(item, rules, runtime)) {
    return { removed: true, reason: 'spoiler', score: scoreDanmakuQuality(item, rules, runtime) };
  }

  const score = scoreDanmakuQuality(item, rules, runtime);
  const qualityEnabled = rules.quality?.enabled !== false && rules.garbage_filter?.quality_score !== false;
  if (qualityEnabled && score < (rules.quality?.threshold ?? 45)) {
    return { removed: true, reason: 'low_quality', score };
  }

  return { removed: false, score };
}

function ngrams(text, size = 2) {
  if (text.length <= size) return [text];
  const result = [];
  for (let i = 0; i <= text.length - size; i++) {
    result.push(text.slice(i, i + size));
  }
  return result;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = ngrams(a);
  const bGrams = ngrams(b);
  const counts = new Map();
  for (const gram of aGrams) counts.set(gram, (counts.get(gram) || 0) + 1);
  let matches = 0;
  for (const gram of bGrams) {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      matches++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * matches) / (aGrams.length + bGrams.length);
}

function jaccardChars(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const char of setA) {
    if (setB.has(char)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * 快速相似度：优先 SimHash + Dice，不再默认跑 O(n*m) LCS
 */
export function calculateTextSimilarity(textA, textB) {
  const a = normalizeSemanticText(textA);
  const b = normalizeSemanticText(textB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lengthRatio < 0.45) return 0;

  const hashA = computeSimHash(a);
  const hashB = computeSimHash(b);
  const ham = hammingDistance64(hashA, hashB);
  if (ham <= 3) return 0.95;
  if (ham <= 6) {
    return Math.max(diceCoefficient(a, b), jaccardChars(a, b));
  }
  if (ham > 12) return 0;

  return Math.max(diceCoefficient(a, b) * 0.85, jaccardChars(a, b) * 0.7);
}

function calculatePreparedSimilarity(itemA, itemB) {
  const a = itemA._semantic || itemA._strict || '';
  const b = itemB._semantic || itemB._strict || '';
  if (!a || !b) return 0;
  if (a === b) return 1;

  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lengthRatio < 0.45) return 0;

  const ham = hammingDistance64(itemA._simhash, itemB._simhash);
  if (ham <= 3) return 0.95;
  if (ham > 10) return 0;
  if (ham <= 6) {
    return Math.max(diceCoefficient(a, b), jaccardChars(a, b));
  }
  return diceCoefficient(a, b) * 0.8;
}

function sameEpisode(a, b) {
  return String(a.episode ?? '') === String(b.episode ?? '');
}

function addRemoval(stats, samples, reason, item, rules) {
  stats.removed_by_reason[reason] = (stats.removed_by_reason[reason] || 0) + 1;

  if (rules.output?.include_removed_samples && samples.length < (rules.output?.removed_sample_limit ?? 20)) {
    // 输出时去掉内部缓存字段
    const {
      _strict, _semantic, _simhash, _len, _semanticLen, _repeated, _diversity, _symbol, ...clean
    } = item;
    samples.push({ reason, item: clean });
  }
}

/**
 * 刷屏：时间窗口内相同/近似文本超量
 * - 短文本 / 高重复：更严
 * - 任意文本：窗口内超过 max_keep 也计刷屏
 */
function detectBurst(item, queues, rules) {
  const config = rules.duplicate?.burst || {};
  if (config.enabled === false) return false;

  const key = item._strict || '';
  if (!key) return false;

  const windowSeconds = config.time_window_seconds ?? 10;
  const shortMax = config.short_text_max_length ?? 12;
  const shortEnough = key.length <= shortMax;
  const repeatedEnough = (item._repeated ?? 0) >= (config.repeated_char_ratio ?? 0.65);
  const spamToken = /^(哈|呵|嘿|嘻|哇|嗷|呜|啊|哦|噢|额|呃|h|w|a|e|6|2|3|\?|？|!|！|。|\.)+$/i.test(key);
  const pureDigit = /^\d+$/.test(key);

  // 仅对刷屏特征文本启用；正常句子交给 exact/similar，避免误杀
  if (!(repeatedEnough || spamToken || pureDigit || (shortEnough && key.length <= 4))) {
    return false;
  }

  const maxKeep = Math.min(
    config.max_keep_per_window ?? 2,
    config.short_max_keep ?? 1
  );

  const queueKey = `${item.episode ?? ''}|${key}`;
  const queue = queues.get(queueKey) || [];
  const t = item.time;
  while (queue.length && t - queue[0] > windowSeconds) queue.shift();

  if (queue.length >= maxKeep) {
    queues.set(queueKey, queue);
    return true;
  }

  queue.push(t);
  queues.set(queueKey, queue);
  return false;
}

/** 精确重复：Map + 时间窗，O(1) 均摊 */
function isExactDuplicate(item, exactMap, rules) {
  const config = rules.duplicate?.exact || {};
  if (config.enabled === false) return false;

  const strict = item._strict || '';
  if (!strict) return false;

  const key = `${item.episode ?? ''}|${strict}`;
  const windowSeconds = config.time_window_seconds ?? 3;
  const lastTime = exactMap.get(key);

  if (lastTime !== undefined && item.time - lastTime <= windowSeconds) {
    return true;
  }

  exactMap.set(key, item.time);
  return false;
}

/**
 * 相似去重：时间窗 + 长度桶 + SimHash 汉明距离
 * 避免全量两两比较与 LCS
 */
function isSimilarDuplicate(item, buckets, rules) {
  const config = rules.duplicate?.similar || {};
  if (config.enabled === false) return false;

  const semantic = item._semantic || '';
  const minLen = config.min_text_length ?? 4;
  if ((item._semanticLen || semantic.length) < minLen) return false;

  const windowSeconds = config.time_window_seconds ?? 3;
  const threshold = config.threshold ?? 0.78;
  const maxHam = config.simhash_max_hamming ?? 6;
  const bucketId = Math.floor(item.time / windowSeconds);
  const lenBucket = Math.floor((item._semanticLen || semantic.length) / 4);
  const candidateBuckets = [bucketId - 1, bucketId];

  for (let bi = 0; bi < candidateBuckets.length; bi++) {
    const id = candidateBuckets[bi];
    for (let lb = lenBucket - 1; lb <= lenBucket + 1; lb++) {
      const key = `${id}|${lb}`;
      const candidates = buckets.get(key);
      if (!candidates || !candidates.length) continue;

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (!sameEpisode(item, candidate)) continue;
        if (Math.abs(item.time - candidate.time) > windowSeconds) continue;

        const ham = hammingDistance64(item._simhash, candidate._simhash);
        if (ham > maxHam) continue;

        // 汉明很近直接判相似；边界再用快速 dice
        if (ham <= 3 || calculatePreparedSimilarity(item, candidate) >= threshold) {
          return true;
        }
      }
    }
  }

  return false;
}

function addSimilarCandidate(item, buckets, rules) {
  const config = rules.duplicate?.similar || {};
  if (config.enabled === false) return;
  if ((item._semanticLen || 0) < (config.min_text_length ?? 4)) return;

  const windowSeconds = config.time_window_seconds ?? 3;
  const bucketId = Math.floor(item.time / windowSeconds);
  const lenBucket = Math.floor((item._semanticLen || 0) / 4);
  const key = `${bucketId}|${lenBucket}`;
  const bucket = buckets.get(key) || [];
  bucket.push(item);

  const maxCandidates = config.max_candidates_per_bucket ?? 40;
  if (bucket.length > maxCandidates) bucket.splice(0, bucket.length - maxCandidates);
  buckets.set(key, bucket);

  // 清理过期时间桶
  const oldBucketId = bucketId - 3;
  for (let lb = lenBucket - 2; lb <= lenBucket + 2; lb++) {
    buckets.delete(`${oldBucketId}|${lb}`);
  }
}

function groupBySource(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.source || 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function alignTimelines(items, rules) {
  if (!rules.timeline?.enabled || items.length < 2) {
    return { items, offsets: {} };
  }

  const groups = groupBySource(items);
  if (groups.size < 2) return { items, offsets: {} };

  let referenceSource = rules.timeline.reference_source || '';
  if (!referenceSource || !groups.has(referenceSource)) {
    referenceSource = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  }

  const referenceItems = groups.get(referenceSource) || [];
  const referenceMap = new Map();
  for (const item of referenceItems) {
    const strict = item._strict ?? normalizeStrictText(item.content);
    const key = `${item.episode ?? ''}|${strict}`;
    if (!key.endsWith('|') && (!referenceMap.has(key) || item.time < referenceMap.get(key))) {
      referenceMap.set(key, item.time);
    }
  }

  const offsets = {};
  const roundStep = rules.timeline.offset_round_seconds || 0.5;
  const minMatches = rules.timeline.min_matches ?? 6;
  const minRatio = rules.timeline.min_match_ratio ?? 0.04;
  const threshold = rules.timeline.offset_threshold_seconds ?? 0.75;

  for (const [source, list] of groups.entries()) {
    if (source === referenceSource || !list.length) continue;

    const offsetCounts = new Map();
    let matches = 0;
    for (const item of list) {
      const strict = item._strict ?? normalizeStrictText(item.content);
      const key = `${item.episode ?? ''}|${strict}`;
      if (!referenceMap.has(key)) continue;
      matches++;
      const offset = item.time - referenceMap.get(key);
      const rounded = Math.round(offset / roundStep) * roundStep;
      offsetCounts.set(rounded, (offsetCounts.get(rounded) || 0) + 1);
    }

    let bestOffset = 0;
    let bestCount = 0;
    for (const [offset, count] of offsetCounts.entries()) {
      if (count > bestCount) {
        bestOffset = Number(offset);
        bestCount = count;
      }
    }

    const ratio = matches / Math.max(1, Math.min(list.length, referenceItems.length));
    if (bestCount >= minMatches && ratio >= minRatio && Math.abs(bestOffset) >= threshold) {
      offsets[source] = Number(bestOffset.toFixed(3));
    }
  }

  if (!Object.keys(offsets).length) return { items, offsets };

  const aligned = items.map(item => {
    const offset = offsets[item.source];
    if (!offset) return item;
    const alignedTime = Math.max(0, Number((item.time - offset).toFixed(3)));
    return { ...item, time: alignedTime, timestamp: alignedTime };
  });

  aligned.sort((a, b) => a.time - b.time);
  return { items: aligned, offsets };
}

function stripInternalFields(item) {
  const {
    _strict, _semantic, _simhash, _len, _semanticLen, _repeated, _diversity, _symbol, ...clean
  } = item;
  return clean;
}

export function processDanmakuItems(rawItems, rules) {
  const maxInputItems = rules.performance?.max_input_items ?? 1000000;
  if (rawItems.length > maxInputItems) {
    throw new RangeError(`Too many danmaku items: ${rawItems.length}, max ${maxInputItems}`);
  }

  const stats = {
    removed_by_reason: {},
    timeline_offsets: {},
    source_counts_after: {}
  };
  const removedSamples = [];
  const runtime = createRuleRuntime(rules);

  // 批量预计算归一化 / SimHash，后续步骤 O(1) 取用
  const prepared = new Array(rawItems.length);
  for (let i = 0; i < rawItems.length; i++) {
    prepared[i] = prepareDanmakuItem(rawItems[i]);
  }

  const { items: alignedItems, offsets } = alignTimelines(prepared, rules);
  stats.timeline_offsets = offsets;

  const filtered = [];
  for (let i = 0; i < alignedItems.length; i++) {
    const item = alignedItems[i];
    const quality = evaluateGarbage(item, rules, runtime);
    if (quality.removed) {
      addRemoval(stats, removedSamples, quality.reason, item, rules);
      continue;
    }
    item.quality_score = quality.score;
    filtered.push(item);
  }

  if (!rules.duplicate?.enabled) {
    const items = filtered.map(stripInternalFields);
    items.forEach(item => {
      stats.source_counts_after[item.source] = (stats.source_counts_after[item.source] || 0) + 1;
    });
    return { items, stats, removedSamples };
  }

  const exactMap = new Map();
  const similarBuckets = new Map();
  const burstQueues = new Map();
  const deduped = [];

  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];

    // 先精确/相似去重，再刷屏（避免正常短句被 burst 抢先误杀）
    if (isExactDuplicate(item, exactMap, rules)) {
      addRemoval(stats, removedSamples, 'duplicate_exact', item, rules);
      continue;
    }
    if (isSimilarDuplicate(item, similarBuckets, rules)) {
      addRemoval(stats, removedSamples, 'duplicate_similar', item, rules);
      continue;
    }
    if (detectBurst(item, burstQueues, rules)) {
      addRemoval(stats, removedSamples, 'burst', item, rules);
      continue;
    }

    deduped.push(item);
    addSimilarCandidate(item, similarBuckets, rules);
    stats.source_counts_after[item.source] = (stats.source_counts_after[item.source] || 0) + 1;
  }

  return {
    items: deduped.map(stripInternalFields),
    stats,
    removedSamples
  };
}

/** 过滤原因 → 中文标签（Web / 日志展示） */
export const REMOVAL_REASON_LABELS = Object.freeze({
  low_quality: '低质量弹幕',
  meaningless: '低质量弹幕',
  duplicate_exact: '重复弹幕',
  duplicate_similar: '相似弹幕',
  burst: '刷屏弹幕',
  timeline_hint: '时间提示',
  time_comment: '时间提示',
  advertisement: '广告弹幕',
  spoiler: '剧透弹幕',
  custom_blacklist: '黑名单'
});

export function getRemovalReasonLabel(reason) {
  return REMOVAL_REASON_LABELS[reason] || reason;
}

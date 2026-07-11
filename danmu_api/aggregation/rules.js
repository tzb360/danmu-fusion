import { globals } from '../configs/globals.js';
import { log } from '../utils/log-util.js';

const DEFAULT_FILTER_RULES = Object.freeze({
  version: 1,
  timeline: {
    enabled: true,
    reference_source: '',
    min_matches: 6,
    min_match_ratio: 0.04,
    offset_threshold_seconds: 0.75,
    offset_round_seconds: 0.5
  },
  merge: {
    enabled: true,
    time_merge_range_seconds: 3,
    similar_threshold: 0.82,
    max_keep_per_cluster: 1
  },
  duplicate: {
    enabled: true,
    exact: {
      enabled: true,
      // 扩大时间窗，同句邻近重复更易命中
      time_window_seconds: 3
    },
    similar: {
      enabled: true,
      time_window_seconds: 3,
      // 略放宽相似阈值，配合 SimHash 提升过滤率
      threshold: 0.78,
      min_text_length: 4,
      max_candidates_per_bucket: 40,
      simhash_max_hamming: 6
    },
    burst: {
      enabled: true,
      time_window_seconds: 10,
      max_keep_per_window: 2,
      short_max_keep: 1,
      normal_max_keep: 3,
      short_text_max_length: 12,
      repeated_char_ratio: 0.65
    }
  },
  garbage_filter: {
    enabled: true,
    meaningless: true,
    advertisement: true,
    timeline_hint: true,
    custom_blacklist: true,
    spoiler: false,
    quality_score: true
  },
  allowlist: {
    enabled: true,
    keywords: [],
    regexes: []
  },
  custom_blacklist: {
    enabled: true,
    keywords: [],
    regexes: []
  },
  meaningless: {
    enabled: true,
    min_text_length: 1,
    common_tokens: [
      '666', '6666', '66666', '666666', '233', '2333', 'hhh', 'hhhh', 'www', 'wwww',
      '???', '？？？', '？？？？', '。。。', '....', '!!!', '！！！', '哈哈', '哈哈哈',
      '哈哈哈哈', '啊啊啊', '哦哦哦', '嗯嗯', '嘿嘿', '嘻嘻', '牛', 'nb', 'yyds'
    ],
    max_repeated_text_length: 20,
    repeated_char_ratio: 0.65
  },
  advertisement: {
    enabled: true,
    keywords: [
      '加群', '群号', '裙号', 'QQ群', 'qq群', '微信', 'VX', 'vx', 'wx', 'weixin', '公众号',
      '私信', '扫码', '二维码', '淘宝', '拼多多', '返利', '领券', '推广', '代理',
      '兼职', '刷单', '下载APP', '下载 app', '下载', '资源', '优惠', '网址', '链接',
      '加微信', '加qq', '加QQ', '企鹅群', '扣扣', '粉丝群', '免费看', '全集网盘',
      '百度网盘', '夸克网盘', '关注我', '私聊', '有惊喜'
    ],
    regexes: [
      '(?:https?:\\/\\/|www\\.)\\S+',
      '[a-zA-Z0-9][a-zA-Z0-9._-]+\\.(?:com|cn|net|org|top|xyz|icu|vip|cc|tv|me|co)\\b',
      '(?:QQ|qq|企鹅|扣扣|Q群|q群)[:：\\s-]*\\d{5,}',
      '(?:微信|微 信|VX|vx|V信|v信|wx|weixin)[:：\\s-]*[a-zA-Z0-9_-]{4,}',
      '(?:群|裙|qun)[号號]?[:：\\s-]*\\d{5,}',
      '(?:淘宝|拼多多|优惠券|领券|返利)'
    ]
  },
  timeline_hint: {
    enabled: true,
    keywords: [
      '看到这里', '看到这', '记得回来', '回来感谢', '空降', '前方高能', '点赞', '三连',
      '分钟回来', '秒回来', '卡点', '高能预警', '下一段精彩', '精彩开始', '别眨眼'
    ],
    regexes: [
      '^\\s*\\d{1,2}[:：]\\d{2}(?::\\d{2})?\\s*$',
      '^\\s*\\d{1,2}[:：]\\d{2}\\s*[-~～到至]\\s*\\d{1,2}[:：]\\d{2}\\s*$',
      '\\d+\\s*(?:分钟|分|秒).*?(?:回来|再来|跳|空降)',
      '(?:跳到|快进到|空降到|看到)\\s*\\d{1,2}[:：]\\d{2}',
      '第\\s*\\d+\\s*(?:分钟|分|秒)',
      '\\d+\\s*分钟',
      '(?:00|0?\\d)[:：][0-5]\\d'
    ]
  },
  spoiler: {
    enabled: false,
    keywords: ['结局', '死了', '死亡', '凶手', '最后', '真相', '幕后黑手', '反派是', '犯人是', '剧透', '结局是'],
    regexes: []
  },
  quality: {
    enabled: true,
    // 提高阈值，过滤更多低信息量弹幕
    threshold: 45,
    min_length: 2,
    length_weight: 2.6,
    information_weight: 34,
    diversity_weight: 20,
    repeated_penalty: 40,
    garbage_keyword_penalty: 32,
    symbol_penalty: 18,
    emotion_keyword_penalty: 14,
    emotion_words: ['哈哈', '笑死', '哭了', '泪目', '牛', '绝', '好看', '无语', '卧槽', '啊啊', '666', 'hhh']
  },
  ai: {
    enabled: false,
    provider: 'none',
    base_url: '',
    model: '',
    api_key: '',
    timeout_ms: 60000
  },
  // 播放器实时弹幕链路是否启用智能清洗（服务端处理后返回给 Emby 等客户端）
  pipeline: {
    enabled: true,
    timeline: false
  },
  output: {
    include_removed_samples: false,
    removed_sample_limit: 20
  },
  performance: {
    max_input_items: 1000000
  },
  statistics: {
    enabled: true,
    history_limit: 50
  }
});

let runtimeRulePatch = {};
let runtimeRulesHydrated = false;
let lastPersistMeta = {
  available: null,
  path: null,
  exists: false,
  updated_at: null,
  error: null
};

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function deepMerge(base, patch) {
  const output = deepClone(base) || {};
  if (!isPlainObject(patch)) return output;

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = deepClone(value);
    }
  }

  return output;
}

function parseEnvRules() {
  const raw = globals.danmakuFilterRules || '';
  if (!raw || typeof raw !== 'string' || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      log('warn', '[DanmakuAggregation] DANMAKU_FILTER_RULES must be a JSON object, ignored');
      return {};
    }
    return parsed;
  } catch (error) {
    log('warn', `[DanmakuAggregation] Failed to parse DANMAKU_FILTER_RULES: ${error.message}`);
    return {};
  }
}

export function getDefaultFilterRules() {
  return deepClone(DEFAULT_FILTER_RULES);
}

export function normalizeRequestRuleOverrides(rawRules = {}) {
  if (!isPlainObject(rawRules)) return {};
  const patch = {};

  for (const [key, value] of Object.entries(rawRules)) {
    if (key === 'duplicate' && typeof value === 'boolean') {
      patch.duplicate = { enabled: value };
      continue;
    }
    if (key === 'merge' && typeof value === 'boolean') {
      patch.merge = { enabled: value };
      continue;
    }
    if (key === 'garbage_filter' && typeof value === 'boolean') {
      patch.garbage_filter = { enabled: value };
      continue;
    }
    if (key === 'spoiler' && typeof value === 'boolean') {
      patch.garbage_filter = deepMerge(patch.garbage_filter || {}, { spoiler: value });
      patch.spoiler = deepMerge(patch.spoiler || {}, { enabled: value });
      continue;
    }
    patch[key] = value;
  }

  return patch;
}

export function getActiveFilterRules(requestOverride = {}) {
  let rules = getDefaultFilterRules();
  rules = deepMerge(rules, parseEnvRules());
  rules = deepMerge(rules, runtimeRulePatch);
  rules = deepMerge(rules, normalizeRequestRuleOverrides(requestOverride));
  return rules;
}

export function getRuntimeRulePatch() {
  return deepClone(runtimeRulePatch);
}

export function getRuntimeRulesHydrated() {
  return runtimeRulesHydrated;
}

export function getRulesPersistMeta() {
  return deepClone(lastPersistMeta);
}

/**
 * 从磁盘/外部 hydrate 运行时规则补丁（启动时调用）
 */
export function hydrateRuntimeRulePatch(patch = {}, meta = {}) {
  if (isPlainObject(patch)) {
    runtimeRulePatch = deepClone(patch);
  } else {
    runtimeRulePatch = {};
  }
  runtimeRulesHydrated = true;
  lastPersistMeta = {
    available: meta.available ?? lastPersistMeta.available,
    path: meta.path ?? lastPersistMeta.path,
    exists: meta.exists ?? Boolean(Object.keys(runtimeRulePatch).length),
    updated_at: meta.updated_at ?? lastPersistMeta.updated_at,
    error: meta.error ?? null
  };
  return getRuntimeRulePatch();
}

export function setRulesPersistMeta(meta = {}) {
  lastPersistMeta = {
    ...lastPersistMeta,
    ...meta
  };
  return getRulesPersistMeta();
}

export function updateRuntimeFilterRules(patch = {}, options = {}) {
  if (options.reset === true) {
    runtimeRulePatch = {};
    runtimeRulesHydrated = true;
    if (options.persistMeta) {
      lastPersistMeta = { ...lastPersistMeta, ...options.persistMeta, exists: false };
    }
    return getActiveFilterRules();
  }

  if (!isPlainObject(patch)) {
    throw new TypeError('Filter rules patch must be a JSON object');
  }

  // replace: true 时整体替换运行时补丁，否则 deepMerge
  if (options.replace === true) {
    runtimeRulePatch = normalizeRequestRuleOverrides(patch);
  } else {
    runtimeRulePatch = deepMerge(runtimeRulePatch, normalizeRequestRuleOverrides(patch));
  }
  runtimeRulesHydrated = true;
  if (options.persistMeta) {
    lastPersistMeta = { ...lastPersistMeta, ...options.persistMeta, exists: true };
  }
  return getActiveFilterRules();
}

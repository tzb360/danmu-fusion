import { simplized } from '../utils/zh-util.js';

const SOURCE_HINTS = [
  ['bilibili', /bilibili|bili|哔哩|嗶哩|b站|b23/i],
  ['tencent', /tencent|qq|v\.qq|腾讯|騰訊/i],
  ['iqiyi', /iqiyi|qiyi|爱奇艺|愛奇藝/i],
  ['youku', /youku|优酷|優酷/i],
  ['mango', /mango|imgo|mgtv|芒果/i],
  ['dandan', /dandan|弹弹|彈彈/i],
  ['ass', /\.ass$|ass/i],
  ['xml', /\.xml$|xml/i],
  ['json', /\.json$|json/i],
  ['user', /upload|user|用户|用戶/i]
];

function decodeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeContent(value) {
  return decodeText(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBase64(value) {
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(value)));
    }
  } catch (error) {
    return value;
  }
  return value;
}

function inferSourceName(source = {}, fallback = 'unknown') {
  const explicitSource = source.source || source.sourceName || source.platform;
  if (explicitSource) return String(explicitSource);

  const candidates = [
    source.name,
    source.fileName,
    source.filename,
    source.type,
    source.format
  ].filter(Boolean).join(' ');

  for (const [name, regex] of SOURCE_HINTS) {
    if (regex.test(candidates)) return name;
  }

  return source.source || source.platform || fallback;
}

function inferFormat(source = {}, payload = '') {
  if (source.format) return String(source.format).toLowerCase();
  if (source.type && ['xml', 'json', 'ass'].includes(String(source.type).toLowerCase())) {
    return String(source.type).toLowerCase();
  }

  const fileName = String(source.fileName || source.filename || source.name || '').toLowerCase();
  if (fileName.endsWith('.ass')) return 'ass';
  if (fileName.endsWith('.xml')) return 'xml';
  if (fileName.endsWith('.json')) return 'json';

  if (typeof payload !== 'string') return 'json';
  const trimmed = payload.trim();
  if (!trimmed) return 'json';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  if (/^\s*(?:\[Script Info\]|Dialogue:)/i.test(trimmed)) return 'ass';
  return 'text';
}

function parseTimeValue(value, assumeMilliseconds = false) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const assMatch = trimmed.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (assMatch) {
      const [, h, m, s, frac = '0'] = assMatch;
      return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac.padEnd(3, '0')}`);
    }
    const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (colonMatch) {
      if (colonMatch[3]) return Number(colonMatch[1]) * 3600 + Number(colonMatch[2]) * 60 + Number(colonMatch[3]);
      return Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
    }
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (assumeMilliseconds || numeric > 6 * 60 * 60) return numeric / 1000;
  return numeric;
}

function parseColor(value) {
  if (value === null || value === undefined || value === '') return 16777215;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(16777215, Math.round(value)));
  }

  const raw = String(value).trim();
  if (/^\[.*\]$/.test(raw)) return 16777215;
  if (/^#[0-9a-f]{6}$/i.test(raw)) return parseInt(raw.slice(1), 16);
  if (/^0x[0-9a-f]{6}$/i.test(raw)) return parseInt(raw.slice(2), 16);
  if (/^[0-9a-f]{6}$/i.test(raw)) return parseInt(raw, 16);

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(16777215, Math.round(numeric)));
  return 16777215;
}

function normalizePosition(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw === '4' || raw.includes('bottom') || raw.includes('下') || raw.includes('btm')) return 'bottom';
  if (raw === '5' || raw.includes('top') || raw.includes('上')) return 'top';
  if (raw === '6' || raw.includes('reverse')) return 'reverse';
  return 'scroll';
}

function extractSourceFromP(pValue) {
  const match = String(pValue || '').match(/\[([^\]]+)\]\s*$/);
  return match ? match[1].trim() : '';
}

function parsePFields(pValue) {
  const parts = String(pValue || '').split(',');
  const time = parseTimeValue(parts[0]);
  const mode = parts[1] || '1';
  let color = 16777215;

  if (parts.length >= 8) {
    color = parseColor(parts[3]);
  } else if (parts.length >= 3) {
    color = parseColor(parts[2]);
  }

  return {
    time,
    color,
    position: normalizePosition(mode),
    source: extractSourceFromP(pValue)
  };
}

function buildStandardDanmaku(raw, context = {}) {
  if (!raw || typeof raw !== 'object') return null;

  let parsedP = null;
  if (typeof raw.p === 'string') parsedP = parsePFields(raw.p);

  const progressValue = raw.progress ?? raw.vpos;
  const time = parsedP?.time
    ?? parseTimeValue(raw.time ?? raw.timepoint ?? raw.t ?? raw.ts ?? raw.start)
    ?? parseTimeValue(progressValue, progressValue !== undefined)
    ?? 0;

  const content = normalizeContent(
    raw.content ?? raw.text ?? raw.m ?? raw.message ?? raw.comment ?? raw.body ?? raw.value
  );
  if (!content) return null;

  const explicitSource = raw.source ?? raw.sourceName ?? raw.platform ?? raw._sourceLabel ?? raw.type;
  const source = explicitSource || parsedP?.source || context.source || 'unknown';

  return {
    id: raw.id ?? raw.cid ?? raw.dmid ?? raw.danmakuId ?? null,
    time: Number(time.toFixed(3)),
    timestamp: Number(time.toFixed(3)),
    content: simplized(content),
    color: parseColor(raw.color ?? parsedP?.color),
    position: normalizePosition(raw.position ?? raw.mode ?? raw.ct ?? parsedP?.position),
    source,
    episode: raw.episode ?? context.episode ?? null,
    status: raw.status || 'active'
  };
}

function parseJsonPayload(payload, context) {
  let data = payload;
  if (typeof payload === 'string') {
    data = JSON.parse(payload);
  }

  if (Array.isArray(data)) {
    return data.flatMap((item) => parseJsonItem(item, context)).filter(Boolean);
  }

  if (data && typeof data === 'object') {
    const source = inferSourceName(data, context.source);
    const nextContext = { ...context, source, episode: data.episode ?? context.episode };
    const list = data.comments ?? data.danmaku ?? data.danmuku ?? data.danmakus ?? data.items ?? data.data ?? data.result;
    if (Array.isArray(list)) {
      return list.flatMap((item) => parseJsonItem(item, nextContext)).filter(Boolean);
    }
    const one = buildStandardDanmaku(data, nextContext);
    return one ? [one] : [];
  }

  return [];
}

function parseJsonItem(item, context) {
  if (Array.isArray(item)) {
    const [time, position, color, , content] = item;
    return buildStandardDanmaku({ time, position, color, content }, context);
  }
  return buildStandardDanmaku(item, context);
}

function parseXmlPayload(payload, context) {
  const text = String(payload || '');
  const items = [];
  const regex = /<d\b([^>]*)>([\s\S]*?)<\/d>/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const attrs = {};
    const attrRegex = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = decodeText(attrMatch[2] ?? attrMatch[3] ?? '');
    }
    const parsedP = parsePFields(attrs.p || '');
    items.push(buildStandardDanmaku({
      p: attrs.p,
      time: parsedP.time,
      mode: attrs.mode,
      color: parsedP.color,
      content: match[2],
      source: parsedP.source || attrs.source
    }, context));
  }

  return items.filter(Boolean);
}

function stripAssText(text) {
  return normalizeContent(
    String(text || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[nNh]/g, ' ')
  );
}

function parseAssPayload(payload, context) {
  const lines = String(payload || '').split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    if (!/^Dialogue:/i.test(line)) continue;
    const body = line.replace(/^Dialogue:\s*/i, '');
    const parts = body.split(',');
    if (parts.length < 10) continue;

    const start = parts[1];
    const style = parts[3] || '';
    const effect = parts[8] || '';
    const text = parts.slice(9).join(',');
    const strippedText = stripAssText(text);
    const positionHint = /\\an[789]/i.test(text) || /top/i.test(style) ? 'top'
      : /\\an[123]/i.test(text) || /bottom/i.test(style) ? 'bottom'
      : effect;

    items.push(buildStandardDanmaku({
      time: parseTimeValue(start),
      position: positionHint,
      content: strippedText
    }, context));
  }

  return items.filter(Boolean);
}

function normalizeSourcePayload(source) {
  if (typeof source === 'string' || Array.isArray(source)) {
    return { payload: source, meta: {} };
  }

  if (!source || typeof source !== 'object') {
    return { payload: null, meta: {} };
  }

  const payload = source.content ?? source.text ?? source.body ?? source.data ?? source.comments
    ?? source.danmaku ?? source.danmuku ?? source.items ?? source.result ?? source;
  return { payload, meta: source };
}

export function parseDanmakuSources(sources = [], options = {}) {
  if (!Array.isArray(sources)) {
    throw new TypeError('sources must be an array');
  }

  const items = [];
  const warnings = [];
  const sourceStats = {};

  sources.forEach((sourceInput, index) => {
    const { payload: rawPayload, meta } = normalizeSourcePayload(sourceInput);
    const sourceName = inferSourceName(meta, `source_${index + 1}`);
    const episode = meta.episode ?? options.episode ?? null;
    const context = { source: sourceName, episode };
    let payload = rawPayload;

    if (meta.encoding === 'base64' && typeof payload === 'string') {
      payload = decodeBase64(payload);
    }

    const format = inferFormat(meta, payload);
    let parsed = [];

    try {
      if (format === 'xml') parsed = parseXmlPayload(payload, context);
      else if (format === 'ass') parsed = parseAssPayload(payload, context);
      else if (format === 'json') parsed = parseJsonPayload(payload, context);
      else parsed = parseJsonPayload([{ time: 0, content: String(payload || '') }], context);
    } catch (error) {
      warnings.push({ source: sourceName, index, message: error.message });
      parsed = [];
    }

    const offset = Number(meta.offset ?? meta.timeOffset ?? meta.time_offset ?? 0);
    if (Number.isFinite(offset) && offset !== 0) {
      parsed = parsed.map(item => {
        const shiftedTime = Math.max(0, Number((item.time + offset).toFixed(3)));
        return { ...item, time: shiftedTime, timestamp: shiftedTime };
      });
    }

    parsed.forEach(item => {
      const normalizedItem = {
        ...item,
        id: item.id || `${item.source || sourceName}-${items.length + 1}`
      };
      items.push(normalizedItem);
      sourceStats[normalizedItem.source] = (sourceStats[normalizedItem.source] || 0) + 1;
    });
  });

  return {
    items: items.sort((a, b) => a.time - b.time),
    sourceStats,
    warnings
  };
}

/**
 * 转为弹弹兼容评论
 * @param {object} item
 * @param {{ includeSource?: boolean }} [options]
 *   includeSource=true（默认）：p 末尾带 [source]，供内部统计/调试
 *   includeSource=false：播放器纯净格式，无来源标签
 */
export function toDandanComment(item, options = {}) {
  const includeSource = options.includeSource !== false;
  const mode = item.position === 'top' ? 5 : item.position === 'bottom' ? 4 : item.position === 'reverse' ? 6 : 1;
  const time = Number(item.time || 0).toFixed(2);
  const color = parseColor(item.color);
  const p = includeSource
    ? `${time},${mode},${color},[${item.source || 'unknown'}]`
    : `${time},${mode},${color}`;
  const out = {
    id: item.id,
    p,
    m: item.content,
    t: Number(item.time || 0),
    status: item.status || 'active',
    quality_score: item.quality_score
  };
  // 内部保留 source 字段（对象属性），但播放器序列化时应剥离
  if (item.source) out._source = item.source;
  return out;
}

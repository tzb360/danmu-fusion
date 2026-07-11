/**
 * Forward 播放器输出格式转换
 * - 播放器可见：纯净弹幕（无来源标签）
 * - 内部/后台：可保留 source 用于统计
 *
 * 参考 ForwardWidgets 弹幕约定（dandan 兼容）：
 * { count, comments: [{ p, m, cid? }] }
 * p 字段：时间,模式,颜色[,可选标记]
 * 不在 p 末尾附带 [source] 平台名，避免 UI 显示【renren】等
 */

/**
 * 去掉剧集/动画标题中的来源装饰
 * 例如：【renren】第10集 → 第10集
 *       流浪地球 from migu 第1集 → 流浪地球 第1集
 */
export function sanitizePlayerTitle(title) {
  if (title == null) return '';
  let t = String(title);
  // 【source】 / [source] 包裹
  t = t.replace(/【\s*[^】]{0,40}\s*】/g, ' ');
  t = t.replace(/\[\s*[^\]]{0,40}\s*\]/g, ' ');
  // from xxx 来源后缀
  t = t.replace(/\s*from\s+[\w\u4e00-\u9fa5.&＆-]+\s*/gi, ' ');
  // 标题中残留的纯平台名装饰（前后有空白）
  t = t.replace(/\s+(?:renren|hanjutv|bilibili|tencent|iqiyi|youku|imgo|migu|dandan|animeko|bahamut|qq|qiyi)\s+/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 从 p 属性剥离末尾来源段 [xxx] / 【xxx】
 * 保留 time,mode,color（及 bilibili 8 字段中的前几项）
 */
export function stripSourceFromP(pValue) {
  if (pValue == null) return '';
  let p = String(pValue).trim();
  // 去掉末尾 [platform] 或 【platform】
  p = p.replace(/,?\s*[\[【][^\]】]*[\]】]\s*$/u, '');
  // 旧 4 字段：time,mode,color,platform(无括号)
  const parts = p.split(',').map(s => s.trim()).filter(s => s !== '');
  if (parts.length === 4) {
    const last = parts[3];
    // 若第四段不像颜色数字，视为平台名
    if (!/^\d+$/.test(last) && !/^#?[0-9a-fA-F]{6}$/.test(last)) {
      return parts.slice(0, 3).join(',');
    }
  }
  // 标准 8 字段 bilibili 不带平台名，原样返回
  return parts.join(',');
}

/**
 * 单条弹幕转为播放器可见格式（无 source 展示）
 */
export function toPlayerComment(comment, index = 0) {
  if (!comment || typeof comment !== 'object') return null;

  const content = comment.m ?? comment.content ?? comment.text ?? '';
  if (!content) return null;

  let p = comment.p;
  if (!p && (comment.time != null || comment.t != null)) {
    const time = Number(comment.time ?? comment.t ?? 0).toFixed(2);
    const mode = comment.position === 'top' ? 5 : comment.position === 'bottom' ? 4 : 1;
    const color = comment.color != null ? comment.color : 16777215;
    p = `${time},${mode},${color}`;
  }

  p = stripSourceFromP(p);

  // 确保至少 time,mode,color
  const parts = String(p).split(',');
  if (parts.length < 3) {
    const time = parts[0] || '0.00';
    const mode = parts[1] || '1';
    const color = parts[2] || '16777215';
    p = `${time},${mode},${color}`;
  } else if (parts.length > 3) {
    // 播放器输出只保留前 3 段，避免第 4 段被当成来源
    // 若已是 bilibili 8 字段，保留完整 8 字段（无来源名）
    if (parts.length < 8) {
      p = parts.slice(0, 3).join(',');
    }
  }

  const out = {
    p,
    m: String(content),
    cid: comment.cid ?? comment.id ?? index + 1
  };
  if (comment.t != null) out.t = comment.t;
  // 不向播放器输出 source / provider / _sourceLabel
  return out;
}

/**
 * 批量转为播放器弹幕列表
 */
export function toPlayerComments(comments = []) {
  if (!Array.isArray(comments)) return [];
  const result = [];
  for (let i = 0; i < comments.length; i++) {
    const c = toPlayerComment(comments[i], i);
    if (c) result.push(c);
  }
  return result;
}

/** 白色 decimal */
export const PLAYER_WHITE_COLOR = '16777215';
/** 顶部滚动 mode（dandan/bilibili 惯例 1=滚动，5=顶部；需求：统一顶部滚动 → 用 1 滚动） */
export const PLAYER_SCROLL_MODE = '1';

/**
 * Forward 专用：颜色转白 / 模式统一滚动
 * 在服务端聚合清洗之后执行，模块不再二次猜测
 * @param {Array} comments
 * @param {{ colorToWhite?: boolean, forceScroll?: boolean }} opts
 */
export function applyPlayerPresentation(comments = [], opts = {}) {
  const colorToWhite = opts.colorToWhite !== false; // 默认开
  const forceScroll = opts.forceScroll !== false;   // 默认开
  if (!Array.isArray(comments) || (!colorToWhite && !forceScroll)) {
    return comments;
  }
  return comments.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const parts = String(c.p || '').split(',').map((s) => s.trim());
    while (parts.length < 3) parts.push(parts.length === 2 ? PLAYER_WHITE_COLOR : '0');
    if (forceScroll) {
      // mode 在 index 1
      parts[1] = PLAYER_SCROLL_MODE;
    }
    if (colorToWhite) {
      // color 在 index 2
      parts[2] = PLAYER_WHITE_COLOR;
    }
    return { ...c, p: parts.join(',') };
  });
}

/**
 * Forward 标准 JSON 响应体（dandan 兼容，无来源展示）
 * @param {object} options
 * @param {Array} options.comments - 内部评论（可含 source）
 * @param {boolean} [options.includeMeta=false] - 是否附加 meta（默认 false，播放器纯净）
 * @param {object} [options.meta] - 管理用元数据
 * @param {boolean} [options.colorToWhite=true]
 * @param {boolean} [options.forceScroll=true]
 */
export function buildForwardDanmakuPayload({
  comments = [],
  includeMeta = false,
  meta = null,
  colorToWhite = true,
  forceScroll = true
} = {}) {
  let clean = toPlayerComments(comments);
  clean = applyPlayerPresentation(clean, { colorToWhite, forceScroll });
  const payload = {
    count: clean.length,
    comments: clean
  };
  if (includeMeta && meta) {
    payload.meta = meta;
  }
  return payload;
}

/**
 * 生成播放器用 XML（Bilibili 8 字段，无来源标签）
 */
export function toPlayerXml(comments = []) {
  const clean = toPlayerComments(comments);
  let xml = '<?xml version="1.0" ?>\n<i>\n';
  for (const comment of clean) {
    const pValues = String(comment.p || '').split(',');
    const time = (parseFloat(pValues[0]) || 0).toFixed(1);
    const mode = pValues[1] || '1';
    const color = pValues[2] || '16777215';
    const fontSize = '25';
    const timestamp = '1751533608';
    const pool = '0';
    const userHash = '0';
    const danmuId = String(Date.now() % 100000000).padStart(8, '0')
      + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const p = `${time},${mode},${fontSize},${color},${timestamp},${pool},${userHash},${danmuId}`;
    const text = escapeXml(comment.m);
    xml += `    <d p="${escapeXmlAttr(p)}">${text}</d>\n`;
  }
  xml += '</i>';
  return xml;
}

/**
 * 简易 ASS 输出（无 Style 中的来源信息，Dialogue 文本纯净）
 */
export function toPlayerAss(comments = []) {
  const clean = toPlayerComments(comments);
  const header = `[Script Info]
Title: Aggregated Danmaku
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,sans-serif,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = clean.map((c) => {
    const t = Number(String(c.p || '0').split(',')[0]) || 0;
    const start = formatAssTime(t);
    const end = formatAssTime(t + 5);
    const text = String(c.m || '').replace(/\n/g, ' ').replace(/,/g, '，');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return header + lines.join('\n') + '\n';
}

function formatAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const cs = Math.floor((sec - whole) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(str) {
  return escapeXml(str).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 净化 anime/episode 列表标题（Forward 列表展示用）
 */
export function sanitizeEpisodeList(episodes = []) {
  if (!Array.isArray(episodes)) return [];
  return episodes.map((ep, index) => ({
    ...ep,
    episodeTitle: sanitizePlayerTitle(ep.episodeTitle || ep.title || `第${index + 1}集`),
    title: ep.title != null ? sanitizePlayerTitle(ep.title) : ep.title
  }));
}

export function sanitizeAnimeList(animes = []) {
  if (!Array.isArray(animes)) return [];
  return animes.map((a) => ({
    ...a,
    animeTitle: sanitizePlayerTitle(a.animeTitle || a.title || ''),
    title: a.title != null ? sanitizePlayerTitle(a.title) : a.title
  }));
}

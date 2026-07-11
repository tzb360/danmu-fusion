/**
 * 内容消歧：排除同名但非正片的干扰项
 * - 综艺 / 赏析 / 幕后纪实 / 舞蹈翻拍 等
 * - 标题仅「包含」关键词但主体是另一节目
 * - 查询类型与结果类型明显冲突（电影 vs 综艺）
 */

/** 标题噪声：出现则大概率非用户观看的正片 */
const INTERFERENCE_TITLE_RES = [
  /赏析/,
  /幕后/,
  /纪实/,
  /花絮/,
  /特辑/,
  /看点/,
  /解读/,
  /影评/,
  /观影/,
  /预告/,
  /trailer/i,
  /making\s*of/i,
  /behind\s*the\s*scenes/i,
  /广场舞蹈/,
  /时光印记/,
  /探究吧/,
  /配音教学/,
  /剪辑教程/,
  /混剪/,
  /反应视频/,
  /reaction/i,
  /解说版/,
  /高能名场面/,
  /片段合集/,
  /主题曲/,
  /片尾曲/,
  /演唱会/,
  /音乐会/,
  /交响/
];

const VARIETY_TYPE_RES = [/综艺/, /真人秀/, /variety/i, /脱口秀/];
const DOCUMENTARY_TYPE_RES = [/纪录片/, /documentary/i];
const MOVIE_TYPE_RES = [/电影/, /剧场版/, /movie/i, /film/i];
const TV_TYPE_RES = [/电视剧/, /剧集/, /美剧/, /英剧/, /韩剧/, /日剧/, /tv/i, /series/i];
const ANIME_TYPE_RES = [/动漫/, /动画/, /日番/, /国创/, /anime/i];

function normalizeQueryType(type) {
  const t = String(type || '').toLowerCase().trim();
  if (!t) return 'unknown';
  if (['movie', 'movies', 'film', '电影', '动画电影', '剧场版', '华语电影', '欧美电影'].some(k => t.includes(k.toLowerCase()) || t === k)) {
    return 'movie';
  }
  if (['综艺', 'variety', '真人秀'].some(k => t.includes(k.toLowerCase()))) return 'variety';
  if (['纪录片', 'documentary'].some(k => t.includes(k.toLowerCase()))) return 'documentary';
  if (['tv', '电视剧', '剧集', 'tvseries', 'show'].some(k => t === k || t.includes(k))) return 'tv';
  if (['动漫', '动画', 'anime', '日番'].some(k => t.includes(k))) return 'anime';
  return t;
}

export function stripTitleDecorations(title) {
  let t = String(title || '');
  t = t.replace(/【[^】]*】/g, ' ');
  t = t.replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\s*from\s+[\w.-]+/gi, ' ');
  t = t.replace(/\(\d{4}\)/g, ' ');
  t = t.replace(/（\d{4}）/g, ' ');
  t = t.replace(/第\s*[0-9一二三四五六七八九十百千万]+\s*[季期部].*$/u, ' ');
  t = t.replace(/S(?:eason)?\s*\d+.*$/i, ' ');
  t = t.replace(/[（(](?:美版|英版|日版|韩版|国语|粤语|中配|台配)[）)]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function isInterferenceTitle(title) {
  const t = String(title || '');
  return INTERFERENCE_TITLE_RES.some((re) => re.test(t));
}

export function isVarietyType(type) {
  const t = String(type || '');
  return VARIETY_TYPE_RES.some((re) => re.test(t));
}

export function isMovieType(type) {
  const t = String(type || '');
  return MOVIE_TYPE_RES.some((re) => re.test(t));
}

export function isTvType(type) {
  const t = String(type || '');
  return TV_TYPE_RES.some((re) => re.test(t)) || ANIME_TYPE_RES.some((re) => re.test(t));
}

/**
 * 查询词是否作为「主标题」出现（而非节目名里的引用片段）
 * 允许：我和我的祖国 / 我和我的祖国 国语
 * 拒绝：时光印记-我和我的祖国 / 电影赏析《我和我的祖国》/ 炫舞…｜我和我的祖国-xxx
 */
export function isPrimaryTitleMatch(animeTitle, queryTitle) {
  if (!queryTitle) return true;
  const base = stripTitleDecorations(animeTitle).toLowerCase();
  const q = stripTitleDecorations(queryTitle).toLowerCase();
  if (!base || !q) return false;

  if (base === q) return true;

  // 书名号内等于查询词：《我和我的祖国》xxx → 若前缀是赏析/幕后则已在噪声过滤
  const book = base.match(/[《「]([^》」]+)[》」]/);
  if (book && book[1].trim() === q) {
    // 仅当整标题几乎就是书名或「正片名」时通过
    const withoutBook = base.replace(/[《「][^》」]+[》」]/, '').trim();
    if (!withoutBook || /^(电影|正片|高清|国语|粤语)?$/.test(withoutBook)) return true;
    // 「电影赏析《…》」withoutBook=电影赏析 → false
    if (/赏析|幕后|纪实|解读|影评/.test(withoutBook)) return false;
  }

  const idx = base.indexOf(q);
  if (idx === -1) return false;

  if (idx === 0) {
    const rest = base.slice(q.length).trim();
    // 后缀仅版本/格式词
    if (!rest) return true;
    if (/^(美版|英版|国语|粤语|加长版|重映|修复版|4k|hdr|蓝光)?$/i.test(rest)) return true;
    // 后缀过长 → 另一部作品
    return rest.length <= 4;
  }

  // 前缀存在：仅允许极短分隔，不允许「时光印记-」「炫舞未来…｜」
  const prefix = base.slice(0, idx).replace(/[\s\-_—–|｜·:：,，.。]/g, '');
  if (prefix.length === 0) return true;
  // 任何有意义前缀都视为非主标题
  return false;
}

/**
 * 类型是否与查询意图冲突
 */
export function isTypeConflict(queryType, resultType) {
  const qt = normalizeQueryType(queryType);
  const rt = String(resultType || '');
  if (qt === 'unknown' || !rt) return false;

  if (qt === 'movie') {
    if (isVarietyType(rt)) return true;
    if (DOCUMENTARY_TYPE_RES.some((re) => re.test(rt)) && !isMovieType(rt)) return true;
    // 动漫/探究类节目
    if (ANIME_TYPE_RES.some((re) => re.test(rt)) && !/剧场版|电影/.test(rt)) return true;
  }
  if (qt === 'tv') {
    if (isVarietyType(rt)) return true;
  }
  if (qt === 'variety') {
    // 综艺查询不排斥
    return false;
  }
  return false;
}

/**
 * 综合打分：越高越像正片；-1 表示应丢弃
 */
export function scoreContentCandidate(anime, query = {}) {
  const title = anime?.animeTitle || anime?.title || '';
  const type = anime?.type || anime?.typeDescription || '';
  const qTitle = query.title || query.keyword || '';
  const qType = query.type || 'unknown';
  const qYear = query.year ? String(query.year).match(/(19|20)\d{2}/)?.[0] : null;

  if (isInterferenceTitle(title)) {
    return { score: -1, reason: 'interference_title' };
  }
  if (isTypeConflict(qType, type)) {
    return { score: -1, reason: 'type_conflict' };
  }
  if (qTitle && !isPrimaryTitleMatch(title, qTitle)) {
    // 非主标题：直接丢弃（时光印记-xxx、舞蹈|xxx）
    return { score: -1, reason: 'not_primary_title' };
  }

  let score = 50;

  // 类型契合
  const qt = normalizeQueryType(qType);
  if (qt === 'movie' && isMovieType(type)) score += 40;
  if (qt === 'tv' && isTvType(type)) score += 40;
  if (qt === 'movie' && isVarietyType(type)) score -= 80;

  // 年份
  const y = String(anime?.startDate || title).match(/(19|20)\d{2}/)?.[0];
  if (qYear && y) {
    if (y === qYear) score += 35;
    else score -= 25; // 同年份优先，不同年份降权（不直接丢，留给无年份查询）
  }

  // 标题越短越像正片主条目
  const base = stripTitleDecorations(title);
  if (base && qTitle && stripTitleDecorations(qTitle).length > 0) {
    const q = stripTitleDecorations(qTitle);
    if (base === q) score += 30;
    else if (base.length > q.length + 8) score -= 15;
  }

  return { score, reason: 'ok', year: y || null };
}

/**
 * 过滤并按分数排序候选
 * @returns {{ kept: Array, rejected: Array, steps: Array }}
 */
export function filterContentCandidates(animes = [], query = {}) {
  const kept = [];
  const rejected = [];
  const steps = [];

  for (const a of animes || []) {
    const r = scoreContentCandidate(a, query);
    if (r.score < 0) {
      rejected.push({
        title: a.animeTitle || a.title,
        type: a.type,
        reason: r.reason,
        animeId: a.animeId
      });
    } else {
      kept.push({ ...a, _content_score: r.score });
    }
  }

  kept.sort((a, b) => (b._content_score || 0) - (a._content_score || 0));

  // 若有高分正片，丢掉分数明显更低的尾巴（防止混入边缘项）
  if (kept.length > 1) {
    const top = kept[0]._content_score || 0;
    const strong = kept.filter((a) => (a._content_score || 0) >= top - 30);
    if (strong.length && strong.length < kept.length) {
      for (const a of kept.slice(strong.length)) {
        rejected.push({
          title: a.animeTitle,
          type: a.type,
          reason: 'low_score_vs_top',
          animeId: a.animeId
        });
      }
      steps.push({
        step: 'content_score_cut',
        top,
        before: kept.length,
        after: strong.length
      });
      return {
        kept: strong,
        rejected,
        steps: [
          { step: 'content_filter', kept: strong.length, rejected: rejected.length },
          ...steps
        ]
      };
    }
  }

  steps.unshift({ step: 'content_filter', kept: kept.length, rejected: rejected.length });
  return { kept, rejected, steps };
}

/**
 * Node 联调：模拟 Forward 调用 DanmuFusion 弹幕模块 → 本地/指定 danmu_API
 * 用法：
 *   node forward-module/tzb360-danmu-fusion/test-danmu-fusion.mjs
 *   DANMU_API_URL=http://127.0.0.1:9321 node ...
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.DANMU_API_URL || 'http://127.0.0.1:9321').replace(/\/+$/, '');
const TIMEOUT = Number(process.env.TIMEOUT || 120000);

const storage = new Map();

const Widget = {
  http: {
    async get(url, options = {}) {
      const ctrl = new AbortController();
      const ms = options.timeout || TIMEOUT;
      const timer = setTimeout(() => ctrl.abort(), ms);
      try {
        const headers = Object.assign(
          { Accept: 'application/json', 'User-Agent': 'DanmuFusionDanmu-Test/1.0' },
          options.headers || {}
        );
        const res = await fetch(url, { headers, signal: ctrl.signal });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        // 模拟 Forward Widget.http.get 形状
        return { data, status: res.status, headers: Object.fromEntries(res.headers.entries()) };
      } finally {
        clearTimeout(timer);
      }
    }
  },
  storage: {
    get(k) {
      return storage.get(k);
    },
    set(k, v) {
      storage.set(k, v);
    }
  }
};

const code = fs.readFileSync(path.join(__dirname, 'danmu-fusion.js'), 'utf8');
const sandbox = {
  Widget,
  WidgetMetadata: undefined,
  console,
  setTimeout,
  clearTimeout,
  module: { exports: {} },
  exports: {}
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'danmu-fusion.js' });

const { searchDanmu, getDetailById, getCommentsById, WidgetMetadata } = sandbox;
// functions may be global on sandbox
const search = sandbox.searchDanmu || searchDanmu;
const detail = sandbox.getDetailById || getDetailById;
const comments = sandbox.getCommentsById || getCommentsById;
const meta = sandbox.WidgetMetadata || WidgetMetadata;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

async function main() {
  console.log('=== DanmuFusion Forward Module Test ===');
  console.log('API:', API);
  console.log('Module:', meta && meta.id, meta && meta.version, 'author=', meta && meta.author);

  assert(meta && meta.author === 'tzb360', 'author must be tzb360');
  assert(meta && meta.id === 'tzb360.danmu.fusion', 'module id');

  const baseParams = {
    danmu_api_url: API,
    timeout: String(TIMEOUT),
    retry: '1',
    cache: '1',
    debug: '1',
    type: 'tv',
    title: '鬼灭之刃',
    seriesName: '鬼灭之刃',
    year: '2019',
    season: '1',
    episode: '1',
    airDate: '2019-04-06'
  };

  // 1) search
  const t0 = Date.now();
  const sres = await search(baseParams);
  console.log('\n[searchDanmu]', Date.now() - t0, 'ms');
  console.log(JSON.stringify(sres, null, 2).slice(0, 500));
  assert(sres && Array.isArray(sres.animes) && sres.animes.length >= 1, 'search returns animes');
  const animeId = sres.animes[0].animeId;

  // 2) detail
  const dres = await detail(Object.assign({}, baseParams, { animeId }));
  console.log('\n[getDetailById] episodes=', Array.isArray(dres) ? dres.length : typeof dres);
  assert(Array.isArray(dres) && dres.length >= 1, 'detail returns episodes');

  // 3) comments first
  const t1 = Date.now();
  const cres = await comments(
    Object.assign({}, baseParams, {
      animeId,
      commentId: dres[0].episodeId
    })
  );
  const ms1 = Date.now() - t1;
  console.log('\n[getCommentsById first]', ms1, 'ms count=', cres && cres.count);

  assert(cres && Array.isArray(cres.comments), 'comments array');
  assert((cres.count || 0) > 0, 'expect danmaku count > 0 for 鬼灭 S1E1');

  const sample = cres.comments.slice(0, 3);
  console.log('sample', JSON.stringify(sample, null, 2));

  // purity
  let leak = 0;
  for (const c of cres.comments) {
    if (c.source != null || c.provider != null || c._sourceLabel != null) leak++;
    const blob = String(c.p || '') + String(c.m || '');
    if (/【\s*(renren|bilibili|tencent|youku|iqiyi)\s*】/i.test(blob)) leak++;
    if (/\[(renren|bilibili|tencent|youku|iqiyi)\]/i.test(String(c.p || ''))) leak++;
  }
  assert(leak === 0, 'source tags must not leak, leaks=' + leak);

  // style
  const p0 = String(cres.comments[0].p || '');
  assert(/^\d+(\.\d+)?,\d+,/.test(p0), 'p must start with time,mode,');
  assert(cres.comments[0].m, 'm content required');

  // 4) comments second (module cache)
  const t2 = Date.now();
  const cres2 = await comments(
    Object.assign({}, baseParams, {
      animeId,
      commentId: dres[0].episodeId
    })
  );
  const ms2 = Date.now() - t2;
  console.log('\n[getCommentsById second]', ms2, 'ms count=', cres2 && cres2.count);
  assert(cres2.count === cres.count, 'cache count stable');

  console.log('\n=== PASS ===');
  console.log(
    JSON.stringify(
      {
        module: meta.id,
        author: meta.author,
        version: meta.version,
        api: API,
        title: '鬼灭之刃',
        season: 1,
        episode: 1,
        first_ms: ms1,
        second_ms: ms2,
        count: cres.count,
        pure: true,
        multi_source_via_api: true
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});

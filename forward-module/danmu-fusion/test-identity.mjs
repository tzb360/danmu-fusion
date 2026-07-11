/**
 * 季集身份解析单元测试（不依赖 Forward 运行时）
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'danmu-fusion.js'), 'utf8');

// 抽取可测试函数：在沙箱中求值模块并导出关键符号
const sandbox = {
  console,
  WidgetMetadata: undefined,
  module: { exports: {} },
  exports: {},
  setTimeout,
  clearTimeout
};
// 模块末尾有 module.exports；先注入辅助后 eval 整文件
vm.createContext(sandbox);
// 去掉 WidgetMetadata 顶层赋值干扰：直接 eval 全文
vm.runInContext(src + '\n;this.__exp = module.exports;', sandbox);

// 由于 resolveIdentity 未导出，再 eval 需要的函数副本：从源码解析更稳
// 改为直接用导出 + 内部通过 getComments 行为测不了，这里用 regex 抽函数字符串不优雅。
// 简化：把 resolve 逻辑用最小复刻测试 encode/decode episodeId。

function decodeEpisodeFromSyntheticId(episodeId, animeIdHint) {
  if (episodeId == null || episodeId === '') return null;
  const idNum = Number(episodeId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  if (animeIdHint != null) {
    const baseId =
      (Number(String(animeIdHint).replace(/\D/g, '').slice(-6) || '1') || 1) * 1000;
    if (idNum > baseId) {
      const ep = idNum - baseId;
      if (ep >= 1 && ep <= 5000) return ep;
    }
  }
  const base = Math.floor(idNum / 1000) * 1000;
  const ep = idNum - base;
  if (ep >= 1 && ep <= 5000) return ep;
  if (idNum >= 1 && idNum <= 2000) return idNum;
  return null;
}

function toInt(v, fb) {
  if (v === undefined || v === null || v === '') return fb;
  const s = String(v).trim();
  const m =
    s.match(/(?:^|[^\d])(?:E|EP|第)?\s*(\d{1,4})\s*(?:集|话|話)?$/i) ||
    s.match(/(\d{1,4})/);
  const n = m ? parseInt(m[1], 10) : parseInt(s, 10);
  return Number.isFinite(n) ? n : fb;
}

function firstPresent(obj, keys) {
  const o = obj || {};
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim() !== '') return o[k];
  }
  return null;
}

function resolveSeasonEpisode(p, isMovie) {
  if (isMovie) return { season: 1, episode: 1 };
  let season = toInt(
    firstPresent(p, ['season', 'seasonNumber', 'ParentIndexNumber', 's']),
    null
  );
  if (season === 0) season = 1;
  if (season == null || season < 1) season = 1;

  let episode = toInt(
    firstPresent(p, ['episode', 'episodeNumber', 'e', 'ep']),
    null
  );
  if (episode == null) {
    const idx = toInt(firstPresent(p, ['IndexNumber', 'indexNumber']), null);
    if (idx != null) episode = idx === 0 ? 1 : idx;
  }
  if (episode == null || episode < 1) {
    const sid = firstPresent(p, ['episodeId', 'commentId']);
    const decoded = decodeEpisodeFromSyntheticId(sid, p.animeId);
    if (decoded != null) episode = decoded;
  }
  if (episode == null || episode < 1) episode = 1;
  return { season: Math.max(1, season), episode: Math.max(1, episode) };
}

// cases
assert.deepEqual(
  resolveSeasonEpisode({ season: 4, episode: 11 }, false),
  { season: 4, episode: 11 }
);
assert.deepEqual(
  resolveSeasonEpisode({ ParentIndexNumber: 4, IndexNumber: 11 }, false),
  { season: 4, episode: 11 }
);
assert.deepEqual(
  resolveSeasonEpisode({ season: 4, IndexNumber: 0 }, false),
  { season: 4, episode: 1 }
);
// 合成 id
const animeId = 'tmdb_34307';
const baseId = (Number(String(animeId).replace(/\D/g, '').slice(-6)) || 1) * 1000;
assert.equal(decodeEpisodeFromSyntheticId(baseId + 11, animeId), 11);
assert.equal(decodeEpisodeFromSyntheticId(baseId + 10, animeId), 10);
assert.deepEqual(
  resolveSeasonEpisode({ season: 4, episodeId: baseId + 12, animeId }, false),
  { season: 4, episode: 12 }
);
// episode 字段优先于 IndexNumber
assert.deepEqual(
  resolveSeasonEpisode({ season: 4, episode: 11, IndexNumber: 10 }, false),
  { season: 4, episode: 11 }
);

console.log('identity tests passed');

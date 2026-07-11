/**
 * Forward 适配模块入口
 * 仅参考 ForwardWidgets 的模块/数据约定，实现完全独立于该仓库
 */
export {
  sanitizePlayerTitle,
  stripSourceFromP,
  toPlayerComment,
  toPlayerComments,
  buildForwardDanmakuPayload,
  toPlayerXml,
  toPlayerAss,
  sanitizeEpisodeList,
  sanitizeAnimeList
} from './format.js';

export {
  parseForwardQuery,
  resolveForwardIdentity,
  getForwardDanmaku,
  adaptSearchAnimesForForward,
  adaptEpisodesForForward
} from './service.js';

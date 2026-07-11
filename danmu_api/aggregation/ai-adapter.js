import AIClient from '../utils/ai-util.js';
import { log } from '../utils/log-util.js';

/**
 * AI 弹幕增强适配器（可插拔，默认关闭，不依赖在线服务）
 * 当前主清洗链路为同步规则引擎；AI 用于可选的高级语义判断扩展点。
 */
export class DanmakuAIAdapter {
  constructor(config = {}) {
    this.config = config || {};
    this.enabled = config.enabled === true;
  }

  isAvailable() {
    return false;
  }

  getStatus() {
    return {
      enabled: this.enabled === true,
      available: this.isAvailable(),
      provider: this.config.provider || 'none',
      mode: 'disabled'
    };
  }

  async judgeGarbage() {
    return null;
  }

  async compareSimilarity() {
    return null;
  }

  async enhanceBatch() {
    return null;
  }
}

export class OpenAICompatibleDanmakuAIAdapter extends DanmakuAIAdapter {
  constructor(config = {}) {
    super(config);
    this.client = null;
    if (this.isAvailable() && config.api_key) {
      try {
        this.client = new AIClient({
          baseURL: config.base_url || 'https://api.openai.com/v1',
          model: config.model || 'gpt-4o',
          apiKey: config.api_key,
          systemPrompt: '你是弹幕质量判断助手，只返回 JSON，不要输出其它文字。'
        });
      } catch (error) {
        log('warn', `[DanmakuAI] init client failed: ${error.message}`);
        this.client = null;
      }
    }
  }

  isAvailable() {
    return this.enabled
      && ['openai', 'deepseek', 'local', 'openai_compatible'].includes(String(this.config.provider || '').toLowerCase())
      && Boolean(this.config.api_key);
  }

  getStatus() {
    return {
      enabled: this.enabled === true,
      available: this.isAvailable(),
      provider: this.config.provider || 'none',
      model: this.config.model || '',
      base_url: this.config.base_url || '',
      mode: this.isAvailable() ? 'openai_compatible' : 'unavailable',
      has_api_key: Boolean(this.config.api_key)
    };
  }

  async judgeGarbage(danmaku) {
    if (!this.client) return null;
    try {
      const prompt = JSON.stringify({
        task: 'judge_danmaku_garbage',
        danmaku: {
          content: danmaku?.content || danmaku?.m || '',
          time: danmaku?.time ?? danmaku?.t,
          source: danmaku?.source
        },
        output: { garbage: 'boolean', reason: 'string', confidence: 'number' }
      });
      const answer = await this.client.ask(prompt, { maxTokens: 160 });
      return this.#parseJsonAnswer(answer);
    } catch (error) {
      log('warn', `[DanmakuAI] judgeGarbage failed: ${error.message}`);
      return null;
    }
  }

  async compareSimilarity(a, b) {
    if (!this.client) return null;
    try {
      const prompt = JSON.stringify({
        task: 'compare_danmaku_similarity',
        a: a?.content || a?.m || a,
        b: b?.content || b?.m || b,
        output: { similar: 'boolean', score: 'number' }
      });
      const answer = await this.client.ask(prompt, { maxTokens: 120 });
      return this.#parseJsonAnswer(answer);
    } catch (error) {
      log('warn', `[DanmakuAI] compareSimilarity failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 批量增强入口（预留）：主链路暂不自动调用，避免阻塞实时弹幕
   */
  async enhanceBatch(items = [], task = 'judge_garbage') {
    if (!this.client || !Array.isArray(items) || !items.length) return null;
    const limited = items.slice(0, 20);
    try {
      const prompt = JSON.stringify({
        task,
        count: limited.length,
        danmaku: limited.map(item => ({
          id: item.id,
          content: item.content || item.m,
          time: item.time ?? item.t,
          source: item.source
        })),
        output: 'JSON array aligned with input order'
      });
      const answer = await this.client.ask(prompt, { maxTokens: 800 });
      return this.#parseJsonAnswer(answer);
    } catch (error) {
      log('warn', `[DanmakuAI] enhanceBatch failed: ${error.message}`);
      return null;
    }
  }

  #parseJsonAnswer(answer) {
    if (answer == null) return null;
    if (typeof answer === 'object') return answer;
    const text = String(answer).trim();
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) return { raw: text };
      try {
        return JSON.parse(match[0]);
      } catch {
        return { raw: text };
      }
    }
  }
}

export function createDanmakuAIAdapter(config = {}) {
  if (!config || config.enabled !== true) {
    return new DanmakuAIAdapter(config || {});
  }
  return new OpenAICompatibleDanmakuAIAdapter(config);
}

export function getDanmakuAIStatus(config = {}) {
  return createDanmakuAIAdapter(config).getStatus();
}

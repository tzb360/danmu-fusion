import { jsonResponse } from '../utils/http-util.js';
import { log } from '../utils/log-util.js';
import { globals } from '../configs/globals.js';
import { processDanmakuMerge } from '../aggregation/aggregator.js';
import {
  getActiveFilterRules,
  getDefaultFilterRules,
  getRuntimeRulePatch,
  getRulesPersistMeta,
  hydrateRuntimeRulePatch,
  setRulesPersistMeta,
  updateRuntimeFilterRules
} from '../aggregation/rules.js';
import {
  getProcessingStatistics,
  recordProcessingStatistics,
  resetProcessingStatistics
} from '../aggregation/statistics.js';
import { getDanmakuAIStatus } from '../aggregation/ai-adapter.js';

let persistHydratePromise = null;

async function ensurePersistedRulesLoaded() {
  if (persistHydratePromise) return persistHydratePromise;

  persistHydratePromise = (async () => {
    try {
      const persist = await import('../aggregation/rules-persist.js');
      const loaded = persist.loadPersistedRulePatch();
      if (loaded.error) {
        log('warn', `[DanmakuAggregation] load persisted rules failed: ${loaded.error}`);
      }
      if (loaded.available && loaded.patch && Object.keys(loaded.patch).length) {
        hydrateRuntimeRulePatch(loaded.patch, {
          available: true,
          path: loaded.path,
          exists: true,
          updated_at: loaded.updated_at || null,
          error: loaded.error || null
        });
        log('info', `[DanmakuAggregation] loaded persisted rules from ${loaded.path}`);
      } else {
        setRulesPersistMeta({
          available: loaded.available,
          path: loaded.path,
          exists: Boolean(loaded.exists),
          updated_at: loaded.updated_at || null,
          error: loaded.error || null
        });
      }
    } catch (error) {
      setRulesPersistMeta({ available: false, error: error.message });
      log('warn', `[DanmakuAggregation] rule persistence unavailable: ${error.message}`);
    }
  })();

  return persistHydratePromise;
}

async function persistRulesSafely(patch, { reset = false } = {}) {
  try {
    const persist = await import('../aggregation/rules-persist.js');
    if (reset) {
      const result = persist.clearPersistedRulePatch();
      setRulesPersistMeta({
        available: result.available,
        path: result.path,
        exists: false,
        updated_at: null,
        error: result.error || null
      });
      if (!result.success && result.error) {
        log('warn', `[DanmakuAggregation] clear persisted rules failed: ${result.error}`);
      }
      return result;
    }

    const result = persist.savePersistedRulePatch(patch);
    setRulesPersistMeta({
      available: result.available,
      path: result.path,
      exists: result.success,
      updated_at: result.updated_at || new Date().toISOString(),
      error: result.error || null
    });
    if (!result.success) {
      log('warn', `[DanmakuAggregation] persist rules failed: ${result.error || result.reason}`);
    } else {
      log('info', `[DanmakuAggregation] rules persisted to ${result.path}`);
    }
    return result;
  } catch (error) {
    setRulesPersistMeta({ available: false, error: error.message });
    log('warn', `[DanmakuAggregation] persist rules skipped: ${error.message}`);
    return { success: false, available: false, error: error.message };
  }
}

async function readJsonBody(req) {
  try {
    return await req.json();
  } catch (error) {
    throw new SyntaxError('Invalid JSON request body');
  }
}

function hasRuleWritePermission() {
  const adminToken = String(globals.adminToken || '').trim();
  if (!adminToken) return Boolean(globals.currentToken);
  return globals.currentToken === adminToken;
}

function forbiddenResponse() {
  return jsonResponse({
    errorCode: 403,
    success: false,
    errorMessage: 'Forbidden'
  }, 403);
}

function buildRulesResponseExtras() {
  const rules = getActiveFilterRules();
  return {
    persistence: getRulesPersistMeta(),
    ai: getDanmakuAIStatus(rules.ai || {})
  };
}

export async function handleDanmakuMerge(req) {
  try {
    await ensurePersistedRulesLoaded();
    const body = await readJsonBody(req);
    if (!Array.isArray(body.sources)) {
      return jsonResponse({
        errorCode: 400,
        success: false,
        errorMessage: 'sources must be an array'
      }, 400);
    }

    // 测试/调试时可强制返回过滤样本
    if (body.include_removed_samples === true) {
      body.rules = {
        ...(body.rules || {}),
        output: {
          include_removed_samples: true,
          removed_sample_limit: body.removed_sample_limit || 50,
          ...((body.rules && body.rules.output) || {})
        }
      };
    }

    const result = processDanmakuMerge(body);
    recordProcessingStatistics(result, { operation: 'merge' });
    log('info', `[DanmakuAggregation] merge completed: before=${result.total_before}, after=${result.total_after}, removed=${result.removed}, cost=${result.stats.processing_ms}ms`);
    return jsonResponse(result);
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    log(status >= 500 ? 'error' : 'warn', `[DanmakuAggregation] merge failed: ${error.message}`);
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message
    }, status);
  }
}

export async function handleDanmakuFilter(req) {
  try {
    await ensurePersistedRulesLoaded();
    const body = await readJsonBody(req);
    const sources = Array.isArray(body.sources)
      ? body.sources
      : [{
        source: body.source || 'filter',
        episode: body.episode ?? null,
        data: body.comments || body.danmaku || body.danmuku || body.items || body.data || []
      }];

    if (!Array.isArray(sources)) {
      return jsonResponse({
        errorCode: 400,
        success: false,
        errorMessage: 'sources or comments must be an array'
      }, 400);
    }

    if (body.include_removed_samples === true) {
      body.rules = {
        ...(body.rules || {}),
        output: {
          include_removed_samples: true,
          removed_sample_limit: body.removed_sample_limit || 50,
          ...((body.rules && body.rules.output) || {})
        }
      };
    }

    const result = processDanmakuMerge({
      ...body,
      sources,
      rules: {
        ...(body.rules || {}),
        timeline: { enabled: false, ...(body.rules?.timeline || {}) }
      }
    });
    recordProcessingStatistics(result, { operation: 'filter' });
    log('info', `[DanmakuAggregation] filter completed: before=${result.total_before}, after=${result.total_after}, removed=${result.removed}, cost=${result.stats.processing_ms}ms`);
    return jsonResponse(result);
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    log(status >= 500 ? 'error' : 'warn', `[DanmakuAggregation] filter failed: ${error.message}`);
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message
    }, status);
  }
}

export async function handleGetFilterRules() {
  await ensurePersistedRulesLoaded();
  return jsonResponse({
    rules: getActiveFilterRules(),
    runtime_patch: getRuntimeRulePatch(),
    defaults: getDefaultFilterRules(),
    ...buildRulesResponseExtras()
  });
}

export async function handlePutFilterRules(req, url) {
  try {
    await ensurePersistedRulesLoaded();
    if (!hasRuleWritePermission()) return forbiddenResponse();

    const body = await readJsonBody(req);
    const reset = url.searchParams.get('reset') === 'true' || body.reset === true;
    const patch = body.rules && typeof body.rules === 'object' ? body.rules : body;

    let rules;
    if (reset) {
      rules = updateRuntimeFilterRules({}, { reset: true });
      await persistRulesSafely({}, { reset: true });
    } else {
      rules = updateRuntimeFilterRules(patch, { replace: body.replace === true });
      await persistRulesSafely(getRuntimeRulePatch(), { reset: false });
    }

    log('info', `[DanmakuAggregation] filter rules ${reset ? 'reset' : 'updated'} (persisted)`);
    return jsonResponse({
      success: true,
      rules,
      runtime_patch: getRuntimeRulePatch(),
      ...buildRulesResponseExtras()
    });
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
    log(status >= 500 ? 'error' : 'warn', `[DanmakuAggregation] update rules failed: ${error.message}`);
    return jsonResponse({
      errorCode: status,
      success: false,
      errorMessage: error.message
    }, status);
  }
}

export async function handleGetDanmakuStatistics() {
  await ensurePersistedRulesLoaded();
  return jsonResponse({
    success: true,
    statistics: getProcessingStatistics()
  });
}

export async function handleResetDanmakuStatistics() {
  if (!hasRuleWritePermission()) return forbiddenResponse();
  return jsonResponse({
    success: true,
    statistics: resetProcessingStatistics()
  });
}

/**
 * 供 server.js 启动时主动加载持久化规则
 */
export async function bootstrapDanmakuRules() {
  await ensurePersistedRulesLoaded();
  return {
    runtime_patch: getRuntimeRulePatch(),
    persistence: getRulesPersistMeta()
  };
}

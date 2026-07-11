/**
 * 弹幕规则持久化（Node / Docker）
 * 写入 config/danmaku-filter-rules.json，挂载 config 卷后重启不丢失
 * 云函数 / Workers 无文件系统时自动降级为仅内存
 */
import fs from 'fs';
import path from 'path';

const DEFAULT_RELATIVE_PATH = path.join('config', 'danmaku-filter-rules.json');

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function getRulesPersistPath() {
  const custom = typeof process !== 'undefined' ? process.env.DANMAKU_RULES_PATH : '';
  if (custom && String(custom).trim()) {
    return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  }
  return path.join(process.cwd(), DEFAULT_RELATIVE_PATH);
}

export function isRulesPersistAvailable() {
  try {
    return typeof process !== 'undefined' && Boolean(process.versions?.node);
  } catch {
    return false;
  }
}

export function loadPersistedRulePatch() {
  if (!isRulesPersistAvailable()) return { available: false, patch: {}, path: null };

  const filePath = getRulesPersistPath();
  try {
    if (!fs.existsSync(filePath)) {
      return { available: true, patch: {}, path: filePath, exists: false };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) {
      return { available: true, patch: {}, path: filePath, exists: true };
    }

    const parsed = JSON.parse(raw);
    let patch = {};
    if (isPlainObject(parsed?.rules)) {
      patch = parsed.rules;
    } else if (isPlainObject(parsed)) {
      // 兼容直接存 patch 的旧格式
      const { version, updated_at, updatedAt, ...rest } = parsed;
      patch = rest.rules && isPlainObject(rest.rules) ? rest.rules : rest;
      if (patch.version && Object.keys(patch).length === 1) patch = {};
    }

    return {
      available: true,
      patch: isPlainObject(patch) ? patch : {},
      path: filePath,
      exists: true,
      updated_at: parsed?.updated_at || parsed?.updatedAt || null
    };
  } catch (error) {
    return {
      available: true,
      patch: {},
      path: filePath,
      exists: true,
      error: error.message
    };
  }
}

export function savePersistedRulePatch(patch = {}) {
  if (!isRulesPersistAvailable()) {
    return { success: false, available: false, reason: 'filesystem_unavailable' };
  }

  const filePath = getRulesPersistPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload = {
      version: 1,
      updated_at: new Date().toISOString(),
      rules: isPlainObject(patch) ? patch : {}
    };

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);

    return { success: true, available: true, path: filePath, updated_at: payload.updated_at };
  } catch (error) {
    return { success: false, available: true, path: filePath, error: error.message };
  }
}

export function clearPersistedRulePatch() {
  if (!isRulesPersistAvailable()) {
    return { success: false, available: false, reason: 'filesystem_unavailable' };
  }

  const filePath = getRulesPersistPath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true, available: true, path: filePath, cleared: true };
  } catch (error) {
    return { success: false, available: true, path: filePath, error: error.message };
  }
}

export function getPersistStatus() {
  const loaded = loadPersistedRulePatch();
  return {
    available: loaded.available,
    path: loaded.path,
    exists: Boolean(loaded.exists),
    updated_at: loaded.updated_at || null,
    error: loaded.error || null
  };
}

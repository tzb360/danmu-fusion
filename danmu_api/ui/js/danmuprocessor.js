// language=JavaScript
export const danmakuProcessorJsContent = /* javascript */ `
let danmakuRuleState = null;
let danmakuStatisticsTimer = null;
let lastOnlineTestResult = null;

function toKeywordList(value) {
    return String(value || '')
        .split(/\\n+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function fromKeywordList(value) {
    return Array.isArray(value) ? value.join('\\n') : '';
}

function setChecked(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = value === true;
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

function getNumber(id, fallback = 0) {
    const el = document.getElementById(id);
    const value = Number(el?.value);
    return Number.isFinite(value) ? value : fallback;
}

function getText(id, fallback = '') {
    const el = document.getElementById(id);
    return el ? String(el.value || '') : fallback;
}

function syncDanmakuRuleLabels() {
    const timeRange = getNumber('rule-time-range', 3);
    const mergeSimilar = getNumber('rule-merge-similar', 82);
    const duplicateSimilar = getNumber('rule-duplicate-similar', 82);
    const quality = getNumber('rule-quality-threshold', 35);

    const timeLabel = document.getElementById('rule-time-range-label');
    const mergeLabel = document.getElementById('rule-merge-similar-label');
    const duplicateLabel = document.getElementById('rule-duplicate-similar-label');
    const qualityLabel = document.getElementById('rule-quality-threshold-label');

    if (timeLabel) timeLabel.textContent = timeRange + 's';
    if (mergeLabel) mergeLabel.textContent = mergeSimilar + '%';
    if (duplicateLabel) duplicateLabel.textContent = duplicateSimilar + '%';
    if (qualityLabel) qualityLabel.textContent = String(quality);
}

function renderDanmakuRules(rules) {
    danmakuRuleState = rules;
    setChecked('rule-merge-enabled', rules.merge?.enabled !== false);
    setChecked('rule-timeline-enabled', rules.timeline?.enabled !== false);
    setValue('rule-time-range', rules.merge?.time_merge_range_seconds ?? rules.duplicate?.similar?.time_window_seconds ?? 3);
    setValue('rule-merge-similar', Math.round((rules.merge?.similar_threshold ?? 0.82) * 100));
    setValue('rule-merge-keep', rules.merge?.max_keep_per_cluster ?? 1);

    setChecked('rule-duplicate-enabled', rules.duplicate?.enabled !== false);
    setChecked('rule-garbage-enabled', rules.garbage_filter?.enabled !== false);
    setChecked('rule-timeline-hint-enabled', rules.garbage_filter?.timeline_hint !== false && rules.timeline_hint?.enabled !== false);
    setChecked('rule-ad-enabled', rules.garbage_filter?.advertisement !== false && rules.advertisement?.enabled !== false);
    setChecked('rule-spoiler-enabled', rules.garbage_filter?.spoiler === true || rules.spoiler?.enabled === true);
    setChecked('rule-quality-enabled', rules.garbage_filter?.quality_score !== false && rules.quality?.enabled !== false);
    setValue('rule-duplicate-similar', Math.round((rules.duplicate?.similar?.threshold ?? 0.82) * 100));
    setValue('rule-quality-threshold', rules.quality?.threshold ?? 35);
    setValue('rule-ad-keywords', fromKeywordList(rules.advertisement?.keywords));
    setValue('rule-custom-blacklist', fromKeywordList(rules.custom_blacklist?.keywords));
    setValue('rule-allowlist', fromKeywordList(rules.allowlist?.keywords));

    setChecked('rule-pipeline-enabled', rules.pipeline?.enabled !== false);
    setChecked('rule-ai-enabled', rules.ai?.enabled === true);
    setValue('rule-ai-provider', rules.ai?.provider || 'none');
    setValue('rule-ai-base-url', rules.ai?.base_url || '');
    setValue('rule-ai-model', rules.ai?.model || '');
    syncDanmakuRuleLabels();
}

function collectDanmakuRulesFromForm() {
    const mergeRange = getNumber('rule-time-range', 3);
    const mergeThreshold = getNumber('rule-merge-similar', 82) / 100;
    const duplicateThreshold = getNumber('rule-duplicate-similar', 82) / 100;
    const maxKeep = Math.max(1, Math.round(getNumber('rule-merge-keep', 1)));
    return {
        merge: {
            enabled: getChecked('rule-merge-enabled'),
            time_merge_range_seconds: mergeRange,
            similar_threshold: mergeThreshold,
            max_keep_per_cluster: maxKeep
        },
        timeline: {
            enabled: getChecked('rule-timeline-enabled')
        },
        duplicate: {
            enabled: getChecked('rule-duplicate-enabled'),
            exact: {
                enabled: getChecked('rule-duplicate-enabled'),
                time_window_seconds: Math.max(0.5, Math.min(mergeRange, 10))
            },
            similar: {
                enabled: getChecked('rule-duplicate-enabled'),
                threshold: duplicateThreshold,
                time_window_seconds: mergeRange
            },
            burst: {
                enabled: getChecked('rule-duplicate-enabled'),
                max_keep_per_window: maxKeep
            }
        },
        garbage_filter: {
            enabled: getChecked('rule-garbage-enabled'),
            advertisement: getChecked('rule-ad-enabled'),
            timeline_hint: getChecked('rule-timeline-hint-enabled'),
            custom_blacklist: true,
            spoiler: getChecked('rule-spoiler-enabled'),
            quality_score: getChecked('rule-quality-enabled')
        },
        advertisement: {
            enabled: getChecked('rule-ad-enabled'),
            keywords: toKeywordList(document.getElementById('rule-ad-keywords')?.value)
        },
        custom_blacklist: {
            enabled: true,
            keywords: toKeywordList(document.getElementById('rule-custom-blacklist')?.value)
        },
        allowlist: {
            enabled: true,
            keywords: toKeywordList(document.getElementById('rule-allowlist')?.value)
        },
        timeline_hint: {
            enabled: getChecked('rule-timeline-hint-enabled')
        },
        spoiler: {
            enabled: getChecked('rule-spoiler-enabled')
        },
        quality: {
            enabled: getChecked('rule-quality-enabled'),
            threshold: getNumber('rule-quality-threshold', 35)
        },
        pipeline: {
            enabled: getChecked('rule-pipeline-enabled'),
            timeline: false
        },
        ai: {
            enabled: getChecked('rule-ai-enabled'),
            provider: getText('rule-ai-provider', 'none') || 'none',
            base_url: getText('rule-ai-base-url', ''),
            model: getText('rule-ai-model', '')
        }
    };
}

function renderPersistAndAiStatus(data) {
    const persistEl = document.getElementById('danmaku-persist-status');
    const aiEl = document.getElementById('danmaku-ai-status');
    const persistence = data.persistence || {};
    const ai = data.ai || {};

    if (persistEl) {
        if (persistence.available === false) {
            persistEl.textContent = '规则持久化: 当前运行环境不支持写文件（云函数/Workers 仅内存生效，可用环境变量 DANMAKU_FILTER_RULES）';
        } else {
            const path = persistence.path || 'config/danmaku-filter-rules.json';
            const exists = persistence.exists ? '已落盘' : '尚未保存过自定义规则';
            const updated = persistence.updated_at ? ('，更新时间 ' + persistence.updated_at) : '';
            persistEl.textContent = '规则持久化: ' + exists + ' → ' + path + updated + '（Docker 请挂载 config 卷）';
        }
    }

    if (aiEl) {
        aiEl.textContent = 'AI 状态: enabled=' + Boolean(ai.enabled) + ', available=' + Boolean(ai.available) + ', provider=' + (ai.provider || 'none') + ', mode=' + (ai.mode || 'disabled');
    }
}

async function loadDanmakuRules() {
    const response = await fetch(buildApiUrl('/api/rules'));
    if (!response.ok) {
        throw new Error('规则加载失败: ' + response.status);
    }
    const data = await response.json();
    renderDanmakuRules(data.rules || {});
    renderPersistAndAiStatus(data);
    return data.rules || {};
}

async function saveDanmakuRules() {
    try {
        showLoading('正在保存规则...', '写入磁盘并更新运行时规则');
        const rules = collectDanmakuRulesFromForm();
        const response = await fetch(buildApiUrl('/api/rules', true), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules })
        });
        const result = await response.json();
        if (!response.ok || result.success === false) {
            throw new Error(result.errorMessage || ('保存失败: ' + response.status));
        }
        renderDanmakuRules(result.rules || rules);
        renderPersistAndAiStatus(result);
        const persistHint = result.persistence?.exists
            ? '已持久化到 ' + (result.persistence.path || 'config/danmaku-filter-rules.json')
            : (result.persistence?.available === false ? '当前环境无法落盘，仅内存生效' : '已保存');
        customAlert('弹幕处理规则已保存。\\n' + persistHint, '保存成功');
        addLog('弹幕处理规则已保存（持久化）', 'success');
    } catch (error) {
        customAlert(error.message, '保存失败');
        addLog('弹幕处理规则保存失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function resetDanmakuRules() {
    const confirmed = await customConfirm('确认恢复默认弹幕处理规则？将删除已持久化的自定义规则文件。', '恢复默认');
    if (!confirmed) return;
    try {
        showLoading('正在恢复默认规则...', '清除运行时规则与磁盘文件');
        const response = await fetch(buildApiUrl('/api/rules?reset=true', true), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset: true })
        });
        const result = await response.json();
        if (!response.ok || result.success === false) {
            throw new Error(result.errorMessage || ('恢复失败: ' + response.status));
        }
        renderDanmakuRules(result.rules || {});
        renderPersistAndAiStatus(result);
        addLog('弹幕处理规则已恢复默认', 'success');
    } catch (error) {
        customAlert(error.message, '恢复失败');
        addLog('恢复弹幕处理规则失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

const REMOVAL_REASON_LABELS_UI = {
    low_quality: '低质量弹幕',
    meaningless: '低质量弹幕',
    duplicate_exact: '重复弹幕',
    duplicate_similar: '相似弹幕',
    burst: '刷屏弹幕',
    timeline_hint: '时间提示',
    time_comment: '时间提示',
    advertisement: '广告弹幕',
    spoiler: '剧透弹幕',
    custom_blacklist: '黑名单'
};

function formatRemovalReasonLabel(reason) {
    return REMOVAL_REASON_LABELS_UI[reason] || reason;
}

function renderReasonBars(container, reasons) {
    if (!container) return;
    const entries = Object.entries(reasons || {});
    if (!entries.length) {
        container.innerHTML = '<div class="empty-state">暂无处理统计</div>';
        return;
    }
    const maxValue = Math.max(1, ...entries.map(([, v]) => Number(v || 0)));
    container.innerHTML = entries.map(([reason, raw]) => {
        const value = Number(raw || 0);
        const percent = Math.max(4, Math.round(value / maxValue * 100));
        const label = formatRemovalReasonLabel(reason);
        return '<div class="stats-bar-row"><span title="' + escapeHtml(reason) + '">' + escapeHtml(label) + '</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + percent + '%"></div></div><strong>' + value + '</strong></div>';
    }).join('');
}

function renderDanmakuStatistics(statistics) {
    const stats = statistics || {};
    const cards = document.getElementById('danmaku-stats-cards');
    const bars = document.getElementById('danmaku-stats-bars');
    if (!cards || !bars) return;

    const cardItems = [
        ['处理任务', stats.total_jobs || 0],
        ['处理前', stats.total_before || 0],
        ['过滤数', stats.total_removed || 0],
        ['最终输出', stats.total_after || 0],
        ['平均耗时', (stats.average_processing_ms || 0) + ' ms']
    ];
    cards.innerHTML = cardItems.map(([label, value]) => '<div class="stats-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');
    renderReasonBars(bars, stats.removed_by_reason || {});
}

async function loadDanmakuStatistics() {
    const response = await fetch(buildApiUrl('/api/statistics'));
    if (!response.ok) return;
    const data = await response.json();
    renderDanmakuStatistics(data.statistics || {});
}

async function resetDanmakuStatistics() {
    const confirmed = await customConfirm('确认清空弹幕处理统计？', '清空统计');
    if (!confirmed) return;
    try {
        const response = await fetch(buildApiUrl('/api/statistics', true), { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.errorMessage || '统计清空失败');
        }
        renderDanmakuStatistics(data.statistics || {});
        addLog('弹幕处理统计已清空', 'success');
    } catch (error) {
        customAlert(error.message, '清空失败');
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败: ' + file.name));
        reader.readAsText(file);
    });
}

function guessSourceFromName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.includes('bili')) return 'bilibili';
    if (lower.includes('qq') || lower.includes('tencent')) return 'tencent';
    if (lower.includes('iqiyi') || lower.includes('qiyi')) return 'iqiyi';
    if (lower.includes('youku')) return 'youku';
    if (lower.includes('mango') || lower.includes('imgo')) return 'mango';
    if (lower.endsWith('.ass')) return 'ass';
    if (lower.endsWith('.xml')) return 'xml';
    if (lower.endsWith('.json')) return 'json';
    return 'upload';
}

function renderOnlineTestResult(result) {
    lastOnlineTestResult = result;
    const summary = document.getElementById('danmaku-test-summary');
    const bars = document.getElementById('danmaku-test-reason-bars');
    const removedEl = document.getElementById('danmaku-test-removed');
    const outputEl = document.getElementById('danmaku-test-output');
    if (!summary || !bars || !removedEl || !outputEl) return;

    const reasons = result.stats?.removed_by_reason || {};
    const reasonTotal = Object.values(reasons).reduce((sum, n) => sum + Number(n || 0), 0);
    const filterRate = result.total_before
        ? ((Number(result.removed || reasonTotal || 0) / Number(result.total_before)) * 100).toFixed(1) + '%'
        : '0%';
    const cards = [
        ['处理前', result.total_before || 0],
        ['过滤总数', result.removed || reasonTotal || 0],
        ['最终输出', result.total_after || 0],
        ['过滤率', filterRate],
        ['耗时', (result.stats?.processing_ms || 0) + ' ms']
    ];
    summary.innerHTML = cards.map(([label, value]) => '<div class="stats-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');

    if (!Object.keys(reasons).length) {
        bars.innerHTML = '<div class="empty-state">本次无过滤（或未命中规则）</div>';
    } else {
        renderReasonBars(bars, reasons);
    }

    const samples = result.removed_samples || [];
    if (!samples.length) {
        removedEl.className = 'test-samples empty-state';
        removedEl.textContent = '无被过滤样本返回（可检查 output.include_removed_samples）';
    } else {
        removedEl.className = 'test-samples';
        removedEl.innerHTML = samples.map(sample => {
            const item = sample.item || sample;
            const content = item.content || item.m || '';
            const time = item.time ?? item.t ?? '-';
            const reason = formatRemovalReasonLabel(sample.reason || item.reason || 'unknown');
            return '<div class="test-sample-row"><span class="tag">' + escapeHtml(reason) + '</span><span class="time">' + escapeHtml(time) + 's</span><span class="text">' + escapeHtml(content) + '</span></div>';
        }).join('');
    }

    const outputs = Array.isArray(result.result) ? result.result.slice(0, 20) : [];
    if (!outputs.length) {
        outputEl.className = 'test-samples empty-state';
        outputEl.textContent = '无输出弹幕';
    } else {
        outputEl.className = 'test-samples';
        outputEl.innerHTML = outputs.map(item => {
            const content = item.content || item.m || '';
            const time = item.time ?? item.t ?? '-';
            const source = item.source || '';
            const score = item.quality_score != null ? ('分' + item.quality_score) : '';
            return '<div class="test-sample-row"><span class="tag">' + escapeHtml(source) + '</span><span class="time">' + escapeHtml(time) + 's</span><span class="text">' + escapeHtml(content) + '</span><span class="score">' + escapeHtml(score) + '</span></div>';
        }).join('');
    }
}

function clearDanmakuOnlineTest() {
    lastOnlineTestResult = null;
    const fileInput = document.getElementById('danmaku-test-files');
    const paste = document.getElementById('danmaku-test-paste');
    if (fileInput) fileInput.value = '';
    if (paste) paste.value = '';
    const summary = document.getElementById('danmaku-test-summary');
    const bars = document.getElementById('danmaku-test-reason-bars');
    const removedEl = document.getElementById('danmaku-test-removed');
    const outputEl = document.getElementById('danmaku-test-output');
    if (summary) summary.innerHTML = '';
    if (bars) bars.innerHTML = '';
    if (removedEl) {
        removedEl.className = 'test-samples empty-state';
        removedEl.textContent = '尚未执行测试';
    }
    if (outputEl) {
        outputEl.className = 'test-samples empty-state';
        outputEl.textContent = '尚未执行测试';
    }
}

async function runDanmakuOnlineTest() {
    try {
        const fileInput = document.getElementById('danmaku-test-files');
        const files = fileInput?.files ? Array.from(fileInput.files) : [];
        const paste = getText('danmaku-test-paste', '').trim();
        if (!files.length && !paste) {
            customAlert('请先上传弹幕文件，或粘贴弹幕文本。', '缺少测试数据');
            return;
        }

        showLoading('正在执行清洗测试...', '解析并合并弹幕');
        const sources = [];
        for (const file of files) {
            const content = await readFileAsText(file);
            sources.push({
                source: guessSourceFromName(file.name),
                fileName: file.name,
                content
            });
        }
        if (paste) {
            sources.push({
                source: 'paste',
                fileName: 'pasted.txt',
                content: paste
            });
        }

        const rules = collectDanmakuRulesFromForm();
        rules.output = {
            include_removed_samples: true,
            removed_sample_limit: 50
        };

        const response = await fetch(buildApiUrl('/api/danmaku/merge', true), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sources,
                rules,
                include_removed_samples: true,
                removed_sample_limit: 50
            })
        });
        const result = await response.json();
        if (!response.ok || result.success === false) {
            throw new Error(result.errorMessage || ('测试失败: ' + response.status));
        }

        renderOnlineTestResult(result);
        await loadDanmakuStatistics();
        addLog('在线清洗测试完成: ' + (result.total_before || 0) + ' → ' + (result.total_after || 0), 'success');
    } catch (error) {
        customAlert(error.message, '测试失败');
        addLog('在线清洗测试失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function refreshDanmakuProcessor() {
    try {
        await loadDanmakuRules();
        await loadDanmakuStatistics();
        addLog('弹幕处理页面已刷新', 'success');
    } catch (error) {
        customAlert(error.message, '刷新失败');
        addLog('弹幕处理页面刷新失败: ' + error.message, 'error');
    }
}

function initDanmakuProcessorInterface() {
    refreshDanmakuProcessor();
    if (danmakuStatisticsTimer) {
        clearInterval(danmakuStatisticsTimer);
    }
    danmakuStatisticsTimer = setInterval(() => {
        const section = document.getElementById('processor-section');
        if (section && section.classList.contains('active')) {
            loadDanmakuStatistics();
        }
    }, 5000);
}
`;

// language=JavaScript
export const episodeAggregateJsContent = /* javascript */ `
/**
 * 弹幕聚合 — 缓存管理 + Forward API 状态
 * 主流程由 Forward 请求自动触发；此处查看/刷新/清除缓存与来源文件明细
 */
async function loadEpisodeAggregateList() {
    const listEl = document.getElementById('episode-agg-list');
    if (!listEl) return;
    try {
        const response = await fetch(buildApiUrl('/api/episode/cache'));
        const data = await response.json();
        if (!response.ok) throw new Error(data.errorMessage || ('加载失败 ' + response.status));
        const items = data.items || [];
        if (!items.length) {
            listEl.innerHTML = '<div class="empty-state">暂无 Forward 聚合缓存。<br>当 Forward 模块请求 /api/forward/danmaku 后，聚合结果会自动出现在此。</div>';
            return;
        }
        listEl.innerHTML = items.map(item => {
            const id = item.identity || {};
            const title = item.display || id.display || id.title || id.tmdb_id || item.key;
            const isMovie = id.is_movie === true || id.type === 'movie' || String(item.key || '').endsWith(':movie') || String(item.key || '').includes('_movie');
            // 电影禁止展示假 SxxExx；电视剧显示季集
            const typeTag = isMovie
                ? '电影'
                : ('S' + String(id.season || '?').padStart(2,'0') + 'E' + String(id.episode || '?').padStart(2,'0'));
            const reg = id.region_label || id.region || '';
            const year = id.year || '';
            // 来源预览：provider · 原始文件名 · 数量
            const srcPreview = (item.sources_summary || []).slice(0, 5).map(function(s) {
                const file = s.file_name || s.fileName || s.raw_file || '';
                const cnt = (s.count_raw != null ? s.count_raw : (s.count_used != null ? s.count_used : ''));
                return escapeHtml(s.provider || s.source || 'unknown')
                    + (file ? ' · ' + escapeHtml(file) : '')
                    + (cnt !== '' ? ' · ' + escapeHtml(String(cnt)) : '');
            }).join('<br>') || '<span style="color:#c00">无来源明细</span>';
            return '<div class="episode-agg-card" data-key="' + escapeHtml(item.key) + '">'
                + '<div class="episode-agg-main">'
                + '<strong>' + escapeHtml(title) + '</strong> '
                + '<span class="tag">' + escapeHtml(typeTag) + '</span> '
                + (reg ? '<span class="tag">' + escapeHtml(reg) + '</span> ' : '')
                + (year ? '<span class="tag">' + escapeHtml(String(year)) + '</span> ' : '')
                + '<div class="muted-text">' + escapeHtml(item.key) + '</div>'
                + '<div class="episode-agg-metrics">'
                + '<span>来源 ' + escapeHtml(item.source_count || 0) + '</span>'
                + '<span>原始 ' + escapeHtml(item.total_before ?? '-') + '</span>'
                + '<span>合并后 ' + escapeHtml(item.total_after ?? '-') + '</span>'
                + '<span>生成 ' + escapeHtml(item.updated_at || '-') + '</span>'
                + '</div>'
                + '<div class="muted-text" style="margin-top:6px;font-size:12px;">' + srcPreview + '</div>'
                + '</div>'
                + '<div class="episode-agg-actions">'
                + '<button class="btn btn-primary btn-sm" onclick="showEpisodeAggregateDetail(\\'' + encodeURIComponent(item.key) + '\\')">查看来源统计</button>'
                + '<button class="btn btn-success btn-sm" onclick="refreshEpisodeAggregateCache(\\'' + encodeURIComponent(item.key) + '\\')">刷新缓存</button>'
                + '<button class="btn btn-danger btn-sm" onclick="deleteEpisodeAggregateCache(\\'' + encodeURIComponent(item.key) + '\\')">删除缓存</button>'
                + '</div></div>';
        }).join('');
    } catch (error) {
        listEl.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(error.message) + '</div>';
        addLog('缓存列表加载失败: ' + error.message, 'error');
    }
}

function renderEpisodeAggregateResult(result) {
    const box = document.getElementById('episode-agg-result');
    if (!box) return;
    const id = result.identity || result.media || {};
    const reasons = result.stats?.removed_by_reason || result.removed_by_reason || {};
    const reasonHtml = Object.keys(reasons).length
        ? Object.entries(reasons).map(([k, v]) => '<li>' + escapeHtml(typeof formatRemovalReasonLabel === 'function' ? formatRemovalReasonLabel(k) : k) + ': ' + v + '</li>').join('')
        : '<li>无</li>';

    const detailList = result.sources_detail || result.sources || [];
    const isMovie = id.is_movie === true || id.type === 'movie' || String(result.key || '').includes(':movie');
    const sourcesHtml = detailList.length
        ? detailList.map(function(s) {
            const file = s.file_name || s.fileName || s.raw_file || '-';
            const matched = s.matched_title || s.anime_title || '-';
            const cn = s.title || id.title || '-';
            const region = s.region_label || s.region || id.region_label || id.region || '-';
            const year = s.year || id.year || '-';
            const se = isMovie
                ? '电影（无季集）'
                : ('S' + String(s.season || id.season || '?') + 'E' + String(s.episode || id.episode || '?'));
            const raw = s.count_raw ?? s.count ?? 0;
            const used = s.count_used ?? '-';
            return '<div class="source-detail-card" style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:8px 0;">'
                + '<div><strong>来源 Provider：</strong>' + escapeHtml(s.provider || s.source || 'unknown') + '</div>'
                + '<div><strong>原始弹幕文件：</strong><code>' + escapeHtml(file) + '</code></div>'
                + '<div><strong>匹配 / 聚合关系：</strong></div>'
                + '<ul style="margin:4px 0 0 16px;">'
                + '<li>中文名：' + escapeHtml(cn) + '</li>'
                + '<li>原始名：' + escapeHtml(matched) + '</li>'
                + '<li>地区：' + escapeHtml(String(region)) + '</li>'
                + '<li>年份：' + escapeHtml(String(year)) + '</li>'
                + '<li>类型：' + escapeHtml(se) + '</li>'
                + '<li>原始条数：' + escapeHtml(String(raw)) + '</li>'
                + '<li>聚合采用：' + escapeHtml(String(used)) + '</li>'
                + (s.match_reason ? '<li>匹配原因：' + escapeHtml(String(s.match_reason)) + '</li>' : '')
                + (s.error ? '<li style="color:#c00;">错误：' + escapeHtml(s.error) + '</li>' : '')
                + '</ul></div>';
        }).join('')
        : '<p class="muted-text" style="color:#c00">无来源明细（source metadata 缺失）</p>';

    const matchLine = result.display || id.display || [
        id.title || '',
        id.region_label || id.region || '',
        id.year || '',
        isMovie ? '电影' : ('S' + (id.season || '?') + 'E' + (id.episode || '?'))
    ].filter(Boolean).join(' ');

    box.innerHTML = '<div class="processor-panel">'
        + '<h3>缓存详情 / 来源统计</h3>'
        + '<p><strong>匹配：</strong>' + escapeHtml(matchLine) + '</p>'
        + '<p class="muted-text">key: ' + escapeHtml(result.key || '') + '</p>'
        + '<div class="stats-cards">'
        + '<div class="stats-card"><span>来源数</span><strong>' + escapeHtml(detailList.length) + '</strong></div>'
        + '<div class="stats-card"><span>原始合计</span><strong>' + escapeHtml(result.stats?.total_before ?? result.total_before ?? 0) + '</strong></div>'
        + '<div class="stats-card"><span>合并后</span><strong>' + escapeHtml(result.count ?? result.stats?.total_after ?? result.total_after ?? 0) + '</strong></div>'
        + '</div>'
        + '<h4>每个来源的原始弹幕文件</h4>'
        + sourcesHtml
        + '<h4>过滤原因</h4><ul>' + reasonHtml + '</ul>'
        + '</div>';
}

async function showEpisodeAggregateDetail(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    try {
        showLoading('加载详情...', key);
        const response = await fetch(buildApiUrl('/api/episode/cache?key=' + encodeURIComponent(key)));
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.errorMessage || '加载失败');
        const d = data.detail || {};
        renderEpisodeAggregateResult({
            key: d.key,
            identity: d.identity,
            media: d.media,
            display: d.display || d.identity?.display,
            sources: d.sources,
            sources_detail: d.sources_detail || d.sources,
            stats: {
                total_before: d.total_before,
                total_after: d.total_after,
                removed_by_reason: d.removed_by_reason,
                ...(d.stats || {})
            },
            count: d.total_after,
            total_after: d.total_after
        });
    } catch (error) {
        customAlert(error.message, '详情失败');
    } finally {
        hideLoading();
    }
}

async function deleteEpisodeAggregateCache(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    const ok = await customConfirm('确认删除缓存：' + key + '？下次 Forward 请求会重新聚合。', '删除缓存');
    if (!ok) return;
    try {
        // 使用当前会话 TOKEN（path token），服务端允许 TOKEN 或 ADMIN 清理缓存
        const response = await fetch(buildApiUrl('/api/episode/cache?key=' + encodeURIComponent(key)), { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.errorMessage || '删除失败');
        addLog('已删除剧集缓存 ' + key, 'success');
        document.getElementById('episode-agg-result').innerHTML = '';
        await loadEpisodeAggregateList();
    } catch (error) {
        customAlert(error.message, '删除失败');
    }
}

async function clearAllEpisodeAggregateCache() {
    const ok = await customConfirm('确认清空全部 Forward 聚合缓存？', '清空全部');
    if (!ok) return;
    try {
        const response = await fetch(buildApiUrl('/api/episode/cache'), { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.errorMessage || '清空失败');
        addLog('已清空全部剧集缓存', 'success');
        document.getElementById('episode-agg-result').innerHTML = '';
        await loadEpisodeAggregateList();
    } catch (error) {
        customAlert(error.message, '清空失败');
    }
}

async function refreshEpisodeAggregateCache(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    let body = { force: true };
    try {
        const detailRes = await fetch(buildApiUrl('/api/episode/cache?key=' + encodeURIComponent(key)));
        const detailData = await detailRes.json();
        if (detailData?.detail?.identity) {
            const id = detailData.detail.identity;
            body = {
                force: true,
                title: id.title || undefined,
                tmdb_id: id.tmdb_id || undefined,
                original_title: id.original_title || undefined,
                region: id.region || undefined,
                year: id.year || undefined,
                season: id.season || 1,
                episode: id.episode || 1
            };
        }
    } catch (e) { /* ignore */ }

    if (!body.title && !body.tmdb_id) {
        customAlert('无法解析剧集信息。请让 Forward 重新请求该集以自动重建缓存。', '提示');
        return;
    }

    try {
        showLoading('强制刷新 Forward 聚合缓存...', key);
        await fetch(buildApiUrl('/api/episode/cache?key=' + encodeURIComponent(key)), { method: 'DELETE' });
        const qs = new URLSearchParams();
        if (body.title) qs.set('title', body.title);
        if (body.tmdb_id) qs.set('tmdb_id', body.tmdb_id);
        if (body.original_title) qs.set('original_title', body.original_title);
        if (body.region) qs.set('region', body.region);
        if (body.year) qs.set('year', body.year);
        qs.set('season', String(body.season || 1));
        qs.set('episode', String(body.episode || 1));
        qs.set('force', '1');
        qs.set('debug', '1');
        const response = await fetch(buildApiUrl('/api/forward/danmaku?' + qs.toString()));
        const result = await response.json();
        if (!response.ok) throw new Error(result.errorMessage || ('刷新失败 ' + response.status));
        addLog('缓存已刷新 ' + key + ' → ' + (result.count || 0) + ' 条', 'success');
        await loadEpisodeAggregateList();
        renderEpisodeAggregateResult({
            key: result.meta?.key || key,
            identity: result.meta?.identity || result.media,
            media: result.media,
            display: result.media?.display,
            count: result.count,
            stats: result.meta?.stats || { total_after: result.count, total_before: result.meta?.stats?.total_before },
            sources: result.meta?.sources_detail || result.meta?.sources || result.sources_detail || [],
            sources_detail: result.meta?.sources_detail || result.meta?.sources || result.sources_detail || []
        });
    } catch (error) {
        customAlert(error.message, '刷新失败');
    } finally {
        hideLoading();
    }
}

function initEpisodeAggregateInterface() {
    loadEpisodeAggregateList();
    if (typeof updateForwardApiEndpoint === 'function') {
        updateForwardApiEndpoint();
    }
}
`;

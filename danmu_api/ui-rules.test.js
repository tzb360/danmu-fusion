import test from 'node:test';
import assert from 'node:assert/strict';
import { HTML_TEMPLATE } from './ui/template.js';
import { danmakuProcessorJsContent } from './ui/js/danmuprocessor.js';

test('web panel renders danmaku processor management page', () => {
  assert(HTML_TEMPLATE.includes('processor-section'));
  assert(HTML_TEMPLATE.includes('弹幕处理规则'));
  assert(HTML_TEMPLATE.includes('rule-merge-enabled'));
  assert(HTML_TEMPLATE.includes('rule-duplicate-enabled'));
  assert(HTML_TEMPLATE.includes('rule-ad-keywords'));
  assert(HTML_TEMPLATE.includes('rule-allowlist'));
  assert(HTML_TEMPLATE.includes('danmaku-stats-cards'));
  assert(HTML_TEMPLATE.includes('在线弹幕测试'));
  assert(HTML_TEMPLATE.includes('danmaku-test-files'));
  assert(HTML_TEMPLATE.includes('rule-pipeline-enabled'));
  assert(HTML_TEMPLATE.includes('rule-ai-enabled'));
});

test('web panel rule modification script saves parameters through rules API', () => {
  assert(danmakuProcessorJsContent.includes('function collectDanmakuRulesFromForm'));
  assert(danmakuProcessorJsContent.includes("fetch(buildApiUrl('/api/rules', true)"));
  assert(danmakuProcessorJsContent.includes("method: 'PUT'"));
  assert(danmakuProcessorJsContent.includes('JSON.stringify({ rules })'));
  assert(danmakuProcessorJsContent.includes('custom_blacklist'));
  assert(danmakuProcessorJsContent.includes('allowlist'));
  assert(danmakuProcessorJsContent.includes('pipeline'));
  assert(danmakuProcessorJsContent.includes('renderPersistAndAiStatus'));
});

test('web panel statistics script loads and resets processing statistics', () => {
  assert(danmakuProcessorJsContent.includes("fetch(buildApiUrl('/api/statistics'))"));
  assert(danmakuProcessorJsContent.includes("fetch(buildApiUrl('/api/statistics', true), { method: 'DELETE' })"));
  assert(danmakuProcessorJsContent.includes('renderDanmakuStatistics'));
});

test('web panel online test script uploads files and calls merge API', () => {
  assert(danmakuProcessorJsContent.includes('function runDanmakuOnlineTest'));
  assert(danmakuProcessorJsContent.includes("fetch(buildApiUrl('/api/danmaku/merge', true)"));
  assert(danmakuProcessorJsContent.includes('include_removed_samples'));
  assert(danmakuProcessorJsContent.includes('renderOnlineTestResult'));
  assert(danmakuProcessorJsContent.includes('removed_samples'));
});

test('web panel shows Chinese labels for removal reasons', () => {
  assert(danmakuProcessorJsContent.includes('低质量弹幕'));
  assert(danmakuProcessorJsContent.includes('重复弹幕'));
  assert(danmakuProcessorJsContent.includes('相似弹幕'));
  assert(danmakuProcessorJsContent.includes('刷屏弹幕'));
  assert(danmakuProcessorJsContent.includes('时间提示'));
  assert(danmakuProcessorJsContent.includes('广告弹幕'));
  assert(danmakuProcessorJsContent.includes('formatRemovalReasonLabel'));
});

test('episode cache panel preserves media type and never refreshes movies as S01E01', async () => {
  const { episodeAggregateJsContent } = await import('./ui/js/episodeaggregate.js');
  assert.match(episodeAggregateJsContent, /qs\.set\('type', body\.type \|\| 'tv'\)/);
  assert.match(episodeAggregateJsContent, /if \(body\.type !== 'movie'\)/);
  assert.match(episodeAggregateJsContent, /拒绝默认刷新 S01E01/);
  assert.match(episodeAggregateJsContent, /最终采用/);
  assert.match(episodeAggregateJsContent, /原始匹配标题/);
});

test('Docker image includes the Forward module assets served by Node', async () => {
  const fs = await import('node:fs');
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY forward-module\/ \.\/forward-module\//);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo.js';
import type { TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes.js';
import { DirectorVideoDetailPanel } from './InspirationDashboard.js';

function video(): TrendVideo {
  return {
    id: 'detail-fixture', recordId: 'detail-fixture', platform: 'tiktok', title: '原片分镜测试',
    thumbnail: '', duration: 9, tags: [], views: '100', trend: 'stable',
    contentFormat: 'video', status: 'analyzed',
    aiAnalysis: benchmarkVideoFixture() as VideoAnalysisPayload,
  };
}

function renderDetail(item: TrendVideo) {
  return renderToStaticMarkup(<DirectorVideoDetailPanel
    video={item} onClose={() => {}} onPreview={() => {}} onCreate={() => {}}
    onRetry={() => {}} onExactAnalysis={() => {}} onReanalyze={() => {}}
    onCancelAnalysis={() => {}} analyzing={false} onFavorite={() => {}}
  />);
}

test('detail reports real shot count and only marks a complete timeline as finished', () => {
  const complete = renderDetail(video());
  assert.ok(complete.includes('全片精确分析已完成'));
  assert.ok(complete.includes('9 个镜头'));
  assert.ok(!complete.includes('9 / 1 段'));

  const slightGap = video();
  slightGap.aiAnalysis = { ...slightGap.aiAnalysis, gemini: { ...slightGap.aiAnalysis!.gemini,
    scriptDetails15s: slightGap.aiAnalysis!.gemini!.scriptDetails15s!.map((shot, index) => index === 4 ? { ...shot, time: '4.5-5.5s' } : shot) } };
  const incomplete = renderDetail(slightGap);
  assert.ok(!incomplete.includes('全片精确分析已完成'));
  assert.ok(incomplete.includes('导演级分镜的时间线未完整覆盖原片'));
});

test('deleted weekly reference remains a readable three-tab snapshot without unusable analysis actions', () => {
  const snapshot = video();
  snapshot.id = 'weekly-reference-deleted';
  snapshot.recordId = undefined;
  snapshot.aiAnalysis = {
    benchmarkAnalysis: buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'deleted', duration: 9 }),
    analysisSource: 'weekly-plan-snapshot', analysisQuality: 'snapshot', geminiStatus: 'analyzed',
    gemini: { theme: '周计划爆款参考' },
  };
  const html = renderDetail(snapshot);
  assert.ok(html.includes('周计划分析快照 · 只读'));
  assert.ok(html.includes('重新导入原片'));
  for (const label of ['内容结构和钩子', '分镜与脚本', '爆火原因分析']) assert.ok(html.includes(label));
  assert.ok(!html.includes('重新分析分镜'));
  assert.ok(!html.includes('>全片精确分析</button>'));
});

test('an unanalyzed image post is not labeled as a completed video analysis', () => {
  const image = video();
  image.contentFormat = 'image';
  image.aiAnalysis = undefined;
  const html = renderDetail(image);
  assert.ok(html.includes('等待编导 Agent 分析'));
  assert.ok(!html.includes('全片精确分析已完成'));
});

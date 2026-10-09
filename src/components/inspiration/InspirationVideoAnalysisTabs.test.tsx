import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBenchmarkAnalysis } from '../../../shared/benchmarkAnalysis.js';
import { benchmarkVideoFixture } from '../../../tests/fixtures/benchmarkVideo.js';
import InspirationVideoAnalysisTabs, { ContentStructureTab, DirectorShotAnalysisStatus, ViralSynthesisTab } from './InspirationVideoAnalysisTabs.js';

test('video detail exposes three analysis dimensions with an evidence based structure', () => {
  const payload = benchmarkVideoFixture();
  const benchmark = buildBenchmarkAnalysis({ analysis: payload, videoId: 'video-fixture', duration: 9 });
  const gemini = { hooks: ['开场一句话直指客户需求'], coarseStructure: [{ time: '0–1s', label: '开场', description: '销售人员向镜头发问' }] };
  const html = renderToStaticMarkup(<InspirationVideoAnalysisTabs benchmark={benchmark} gemini={gemini} pending={false} detailedReady detailedReason="已完成" onAnalyze={() => {}} onReanalyze={() => {}} />);
  for (const label of ['内容结构和钩子', '分镜与脚本', '爆火原因分析', '开场一句话直指客户需求', '原片镜头时间线', '销售人员向镜头发问']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('role="tabpanel"'));
});

test('viral synthesis joins observed visuals, spoken script and stated hypothesis', () => {
  const payload = benchmarkVideoFixture();
  const gemini = (payload.gemini as { scriptDetails15s: Array<Record<string, unknown>> });
  gemini.scriptDetails15s[0]!.viralPotential = { whyEffective: '第一秒就出现直接提问' };
  const benchmark = buildBenchmarkAnalysis({ analysis: payload, videoId: 'video-fixture', duration: 9 });
  const html = renderToStaticMarkup(<ViralSynthesisTab benchmark={benchmark} gemini={{ hooks: ['用提问吸引客户'], sellingPoints: ['定制护肤品'], firstTenSeconds: { camera: '固定镜头直面观众' } }} pending={false} />);
  for (const label of ['用提问吸引客户', '销售人员在工厂背景前面向镜头讲话', 'Hello, boss!', '第一秒就出现直接提问', '固定镜头直面观众', '定制护肤品']) assert.ok(html.includes(label), label);
  const empty = renderToStaticMarkup(<ViralSynthesisTab benchmark={buildBenchmarkAnalysis({ analysis: {} })} pending={false} />);
  assert.ok(empty.includes('尚无足够的原片证据'));
  assert.ok(!empty.includes('可能奏效的原因'));
});

test('pending structure distinguishes observed segments from confirmed cuts', () => {
  const benchmark = buildBenchmarkAnalysis({ analysis: { analysisMode: 'strategy', gemini: { scriptDetails15s: [{ time: '0-2s', visual: '开场画面' }] } }, duration: 9 });
  const html = renderToStaticMarkup(<ContentStructureTab benchmark={benchmark} pending />);
  assert.ok(html.includes('实际切镜数待确认'));
  assert.ok(html.includes('时间线尚未确认覆盖整片'));
});

test('a read-only snapshot keeps its shot evidence but offers no analysis action', () => {
  const benchmark = buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'deleted', duration: 9 });
  const html = renderToStaticMarkup(<DirectorShotAnalysisStatus benchmark={benchmark} pending={false} detailedReady={false}
    detailedReason="原片已删除，仅可查看历史分析" onAnalyze={() => {}} onReanalyze={() => {}} analysisActionAvailable={false} />);
  assert.ok(html.includes('分析快照 · 只读'));
  assert.ok(html.includes('9 个镜头'));
  assert.ok(html.includes('原片已删除'));
  assert.ok(!html.includes('重新分析分镜'));
});

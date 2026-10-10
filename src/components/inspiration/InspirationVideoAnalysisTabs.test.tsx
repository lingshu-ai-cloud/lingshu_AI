import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBenchmarkAnalysis } from '../../../shared/benchmarkAnalysis.js';
import { benchmarkVideoFixture } from '../../../tests/fixtures/benchmarkVideo.js';
import InspirationVideoAnalysisTabs, { ContentStructureTab, DirectorShotAnalysisStatus, ViralSynthesisTab } from './InspirationVideoAnalysisTabs.js';

test('video detail exposes three analysis dimensions with an evidence based structure', () => {
  const payload = benchmarkVideoFixture();
  const benchmark = buildBenchmarkAnalysis({ analysis: payload, videoId: 'video-fixture', duration: 9 });
  const gemini = { hooks: ['开场一句话直指客户需求'], coarseStructure: [{ time: '0–1s', label: 'hook + pain_point', description: '旧的叙事结构标签' }] };
  const html = renderToStaticMarkup(<InspirationVideoAnalysisTabs benchmark={benchmark} gemini={gemini} pending={false} detailedReady detailedReason="已完成" onAnalyze={() => {}} onReanalyze={() => {}} />);
  for (const label of ['内容结构和钩子', '分镜与脚本', '爆火原因分析', '开场一句话直指客户需求', '原片镜头时间线', '真人口播', '工厂实拍', '产品实拍', 'D2C', '其他通用素材']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('旧的叙事结构标签'));
  assert.ok(!html.includes('hook + pain_point'));
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

test('general footage is the fifth production type while unknown evidence stays unclassified', () => {
  const benchmark = buildBenchmarkAnalysis({ analysis: { analysisMode: 'exact', gemini: { scriptDetails15s: [
    { time: '0-1s', visual: '办公桌与窗外街景', materialType: 'general', narrativeRole: 'hook', classificationEvidence: '可见环境空镜' },
    { time: '1-2s', visual: '画面模糊，主体无法确认', materialType: 'unknown', narrativeRole: 'transition', needsReview: true },
  ] } }, duration: 2 });
  const html = renderToStaticMarkup(<ContentStructureTab benchmark={benchmark} pending={false} duration={2} />);
  assert.match(html, /其他通用素材<\/strong><span[^>]*>1 个镜头/);
  assert.match(html, /另有 1 个镜头证据不足/);
  assert.match(html, /不会误计入其他通用素材/);
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

test('an active rerun labels old evidence as a previous result and keeps every tab relationship valid', () => {
  const benchmark = buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'previous-result', duration: 9 });
  const html = renderToStaticMarkup(<InspirationVideoAnalysisTabs benchmark={benchmark} pending detailedReady={false}
    detailedReason="正在生成当前导演级结果" onAnalyze={() => {}} onReanalyze={() => {}} />);
  assert.ok(html.includes('下方仅展示上次分析结果'));
  assert.equal(html.match(/aria-controls=/g)?.length, 3);
  assert.equal(html.match(/role="tabpanel"/g)?.length, 3);
  for (const panel of ['structure-panel', 'storyboard-panel', 'viral-panel']) assert.ok(html.includes(panel), panel);
});

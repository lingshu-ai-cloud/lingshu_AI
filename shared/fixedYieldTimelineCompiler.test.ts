import assert from 'node:assert/strict';
import test from 'node:test';
import type { BenchmarkAnalysis, BenchmarkShot } from './benchmarkAnalysis.js';
import { compileFixedYieldTimeline } from './fixedYieldTimelineCompiler.js';

const shot = (index: number, start: number, end: number, materialType: BenchmarkShot['materialType'], visual: string): BenchmarkShot => ({
  shotId: `shot_${index}`, index, time: `${start}-${end}`, start, end, materialType,
  narrativeRole: index === 1 ? 'hook' : 'capability_proof', classificationSource: 'model',
  classificationEvidence: `evidence-${index}`, visual, dialogue: '', onScreenText: '', purpose: visual,
  firstFrameRef: null, clipRef: null, needsReview: false, granularity: 'shot', environment: visual,
  framing: '中景', camera: '稳定', audio: '', authenticity: '真实', effectivenessHypothesis: '', detailedAnalysis: {},
});
const analysis = (shots: BenchmarkShot[]): BenchmarkAnalysis => ({
  schemaVersion: 1, source: { videoId: 'reference-1', analysisRunId: 'run-1', evidenceRevision: 'revision-1', correctionVersion: 0, analyzedAt: '2026-10-15T00:00:00Z', analysisMode: 'exact' },
  status: 'ready', gaps: [], hookShotId: shots[0]?.shotId || null, shots, totalShots: shots.length,
  timelineComplete: true, materialCounts: { talking_head: 0, factory: 0, product: 0, consumer_demo: 0, general: 0, unknown: 0 },
  structure: shots.map(item => ({ materialType: item.materialType, narrativeRole: item.narrativeRole, shotIds: [item.shotId] })), speechGroups: [],
});

test('exact physical reference shots compile one-to-one without duration ratios', () => {
  const result = compileFixedYieldTimeline({ analysis: analysis([
    shot(1, 0, 2.4, 'talking_head', '人物在工厂稳定站立口播'),
    shot(2, 2.4, 4.1, 'product', '产品包装标签微距特写'),
    shot(3, 4.1, 6.8, 'factory', '灌装机器运行特写'),
  ]), productRef: 'SKU-1' });
  assert.equal(result.ready, true);
  assert.equal(result.shots.length, 3);
  assert.deepEqual(result.shots.map(item => item.targetOutputDurationMs), [2400, 1700, 2700]);
  assert.deepEqual(result.shots.map(item => item.pathId), ['P1_PRESENTER', 'P2_PRODUCT_REAL', 'P3_FACTORY_REAL']);
  assert.equal(result.targetDurationMs, 6800);
  assert.equal(result.classifiedDurationMsByPath.P1_PRESENTER, 2400);
  assert.equal(result.unresolvedReferenceDurationMs, 0);
});

test('timeline gaps and unresolved physical shots block before production', () => {
  const source = analysis([
    shot(1, 0, 1, 'product', '产品货架展示'),
    shot(2, 1.3, 2, 'unknown', '待判断'),
  ]);
  source.status = 'partial'; source.timelineComplete = false; source.gaps = ['全片时间线尚未确认完整'];
  const result = compileFixedYieldTimeline({ analysis: source, productRef: 'SKU-1' });
  assert.equal(result.ready, false);
  assert(result.blockers.some(item => /镜头类型未确认/.test(item)));
  assert(result.blockers.some(item => /空洞/.test(item)));
  assert(result.blockers.some(item => /并非所有参考物理镜头/.test(item)));
});

test('product-bound shots require a frozen SKU before any material candidate is considered', () => {
  const result = compileFixedYieldTimeline({ analysis: analysis([
    shot(1, 0, 2, 'product', '产品在货架展示'),
  ]) });
  assert.equal(result.ready, false);
  assert.equal(result.productRef, null);
  assert.match(result.blockers.join(','), /缺少冻结产品身份/);
});

test('timeline shot capacity is enforced during zero-cost compilation', () => {
  const shots = Array.from({ length: 61 }, (_, index) => shot(index + 1, index, index + 1, 'general', '企业展会现场'));
  const result = compileFixedYieldTimeline({ analysis: analysis(shots), productRef: 'SKU-1' });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(','), /镜头数 61 超过当前上限 60/);
});

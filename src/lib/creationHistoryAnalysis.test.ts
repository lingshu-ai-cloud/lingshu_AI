import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis';
import { creationHistoryAnalysis } from './creationHistoryAnalysis';

test('historical projects retain reference classification and separate new hook narration', () => {
  const data = creationHistoryAnalysis({
    videoKickoff: { video: { referenceRecordId: 'reference-1', duration: 3 }, referenceAnalysis: { details: [{ time: '0–3s', visual: '原片人物', dialogue: '原片台词', materialType: 'talking_head', classificationEvidence: '人物对镜讲话', purpose: '开场提问' }] } },
    analysisResults: { storyboard: { slots: [{ id: 'slot-1', detail: '新片产品画面' }] } },
    shootingSlots: [{ id: 'shoot-1', slotId: 'slot-1' }],
    shotProductions: { 'assembly:shoot-1': { narration: '新片开场台词' } },
  });
  assert.equal(data.reference.shots[0].materialType, 'talking_head');
  assert.equal(data.reference.shots[0].narrativeRole, 'hook');
  assert.equal(data.reference.shots[0].dialogue, '原片台词');
  assert.equal(data.hook.dialogue, '新片开场台词');
  assert.equal(data.hook.visual, '新片产品画面');
});
test('missing history remains explicit and saved hook snapshot takes precedence', () => {
  assert.equal(creationHistoryAnalysis({}).reference.shots.length, 0);
  assert.equal(creationHistoryAnalysis({}).hook.dialogue, '');
  assert.equal(creationHistoryAnalysis({ analysisResults: { hook: { dialogue: '保存的钩子', visual: '保存的画面' } } }).hook.dialogue, '保存的钩子');
});

 test('legacy hook uses the active assembly and snapshot-only production records', () => {
  const data = creationHistoryAnalysis({
    activeAssemblyId: 'current',
    analysisResults: {
      storyboard: { slots: [{ id: 'slot', detail: '开场' }] },
      shots: { shootingSlots: [{ id: 'shot', slotId: 'slot' }], productions: {
        'older:shot': { narration: '旧方案' }, 'current:shot': { narration: '当前方案' },
      } },
    },
  });
  assert.equal(data.hook.dialogue, '当前方案');
 });

test('inherited first frames retain validated tenant API references', () => {
  const analysis = creationHistoryAnalysis({ videoKickoff: { video: { referenceRecordId: 'video' }, referenceAnalysis: { details: [
    { time: '0–3s', firstFrameRef: '/api/overseas/videos/video/shot/1/first-frame' },
    { time: '3–6s', firstFrameRef: '/private/file.jpg' },
  ] } } }).reference;
  assert.equal(analysis.shots[0].firstFrameRef, '/api/overseas/videos/video/shot/1/first-frame');
  assert.equal(analysis.shots[1].firstFrameRef, null);
});

test('canonical metadata restores exact inherited spans without changing timeline or explicit tags', () => {
  const source = buildBenchmarkAnalysis({ analysis: { gemini: { scriptDetails15s: [
    { time: '0–3s', materialType: 'talking_head', visual: '原片', classificationEvidence: '真人讲解', composition: '居中' },
    { time: '3–6s', materialType: 'factory', visual: '生产线', classificationEvidence: '生产动作' },
  ] } } });
  const data = creationHistoryAnalysis({ videoKickoff: { referenceAnalysis: { details: [
    { time: '0-3s', visual: '继承的画面' },
    { time: '3-6s', materialType: 'product', classificationEvidence: '保存的标注', visual: '产品' },
    { time: '6-8s', visual: '未分析' },
  ] } } }, source);
  assert.equal(data.reference.shots.length, 3);
  assert.equal(data.reference.shots[0].materialType, 'talking_head');
  assert.equal(data.reference.shots[0].visual, '继承的画面');
  assert.equal(data.reference.shots[0].detailedAnalysis.composition, '居中');
  assert.equal(data.reference.shots[1].materialType, 'product');
  assert.equal(data.reference.shots[1].classificationEvidence, '保存的标注');
  assert.equal(data.reference.shots[2].materialType, 'unknown');
});

import assert from 'node:assert/strict';
import { applyOpeningHookMotionEvidence, firstSubstantiveOpeningShot, reconcileStoredOpeningHookMotionEvidence } from './hookMotionEvidence.js';
import type { VideoAiAnalysis } from '../types/index.js';

const analysis = {
  theme: 'sample', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
  scriptDetails15s: [
    { time: '0.00-0.10s', visual: '展厅闪帧' },
    { time: '0.10-3.47s', visual: '女子站在工厂' },
    { time: '3.47-4.00s', visual: '产品' },
  ],
} satisfies VideoAiAnalysis;

assert.equal(firstSubstantiveOpeningShot(analysis), 1);
const observed = applyOpeningHookMotionEvidence(analysis, {
  observations: [
    { time: 0.2, visibleState: '女子快速靠近镜头', confidence: 0.9 },
    { time: 0.52, visibleState: '手指贴近镜头', confidence: 0.91 },
    { time: 0.86, visibleState: '敲门手势峰值', confidence: 0.92 },
  ],
  transitions: [
    { from: 0.2, to: 0.52, action: '快速靠近镜头', evidence: '人物占画比例由小变大', confidence: 0.86 },
    { from: 0.52, to: 0.86, action: '完成敲门手势', evidence: '手部连续位置变化', confidence: 0.88 },
  ], uncertainties: [],
});
assert.deepEqual(observed.reviewReasons, []);
assert.match(observed.analysis.scriptDetails15s?.[1]?.visual || '', /靠近.*敲门/);
assert.equal(observed.analysis.scriptDetails15s?.[0]?.visual, '展厅闪帧');

const observedWithNamingUncertainty = applyOpeningHookMotionEvidence(analysis, {
  observations: [
    { time: 0.2, visibleState: '女子快速靠近镜头', confidence: 0.9 },
    { time: 0.52, visibleState: '手指贴近镜头', confidence: 0.91 },
    { time: 0.86, visibleState: '手势到达峰值', confidence: 0.92 },
  ],
  transitions: [
    { from: 0.2, to: 0.52, action: '快速靠近镜头', evidence: '人物占画比例由小变大', confidence: 0.86 },
    { from: 0.52, to: 0.86, action: '手势到达镜头前', evidence: '手部连续位置变化', confidence: 0.88 },
  ],
  uncertainties: ['不确定该手势在语义上是否应称为敲门'],
});
assert.deepEqual(observedWithNamingUncertainty.reviewReasons, [],
  'semantic naming uncertainty must stay auditable without invalidating independently observed motion');
assert.deepEqual((observedWithNamingUncertainty.analysis.scriptDetails15s?.[1] as any)?.hookMotionEvidence?.uncertainties,
  ['不确定该手势在语义上是否应称为敲门']);
const reconciled = reconcileStoredOpeningHookMotionEvidence(observedWithNamingUncertainty.analysis);
assert.equal((reconciled.scriptDetails15s?.[1] as any)?.hookMotionEvidence?.status, 'verified');
assert.equal(reconciled.scriptDetails15s?.[1]?.needsReview, false);

const unverified = applyOpeningHookMotionEvidence(analysis, {
  observations: [{ time: 0.33, visibleState: '女子站立', confidence: 0.9 }],
  transitions: [{ from: 0.33, to: 1.3, action: '向前走', evidence: '单帧猜测', confidence: 0.9 }],
  uncertainties: ['缺少后续清晰帧'],
});
assert.ok(unverified.reviewReasons.includes('opening_hook_motion_incomplete'));
assert.equal(unverified.analysis.scriptDetails15s?.[1]?.needsReview, true);
assert.equal(unverified.analysis.scriptDetails15s?.[1]?.visual, '女子站在工厂');
console.log('Opening hook: flash skipped; independently timed motion enriched; insufficient evidence requires review');

const crossCut = { ...analysis, scriptDetails15s: [
  { time: '0.00-0.10s', visual: '封面闪帧' },
  { time: '0.10-0.55s', visual: '开始靠近' },
  { time: '0.55-1.20s', visual: '完成敲门' },
  { time: '1.20-3.47s', visual: '站立口播' },
] } satisfies VideoAiAnalysis;
assert.equal(firstSubstantiveOpeningShot(crossCut), 1, 'sub-second action carrier is valid');
assert.deepEqual(applyOpeningHookMotionEvidence(crossCut, {
  observations: [{time:.2,visibleState:'靠近',confidence:.9},{time:.52,visibleState:'伸手',confidence:.9},{time:.86,visibleState:'敲门',confidence:.9}],
  transitions: [{from:.2,to:.52,action:'靠近',evidence:'占画比例变化',confidence:.9},{from:.52,to:.86,action:'敲门',evidence:'手势变化',confidence:.9}], uncertainties:[],
}).reviewReasons, [], 'action interval can cross a visual cut');

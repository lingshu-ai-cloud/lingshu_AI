import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPersonReplacementPlan, evaluatePersonReplacementQuality, PERSON_REPLACEMENT_MODE_CONTRACTS, replacementPlanSummary } from './runwayPersonReplacement.js';

test('defines distinct contracts for all three modes', () => {
  assert.deepEqual(Object.keys(PERSON_REPLACEMENT_MODE_CONTRACTS), ['fast', 'expert', 'creative']);
  assert.match(PERSON_REPLACEMENT_MODE_CONTRACTS.fast.label, /面部＋头部＋发型/);
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.expert.label, '保真全人物');
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.expert.providerOrder[0], 'runway_kling_motion');
  assert.deepEqual(PERSON_REPLACEMENT_MODE_CONTRACTS.expert.providerOrder, ['runway_kling_motion']);
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.creative.allowsCompositionChange, true);
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.fast.maturity, 'limited');
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.expert.maturity, 'experimental');
  assert.equal(PERSON_REPLACEMENT_MODE_CONTRACTS.creative.maturity, 'preview');
  assert.match(PERSON_REPLACEMENT_MODE_CONTRACTS.fast.suitableFor.join(' '), /正脸至轻侧脸/);
  assert.match(PERSON_REPLACEMENT_MODE_CONTRACTS.expert.limitations.join(' '), /不得自动进入成片/);
  assert.match(PERSON_REPLACEMENT_MODE_CONTRACTS.creative.limitations.join(' '), /口播核心信息/);
});

test('keeps non-person shots and gates strict fast replacement for review', () => {
  const plan = buildPersonReplacementPlan([
    { time: '0-3s', visual: '产品在桌面旋转特写' },
    { time: '3-7s', visual: '一名女性半身面对镜头讲解', confidence: 0.94 },
  ], 'fast', { sourceKind: 'customer_asset' });
  assert.deepEqual(plan.map(item => item.route), ['preserve', 'review']);
  assert.ok(plan.every(item => item.mode === 'fast'));
  assert.ok(plan.every(item => item.lockedElements.includes('原口播内容与口型时序')));
  assert.deepEqual(replacementPlanSummary(plan), { total: 2, replace: 0, preserve: 1, review: 1, blocked: 0, billableSeconds: 4 });
});

test('routes multiple people and occlusion to review', () => {
  const plan = buildPersonReplacementPlan([
    { time: '0-5', visual: '两人快速转身，其中一人手遮脸', confidence: 0.9 },
  ], 'fast', { sourceKind: 'customer_asset' });
  assert.equal(plan[0]?.route, 'review');
  assert.match(plan[0]?.reasons.join('；') || '', /多人镜头/);
  assert.match(plan[0]?.reasons.join('；') || '', /遮挡/);
});

test('splits long provider inputs and gates full-person replacement', () => {
  const plan = buildPersonReplacementPlan([{ time: '0-24s', visual: '单人全身出镜讲解' }], 'expert', { sourceKind: 'licensed_asset' });
  assert.deepEqual(plan.map(item => item.duration), [10, 10, 4]);
  assert.ok(plan.every(item => item.route === 'review'));
  assert.ok(plan.every(item => item.mode === 'expert'));
  assert.ok(plan.every(item => item.providerOrder[0] === 'runway_kling_motion'));
});

test('creative mode permits composition changes and can generate a clear shot', () => {
  const plan = buildPersonReplacementPlan([{ time: '0-5', visual: '单人半身口播' }], 'creative');
  assert.equal(plan[0]?.route, 'replace');
  assert.equal(plan[0]?.scope, 'creative_person');
  assert.match(plan[0]?.reasons.join('；') || '', /允许重新设计/);
});

test('auto routing recreates external references and blocks direct editing without derivative rights', () => {
  const auto = buildPersonReplacementPlan([{ time: '0-5', visual: '单人半身口播' }]);
  assert.equal(auto[0]?.mode, 'creative');
  assert.equal(auto[0]?.feasibility, 'functional_equivalent');
  assert.equal(auto[0]?.route, 'replace');
  const blocked = buildPersonReplacementPlan([{ time: '0-5', visual: '单人半身口播' }], 'fast');
  assert.equal(blocked[0]?.route, 'blocked');
  assert.equal(blocked[0]?.feasibility, 'blocked_for_facts_or_rights');
  assert.equal(replacementPlanSummary(blocked).billableSeconds, 0);
});

test('auto routing chooses strict modes only for authorized source assets', () => {
  const halfBody = buildPersonReplacementPlan([{ time: '0-5', visual: '单人半身口播' }], 'auto', { sourceKind: 'customer_asset' });
  const fullBody = buildPersonReplacementPlan([{ time: '0-5', visual: '单人全身出镜讲解' }], 'auto', { sourceKind: 'licensed_asset' });
  assert.equal(halfBody[0]?.mode, 'fast');
  assert.equal(fullBody[0]?.mode, 'expert');
  assert.equal(fullBody[0]?.feasibility, 'full_fidelity');
});

test('quality gate requires measurements and rejects failed expert motion', () => {
  assert.equal(evaluatePersonReplacementQuality('expert', { identityPassed: true }).status, 'needs_measurement');
  const result = evaluatePersonReplacementQuality('expert', {
    durationDeltaFrames: 0, audioCorrelation: 0.999, backgroundSsim: 0.97,
    normalizedPoseError: 0.09, handPck: 0.7, identityPassed: true, visibleArtifactCount: 1,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failures.length, 3);
});

test('strict modes pass measured thresholds while creative output needs human review', () => {
  assert.equal(evaluatePersonReplacementQuality('fast', {
    durationDeltaFrames: 1, audioCorrelation: 0.999, backgroundSsim: 0.99,
    headSilhouetteCoverage: 0.95, identityPassed: true, visibleArtifactCount: 0,
  }).status, 'passed');
  assert.equal(evaluatePersonReplacementQuality('creative', { identityPassed: true, visibleArtifactCount: 0 }).status, 'manual_review');
});

test('fast mode rejects a shorter target hairstyle that exposes unrecoverable source pixels', () => {
  const result = evaluatePersonReplacementQuality('fast', {
    durationDeltaFrames: 0, audioCorrelation: 1, backgroundSsim: 0.99,
    headSilhouetteCoverage: 0.48, identityPassed: true, visibleArtifactCount: 0,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.failures.join(' '), /头发轮廓/);
});

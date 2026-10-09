import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateToolsFor, cueFirstFrameTime, digitalHumanPipelineFor, digitalHumanRouteSteps, newDigitalHumanRequirements, planDigitalHumanShot, referenceCues, referenceModelInputAuthorization, routeStepsForExecution, usesDirectReferenceVideo, type DigitalHumanRequirements } from './digitalHumanPlan';
import { initialDigitalHumanQuality, recordDigitalHumanMediaCheck, reviewDigitalHumanQuality } from './digitalHumanQuality';
import { newShotProduction, patchShot, shotFingerprint } from './shotProduction';

const base = { narration: '介绍产品', hasAuthorizedPresenter: true, talkingAvailable: true };
const reference: DigitalHumanRequirements = {
  ...newDigitalHumanRequirements(), workflow: 'viral_replication', method: 'replace', contentConfirmed: true, presenterSelected: true, replacementScope: 'person_keep_scene', targetEffect: 'reference_motion',
  action: '举起产品', scene: '展厅', preserve: '产品、背景、动作',
  reference: { videoUrl: '/reference.mp4', start: 1, end: 4, originalText: '介绍产品', derivativeAuthorized: true, derivativeAuthorizationEvidence: '企业自有拍摄 AUTH-1' },
};
test('product routes keep Pipeline 3 quality scope separate from Pipeline 1 and 2', () => {
  assert.equal(digitalHumanPipelineFor(), 'pipeline_1');
  assert.equal(digitalHumanPipelineFor({ ...newDigitalHumanRequirements(), method: 'talking' }), 'pipeline_1');
  assert.equal(digitalHumanPipelineFor({ ...reference, method: 'replace' }), 'pipeline_2');
  assert.equal(digitalHumanPipelineFor({ ...reference, method: 'reenact', replicationMode: 'direct_reference' }), 'pipeline_2');
  assert.equal(digitalHumanPipelineFor({ ...reference, method: 'reenact', replicationMode: 'sentence_first_frame' }), 'pipeline_3');
});
test('talking requires confirmation for new requirements, preserves legacy admission and checks capability', () => {
  assert.equal(planDigitalHumanShot(base).executable, true);
assert.equal(planDigitalHumanShot({ ...base, requirements: newDigitalHumanRequirements() }).state, 'ready');
assert.deepEqual(referenceModelInputAuthorization(reference, '2026-09-24T00:00:00.000Z'), { evidence: '企业自有拍摄 AUTH-1', confirmedAt: '2026-09-24T00:00:00.000Z' });
assert.equal(referenceModelInputAuthorization({ ...reference, method: 'reenact', reference: { ...reference.reference!, modelInputAuthorized: false } }, '2026-09-24T00:00:00.000Z'), null);
assert.deepEqual(referenceModelInputAuthorization({ ...reference, method: 'reenact', replicationMode: 'direct_reference', reference: { ...reference.reference!, modelInputAuthorized: true, modelInputAuthorizationEvidence: '允许供应商处理 AUTH-MODEL-1' } }, '2026-09-24T00:00:00.000Z'), { evidence: '允许供应商处理 AUTH-MODEL-1', confirmedAt: '2026-09-24T00:00:00.000Z' });
assert.equal(referenceModelInputAuthorization({ ...reference, method: 'reenact', replicationMode: 'sentence_first_frame', reference: { ...reference.reference!, modelInputAuthorized: true, modelInputAuthorizationEvidence: '不应使用' } }, '2026-09-24T00:00:00.000Z'), null);
assert.equal(usesDirectReferenceVideo({ ...reference, method: 'reenact', replicationMode: 'sentence_first_frame' }), false);
assert.equal(usesDirectReferenceVideo({ ...reference, method: 'reenact', replicationMode: 'direct_reference' }), true);
assert.equal(cueFirstFrameTime({ id: 'c1', start: 1.2, end: 2.5, originalText: '原句', targetText: '目标句', shotIds: [] }), 1.2);
assert.equal(cueFirstFrameTime({ id: 'c1', start: 1.2, end: 2.5, originalText: '原句', targetText: '目标句', shotIds: [], sourceFirstFrame: { time: 1.8 } }), 1.8);
  assert.equal(planDigitalHumanShot({ ...base, requirements: { ...newDigitalHumanRequirements(), contentConfirmed: true } }).provider, 'heygen');
  assert.equal(planDigitalHumanShot({ ...base, talkingAvailable: false }).executable, false);
  assert.equal(planDigitalHumanShot({ ...base, hasAuthorizedPresenter: false }).state, 'needs_input');
  assert.equal(planDigitalHumanShot({ ...base, requirements: { ...newDigitalHumanRequirements(), contentConfirmed: true }, presenterCapabilities: ['reference_image'] }).state, 'needs_input');
});
test('reference generation never silently falls back to a talking provider', () => {
  for (const method of ['replace', 'reenact'] as const) {
    const plan = planDigitalHumanShot({ ...base, requirements: { ...reference, method } });
    assert.notEqual(plan.state, 'ready');
    assert.equal(plan.provider, null);
    assert.equal(plan.executable, false);
  }
  assert.equal(planDigitalHumanShot({ ...base, requirements: { ...reference, method: 'talking' } }).executable, false, 'talking must not ignore motion and scene constraints');
});
test('sentence-first-frame reenactment is executable only after Seedream + Seedance preflight', () => {
  const requirements: DigitalHumanRequirements = {
    ...reference,
    method: 'reenact',
    replicationMode: 'sentence_first_frame',
    preferredProvider: 'sd',
    replacementScope: 'person_and_scene',
    targetEffect: 'flexible_scene',
    reference: {
      ...reference.reference!,
      cues: [{ id: 'sentence-1', start: 1, end: 5, originalText: '原句', targetText: '目标口播', shotIds: ['shot-1'], personShot: true, compositionClusterId: 'front-medium' }],
    },
  };
  const unavailable = planDigitalHumanShot({ ...base, requirements, seedanceSentenceAvailable: false });
  assert.equal(unavailable.state, 'preview_only');
  assert.equal(unavailable.executable, false);
  assert.equal(unavailable.provider, null);
  assert.match(unavailable.reasons.join('；'), /尚未通过运行环境预检/);

  const ready = planDigitalHumanShot({ ...base, requirements, seedanceSentenceAvailable: true });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.executable, true);
  assert.equal(ready.provider, 'runway_seedance');
});
test('candidate tools reflect the visual operation instead of the shared digital-human category', () => {
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'replace' }), ['local_head_pipeline', 'runway_kling_motion']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'reenact' }), ['runway_kling_motion', 'runway_seedance', 'runway_act_two', 'self_hosted_video']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'talking' }), ['heygen']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'reenact', preferredProvider: 'sd' }), ['runway_seedance']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'reenact', preferredProvider: 'kling' }), ['runway_kling_motion']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'reenact', preferredProvider: 'runway' }), ['runway_act_two']);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'replace', preferredProvider: 'runway' }), []);
  assert.deepEqual(candidateToolsFor({ ...reference, method: 'replace', preferredProvider: 'self_hosted' }), ['local_head_pipeline']);
});
test('reference validation rejects incomplete evidence, invalid time ranges and unlicensed replacement', () => {
  for (const patch of [{ videoUrl: '' }, { start: -1 }, { end: 1 }, { end: NaN }, { originalText: '' }, { derivativeAuthorized: false }, { derivativeAuthorizationEvidence: '' }]) {
    const result = planDigitalHumanShot({ ...base, requirements: { ...reference, reference: { ...reference.reference!, ...patch } } });
    assert.equal(result.state, 'needs_input');
  }
});
test('reference cues preserve many-to-many sentence and shot mappings while legacy references remain readable', () => {
  assert.deepEqual(referenceCues(reference).map(cue => cue.id), ['legacy-reference']);
  const mapped = { ...reference, reference: { ...reference.reference!, cues: [
    { id: 'sentence-1', start: 1, end: 2, originalText: '第一句', targetText: '改写一', shotIds: ['shot-a', 'shot-b'] },
    { id: 'sentence-2', start: 2, end: 4, originalText: '第二句', targetText: '改写二', shotIds: ['shot-b'] },
  ] } };
  assert.deepEqual(referenceCues(mapped).map(cue => cue.shotIds), [['shot-a', 'shot-b'], ['shot-b']]);
  assert.equal(planDigitalHumanShot({ ...base, requirements: mapped }).state, 'preview_only');
  assert.equal(planDigitalHumanShot({ ...base, requirements: mapped, presenterCapabilities: ['talking'] }).state, 'needs_input');
  const invalid = { ...mapped, reference: { ...mapped.reference, cues: [{ ...mapped.reference.cues[0], end: 0 }] } };
  assert.equal(planDigitalHumanShot({ ...base, requirements: invalid }).state, 'needs_input');
});
test('manually split physical shots require explicit classification and person speech', () => {
  const cue = { id: 'shot-1', start: 1, end: 2, originalText: '原句', targetText: '', shotIds: ['shot-a'], splitFromCueId: 'sentence-1' };
  const requirements = { ...reference, reference: { ...reference.reference!, cues: [cue] } };
  assert.match(planDigitalHumanShot({ ...base, requirements }).reasons.join('；'), /指定类型/);
  assert.match(planDigitalHumanShot({ ...base, requirements: { ...requirements, reference: { ...requirements.reference, cues: [{ ...cue, personShot: true }] } } }).reasons.join('；'), /填写本片对应语句/);
  assert.doesNotMatch(planDigitalHumanShot({ ...base, requirements: { ...requirements, reference: { ...requirements.reference, cues: [{ ...cue, personShot: false }] } } }).reasons.join('；'), /拆分后的每个物理镜头/);
});
test('changed reference, identity or narration revokes content approval and invalidates old candidates', () => {
  const shot = { ...newShotProduction('介绍产品', 'person-1'), source: 'avatar' as const, digitalHuman: reference };
  for (const change of [{ narration: '新台词' }, { presenterId: 'person-2' }, { digitalHuman: { ...reference, preserve: '新保留要求' } }]) {
    const next = patchShot(shot, change);
    assert.equal(next.digitalHuman?.contentConfirmed, false);
    assert.notEqual(shotFingerprint(next, ''), shotFingerprint(shot, ''));
  }
  assert.equal(patchShot(shot, { layout: 'split' }).digitalHuman?.contentConfirmed, true);
  const unconfirmed = { ...shot, digitalHuman: { ...reference, contentConfirmed: false } };
  assert.equal(patchShot(unconfirmed, { digitalHuman: reference }).digitalHuman?.contentConfirmed, true);
});
test('route dependencies expose generation, automatic checks and automatic assembly without a manual checkpoint', () => {
  const planned = digitalHumanRouteSteps('replace', 'runway_act_two', true);
  assert.deepEqual(planned.map(step => step.dependsOn), [[], ['source_alignment'], ['generation'], ['automatic_quality']]);
  assert.equal(planned.some(step => step.id === 'manual_review'), false);
  assert.equal(planned.find(step => step.id === 'generation')?.tool, 'runway_act_two');
  const initial = initialDigitalHumanQuality(undefined, '2026-01-01T00:00:00Z');
  assert.equal(routeStepsForExecution(planned, 'pending', initial).find(step => step.id === 'generation')?.status, 'running');
  const admitted = recordDigitalHumanMediaCheck(initial, { passed: true, evidence: 'material:m1' });
  assert.equal(routeStepsForExecution(planned, 'completed', admitted).find(step => step.id === 'assembly')?.status, 'ready');
  const decisions = Object.fromEntries(admitted.checks.filter(check => check.mode === 'manual').map(check => [check.key, { passed: true, evidence: '人工确认' }]));
  const accepted = reviewDigitalHumanQuality(admitted, decisions, '2026-01-01T00:01:00Z');
  const completed = routeStepsForExecution(planned, 'completed', accepted);
  assert.equal(completed.find(step => step.id === 'assembly')?.status, 'ready');
  assert.equal(routeStepsForExecution(planned, 'completed', accepted, true).find(step => step.id === 'assembly')?.status, 'completed');
  assert.equal(digitalHumanRouteSteps('replace', null, false, 'needs_input')[0]?.status, 'attention');
  assert.equal(digitalHumanRouteSteps('replace', null, false, 'needs_confirmation')[0]?.status, 'ready');
});

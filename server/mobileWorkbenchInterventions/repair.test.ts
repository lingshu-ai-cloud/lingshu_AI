import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareScopedRepair, validateSingleOperationBudget, selectInterventionOption, type RepairSnapshot } from './repair.js';

const snapshot: RepairSnapshot = {
  version: 'v2', scenes: ['电路板', '背面焊点', '接口安装'].map((intent, sceneIndex) => ({ id: `s${sceneIndex}`, sceneIndex, intent, duration: 3 })),
  assets: [{ id: 'replacement', type: 'image', duration: 0, visualObservations: ['背面焊点'] }],
  issues: [{ sceneIndex: 1, start: 3, end: 6, code: 'blur', reason: '模糊' }],
  spec: { scenePlanOrigin: 'director', sceneSourcePlan: [0, 1, 2].map(sceneIndex => ({ sceneIndex, assetId: `old${sceneIndex}`, start: sceneIndex * 3, end: (sceneIndex + 1) * 3 })),
    script: 'confirmed', alignedCuesByLang: { en: ['preserved'] }, voiceoverUrl: '/voice.wav', renderOutputPath: '/bad.mp4', automation: { contentVersion: 2, narrationReviewPassed: true } },
};
const payload = { sceneIds: ['s1'], repairPlanVersion: 'v2', problemType: 'blur' as const };
test('repair invokes production allocator and preserves good shots and narration', () => {
  const result = prepareScopedRepair(snapshot, payload);
  assert.equal(result.spec.sceneSourcePlan[1].assetId, 'replacement');
  assert.deepEqual(result.spec.sceneSourcePlan[0], snapshot.spec.sceneSourcePlan[0]);
  assert.deepEqual(result.spec.sceneSourcePlan[2], snapshot.spec.sceneSourcePlan[2]);
  assert.equal(result.spec.voiceoverUrl, snapshot.spec.voiceoverUrl);
  assert.deepEqual(result.spec.alignedCuesByLang, snapshot.spec.alignedCuesByLang);
  assert.equal(result.spec.automation.contentVersion, 3);
  assert.equal(result.stage, 'render');
  assert.deepEqual(result.preservedSceneIds, ['s0', 's2']);
  assert.equal(snapshot.spec.renderOutputPath, '/bad.mp4');
});
test('rejects stale evidence, foreign scene, passed scene and wrong issue type', () => {
  for (const invalid of [{ ...payload, repairPlanVersion: 'v1' }, { ...payload, sceneIds: ['foreign'] },
    { ...payload, sceneIds: ['s0'] }, { ...payload, problemType: 'blank' as const }, { ...payload, sceneIds: ['s1', 's1'] }])
    assert.throws(() => prepareScopedRepair(snapshot, invalid));
});
test('does not override human-locked sources, exhausted repair limit or missing evidence', () => {
  assert.throws(() => prepareScopedRepair({ ...snapshot, spec: { ...snapshot.spec, scenePlanOrigin: 'user' } }, payload));
  assert.throws(() => prepareScopedRepair({ ...snapshot, spec: { ...snapshot.spec, automation: { sceneRepairAttempts: 2 } } }, payload));
  assert.throws(() => prepareScopedRepair({ ...snapshot, assets: [] }, payload));
});
test('budget is bounded single operation authorization and rejects underfunding/expired/infinite grants', () => {
  const now = Date.now(), grant = { operationId: 'command:scene:1', estimatedIncrementCny: 2, maxIncrementCny: 3, expiresAt: new Date(now + 60000).toISOString() };
  assert.equal(validateSingleOperationBudget(grant, now).scope, 'single_operation');
  for (const invalid of [{ ...grant, maxIncrementCny: 1 }, { ...grant, maxIncrementCny: Infinity },
    { ...grant, expiresAt: new Date(now - 1).toISOString() }, { ...grant, expiresAt: new Date(now + 86400001).toISOString() }])
    assert.throws(() => validateSingleOperationBudget(invalid, now));
});
test('choice uses server supplied options, refusing unavailable or invented choices', () => {
  const options = [{ id: 'repair', enabled: true, payload }, { id: 'raise_budget', enabled: false, payload: null }];
  assert.deepEqual(selectInterventionOption(options, 'repair').payload, payload);
  assert.throws(() => selectInterventionOption(options, 'raise_budget'));
  assert.throws(() => selectInterventionOption(options, 'invented'));
});

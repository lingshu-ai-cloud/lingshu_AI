import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReferenceShotProductionRouting, type ReferenceProductionRouteInput,
  type ReferencePresenterContinuityEvidence } from './referenceShotProductionRouting.js';

const sourceSha256 = 'source-sha';
function shot(shotId: string, role: ReferencePresenterContinuityEvidence['observedPresenterRole'],
  presence: ReferencePresenterContinuityEvidence['personPresence'], critical = false, personId = ''): ReferenceProductionRouteInput {
  return { shotId, time: '0–2s', criticalShot: { classification: critical ? 'critical' : 'non_critical', model: 'qwen3-vl-flash' },
    presenterContinuityEvidence: { time: '0–2s', observedPresenterRole: role, personPresence: presence,
      personContinuityId: personId, confidence: .95, evidence: ['真实原片0.1和1.8秒帧证据'],
      frameSeconds: [.1, 1.8], model: 'qwen3-vl-flash', provenance: 'qwen_vl:source_frames', sourceSha256 } };
}
const build = (shots: ReferenceProductionRouteInput[]) => buildReferenceShotProductionRouting({ shots, sourceSha256 });

test('sales presenter and same-person action always use reference generation even when noncritical', () => {
  const result = build([shot('hook', 'sales_presenter', 'person', true, 'person_1'),
    shot('show', 'presenter_action', 'person', false, 'person_1'), shot('cta', 'sales_presenter', 'person', false, 'person_1')]);
  assert.deepEqual(result.shots.map(item => item.productionRouting.route), Array(3).fill('reference_frame_presenter'));
  assert.deepEqual(result.shots.map(item => item.productionRouting.tier), ['high', 'standard', 'standard']);
  for (const item of result.shots) {
    assert.equal(item.productionRouting.constraints.forbidGenericPersonMatch, true);
    assert.equal(item.productionRouting.constraints.mustUseReferenceFrames, true);
    assert.deepEqual(item.productionRouting.identityLock?.samePersonShotIds, ['hook', 'show', 'cta']);
    assert.equal(item.productionRouting.identityLock?.sourcePersonId, 'person_1');
  }
});

test('one source continuity group binds one target across all its shots; route ready does not claim asset bound', () => {
  const shots = [shot('a', 'sales_presenter', 'person', true, 'person_1'), shot('b', 'presenter_action', 'person', false, 'person_1')];
  const withoutTarget = build(shots);
  assert.equal(withoutTarget.shots[0].productionRouting.state, 'ready');
  assert.equal(withoutTarget.shots[0].productionRouting.identityLock?.targetPresenterAssetId, null);
  const withTarget = buildReferenceShotProductionRouting({ shots, sourceSha256, identityTargets: { person_1: 'account-presenter' } });
  assert.deepEqual(withTarget.shots.map(item => item.productionRouting.identityLock?.targetPresenterAssetId), ['account-presenter', 'account-presenter']);
});

test('confirmed no-person routing follows criticality, separate from hands-only or background people', () => {
  const result = build([shot('empty-normal', 'none', 'none'), shot('empty-key', 'none', 'none', true),
    shot('hands', 'none', 'hands_only'), shot('worker', 'background', 'person'), shot('worker-key', 'background', 'person', true)]);
  assert.deepEqual(result.shots.map(item => item.productionRouting.route),
    ['library_match', 'aigc_video', 'non_presenter_library_match', 'non_presenter_library_match', 'non_presenter_aigc_video']);
  assert.equal(result.shots[2].productionRouting.personPresence, 'hands_only');
  assert.equal(result.shots[3].productionRouting.observedPresenterRole, 'background');
  assert.ok(result.shots.every(item => item.productionRouting.identityLock === null));
});

test('legacy role none and prose descriptions do not prove absence or admit generic person matching', () => {
  const old = { shotId: 'old', time: '0–2s', criticalShot: { classification: 'non_critical' as const },
    observedPresenterRole: 'none', visual: 'No people; face absent; workers in background; white coat' };
  const result = build([old]);
  assert.equal(result.shots[0].productionRouting.route, 'undetermined');
  assert.equal(result.shots[0].productionRouting.personPresence, 'unknown');
  assert.equal(result.shots[0].productionRouting.automaticAnalysisRequired, true);
  assert.equal(result.shots[0].productionRouting.constraints.forbidGenericPersonMatch, true);
});

test('missing identity or action actor not bound to a known source speaker remains unresolved', () => {
  const result = build([shot('no-id', 'sales_presenter', 'person'),
    shot('actor', 'presenter_action', 'person', false, 'unbound_actor'), shot('unclear', 'unknown', 'person')]);
  assert.ok(result.shots.every(item => item.productionRouting.route === 'undetermined'));
  assert.ok(result.shots.every(item => item.productionRouting.automaticAnalysisRequired));
});

test('mismatched source/time, coarse identity confidence and invalid frames cannot authorize routes', () => {
  for (const mode of ['sha', 'time', 'confidence', 'frames', 'model', 'provenance', 'evidence']) {
    const item = shot('a', 'sales_presenter', 'person', false, 'person_1');
    const evidence = item.presenterContinuityEvidence!;
    if (mode === 'sha') evidence.sourceSha256 = 'other-source';
    if (mode === 'time') evidence.time = '0–3s';
    if (mode === 'confidence') evidence.confidence = .6;
    if (mode === 'frames') evidence.frameSeconds = [.1, 2.1];
    if (mode === 'model') evidence.model = '';
    if (mode === 'provenance') evidence.provenance = '';
    if (mode === 'evidence') evidence.evidence = [];
    const result = build([item]);
    assert.equal(result.shots[0].productionRouting.route, 'undetermined', mode);
    assert.equal(result.shots[0].productionRouting.automaticAnalysisRequired, true, mode);
  }
});

test('shot-wide audio quality does not erase independently reliable visual identity evidence', () => {
  const item = { ...shot('a', 'sales_presenter', 'person', false, 'person_1'), needsReview: true, confidence: .55 };
  const result = build([item]);
  assert.equal(result.shots[0].productionRouting.route, 'reference_frame_presenter');
  assert.equal(result.shots[0].productionRouting.source.model, 'qwen3-vl-flash');
});

test('background cannot silently reuse the confirmed protagonist ID, and conflicting role/presence is unresolved', () => {
  const result = build([shot('speaker', 'sales_presenter', 'person', false, 'person_1'),
    shot('conflict', 'background', 'person', false, 'person_1'), shot('inconsistent', 'none', 'person')]);
  assert.equal(result.shots[1].productionRouting.route, 'undetermined');
  assert.equal(result.shots[2].productionRouting.route, 'undetermined');
});

test('missing critical decision does not become cheap generic material, and input evidence is not mutated', () => {
  const item = shot('a', 'sales_presenter', 'person', false, 'person_1');
  delete item.criticalShot;
  const original = JSON.stringify(item);
  const result = build([item]);
  assert.equal(result.shots[0].productionRouting.criticality, 'unknown');
  assert.equal(result.shots[0].productionRouting.route, 'undetermined');
  assert.equal(JSON.stringify(item), original);
});

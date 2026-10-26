import test from 'node:test';
import assert from 'node:assert/strict';
import type { SocialReferenceVideoAnalysis, SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { socialReferenceFidelityFailures } from './socialContentReferenceFidelity.js';

function fixture() {
  const shots = Array.from({ length: 37 }, (_, index) => ({ shotId: `ref-${index}`, startSeconds: index * 38 / 37, endSeconds: (index + 1) * 38 / 37 }));
  const referenceAnalysis = { analysisId: 'analysis', status: 'ready', durationSeconds: 38, shots } as SocialReferenceVideoAnalysis;
  const replicationScript = { referenceAnalysisId: 'analysis', shots: shots.map(shot => ({ ...shot, shotId: `script-${shot.shotId}`, referenceShotId: shot.shotId })) } as SocialReplicationScriptVersion;
  return { referenceAnalysis, replicationScript };
}
test('accepts all 37 ordered physical slots covering 38 seconds and does not mutate inputs', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  assert.deepEqual(socialReferenceFidelityFailures(input), []);
  assert.equal(JSON.stringify(input), before);
});
test('blocks five-scene semantic consolidation despite retained reference IDs', () => {
  const input = fixture();
  input.replicationScript.shots = input.replicationScript.shots.slice(0, 5).map((shot, index) => ({ ...shot, referenceShotIds: input.referenceAnalysis.shots.slice(index * 7, index * 7 + 7).map(row => row.shotId), scriptOrigin: 'budget_semantic_revision', startSeconds: index * 3.6, endSeconds: (index + 1) * 3.6 }));
  const failures = socialReferenceFidelityFailures(input);
  assert.ok(failures.includes('reference_fidelity:shot_count_mismatch'));
  assert.ok(failures.some(row => row.includes('many_to_one')));
  assert.ok(failures.includes('reference_fidelity:reference_slots_omitted'));
  assert.ok(failures.includes('reference_fidelity:script_total_duration_mismatch'));
});
test('forbids budget semantic origin even when every slot identity and time is retained', () => {
  const input = fixture();
  input.replicationScript.shots[0]!.scriptOrigin = 'budget_semantic_revision';
  assert.deepEqual(socialReferenceFidelityFailures(input), ['reference_fidelity:semantic_compression_forbidden:0']);
});
test('blocks reordered, mistimed duplicate, foreign and missing reference slot bindings', () => {
  for (const mutation of ['order', 'duplicate', 'foreign', 'missing'] as const) {
    const input = fixture();
    if (mutation === 'order') [input.replicationScript.shots[0], input.replicationScript.shots[1]] = [input.replicationScript.shots[1]!, input.replicationScript.shots[0]!];
    if (mutation === 'duplicate') input.replicationScript.shots[1]!.referenceShotId = 'ref-0';
    if (mutation === 'foreign') input.replicationScript.shots[1]!.referenceShotId = 'foreign';
    if (mutation === 'missing') input.replicationScript.shots[1]!.referenceShotId = null;
    const failures = socialReferenceFidelityFailures(input);
    assert.ok(mutation === 'duplicate'
      ? failures.some(row => row.includes('slot_timing_mismatch'))
      : failures.some(row => row.includes('slot_identity_or_order_mismatch')), mutation);
  }
});
test('allows contiguous temporal children to retain one reference slot identity', () => {
  const input = fixture();
  const parent = input.replicationScript.shots[0]!;
  const midpoint = (parent.startSeconds + parent.endSeconds) / 2;
  input.replicationScript.shots.splice(0, 1,
    { ...parent, shotId: `${parent.shotId}__part-01`, endSeconds: midpoint },
    { ...parent, shotId: `${parent.shotId}__part-02`, startSeconds: midpoint });
  assert.deepEqual(socialReferenceFidelityFailures(input), []);
});
test('blocks 18-second retiming even with 37 intact identities and 10.923-second truncation', () => {
  const input = fixture();
  input.replicationScript.shots = input.replicationScript.shots.map(shot => ({ ...shot, startSeconds: shot.startSeconds * 18 / 38, endSeconds: shot.endSeconds * 18 / 38 }));
  assert.ok(socialReferenceFidelityFailures(input).some(row => row.includes('slot_timing_mismatch')));
  input.replicationScript.shots.at(-1)!.endSeconds = 10.923;
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:script_total_duration_mismatch'));
});
test('allows serialization drift but blocks gaps, invalid intervals and analysis identity mismatch', () => {
  const input = fixture();
  input.replicationScript.shots[1]!.startSeconds += 0.001;
  assert.deepEqual(socialReferenceFidelityFailures(input), []);
  input.replicationScript.shots[1]!.endSeconds = Number.NaN;
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:invalid_script_interval:1'));
  input.referenceAnalysis.shots[2]!.startSeconds += 0.2;
  input.replicationScript.referenceAnalysisId = 'other';
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:reference_timeline_gap_or_overlap:2'));
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:analysis_identity_mismatch'));
});
test('missing and unready reference evidence fail closed', () => {
  assert.deepEqual(socialReferenceFidelityFailures({ referenceAnalysis: null, replicationScript: null }), ['reference_fidelity:missing_reference_analysis', 'reference_fidelity:missing_replication_script']);
  const input = fixture();
  input.referenceAnalysis.status = 'analyzing';
  input.referenceAnalysis.durationSeconds = null;
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:reference_not_ready'));
  assert.ok(socialReferenceFidelityFailures(input).includes('reference_fidelity:missing_reference_duration'));
});

test('measured coverage permits an excluded opening cover flash, never an unverified gap', () => {
  const input = fixture();
  input.referenceAnalysis.shots[0]!.startSeconds = .1;
  input.replicationScript.shots[0]!.startSeconds = .1;
  assert.ok(socialReferenceFidelityFailures(input).some(code => code.endsWith('gap_or_overlap:0')));
  input.referenceAnalysis.coverage = { fullDurationSeconds: 38, precisionIntervals: [], gaps: [], overallConfidence: 1, fullTimelineCovered: true };
  assert.deepEqual(socialReferenceFidelityFailures(input), []);
  input.referenceAnalysis.shots[0]!.startSeconds = .3;
  input.replicationScript.shots[0]!.startSeconds = .3;
  assert.ok(socialReferenceFidelityFailures(input).some(code => code.endsWith('gap_or_overlap:0')));
});

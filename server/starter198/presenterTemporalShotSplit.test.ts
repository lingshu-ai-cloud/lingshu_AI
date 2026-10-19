import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { presenterTemporalObservationsFromExactAnalysis, splitPresenterTemporalShots, type PresenterTemporalObservation } from './presenterTemporalShotSplit.js';

function fixture(): SocialReplicationScriptVersion {
  const line = { lineId: 'line-1', referenceText: '原口播', draftText: '目标口播', sourceStartSeconds: 0,
    sourceEndSeconds: 4, sourcePrecision: 'phrase' as const, sourceProvenance: 'verified-asr', replacedEntityTypes: [],
    narrationOwnerShotId: 'presenter', visualShotIds: ['presenter'] };
  return { version: '1', referenceAnalysisId: 'analysis', status: 'review_required', primaryHookId: 'hook', hookOptions: [],
    shots: [{ shotId: 'presenter', referenceShotId: 'reference-presenter', startSeconds: 0, endSeconds: 4,
      purpose: 'proof', visualInstruction: '真人展示产品', referenceSpokenText: '原口播', spokenText: '目标口播', speechLines: [line],
      voiceoverReplacement: { mode: 'identity_only', replacedEntityTypes: [] }, captionText: null, audioAndTransition: null,
      fidelityPoints: [], mustDifferPoints: [], lockedRegions: [], risks: [], materialPlan: { shotId: 'presenter', function: 'proof',
        requestedDescription: null, sourceStrategy: 'authorized_digital_presenter', sourceRefs: [], fallbackSourceStrategy: null,
        productionInstruction: '', truthBoundary: { subject: 'none', syntheticVisualAllowed: true,
          customerEvidenceRequired: false, customerEvidenceRefs: [], confirmedFactRefs: [],
          mustNotImplyCustomerReality: false, prohibitedRepresentations: [] },
        functionalEquivalentReplacement: { required: false, preservesFunction: 'proof', replacesSubject: null,
          description: null, reason: null },
        feasibility: 'full_fidelity', feasibilityReason: '', customerShootRequired: false } }], narrationLines: [line],
    narrationSourceStatus: 'asr_aligned', structureFidelitySummary: '', originalityDifferenceSummary: '', createdAt: '2026-10-17' };
}

const row = (startSeconds: number, endSeconds: number, motion: 'stable'|'dynamic', productAction: PresenterTemporalObservation['productAction']): PresenterTemporalObservation => ({
  startSeconds, endSeconds, subject: 'presenter', motion, productAction,
  sampleIntervalSeconds: 0.25,
  frameRefs: [`frame-${startSeconds}-a`, `frame-${startSeconds}-b`],
});

test('keeps pick-up, holding and put-down on Seedance, then cuts to HeyGen only after product contact ends', () => {
  const result = splitPresenterTemporalShots({ script: fixture(), observationsByShotId: { presenter: [
    row(0, 1, 'dynamic', 'pick_up'), row(1, 2, 'stable', 'holding_still'),
    row(2, 3, 'stable', 'put_down'), row(3, 4, 'stable', 'none'),
  ] } });
  assert.deepEqual(result.splitShotIds, ['presenter']);
  assert.equal(result.script.shots.length, 2);
  assert.match(result.script.shots[0]!.visualInstruction, /动态真人口播/);
  assert.match(result.script.shots[1]!.visualInstruction, /HeyGen/);
  assert.equal(result.script.shots[0]!.spokenText, '目标口播');
  assert.equal(result.script.shots[1]!.spokenText, null);
  assert.deepEqual(result.pipelineByShotId, { 'presenter__part-01': 'dynamic_presenter', 'presenter__part-02': 'heygen' });
  assert.deepEqual(result.script.narrationLines![0]!.visualShotIds, ['presenter__part-01', 'presenter__part-02']);
  assert.equal(result.script.narrationLines![0]!.narrationOwnerShotId, 'presenter__part-01');
});

test('stable holding alone remains on the dynamic presenter pipeline', () => {
  const result = splitPresenterTemporalShots({ script: fixture(), observationsByShotId: { presenter: [
    row(0, 2, 'stable', 'holding_still'), row(2, 4, 'stable', 'holding_still'),
  ] } });
  assert.equal(result.script.shots.length, 1);
  assert.equal(result.pipelineByShotId.presenter, 'dynamic_presenter');
});

test('does not densely split non-presenter material', () => {
  const observation = { ...row(0, 4, 'dynamic', 'none'), subject: 'non_presenter' as const };
  const result = splitPresenterTemporalShots({ script: fixture(), observationsByShotId: { presenter: [observation] } });
  assert.equal(result.script.shots.length, 1);
  assert.deepEqual(result.splitShotIds, []);
});

test('blocks incomplete or non-dense presenter evidence instead of guessing a cut', () => {
  const result = splitPresenterTemporalShots({ script: fixture(), observationsByShotId: { presenter: [row(0, 2, 'dynamic', 'none')] } });
  assert.deepEqual(result.blockedShotIds, ['presenter']);
  assert.equal(result.script.shots.length, 1);
});

test('requires finer frame sampling for presenter shots', () => {
  const sparse = { ...row(0, 4, 'stable', 'none'), sampleIntervalSeconds: 1 };
  const result = splitPresenterTemporalShots({ script: fixture(), observationsByShotId: { presenter: [sparse] } });
  assert.deepEqual(result.blockedShotIds, ['presenter']);
});

test('does not mistake text beats and clip URL fragments for inspected dense frames', () => {
  const script = fixture();
  const observations = presenterTemporalObservationsFromExactAnalysis({ script,
    denseSampling: { intervalSeconds: .5, ranges: [{ startSeconds: 0, endSeconds: 4 }] },
    details: [{ referenceShotId: 'reference-presenter', startSeconds: 0, endSeconds: 4, clipRef: '/media/reference.mp4',
      detail: { materialType: 'talking_head', motionClass: '走播', cameraMovement: '跟拍后固定', beats: [
        { time: '0-1s', action: '人物拿起产品并向前走动' },
        { time: '1-2s', action: '人物手持产品对镜展示' },
        { time: '2-3s', action: '人物放下产品' },
        { time: '3-4s', action: '人物站立保持稳定，固定镜头' },
      ] } }],
  });
  assert.deepEqual(observations, {});
  assert.deepEqual(presenterTemporalObservationsFromExactAnalysis({ script,
    denseSampling: { intervalSeconds: .5, ranges: [{ startSeconds: 0, endSeconds: 4 }] },
    details: [{ referenceShotId: 'reference-presenter', startSeconds: 0, endSeconds: 4, clipRef: '/media/factory.mp4',
      detail: { materialType: 'factory', beats: [{ time: '0-4s', action: '工厂设备移动' }] } }],
  }), {});
});

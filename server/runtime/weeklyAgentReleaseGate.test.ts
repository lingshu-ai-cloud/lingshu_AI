import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWeeklyAgentReleaseGate, type WeeklyAgentReleaseGateInput } from './weeklyAgentReleaseGate.js';
import { runtimeCapabilities } from './readiness.js';

const hash = (character: string) => character.repeat(64);
function fixture(): WeeklyAgentReleaseGateInput {
  const capabilities = runtimeCapabilities('all');
  capabilities.starter_workers = { ready: true };
  capabilities.digital_human_quality = { ready: true };
  capabilities.digital_human_auto_release = { ready: true };
  capabilities.scheduled_publishing = { ready: true };
  return {
    weekly: { tenantId: 'tenant', runId: 'run', taskId: 'task', publicationTaskId: 'publication', packageId: 'package', packageVersion: 1 },
    handoff: { schemaVersion: 'social-content-production-handoff.v3', handoffId: 'handoff:1', status: 'locked', taskId: 'task', version: '3', recordHash: hash('a'),
      sourceAnalysis: { analysisId: 'analysis', version: '1', coverageHash: hash('b') },
      shotTraces: [{ sceneId: 'scene-1', immutableIntentHash: hash('c'), execution: { idempotencyKey: 'execute-scene-1' } }] },
    queue: { tenantId: 'tenant', taskId: 'task', runId: 'run', status: 'succeeded', planVersion: '3', inputHash: hash('d') },
    graph: { identity: { tenantId: 'tenant', taskId: 'task', runId: 'run', planVersion: '3', inputHash: hash('d') }, completed: true,
      approval: { approved: true, receiptRef: 'approval:1', subjectVersion: '3', contentHash: hash('e') }, evidence: {
        assets: { artifactRefs: ['asset:1'], inputHash: hash('d') }, render: { artifactRefs: ['render:1'], inputHash: hash('d') },
        quality: { artifactRefs: ['quality:1'], inputHash: hash('d') }, delivery: { artifactRefs: ['film:1', 'package:1'], inputHash: hash('d') },
      } },
    qualityReceipts: [
      { gate: 'G4', sceneId: 'scene-1', status: 'passed', handoffId: 'handoff:1', handoffVersion: '3', evidenceRefs: ['technical:1'] },
      { gate: 'G5', status: 'passed', handoffId: 'handoff:1', handoffVersion: '3', evidenceRefs: ['director:1'] },
      { gate: 'G6', status: 'passed', handoffId: 'handoff:1', handoffVersion: '3', evidenceRefs: ['preflight:1'] },
    ],
    delivery: { artifactId: 'film:1', artifactStatus: 'approved', mediaSha256: hash('f'), packageId: 'package:1', packageStatus: 'ready', packageHash: hash('0'), artifactIds: ['film:1'] },
    capabilities,
  };
}

test('complete immutable evidence chain passes without mutating its input', () => {
  const input = fixture();
  const snapshot = structuredClone(input);
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, true);
  assert.equal(report.automaticPublicationReady, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(input, snapshot);
});

test('a broken handoff cannot be hidden by terminal graph or delivery UI state', () => {
  const input = fixture();
  input.handoff.shotTraces[0]!.immutableIntentHash = '';
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, false);
  assert.ok(report.issues.some(issue => issue.code === 'production_handoff_shot_lineage_invalid'));
});

test('graph evidence, canonical approval, quality receipts and physical media digest are all required', () => {
  const input = fixture();
  delete input.graph.evidence.quality;
  input.graph.approval = null;
  input.qualityReceipts = input.qualityReceipts.filter(receipt => receipt.gate !== 'G5');
  input.delivery.mediaSha256 = 'not-a-sha';
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, false);
  assert.deepEqual(report.issues.filter(issue => issue.blocking === 'film').map(issue => issue.code), [
    'production_graph_quality_evidence_invalid', 'canonical_human_approval_invalid',
    'g5_quality_receipt_missing', 'finished_film_artifact_invalid',
  ]);
});

test('runtime reports starter worker, visual QA and automatic release blockers explicitly', () => {
  const input = fixture();
  input.capabilities.starter_workers = { ready: false, reason: 'starter_workers_not_explicitly_enabled' };
  input.capabilities.digital_human_quality = { ready: false, reason: 'visual_qa_python_missing' };
  input.capabilities.digital_human_auto_release = { ready: false, reason: 'automatic_release_requires_visual_and_semantic_qa' };
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, false);
  assert.deepEqual(report.issues.map(issue => issue.code), [
    'capability_unavailable:starter_workers:starter_workers_not_explicitly_enabled',
    'capability_unavailable:digital_human_quality:visual_qa_python_missing',
    'capability_unavailable:digital_human_auto_release:automatic_release_requires_visual_and_semantic_qa',
  ]);
});

test('publishing worker is a separate downstream gate and does not erase finished-film readiness', () => {
  const input = fixture();
  input.capabilities.scheduled_publishing = { ready: false, reason: 'publishing_worker_not_enabled' };
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, true);
  assert.equal(report.automaticPublicationReady, false);
  assert.deepEqual(report.issues, [{ stage: 'runtime', code: 'capability_unavailable:scheduled_publishing:publishing_worker_not_enabled', blocking: 'automatic_publication' }]);
});

test('G6 business preflight blocks automatic publication without blocking film delivery', () => {
  const input = fixture();
  input.qualityReceipts = input.qualityReceipts.filter(receipt => receipt.gate !== 'G6');
  const report = inspectWeeklyAgentReleaseGate(input);
  assert.equal(report.filmReady, true);
  assert.equal(report.automaticPublicationReady, false);
  assert.ok(report.issues.some(issue => issue.code === 'g6_publication_preflight_receipt_missing'));
});

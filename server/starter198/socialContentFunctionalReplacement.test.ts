import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeFunctionalReplacement } from './socialContentFunctionalReplacement.js';

const base = () => ({
  record: { id: 'row', run_id: '' },
  detail: {
    runId: null,
    brief: { referenceMode: 'single_source_fidelity' },
    assetSupplyPlan: { overallFeasibility: 'functional_equivalent', shots: [{
      shotId: 'shot-1', sourceStrategy: 'customer_real_asset', feasibility: 'functional_equivalent',
      materialRouting: { policy: 'local_only', localMatch: { state: 'matched', sourceRefs: ['material:1'], evidenceRef: 'review:1' } },
      selectedMaterialSegment: { sourceRef: 'material:1', segmentId: 'segment-1', footageEvidence: {
        contentSha256: 'a'.repeat(64), productId: 'product-1', approvalId: 'approval-1', visualFindingId: 'finding-1',
      } },
    }] },
    agentWorkflow: { replicationJob: { factorSpecs: [{ factorId: 'factor-1', evidenceRefs: [{ evidenceId: 'e-1' }],
      validator: { detector: 'detector' }, target: { metric: 'metric' } }] } },
  },
  actorUserId: 'owner', revisedAt: '2026-10-20T00:00:00.000Z',
});

test('seals reviewed functional replacement while retaining reference evidence intent', () => {
  const input = base();
  const revision = authorizeFunctionalReplacement(input as never);
  assert.equal(revision.revisedReferenceMode, 'multi_source_hybrid');
  assert.equal(revision.semanticIntent, 'functionally_replaced');
  assert.equal(revision.retainedReferenceUse, 'structure_and_qa_evidence');
  assert.equal(revision.revisionHash.length, 64);
  assert.deepEqual(revision, authorizeFunctionalReplacement(input as never));
});

test('rejects replacement without reviewed material rights', () => {
  const input = base();
  input.detail.assetSupplyPlan.shots[0]!.materialRouting.localMatch.evidenceRef = '';
  assert.throws(() => authorizeFunctionalReplacement(input as never), /social_content_functional_replacement_reviewed_material_required/);
});

test('rejects replacement after run start', () => {
  const input = base(); input.record.run_id = 'run-1';
  assert.throws(() => authorizeFunctionalReplacement(input as never), /social_content_functional_replacement_run_started/);
});

test('rejects replacement without frozen factor evidence', () => {
  const input = base(); input.detail.agentWorkflow.replicationJob.factorSpecs[0]!.evidenceRefs = [];
  assert.throws(() => authorizeFunctionalReplacement(input as never), /social_content_functional_replacement_factor_evidence_required/);
});

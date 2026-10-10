import assert from 'node:assert/strict';
import test from 'node:test';
import { runProductionGapWorker } from './productionGapWorker.js';
import type { ProductionGapTask, VersionedReferenceSelection } from './orchestration.js';

function task(): ProductionGapTask {
  return { gapTaskId: 'gap-1', tenantId: 'tenant-1', upstreamTaskRef: 'weekly-task-1', taskGap: { description: 'opening proof', requiredSceneIds: ['opening'], minimumReferences: 1, requiredReadiness: 'production_reference', requestedModes: ['momentum'] }, budget: { currency: 'CNY', limitCny: 12, spentCny: 0 }, status: 'collecting', attemptCount: 0, lastError: null, lastAttemptAt: null, runRefs: [], selectedEvidenceRefs: [], referenceSelectionRef: null, stopReason: null, createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z' };
}

test('production gap consumes inventory first, persists selection, and resumes the original task', async () => {
  const saved: ProductionGapTask[] = [];
  let discoveryCalls = 0;
  let resumedTask = '';
  const result = await runProductionGapWorker(task(), {
    async loadInventory() { return [{ candidateId: 'candidate-1', evidenceId: 'evidence-1', evidenceVersion: 3, readiness: 'production_reference', taskRelevance: 0.9, transferability: 0.8, rightsClear: true, sceneIds: ['opening'], sourceRef: 'https://example.invalid/v' }]; },
    async executeRun() { discoveryCalls += 1; return { skipped: true as const }; },
    async persistSelection(input) { return { ...input.selection, selectionId: 'selection-1', version: 1, tenantId: input.tenantId, upstreamTaskRef: input.upstreamTaskRef, createdAt: '', supersedesSelectionId: null } as VersionedReferenceSelection; },
    async resumeUpstreamTask(value) { resumedTask = value.upstreamTaskRef; },
    async saveTask(value) { saved.push(structuredClone(value)); },
  });
  assert.equal(discoveryCalls, 0);
  assert.equal(result.status, 'resumed');
  assert.equal(resumedTask, 'weekly-task-1');
  assert.deepEqual(result.referenceSelectionRef, { selectionId: 'selection-1', version: 1 });
  assert.deepEqual(saved.map(item => item.status), ['ready_to_resume', 'resumed']);
});

test('resume failure remains replayable on the original task', async () => {
  const ready = { ...task(), status: 'ready_to_resume' as const, referenceSelectionRef: { selectionId: 'selection-1', version: 1 }, selectedEvidenceRefs: ['evidence-1@3'] };
  const result = await runProductionGapWorker(ready, {
    async loadInventory() { return []; },
    async resumeUpstreamTask() { throw new Error('upstream_temporarily_unavailable'); },
    async saveTask() {},
  });
  assert.equal(result.status, 'ready_to_resume');
  assert.equal(result.upstreamTaskRef, 'weekly-task-1');
  assert.equal(result.attemptCount, 1);
  assert.equal(result.lastError, 'upstream_temporarily_unavailable');
});

test('bounded top-up carries the exact task gap and remaining budget, then resumes', async () => {
  let inventoryReads = 0;
  let runInput: { triggerType?: string; productionGapContext?: unknown } | null = null;
  const result = await runProductionGapWorker(task(), {
    async loadInventory() {
      inventoryReads += 1;
      return inventoryReads === 1 ? [] : [{ candidateId: 'candidate-2', evidenceId: 'evidence-2', evidenceVersion: 1, readiness: 'production_reference', taskRelevance: 0.9, transferability: 0.9, rightsClear: true, sceneIds: ['opening'], sourceRef: 'https://example.invalid/v2' }];
    },
    async executeRun(input) {
      runInput = input;
      return { run: { runId: 'run-2', planId: 'plan', keywordSetId: 'keywords', keywordSetVersion: 1, discoveryScopeId: 'scope', discoveryScopeVersion: 1, status: 'succeeded', triggerType: 'production_gap', scopeSnapshot: {} as never, modeStats: { momentum: { requested: 1, fetched: 1, deduplicated: 0, accepted: 1, momentumCandidates: 1, failed: 0, costCny: 3, effectiveRate: 1 } }, evidenceOutcomes: { momentum: { acceptedCandidateIds: ['candidate-2'], acceptedEvidenceRefs: ['evidence-2@1'], suggestionCandidateIds: [], failedCandidateIds: [] } }, sourceRunRefs: [], queryBasis: {}, market: 'US', language: 'en', stopReason: 'completed', startedAt: '', finishedAt: '', error: null } };
    },
    async persistSelection(input) { return { ...input.selection, selectionId: 'selection-2', version: 1, tenantId: input.tenantId, upstreamTaskRef: input.upstreamTaskRef, createdAt: '', supersedesSelectionId: null }; },
    async resumeUpstreamTask() {},
    async saveTask() {},
  });
  assert.equal((runInput as { triggerType?: string } | null)?.triggerType, 'production_gap');
  assert.deepEqual((runInput as { productionGapContext?: unknown } | null)?.productionGapContext, { gapTaskId: 'gap-1', upstreamTaskRef: 'weekly-task-1', description: 'opening proof', remainingBudgetCny: 12 });
  assert.equal(result.status, 'resumed');
  assert.equal(result.stopReason, 'evidence_satisfied');
  assert.equal(result.budget.spentCny, 3);
});

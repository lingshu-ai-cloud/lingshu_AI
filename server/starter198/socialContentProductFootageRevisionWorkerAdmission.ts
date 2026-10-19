import { SocialContentTaskBudget, type SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import { socialPaidIntentOperation,
  type SocialApprovedBudgetPlan } from '../lib/socialContentTaskBudgetAuthority.js';
import { readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import { readSocialProductFootageRevisionHandoffGuard } from './socialContentProductFootageRevisionHandoff.js';
import { automaticallyConfirmPresenterFirstFrameApproval,
  listPresenterFirstFrameApprovalsForReview,
  readConfirmedPresenterFirstFrameApproval,
  type PresenterFirstFrameApprovalContract } from './socialContentPresenterFirstFrameApproval.js';
import { presenterGroupContractHash,
  type FrozenPresenterGroup } from './socialContentPaidOperationPlan.js';
import { withSocialContentSubjectLease, assertSocialContentSubjectLease } from './socialContentMutation.js';
import { socialJson, socialObject, socialRequestHash, socialText,
  SocialContentWorkflowError } from './socialContentValidation.js';

type GuardInput = Parameters<typeof readSocialProductFootageRevisionHandoffGuard>[0];
export type ProductFootageRevisionWorkerPlan = SocialApprovedBudgetPlan & {
  revisionGuardHash: string; revisedPlanHash: string; footageEvidenceHash: string;
};
type ApprovalBinding = { groupId: string; approvalRecordHash: string; decisionRecordHash: string;
  assetProvenanceHash: string };
type Admission = { schemaVersion: 'social-product-footage-revision-worker-admission.v1';
  tenantId: string; taskId: string; runId: string; guardHash: string; paidPlanFreezeHash: string;
  canonicalPlanHash: string; planHash: string; approvalBindings: ApprovalBinding[];
  workerLane: 'social_content_production'; admittedAt: string; recordHash: string };

const fail = (reason: string): never => {
  throw new SocialContentWorkflowError(`product_footage_revision_worker_admission_${reason}`, 409);
};
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validGroup(group: FrozenPresenterGroup): boolean {
  return Boolean(group && socialText(group.groupId) && socialText(group.presenterAssetId)
    && Array.isArray(group.shotIds) && group.shotIds.length
    && new Set(group.shotIds).size === group.shotIds.length
    && group.shotIds.every(socialText) && Number.isFinite(group.durationSeconds)
    && group.durationSeconds > 0 && typeof group.spokenText === 'string'
    && sha(group.contractHash) && presenterGroupContractHash(group) === group.contractHash);
}

async function bindCurrentApprovals(input: {
  repository: Starter198Repository; scope: SocialTaskBudgetScope; groups: FrozenPresenterGroup[];
  oldApprovalHashes: string[];
  readCurrentAssetProvenanceHash(approval: PresenterFirstFrameApprovalContract): Promise<string | null>;
}): Promise<ApprovalBinding[]> {
  const store = input.repository.dataStore;
  if (!store || input.groups.some(group => !validGroup(group))
    || new Set(input.groups.map(group => group.groupId)).size !== input.groups.length) return fail('presenter_group_invalid');
  const approvals = await listPresenterFirstFrameApprovalsForReview(store, {
    tenantId: input.scope.tenantId, taskId: input.scope.taskId, runId: input.scope.runId });
  if (approvals.length !== input.groups.length
    || approvals.some(approval => !input.groups.some(group => group.groupId === approval.groupId)))
    return fail('new_first_frame_approval_set_incomplete');
  const bindings: ApprovalBinding[] = [];
  for (const group of input.groups) {
    const approval = approvals.find(item => item.groupId === group.groupId);
    if (!approval || approval.planHash !== input.scope.planHash || !approval.qa.passed
      || approval.presenterGroupContractHash !== group.contractHash
      || approval.presenter.assetId !== group.presenterAssetId
      || input.oldApprovalHashes.includes(approval.recordHash)
      || !approval.assetProvenance || !sha(approval.assetProvenance.manifestHash))
      return fail(`new_first_frame_approval_invalid:${group.groupId}`);
    const provenanceHash = await input.readCurrentAssetProvenanceHash(approval);
    if (!provenanceHash || provenanceHash !== approval.assetProvenance.manifestHash)
      return fail(`new_first_frame_asset_provenance_changed:${group.groupId}`);
    let confirmed = await readConfirmedPresenterFirstFrameApproval(store, { scope: input.scope,
      groupId: group.groupId, presenterGroupContractHash: group.contractHash,
      presenterAssetId: group.presenterAssetId, expectedAssetProvenanceHash: provenanceHash });
    if (!confirmed) {
      await automaticallyConfirmPresenterFirstFrameApproval(store, { scope: input.scope,
        groupId: group.groupId, expectedRecordHash: approval.recordHash });
      confirmed = await readConfirmedPresenterFirstFrameApproval(store, { scope: input.scope,
        groupId: group.groupId, presenterGroupContractHash: group.contractHash,
        presenterAssetId: group.presenterAssetId, expectedAssetProvenanceHash: provenanceHash });
    }
    if (!confirmed) return fail(`new_first_frame_confirmation_missing:${group.groupId}`);
    bindings.push({ groupId: group.groupId, approvalRecordHash: confirmed.approval.recordHash,
      decisionRecordHash: confirmed.decision.recordHash, assetProvenanceHash: provenanceHash });
  }
  return bindings.sort((left, right) => left.groupId.localeCompare(right.groupId));
}

/**
 * Promote the already staged revision job back into the existing content
 * production queue. The generic worker recognizes only this complete immutable
 * checkpoint; this function never creates a provider permit or acknowledges
 * the outbox.
 */
export async function admitSocialProductFootageRevisionWorker(input: {
  repository: Starter198Repository; guard: GuardInput; ledgerRoot?: string; now?: Date;
  readCanonicalPlan(scope: SocialTaskBudgetScope): Promise<ProductFootageRevisionWorkerPlan>;
  readCurrentAssetProvenanceHash(approval: PresenterFirstFrameApprovalContract): Promise<string | null>;
}): Promise<{ jobId: string; recordHash: string; repeated: boolean;
  authorizesProductionQueue: true; authorizesProvider: false; authorizesProduction: false }> {
  const { repository, guard } = input, store = repository.dataStore;
  if (!store?.compareAndSwap || !await store.supportsAtomicCompareAndSwap?.()
    || guard.repository !== repository || guard.prepared.repository !== repository
    || guard.prepared.store !== store) return fail('atomic_store_required');
  const compareAndSwap = store.compareAndSwap.bind(store);
  return withSocialContentSubjectLease({ repository, tenantId: guard.prepared.tenantId,
    subjectId: guard.prepared.taskId, action: async () => {
      const authority = await readSocialProductFootageRevisionHandoffGuard(guard);
      const run = await repository.get(STARTER_COLLECTIONS.runs, guard.prepared.tenantId, guard.revisionRunId);
      const context = socialObject(socialJson(run?.starter_context));
      const frozen = socialObject(context?.paidPlanFreeze);
      const frozenPlan = socialObject(frozen?.canonicalPlan) as ProductFootageRevisionWorkerPlan | null;
      const { recordHash: frozenRecordHash, ...frozenBody } = frozen ?? {};
      if (!run || run.status !== 'waiting_external'
        || frozen?.schemaVersion !== 'social-product-footage-revision-paid-plan-freeze.v1'
        || !sha(frozenRecordHash) || socialRequestHash(frozenBody) !== frozenRecordHash
        || !frozenPlan || socialRequestHash(frozenPlan) !== frozen?.planHash
        || frozen?.guardHash !== authority.guard.recordHash) return fail('paid_plan_freeze_invalid');
      const scope: SocialTaskBudgetScope = { tenantId: guard.prepared.tenantId,
        taskId: guard.prepared.taskId, runId: guard.revisionRunId,
        planHash: authority.guard.revisedPlanHash };
      const canonical = await input.readCanonicalPlan(scope);
      if (socialRequestHash(canonical) !== socialRequestHash(frozenPlan)
        || canonical.scope.tenantId !== scope.tenantId || canonical.scope.taskId !== scope.taskId
        || canonical.scope.runId !== scope.runId || canonical.scope.planHash !== scope.planHash
        || canonical.scope.budgetTaskId !== undefined || canonical.maximumCny !== 10
        || canonical.authorizationRef !== `footage-revision:${authority.guard.recordHash}`
        || canonical.revisionGuardHash !== authority.guard.recordHash
        || canonical.revisedPlanHash !== scope.planHash
        || !Array.isArray(canonical.paidOperations) || !canonical.paidOperations.length)
        return fail('canonical_plan_changed');
      const groups = canonical.presenterGroups ?? [];
      const operations = canonical.paidOperations.map(intent => socialPaidIntentOperation(scope, intent));
      if (new Set(operations.map(operation => operation.operationId)).size !== operations.length)
        return fail('duplicate_operation');
      for (const group of groups) {
        const firstFrames = canonical.paidOperations.filter(intent => intent.stage === 'first_frame'
          && intent.shotId === group.groupId);
        const reviews = canonical.paidOperations.filter(intent => intent.stage === 'first_frame_qa'
          && intent.shotId === group.groupId);
        if (firstFrames.length !== 1 || reviews.length > 1) return fail(`first_frame_operation_invalid:${group.groupId}`);
      }
      const ledger = new SocialContentTaskBudget(input.ledgerRoot, { authorization: async () => fail('read_only'),
        quote: async () => fail('read_only'), assertCurrent: async () => fail('read_only'),
        verifyRejection: async () => false });
      const budget = ledger.status(scope);
      if (!budget || budget.limitCny !== 10 || budget.authorizedLimitCny !== 10
        || budget.hasCorrectionAuthorization || budget.retainedCny > 10
        || budget.entries.some(entry => (entry.executionTaskId ?? scope.taskId) !== scope.taskId))
        return fail('ten_yuan_ledger_invalid');
      const entries = budget.entries.filter(entry => entry.runId === scope.runId && entry.status !== 'rejected');
      if (entries.length !== operations.length || operations.some(operation => {
        const entry = entries.find(item => item.operationId === operation.operationId);
        return !entry || entry.planHash !== scope.planHash
          || (['fingerprint', 'provider', 'model', 'accountRef', 'stage', 'shotId'] as const)
            .some(key => entry[key] !== operation[key]);
      })) return fail('complete_reservation_missing');
      const requiredFirstFrameIds = new Set(canonical.paidOperations.filter(intent => groups.some(group =>
        group.groupId === intent.shotId) && ['first_frame', 'first_frame_qa'].includes(intent.stage))
        .map(intent => intent.operationId));
      if (entries.some(entry => requiredFirstFrameIds.has(entry.operationId)
        ? entry.status !== 'completed' || !entry.receiptRef
        : entry.status !== 'reserved' || entry.receiptRef !== null))
        return fail('first_frame_settlement_or_future_hold_invalid');
      const approvalBindings = await bindCurrentApprovals({ repository, scope, groups,
        oldApprovalHashes: authority.guard.oldApprovalHashes,
        readCurrentAssetProvenanceHash: input.readCurrentAssetProvenanceHash });
      const job = await readContentExecutionJob(store, scope.tenantId, scope.taskId, scope.runId);
      const executor = socialObject(job?.checkpoints['social.executor']?.payload);
      const bridge = socialObject(job?.checkpoints['content.production_bridge']?.payload);
      const prior = socialObject(job?.checkpoints['social.footage_revision_worker_admission']?.payload) as Admission | null;
      if (!job || !executor || executor.executor !== 'langgraph' || executor.inputHash !== job.checkpoints['social.executor']?.inputHash
        || !bridge || bridge.inputHash !== executor.inputHash || job.providerState !== 'none'
        || job.providerReceipts.length || job.workerId || job.leaseExpiresAt) return fail('staged_job_invalid');
      const immutable = { schemaVersion: 'social-product-footage-revision-worker-admission.v1' as const,
        tenantId: scope.tenantId, taskId: scope.taskId, runId: scope.runId,
        guardHash: authority.guard.recordHash, paidPlanFreezeHash: frozenRecordHash,
        canonicalPlanHash: socialRequestHash(canonical), planHash: scope.planHash,
        approvalBindings, workerLane: 'social_content_production' as const };
      if (prior) {
        const { recordHash, admittedAt: _time, ...body } = prior;
        if (prior.schemaVersion !== immutable.schemaVersion || prior.recordHash !== socialRequestHash({ ...body,
          admittedAt: prior.admittedAt }) || socialRequestHash(body) !== socialRequestHash(immutable)
          || job.status !== 'queued') return fail('admission_changed');
        return { jobId: job.id, recordHash, repeated: true, authorizesProductionQueue: true as const,
          authorizesProvider: false as const, authorizesProduction: false as const };
      }
      if (job.status !== 'blocked' || job.lastError !== 'product_footage_revision_new_first_frame_approval_required')
        return fail('staged_job_changed');
      const admittedAt = (input.now ?? new Date()).toISOString();
      const body = { ...immutable, admittedAt };
      const admission: Admission = { ...body, recordHash: socialRequestHash(body) };
      await assertSocialContentSubjectLease({ repository, tenantId: scope.tenantId, subjectId: scope.taskId });
      if (!await compareAndSwap('content_execution_jobs', job.id,
        { tenant_id: scope.tenantId, task_id: scope.taskId, run_id: scope.runId,
          status: 'blocked', checkpoints: job.checkpoints, provider_state: 'none',
          provider_receipts: [], worker_id: '', lease_expires_at: '' },
        { status: 'queued', next_attempt_at: admittedAt, last_error: '', updated_at: admittedAt,
          checkpoints: { ...job.checkpoints, 'social.footage_revision_worker_admission': {
            version: '1', inputHash: admission.recordHash, payload: admission, updatedAt: admittedAt } } }))
        return fail('job_conflict');
      const verified = await readContentExecutionJob(store, scope.tenantId, scope.taskId, scope.runId);
      const stored = socialObject(verified?.checkpoints['social.footage_revision_worker_admission']?.payload);
      if (!verified || verified.status !== 'queued' || stored?.recordHash !== admission.recordHash)
        return fail('readback_changed');
      return { jobId: verified.id, recordHash: admission.recordHash, repeated: false,
        authorizesProductionQueue: true as const, authorizesProvider: false as const,
        authorizesProduction: false as const };
    } });
}

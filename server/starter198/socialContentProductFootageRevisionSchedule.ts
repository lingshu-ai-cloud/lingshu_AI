import { createHash } from 'node:crypto';
import { CONTENT_CREATION_QUOTA_COLLECTION, createContentCreationQuotaService,
  type QuotaScope } from '../socialPrograms/contentCreationQuota.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { withSocialContentSubjectLease, assertSocialContentSubjectLease } from './socialContentMutation.js';
import { readPreparedSocialProductFootageRevision } from './socialContentProductFootageRevisionPrepare.js';
import { requireSocialTask } from './socialContentRecords.js';
import { socialContentQueueItemId } from './socialContentScheduler.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';

type Prepared = Parameters<typeof readPreparedSocialProductFootageRevision>[0];
const fail = (reason: string): never => { throw new SocialContentWorkflowError(`product_footage_revision_schedule_${reason}`, 409); };
const id = (kind: string, tenantId: string, commandId: string) =>
  createHash('sha256').update(JSON.stringify([kind, tenantId, commandId])).digest('hex').slice(0, 15);

/** Register a same-task revision in the existing quota slot and create a
 * non-executable child run. The original task still points at its source run;
 * this step never acknowledges the outbox or submits a provider request. */
export async function schedulePreparedSocialProductFootageRevision(input: {
  repository: Starter198Repository; prepared: Prepared; tenantId: string; taskId: string;
  userId: string; commandId: string; now?: Date;
}): Promise<{ runId: string; queueItemId: string; lineageHash: string;
  authorizesQueue: false; authorizesProvider: false; authorizesProduction: false }> {
  const { repository, prepared, tenantId, taskId, userId, commandId } = input;
  const store = repository.dataStore;
  if (!store?.compareAndSwap || !await store.supportsAtomicCompareAndSwap?.()
    || prepared.repository !== repository || prepared.store !== store
    || prepared.tenantId !== tenantId || prepared.taskId !== taskId
    || !userId || !commandId) return fail('input_invalid');
  const compareAndSwap = store.compareAndSwap.bind(store);
  return withSocialContentSubjectLease({ repository, tenantId, subjectId: taskId, action: async () => {
    const readAuthority = async () => {
      const candidate = await readPreparedSocialProductFootageRevision(prepared);
      const task = await requireSocialTask({ repository, tenantId, taskId });
      const brief = socialObject(socialJson(task.brief));
      const marker = socialObject(brief?._productFootageRevision);
      const binding = socialObject(socialJson(task.content_order));
      const original = socialObject(binding?.dispatch);
      const originalQueue = socialObject(original?.queueRequest);
      const originalSubject = socialObject(originalQueue?.subject);
      if (!marker || !binding || !original || !originalQueue || !originalSubject
        || brief?.perItemBudgetCny !== 10
        || binding.schemaVersion !== 'social-content-order.v1'
        || binding.contentId !== taskId || binding.budgetTaskId !== taskId
        || !socialText(binding.programId) || !socialText(binding.originWeek)
        || binding.cancellation || binding.replacedByContentId || binding.supersededByContentId
        || socialText(task.run_id) !== prepared.sourceRunId
        || socialText(task.version) !== prepared.expectedPreparedVersion
        || original.schemaVersion !== 'social-content-dispatch.v1'
        || socialRequestHash((({ requestHash, ...body }) => body)(original)) !== original.requestHash
        || originalQueue.tenantId !== tenantId || originalQueue.workflowScope !== 'social_content'
        || originalSubject.id !== taskId || original.commandId !== originalQueue.commandId
        || socialContentQueueItemId(originalQueue as any) !== socialText(task.orchestrator_item_id)) return fail('original_binding_changed');
      const originalOperation = await repository.list(STARTER_COLLECTIONS.socialContentOperations, tenantId,
        { where: { operation_id: String(original.commandId) }, perPage: 2 });
      const op = originalOperation.items[0];
      if (originalOperation.totalItems !== 1 || originalOperation.items.length !== 1 || !op
        || op.operation !== 'start_social_content_task' || op.target_id !== taskId
        || op.created_by !== original.userId || op.idempotency_key !== original.idempotencyKey
        || op.request_hash !== socialRequestHash({ expectedVersion: original.expectedVersion })
        || !['processing', 'succeeded'].includes(socialText(op.status))) return fail('original_start_changed');
      const scope: QuotaScope = { tenantId, programId: String(binding.programId), weekStart: String(binding.originWeek) };
      const body = { schemaVersion: 'social-product-footage-revision-lineage.v1', tenantId, taskId,
        contentId: taskId, budgetTaskId: taskId, sourceRunId: prepared.sourceRunId,
        sourceTaskVersion: marker.sourceTaskVersion, preparedVersion: prepared.expectedPreparedVersion,
        revisedPlanHash: candidate.revisedPlanHash, sourcePlanHash: marker.sourcePlanHash,
        budgetLedgerRef: prepared.budgetLedgerRef, originalCommandId: original.commandId,
        scope, slotOrigin: 'original_order' as const };
      return { candidate, task, binding, scope, lineageHash: socialRequestHash(body), body };
    };
    let authority = await readAuthority();
    const quota = createContentCreationQuotaService({ store,
      assertAtomicStore: async () => { if (!await store.supportsAtomicCompareAndSwap?.()) return fail('atomic_store_required'); },
      readReleaseSafety: async () => ({ leaseActive: true, inFlight: true, paid: true, unknown: true }),
      verifyDelivery: async () => false,
      verifyRevisionDispatch: async (order, scope, value) => {
        const fresh = await readAuthority();
        return scope.tenantId === fresh.scope.tenantId && scope.programId === fresh.scope.programId
          && scope.weekStart === fresh.scope.weekStart && order.contentId === taskId
          && value.executionTaskId === taskId && value.lineageHash === fresh.lineageHash;
      },
      now: () => input.now ?? new Date() });
    const pool = await quota.read(authority.scope);
    const order = pool?.orders?.[taskId];
    if (!pool || !order || !['reserved', 'running', 'delivered'].includes(order.state)
      || order.slotId !== pool.slots.find(slot => slot.contentId === taskId)?.slotId
      || !pool.outbox.some(item => item.kind === 'dispatch' && item.contentId === taskId
        && item.commandId === authority.body.originalCommandId && !item.executionTaskId)) return fail('original_quota_changed');
    if (order.revisions?.some(item => item.executionTaskId === taskId
      && (item.lineageHash !== authority.lineageHash || item.commandId !== commandId))) return fail('revision_conflict');
    const dispatchBody = { schemaVersion: 'social-product-footage-revision-dispatch.v1', tenantId, taskId,
      commandId, userId, lineageHash: authority.lineageHash, preparedVersion: prepared.expectedPreparedVersion,
      revisedPlanHash: authority.candidate.revisedPlanHash, sourceRunId: prepared.sourceRunId };
    const dispatch = { ...dispatchBody, recordHash: socialRequestHash(dispatchBody) };
    const existing = socialObject(authority.binding.footageRevisionDispatch);
    if (existing) {
      if (socialRequestHash(existing) !== socialRequestHash(dispatch)) return fail('dispatch_changed');
    } else {
      await assertSocialContentSubjectLease({ repository, tenantId, subjectId: taskId });
      if (!await compareAndSwap(STARTER_COLLECTIONS.socialContentTasks, authority.task.id,
        { tenant_id: tenantId, version: authority.task.version, run_id: authority.task.run_id,
          content_order: authority.task.content_order, brief: authority.task.brief },
        { content_order: { ...authority.binding, footageRevisionDispatch: dispatch } })) return fail('dispatch_conflict');
    }
    authority = await readAuthority();
    const registered = await quota.registerRevisionDispatch(authority.scope,
      { commandId, actorId: userId, reason: 'verified_product_footage_revision' },
      { contentId: taskId, executionTaskId: taskId, lineageHash: authority.lineageHash });
    const revision = registered.order?.revisions?.filter(item => item.executionTaskId === taskId
      && item.lineageHash === authority.lineageHash && item.commandId === commandId);
    const outbox = registered.pool.outbox.filter(item => item.kind === 'dispatch'
      && item.contentId === taskId && item.executionTaskId === taskId && item.commandId === commandId);
    if (revision?.length !== 1 || outbox.length !== 1 || outbox[0]?.state !== 'pending'
      || registered.order?.slotId !== order.slotId) return fail('quota_changed');
    const now = (input.now ?? new Date()).toISOString();
    const goalId = id('footage-revision-goal', tenantId, commandId);
    const planId = id('footage-revision-plan', tenantId, commandId);
    const runId = id('footage-revision-run', tenantId, commandId);
    const queueId = id('footage-revision-queue', tenantId, commandId);
    const queueItemId = `social-footage-revision:${socialRequestHash({ tenantId, taskId, commandId }).slice(0, 32)}`;
    const context = { schemaVersion: 'social-product-footage-revision-schedule.v1', tenantId, taskId,
      sourceRunId: prepared.sourceRunId, preparedVersion: prepared.expectedPreparedVersion,
      revisedPlanHash: authority.candidate.revisedPlanHash, lineageHash: authority.lineageHash,
      originalSlotId: order.slotId, budgetLedgerRef: prepared.budgetLedgerRef,
      dispatchCommandId: commandId, queueItemId, authorizesProduction: false };
    const exact = (row: StarterRecord) => row.tenant_id === tenantId
      && socialRequestHash(socialJson(row.starter_context ?? row.output ?? row.plan ?? row.scope)) === socialRequestHash(context);
    const ensure = async (collection: Parameters<Starter198Repository['get']>[0], recordId: string,
      data: Record<string, unknown>, valid: (row: StarterRecord) => boolean) => {
      const prior = await repository.get(collection, tenantId, recordId);
      if (prior) { if (!valid(prior)) return fail('record_changed'); return; }
      await assertSocialContentSubjectLease({ repository, tenantId, subjectId: taskId });
      try { const written = await repository.create(collection, tenantId, { id: recordId, ...data });
        if (!valid(written)) return fail('record_changed'); }
      catch (error) { const raced = await repository.get(collection, tenantId, recordId);
        if (!raced || !valid(raced)) throw error; }
    };
    await ensure(STARTER_COLLECTIONS.goals, goalId,
      { title: '同品实拍补审修订', objective: '原任务同槽非执行恢复', metric: 'revision_admission',
        target: 1, unit: 'revision', starts_at: now.slice(0, 10), ends_at: now.slice(0, 10),
        scope: context, constraints: [], owner_id: userId, status: 'active', version: 1,
        created_at: now, updated_at: now }, exact);
    await ensure(STARTER_COLLECTIONS.plans, planId,
      { goal_id: goalId, status: 'blocked', plan: context, created_at: now },
      row => row.goal_id === goalId && exact(row));
    await ensure(STARTER_COLLECTIONS.runs, runId,
      { goal_id: goalId, plan_id: planId, status: 'waiting_external', current_controller: 'system',
        pause_reason: 'product_footage_revision_paid_admission_required',
        product_profile: 'starter_social_content_footage_revision',
        starter_initialization_id: socialRequestHash(context), starter_input_version: prepared.expectedPreparedVersion,
        starter_plan_version: 1, starter_context: context, started_at: now, completed_at: '' },
      row => row.goal_id === goalId && row.plan_id === planId && row.status === 'waiting_external' && exact(row));
    await ensure(STARTER_COLLECTIONS.tasks, queueId,
      { goal_id: goalId, plan_id: planId, run_id: runId, task_key: 'social_product_footage_revision_admission',
        title: '同品实拍修订待独立付费准入', description: '记录不授权供应商调用。',
        agent_role: 'content', kind: 'production', status: 'blocked', sequence: 1, priority: 'high',
        requires_approval: false, depends_on: [], output: context,
        blocked_reason: 'product_footage_revision_paid_admission_required', owner_id: userId,
        execution_mode: 'automatic', external_effect: 'none', automatic_execution_allowed: false,
        policy_source: 'social-product-footage-revision-schedule.v1', task_version: 1,
        correction_version: 0, created_at: now, updated_at: now },
      row => row.run_id === runId && row.task_key === 'social_product_footage_revision_admission'
        && row.status === 'blocked' && row.automatic_execution_allowed === false && exact(row));
    const reread = await readAuthority();
    if (reread.lineageHash !== authority.lineageHash) return fail('authority_changed');
    return { runId, queueItemId, lineageHash: authority.lineageHash,
      authorizesQueue: false as const, authorizesProvider: false as const, authorizesProduction: false as const };
  } });
}

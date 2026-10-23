import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import {SOCIAL_WORK_PACKAGE_KINDS} from '../../shared/contracts/socialContentWorkflow.js';
import { createContentCreationQuotaService, CONTENT_CREATION_QUOTA_COLLECTION } from '../socialPrograms/contentCreationQuota.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { socialContentQueueItemId } from './socialContentScheduler.js';
import { socialRequestHash } from './socialContentValidation.js';
import { prepareSocialProductFootageRevision } from './socialContentProductFootageRevisionPrepare.js';
import { schedulePreparedSocialProductFootageRevision } from './socialContentProductFootageRevisionSchedule.js';
import { recoverSocialContentOrderDispatch } from './socialContentTasks.js';
import { SocialContentTaskBudget } from '../lib/socialContentTaskBudget.js';
import { createPresenterFirstFrameApproval } from './socialContentPresenterFirstFrameApproval.js';
import { createPresenterFirstFrameAssetProvenance } from './socialContentPresenterFirstFrameAssetProvenance.js';
import { freezeSocialProductFootageRevisionHandoff, handoffSocialProductFootageRevision,
  readSocialProductFootageRevisionHandoffGuard } from './socialContentProductFootageRevisionHandoff.js';
import { readSocialProductFootageRevisionPaidPreflight } from './socialContentProductFootageRevisionPaidPreflight.js';
import { freezeSocialProductFootageRevisionPaidPlan,
  readSocialProductFootageRevisionPaidPlanFreeze } from './socialContentProductFootageRevisionPaidPlanFreeze.js';
import type { SocialProductFootageRevisionCanonicalPlan } from './socialContentProductFootageRevisionPaidPreflight.js';
import { admitContentExecutionJob, controlContentExecutionJob, DurableContentExecutionWorker,
  hasCompleteFootageRevisionProductionAdmission, readContentExecutionJob,
  stageBlockedFootageRevisionJob } from '../contentExecution/durableQueue.js';
import { enqueueSocialContentAutoProduction } from './socialContentProductionQueue.js';
import { paidProductionHash, presenterGroupContractHash } from './socialContentPaidOperationPlan.js';
import { admitSocialProductFootageRevisionWorker } from './socialContentProductFootageRevisionWorkerAdmission.js';
import { prepareSocialContentProductionBudget } from './socialContentProductionBudgetPreflight.js';

test('reviewed same-SKU revision registers the original quota slot and blocked new run, recovering a crash without enqueue', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-revision-schedule-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json');
  const first = new LangGraphTestStore(file);
  (first as any).supportsAtomicCompareAndSwap = async () => true;
  const repository = createStarter198Repository(first);
  const scope = { tenantId: 'tenant', programId: 'program', weekStart: '2026-10-12' };
  const quota = createContentCreationQuotaService({ store: first, assertAtomicStore: async () => {},
    readReleaseSafety: async () => ({ leaseActive: true, inFlight: true, paid: true, unknown: true }),
    verifyDelivery: async () => false });
  const originalQueue: any = { tenantId: 'tenant', userId: 'owner', commandId: 'original-start',
    idempotencyKey: 'original-start', workflowScope: 'social_content', input: 'source',
    subject: { type: 'social_content_task', id: 'task', admissionVersion: '1', version: '1' } };
  const originalBody: any = { schemaVersion: 'social-content-dispatch.v1', commandId: 'original-start',
    userId: 'owner', expectedVersion: '1', idempotencyKey: 'original-start', queueRequest: originalQueue };
  const original = { ...originalBody, requestHash: socialRequestHash(originalBody) };
  await quota.reserve(scope, { commandId: 'original-start', actorId: 'owner', reason: 'confirmed_content_start' },
    { contentId: 'task', entry: 'workspace' });
  await first.create(STARTER_COLLECTIONS.socialContentOperations, { id: 'original-op', tenant_id: 'tenant',
    operation_id: 'original-start', operation: 'start_social_content_task', target_id: 'task',
    created_by: 'owner', idempotency_key: 'original-start',
    request_hash: socialRequestHash({ expectedVersion: '1' }), status: 'succeeded' });
  await first.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant',
    task_id: 'task', version: '7', status: 'attention', run_id: 'old-run',
    task_mode:'weekly',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:0,
    approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
    package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),
    orchestrator_item_id: socialContentQueueItemId(originalQueue), last_operation_id: 'original-start',
    content_order: { schemaVersion: 'social-content-order.v1', contentId: 'task', budgetTaskId: 'task',
      entry: 'workspace', programId: 'program', originWeek: '2026-10-12', dispatch: original },
    brief: { title:'same-SKU revision',objective:'replace the reviewed same-product shot',
      productId: 'product', perItemBudgetCny: 10, voice: 'fixed-voice',markets:[],languages:[],
      platforms:[],formats:[],restrictions:[] } });
  await first.create(STARTER_COLLECTIONS.runs, { id: 'old-run', tenant_id: 'tenant', status: 'failed',
    starter_context: { socialTaskId: 'task', budgetLedgerRef: 'ledger:original' } });
  const plan: any = { planVersion: '7', shots: [{ shotId: 'S01', sourceRefs: ['footage'],
    materialRouting: { materialType: 'product', policy: 'local_only', localMatch: {
      state: 'matched', sourceRefs: ['footage'], productRef: 'product', evidenceRef: 'match' } },
    selectedMaterialSegment: { sourceRef: 'footage', segmentId: 'window', startSeconds: 1, endSeconds: 3 } }] };
  await first.create('content_execution_jobs', { id: 'source-job', tenant_id: 'tenant',
    job_key: 'source-job', task_id: 'task', run_id: 'old-run', user_id: 'owner',
    account_id: '_unassigned', task_type: 'social_content_weekly', status: 'blocked',
    checkpoints: { 'social.executor': { version: '1', inputHash: 'f'.repeat(64),
      payload: { inputHash: 'f'.repeat(64), approvedContext: { assetSupplyPlan: structuredClone(plan) } },
      updatedAt: new Date().toISOString() } }, provider_receipts: [], provider_state: 'none' });
  const evidence = { contentSha256: 'a'.repeat(64), productId: 'product', sceneFunction: 'demonstration',
    approvalId: 'b'.repeat(15), visualFindingId: 'c'.repeat(15) };
  let rightsCurrent = true, bytesCurrent = true;
  const proof = { readMaterials: async () => ({ status: 'ready' as const, items: [] }),
    readCurrentPlan: async () => structuredClone(plan), readBudgetLedgerRef: async () => 'ledger:original',
    readReviewedSegment: async (request: any) => rightsCurrent ? ({ material: { id: request.materialId,
      productId: request.productId, contentSha256: bytesCurrent ? request.expectedContentSha256 : 'f'.repeat(64) },
      segmentId: request.segmentId, startSeconds: request.startSeconds, endSeconds: request.endSeconds }) as any : null as any };
  const preparedInput = { repository, store: first, tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run',
    budgetLedgerRef: 'ledger:original', productId: 'product', shotId: 'S01', evidence,
    userId: 'system', idempotencyKey: 'prepare', expectedVersion: '7', sourcePlan: plan, ...proof };
  await prepareSocialProductFootageRevision(preparedInput);
  const before = await quota.read(scope);
  const schedule = { repository, prepared: { ...preparedInput, expectedPreparedVersion: '8' },
    tenantId: 'tenant', taskId: 'task', userId: 'owner', commandId: 'footage-dispatch' };
  const cas = first.compareAndSwap.bind(first);
  let crash = true;
  first.compareAndSwap = async (collection, recordId, expected, patch) => {
    if (collection === CONTENT_CREATION_QUOTA_COLLECTION && crash) { crash = false; throw Error('crash-after-task-dispatch'); }
    return cas(collection, recordId, expected, patch);
  };
  await assert.rejects(schedulePreparedSocialProductFootageRevision(schedule), /crash-after-task-dispatch/);
  const afterCrash = await repository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  assert.equal((afterCrash?.content_order as any).footageRevisionDispatch.commandId, 'footage-dispatch');
  const restartedStore = new LangGraphTestStore(file);
  (restartedStore as any).supportsAtomicCompareAndSwap = async () => true;
  const restartedRepository = createStarter198Repository(restartedStore);
  const restarted = { ...schedule, repository: restartedRepository,
    prepared: { ...schedule.prepared, repository: restartedRepository, store: restartedStore } };
  const create = restartedRepository.create.bind(restartedRepository);
  let crashRun = true;
  restartedRepository.create = async (collection, tenantId, data) => {
    if (collection === STARTER_COLLECTIONS.runs && crashRun) { crashRun = false; throw Error('crash-after-quota-outbox'); }
    return create(collection, tenantId, data);
  };
  await assert.rejects(schedulePreparedSocialProductFootageRevision(restarted), /crash-after-quota-outbox/);
  const finalStore = new LangGraphTestStore(file);
  (finalStore as any).supportsAtomicCompareAndSwap = async () => true;
  const finalRepository = createStarter198Repository(finalStore);
  const final = { ...restarted, repository: finalRepository,
    prepared: { ...restarted.prepared, repository: finalRepository, store: finalStore } };
  const result = await schedulePreparedSocialProductFootageRevision(final);
  assert.equal(result.authorizesQueue, false);
  assert.equal(result.authorizesProvider, false);
  assert.equal(result.authorizesProduction, false);
  assert.notEqual(result.runId, 'old-run');
  assert.deepEqual(await schedulePreparedSocialProductFootageRevision(final), result);
  const pool = await createContentCreationQuotaService({ store: finalStore, assertAtomicStore: async () => {},
    readReleaseSafety: async () => ({ leaseActive: true, inFlight: true, paid: true, unknown: true }),
    verifyDelivery: async () => false }).read(scope);
  assert.equal(pool?.slots.filter(slot => slot.contentId).length, before?.slots.filter(slot => slot.contentId).length);
  assert.equal(pool?.orders.task?.slotId, before?.orders.task?.slotId);
  assert.equal(pool?.orders.task?.revisions?.length, 1);
  assert.equal(pool?.outbox.filter(item => item.commandId === 'footage-dispatch').length, 1);
  assert.equal(pool?.outbox.find(item => item.commandId === 'footage-dispatch')?.state, 'pending');
  assert.equal((await finalRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row'))?.run_id, 'old-run');
  assert.equal((await finalRepository.get(STARTER_COLLECTIONS.runs, 'tenant', result.runId))?.status, 'waiting_external');
  const queue = await finalStore.list<any>(STARTER_COLLECTIONS.tasks,
    { where: { tenant_id: 'tenant', run_id: result.runId }, perPage: 2 });
  assert.equal(queue.totalItems, 1);
  assert.equal(queue.items[0]?.status, 'blocked');
  assert.equal(queue.items[0]?.automatic_execution_allowed, false);
  assert.equal((await finalStore.list('content_execution_jobs',
    { where: { tenant_id: 'tenant', task_id: 'task' } })).totalItems, 1);
  await assert.rejects(enqueueSocialContentAutoProduction({ repository: finalRepository,
    tenantId: 'tenant', userId: 'owner', taskId: 'task', runId: result.runId }),
  /product_footage_revision_worker_admission_required/);
  let enqueues = 0;
  await assert.rejects(recoverSocialContentOrderDispatch({ repository: finalRepository,
    tenantId: 'tenant', taskId: 'task', commandId: 'footage-dispatch',
    orchestratorQueue: { enqueue: async () => { enqueues++; return { queueItemId: 'wrong', runId: 'wrong' }; } } }),
  /dispatch_missing_or_ambiguous/);
  assert.equal(enqueues, 0);
  await assert.rejects(schedulePreparedSocialProductFootageRevision({ ...final, commandId: 'different' }), /revision_conflict/);
  const ledgerRoot = path.join(root, 'ledger');
  const handoffScope = { repository: finalRepository, prepared: final.prepared,
    revisionRunId: result.runId, queueItemId: result.queueItemId, ledgerRoot };
  await assert.rejects(freezeSocialProductFootageRevisionHandoff(handoffScope), /original_ten_yuan_ledger_missing/);
  const budget = new SocialContentTaskBudget(ledgerRoot, {
    authorization: async () => ({ maximumCny: 10, authorizationRef: 'original-ten-yuan' }),
    quote: async () => ({ upperBoundCny: 4, quoteRef: 'old-first-frame',
      validUntil: new Date(Date.now() + 60_000).toISOString() }),
    assertCurrent: async () => {}, verifyRejection: async () => false });
  const oldBudgetScope = { tenantId: 'tenant', taskId: 'task', runId: 'old-run', planHash: 'd'.repeat(64) };
  await budget.reserveBatch(oldBudgetScope, [{ operationId: 'old-first-frame', fingerprint: 'e'.repeat(64),
    provider: 'seedream', model: 'test', accountRef: 'old', stage: 'first_frame', shotId: 'S01' }]);
  await budget.markOutcome(oldBudgetScope, 'old-first-frame', 'unknown', 'supplier-unknown');
  const oldApproval = await createPresenterFirstFrameApproval(finalStore, {
    tenantId: 'tenant', taskId: 'task', runId: 'old-run', planHash: oldBudgetScope.planHash,
    groupId: 'G1', presenterGroupContractHash: '1'.repeat(64),
    referenceCompositionHashes: ['2'.repeat(64)], backgroundPlateSha256: '3'.repeat(64),
    personRemovalEvidence: { receiptRef: 'removal', sourceSha256: '4'.repeat(64),
      outputSha256: '5'.repeat(64) },
    presenter: { assetId: 'person', assetVersion: 1, authorizationRef: 'rights', consentRef: 'consent',
      providerId: 'heygen', providerPresenterId: 'avatar', providerVoiceId: 'voice' },
    compositeFirstFrameSha256: '6'.repeat(64),
    compositeFirstFrameUrl: '/media/tenants/tenant/frame.png',
    qa: { passed: true, receiptRef: 'qa', reportHash: '7'.repeat(64) },
    createdAt: new Date().toISOString() });
  const frozen = await freezeSocialProductFootageRevisionHandoff(handoffScope);
  assert.equal(frozen.retainedCny, 4);
  assert.equal(frozen.authorizesProvider, false);
  const afterFreeze = new LangGraphTestStore(file);
  (afterFreeze as any).supportsAtomicCompareAndSwap = async () => true;
  const afterFreezeRepository = createStarter198Repository(afterFreeze);
  const resumedScope = { ...handoffScope, repository: afterFreezeRepository,
    prepared: { ...handoffScope.prepared, repository: afterFreezeRepository, store: afterFreeze },
    expectedRecordHash: frozen.recordHash };
  const checked = await readSocialProductFootageRevisionHandoffGuard(resumedScope);
  assert.deepEqual(checked.guard.oldApprovalHashes, [oldApproval.recordHash]);
  const competing = await Promise.allSettled([
    handoffSocialProductFootageRevision({ ...resumedScope, actorId: 'system' }),
    handoffSocialProductFootageRevision({ ...resumedScope, actorId: 'system' }),
  ]);
  const completed = competing.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof handoffSocialProductFootageRevision>>> => item.status === 'fulfilled');
  assert.ok(completed.length >= 1);
  assert.ok(competing.every(item => item.status === 'fulfilled' || /social_content_mutation_busy/.test(String(item.reason))));
  assert.equal(completed[0]?.value.taskVersion, '9'); assert.equal(completed[0]?.value.authorizesProvider, false);
  const afterHandoff = await afterFreezeRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  assert.equal(afterHandoff?.run_id, result.runId);
  assert.equal(afterHandoff?.status, 'paused');
  assert.equal((afterHandoff?.brief as any).voice, 'fixed-voice');
  assert.equal(budget.status(oldBudgetScope)?.retainedCny, 4);
  const replayStore = new LangGraphTestStore(file);
  (replayStore as any).supportsAtomicCompareAndSwap = async () => true;
  const replayRepository = createStarter198Repository(replayStore);
  const replayScope = { ...resumedScope, repository: replayRepository,
    prepared: { ...resumedScope.prepared, repository: replayRepository, store: replayStore } };
  assert.equal((await handoffSocialProductFootageRevision({ ...replayScope, actorId: 'system' })).repeated, true);
  assert.equal((await replayRepository.get(STARTER_COLLECTIONS.runs, 'tenant', 'old-run'))?.status, 'failed');
  assert.equal((await replayStore.list<any>('social_presenter_first_frame_approvals',
    { where: { tenant_id: 'tenant', task_id: 'task', run_id: result.runId } })).totalItems, 0);
  const revisionRow = await replayRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  const evidenceHash = (revisionRow?.brief as any)._productFootageRevision.revision.recordHash;
  const newBudgetScope = { tenantId: 'tenant', taskId: 'task', runId: result.runId,
    planHash: (revisionRow?.brief as any)._productFootageRevision.revision.revisedPlanHash as string };
  const presenterGroupBase = { groupId: 'S01', shotIds: ['S01'], durationSeconds: 2,
    spokenText: 'frozen narration', presenterAssetId: 'person' };
  const presenterGroup = { ...presenterGroupBase, contractHash: presenterGroupContractHash(presenterGroupBase) };
  const revisionRequirement = { key: 'revision:S01:first_frame', stage: 'first_frame', shotId: 'S01',
    sourceRef: 'footage', durationSeconds: null, text: null, frameCount: 1,
    presenterGroupId: 'S01', presenterGroupShotIds: ['S01'], presenterAssetId: 'person',
    presenterGroupContractHash: presenterGroup.contractHash, inputContractHash: newBudgetScope.planHash };
  const revisionRoute = { provider: 'seedream', model: 'test', accountRef: 'revision',
    routeEvidenceRef: 'revision-route', usageBoundRef: 'revision-bound', maximumUnits: { requests: 1 },
    maximumAttempts: 1 };
  const revisionOperationId = `paid-plan:${paidProductionHash({ scope: newBudgetScope,
    key: revisionRequirement.key, attempt: 0 })}`;
  const revisionInputContractHash = paidProductionHash({ requirement: revisionRequirement,
    route: revisionRoute, attempt: 0 });
  const videoRequirement = { key: 'revision:S01:presenter_video', stage: 'presenter_video', shotId: 'S01',
    sourceRef: 'footage', durationSeconds: 2, text: 'presenter line', frameCount: null,
    presenterGroupId: 'S01', presenterGroupShotIds: ['S01'], presenterAssetId: 'person',
    presenterGroupContractHash: presenterGroup.contractHash, inputContractHash: newBudgetScope.planHash };
  const videoRoute = { provider: 'heygen', model: 'avatar-video', accountRef: 'revision',
    routeEvidenceRef: 'revision-video-route', usageBoundRef: 'revision-video-bound',
    maximumUnits: { providerSeconds: 2 }, maximumAttempts: 1 };
  const videoOperationId = `paid-plan:${paidProductionHash({ scope: newBudgetScope,
    key: videoRequirement.key, attempt: 0 })}`;
  const videoInputContractHash = paidProductionHash({ requirement: videoRequirement,
    route: videoRoute, attempt: 0 });
  const canonical: SocialProductFootageRevisionCanonicalPlan = { scope: newBudgetScope, maximumCny: 10,
    authorizationRef: `footage-revision:${frozen.recordHash}`, revisionGuardHash: frozen.recordHash,
    revisedPlanHash: newBudgetScope.planHash, footageEvidenceHash: evidenceHash,
    presenterGroups: [presenterGroup],
    paidOperations: [{ operationId: revisionOperationId, provider: 'seedream', model: 'test',
      accountRef: 'revision', stage: 'first_frame', shotId: 'S01',
      inputContractHash: revisionInputContractHash, maximumUnits: { requests: 1 } },
    { operationId: videoOperationId, provider: 'heygen', model: 'avatar-video',
      accountRef: 'revision', stage: 'presenter_video', shotId: 'S01',
      inputContractHash: videoInputContractHash, maximumUnits: { providerSeconds: 2 } }],
    productionAdapter: { schemaVersion: 'social-product-footage-revision-production-budget.v1',
      requirements: [revisionRequirement, videoRequirement], routeBindings: {
        [revisionRequirement.key]: revisionRoute, [videoRequirement.key]: videoRoute },
      quotes: { [revisionOperationId]: { upperBoundCny: 1, quoteRef: 'new-first-frame',
        validUntil: new Date(Date.now() + 60_000).toISOString() },
      [videoOperationId]: { upperBoundCny: 1, quoteRef: 'new-first-frame',
        validUntil: new Date(Date.now() + 60_000).toISOString() } } } };
  const preflight = { repository: replayRepository, guard: replayScope,
    ledgerRoot, readCanonicalPlan: async () => canonical };
  await assert.rejects(readSocialProductFootageRevisionPaidPreflight(preflight), /complete_new_run_reservation_required/);
  const overspend = new SocialContentTaskBudget(ledgerRoot, {
    authorization: async () => ({ maximumCny: 10, authorizationRef: 'original-ten-yuan' }),
    quote: async () => ({ upperBoundCny: 7, quoteRef: 'too-expensive',
      validUntil: new Date(Date.now() + 60_000).toISOString() }),
    assertCurrent: async () => {}, verifyRejection: async () => false });
  const { socialPaidIntentOperation } = await import('../lib/socialContentTaskBudgetAuthority.js');
  const actualOperations = canonical.paidOperations.map(intent => socialPaidIntentOperation(newBudgetScope, intent));
  await assert.rejects(overspend.reserveBatch(newBudgetScope, [actualOperations[0]!]), /production_budget_decision_required/);
  const affordable = new SocialContentTaskBudget(ledgerRoot, {
    authorization: async () => ({ maximumCny: 10, authorizationRef: 'original-ten-yuan' }),
    quote: async () => ({ upperBoundCny: 1, quoteRef: 'new-first-frame',
      validUntil: new Date(Date.now() + 60_000).toISOString() }),
    assertCurrent: async () => {}, verifyRejection: async () => false });
  await affordable.reserveBatch(newBudgetScope, actualOperations);
  await assert.rejects(readSocialProductFootageRevisionPaidPreflight({ ...preflight,
    readCanonicalPlan: async () => ({ ...canonical, paidOperations: [{ ...canonical.paidOperations[0]!,
      inputContractHash: '9'.repeat(64) }] }) }), /complete_new_run_reservation_required/,
  'a paid reservation must match the canonical operation fingerprint');
  const resultPreflight = await readSocialProductFootageRevisionPaidPreflight(preflight);
  assert.equal(resultPreflight.retainedCny, 6);
  assert.equal(resultPreflight.remainingCny, 4);
  assert.equal(resultPreflight.authorizesProvider, false);
  const freezeCas = replayStore.compareAndSwap.bind(replayStore);
  let freezeCrash = true;
  replayStore.compareAndSwap = async (collection, recordId, expected, patch) => {
    const accepted = await freezeCas(collection, recordId, expected, patch);
    if (collection === STARTER_COLLECTIONS.runs && freezeCrash) {
      freezeCrash = false;
      throw Error('crash-after-paid-plan-freeze-cas');
    }
    return accepted;
  };
  await assert.rejects(freezeSocialProductFootageRevisionPaidPlan(preflight),
    /crash-after-paid-plan-freeze-cas/);
  const postFreezeStore = new LangGraphTestStore(file);
  (postFreezeStore as any).supportsAtomicCompareAndSwap = async () => true;
  const postFreezeRepository = createStarter198Repository(postFreezeStore);
  const postFreezeGuard = { ...replayScope, repository: postFreezeRepository,
    prepared: { ...replayScope.prepared, repository: postFreezeRepository, store: postFreezeStore } };
  const postFreezeInput = { ...preflight, repository: postFreezeRepository, guard: postFreezeGuard };
  const restartedPlan = await readSocialProductFootageRevisionPaidPlanFreeze(postFreezeInput);
  assert.equal(restartedPlan.authorizesQueue, false);
  assert.equal(restartedPlan.authorizesProvider, false);
  const frozenPlan = await freezeSocialProductFootageRevisionPaidPlan(postFreezeInput);
  assert.equal(frozenPlan.repeated, true);
  assert.equal(frozenPlan.recordHash, restartedPlan.recordHash);
  const concurrentReplay = await Promise.allSettled([
    freezeSocialProductFootageRevisionPaidPlan(postFreezeInput),
    freezeSocialProductFootageRevisionPaidPlan(postFreezeInput),
  ]);
  assert.ok(concurrentReplay.some(item => item.status === 'fulfilled'
    && item.value.repeated && item.value.recordHash === restartedPlan.recordHash));
  assert.ok(concurrentReplay.every(item => item.status === 'fulfilled'
    ? item.value.recordHash === restartedPlan.recordHash
    : /social_content_mutation_busy/.test(String(item.reason))));
  assert.equal((await postFreezeStore.list<any>('content_execution_jobs',
    { where: { tenant_id: 'tenant', run_id: result.runId } })).totalItems, 0);
  await assert.rejects(enqueueSocialContentAutoProduction({ repository: postFreezeRepository,
    tenantId: 'tenant', userId: 'owner', taskId: 'task', runId: result.runId }),
  /product_footage_revision_worker_admission_required/);
  assert.equal((await postFreezeStore.list<any>('content_execution_jobs',
    { where: { tenant_id: 'tenant', run_id: result.runId } })).totalItems, 0);
  await assert.rejects(readSocialProductFootageRevisionPaidPlanFreeze({ ...postFreezeInput,
    readCanonicalPlan: async () => ({ ...canonical, paidOperations: [{ ...canonical.paidOperations[0]!,
      inputContractHash: '9'.repeat(64) }] }) }), /complete_new_run_reservation_required/);
  await assert.rejects(readSocialProductFootageRevisionPaidPreflight({ ...preflight,
    ledgerRoot: path.join(root, 'wrong-ledger'),
    guard: { ...replayScope, ledgerRoot: path.join(root, 'wrong-ledger') } }), /guard_changed/);
  bytesCurrent = false;
  await assert.rejects(readSocialProductFootageRevisionPaidPreflight(preflight), /review_not_current|review_changed/);
  await assert.rejects(readSocialProductFootageRevisionPaidPlanFreeze(postFreezeInput), /review_not_current|review_changed/);
  bytesCurrent = true;
  rightsCurrent = false;
  await assert.rejects(readSocialProductFootageRevisionHandoffGuard(replayScope), /review_not_current/);
  await assert.rejects(readSocialProductFootageRevisionPaidPlanFreeze(postFreezeInput), /review_not_current/);
  await assert.rejects(admitContentExecutionJob({ dataStore: postFreezeStore,
    tenantId: 'tenant', userId: 'owner', taskId: 'task', runId: result.runId,
    taskType: 'social_content_weekly' }), /footage_revision_admission_required/);
  assert.equal((await postFreezeRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row'))?.status,
    'paused');
  rightsCurrent = true;
  const stagedCheckpoint = { version: '1', inputHash: newBudgetScope.planHash,
    payload: { executor: 'langgraph', inputHash: newBudgetScope.planHash, planVersion: '8',
      approvedContext: { footageRevisionPlanHash: newBudgetScope.planHash } },
    updatedAt: new Date().toISOString() };
  const staged = await stageBlockedFootageRevisionJob({ dataStore: postFreezeStore,
    tenantId: 'tenant', taskId: 'task', runId: result.runId, userId: 'owner',
    taskType: 'social_content_weekly', assertAuthority: async () => {},
    checkpoints: { 'social.executor': stagedCheckpoint,
      'content.production_bridge': { version: '1', inputHash: newBudgetScope.planHash,
        payload: { planVersion: '8', inputHash: newBudgetScope.planHash },
        updatedAt: stagedCheckpoint.updatedAt } } });
  const provenance = createPresenterFirstFrameAssetProvenance({ presenter: { assetId: 'person',
    assetVersion: 2, referenceAssetIds: ['person-master'], referenceSha256s: ['8'.repeat(64)] },
    products: [], background: { referenceSourceId: 'benchmark', referenceShotId: 'S01',
      startSeconds: 0, endSeconds: 2, referenceFirstFrameRef: '/media/tenants/tenant/reference.png',
      referenceFirstFrameSha256: '9'.repeat(64) } });
  const admissionInput = { repository: postFreezeRepository, guard: postFreezeGuard, ledgerRoot,
    readCanonicalPlan: async () => canonical,
    readCurrentAssetProvenanceHash: async () => provenance.manifestHash };
  await assert.rejects(admitSocialProductFootageRevisionWorker(admissionInput),
    /first_frame_settlement_or_future_hold_invalid/);
  await affordable.markOutcome(newBudgetScope, revisionOperationId, 'completed', 'new-first-frame-receipt');
  await assert.rejects(admitSocialProductFootageRevisionWorker(admissionInput),
    /new_first_frame_approval_set_incomplete/);
  await createPresenterFirstFrameApproval(postFreezeStore, { tenantId: 'tenant', taskId: 'task',
    runId: result.runId, planHash: newBudgetScope.planHash, groupId: 'S01',
    presenterGroupContractHash: presenterGroup.contractHash,
    referenceCompositionHashes: ['a'.repeat(64)], backgroundPlateSha256: '9'.repeat(64),
    personRemovalEvidence: { receiptRef: 'new-removal', sourceSha256: '9'.repeat(64),
      outputSha256: 'b'.repeat(64) }, assetProvenance: provenance,
    presenter: { assetId: 'person', assetVersion: 2, authorizationRef: 'new-rights',
      consentRef: 'new-consent', providerId: 'heygen', providerPresenterId: 'new-avatar',
      providerVoiceId: 'new-voice' }, compositeFirstFrameSha256: 'b'.repeat(64),
    compositeFirstFrameUrl: '/media/tenants/tenant/new-frame.png',
    qa: { passed: true, receiptRef: 'new-qa', reportHash: 'c'.repeat(64) },
    createdAt: new Date().toISOString() });
  const admitted = await admitSocialProductFootageRevisionWorker(admissionInput);
  assert.equal(admitted.authorizesProductionQueue, true);
  assert.equal(admitted.authorizesProvider, false);
  assert.equal(admitted.authorizesProduction, false);
  const admissionRestartStore = new LangGraphTestStore(file);
  (admissionRestartStore as any).supportsAtomicCompareAndSwap = async () => true;
  const admissionRestartRepository = createStarter198Repository(admissionRestartStore);
  const replayedAdmission = await admitSocialProductFootageRevisionWorker({ ...admissionInput,
    repository: admissionRestartRepository, guard: { ...postFreezeGuard,
      repository: admissionRestartRepository, prepared: { ...postFreezeGuard.prepared,
        repository: admissionRestartRepository, store: admissionRestartStore } } });
  assert.equal(replayedAdmission.repeated, true);
  assert.equal(replayedAdmission.recordHash, admitted.recordHash);
  const decisions = await admissionRestartStore.list<any>('social_presenter_first_frame_decisions',
    { where: { tenant_id: 'tenant', task_id: 'task', run_id: result.runId }, perPage: 2 });
  assert.equal(decisions.totalItems, 1);
  assert.equal(decisions.items[0]?.payload.actorId, 'system:presenter-first-frame-qa');
  await assert.rejects(admitSocialProductFootageRevisionWorker({ ...admissionInput,
    readCurrentAssetProvenanceHash: async () => 'd'.repeat(64) }), /asset_provenance_changed/);
  const admittedJob = (await readContentExecutionJob(admissionRestartStore, 'tenant', 'task', result.runId))!;
  const admittedTask = (await admissionRestartStore.getById<any>(STARTER_COLLECTIONS.socialContentTasks, 'task-row'))!;
  assert.equal(hasCompleteFootageRevisionProductionAdmission(admittedJob,
    admittedTask.brief._productFootageRevision), true, JSON.stringify({
      checkpoint: admittedJob.checkpoints['social.footage_revision_worker_admission'],
      marker: admittedTask.brief._productFootageRevision,
    }));
  await assert.doesNotReject(controlContentExecutionJob({ dataStore: admissionRestartStore, tenantId: 'tenant',
    jobId: staged.id, action: 'retry' }));
  const admittedRow = await admissionRestartStore.getById<any>('content_execution_jobs', staged.id);
  const admittedCheckpoints = structuredClone(admittedRow!.checkpoints);
  const damaged = structuredClone(admittedCheckpoints);
  damaged['social.footage_revision_worker_admission'].payload.planHash = '0'.repeat(64);
  await admissionRestartStore.update('content_execution_jobs', staged.id, { checkpoints: damaged });
  let damagedExecuted = 0;
  const damagedWorker = new DurableContentExecutionWorker({ dataStore: admissionRestartStore,
    allowedJobIds: [staged.id], execute: async () => { damagedExecuted++; } });
  await damagedWorker.drain();
  assert.equal(damagedExecuted, 0, 'tampered admission is not claimable by the production worker');
  await admissionRestartStore.update('content_execution_jobs', staged.id, { checkpoints: admittedCheckpoints });
  let admittedExecuted = 0;
  const admittedWorker = new DurableContentExecutionWorker({ dataStore: admissionRestartStore,
    allowedJobIds: [staged.id], execute: async job => {
      admittedExecuted++;
      const budget = await prepareSocialContentProductionBudget({ repository: admissionRestartRepository,
        tenantId: job.tenantId, taskId: job.taskId, runId: job.runId,
        ports: { ledgerRoot } } as any);
      assert.equal(budget.status, 'reserved');
      const intent = canonical.paidOperations.find(item => item.operationId === videoOperationId)!;
      const { maximumUnits: _maximumUnits, ...binding } = intent;
      await budget.paidPermit.beforeSubmit({ ...binding, actualUnits: { providerSeconds: 2 } });
    } });
  await admittedWorker.drain();
  for (let attempt = 0; attempt < 60 && admittedWorker.isLocallyActive('tenant', 'task'); attempt++)
    await new Promise<void>(resolve => setImmediate(resolve));
  admittedWorker.stop();
  assert.equal(admittedExecuted, 1, 'complete admission returns the revision to the existing production worker');
  const stopped = await readContentExecutionJob(admissionRestartStore, 'tenant', 'task', result.runId);
  assert.match(stopped?.lastError ?? '', /product_footage_revision_current_provider_authority_adapter_required/);
  assert.equal(stopped?.status, 'blocked');
  await controlContentExecutionJob({ dataStore: admissionRestartStore, tenantId: 'tenant',
    jobId: staged.id, action: 'retry' });
  let currentProviderAuthorityChecks = 0;
  const authorityWorker = new DurableContentExecutionWorker({ dataStore: admissionRestartStore,
    allowedJobIds: [staged.id], execute: async job => {
      const budget = await prepareSocialContentProductionBudget({ repository: admissionRestartRepository,
        tenantId: job.tenantId, taskId: job.taskId, runId: job.runId,
        ports: { ledgerRoot, assertNewSubmit: async () => {
          currentProviderAuthorityChecks++;
          throw Error('user_input_required:weekly_production_sample_policy_evidence_required');
        } } } as any);
      assert.equal(budget.status, 'reserved');
      const intent = canonical.paidOperations.find(item => item.operationId === videoOperationId)!;
      const { maximumUnits: _maximumUnits, ...binding } = intent;
      await budget.paidPermit.beforeSubmit({ ...binding, actualUnits: { providerSeconds: 2 } });
    } });
  await authorityWorker.drain();
  for (let attempt = 0; attempt < 60 && authorityWorker.isLocallyActive('tenant', 'task'); attempt++)
    await new Promise<void>(resolve => setImmediate(resolve));
  authorityWorker.stop();
  const authorityStopped = await readContentExecutionJob(admissionRestartStore, 'tenant', 'task', result.runId);
  assert.equal(currentProviderAuthorityChecks, 1,
    'the revision reuses the canonical current-authority hook before creating a paid claim');
  assert.match(authorityStopped?.lastError ?? '', /weekly_production_sample_policy_evidence_required/);
  assert.equal(authorityStopped?.status, 'blocked');
});

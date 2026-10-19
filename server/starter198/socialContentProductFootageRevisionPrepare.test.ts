import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { SocialContentTaskBudget } from '../lib/socialContentTaskBudget.js';
import { socialPaidIntentOperation } from '../lib/socialContentTaskBudgetAuthority.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { prepareSocialProductFootageRevision, readPreparedSocialProductFootageRevision } from './socialContentProductFootageRevisionPrepare.js';
import { startSocialContentTask } from './socialContentTasks.js';
import { socialRequestHash } from './socialContentValidation.js';
import { createDurableProductFootageRevisionReaders } from './socialContentProductFootageRevisionDurableRead.js';
import { socialAssetSupplyPlanIdentityHash } from './socialAssetSupplyPlanIdentity.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';

const evidence = { contentSha256: 'a'.repeat(64), productId: 'product', sceneFunction: 'demonstration',
  approvalId: 'b'.repeat(15), visualFindingId: 'c'.repeat(15) };
const plan: any = { planVersion: '7', shots: [{ shotId: 'S01', sourceRefs: ['footage'],
  materialRouting: { materialType: 'product', policy: 'local_only', localMatch: {
    state: 'matched', sourceRefs: ['footage'], productRef: 'product', evidenceRef: 'match' } },
  selectedMaterialSegment: { sourceRef: 'footage', segmentId: 'window', startSeconds: 1, endSeconds: 3 },
  productionInstruction: 'unchanged' }] };

async function seedSourceJob(store: LangGraphTestStore) {
  await store.create('content_execution_jobs', { id: 'source-job', tenant_id: 'tenant',
    job_key: 'source-job', task_id: 'task', run_id: 'old-run', user_id: 'owner',
    account_id: '_unassigned', task_type: 'social_content_weekly', status: 'blocked',
    checkpoints: { 'social.executor': { version: '1', inputHash: 'f'.repeat(64),
      payload: { inputHash: 'f'.repeat(64), approvedContext: { assetSupplyPlan: structuredClone(plan) } },
      updatedAt: new Date().toISOString() } }, provider_receipts: [], provider_state: 'none' });
}

test('same-SKU frozen footage revision survives restart and duplicate, but never starts the original task', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-revision-cas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json'), store = new LangGraphTestStore(file);
  (store as any).supportsAtomicCompareAndSwap = async () => true;
  const repository = createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant', task_id: 'task',
    version: '7', status: 'attention', run_id: 'old-run', last_operation_id: 'old',
    replication_script: { frozen: true }, brief: { productId: 'product', voice: 'voice-original', perItemBudgetCny: 10 } });
  await store.create(STARTER_COLLECTIONS.runs, { id: 'old-run', tenant_id: 'tenant', status: 'failed',
    starter_context: { socialTaskId: 'task', budgetLedgerRef: 'ledger:original-10-cny' } });
  await seedSourceJob(store);
  let proofValid = true;
  const proof = { readMaterials: async () => ({ status: 'ready' as const, items: [] }),
    readCurrentPlan: async () => structuredClone(plan), readBudgetLedgerRef: async () => 'ledger:original-10-cny',
    readReviewedSegment: async (request: any) => proofValid ? ({ material: { id: request.materialId,
      productId: request.productId, contentSha256: request.expectedContentSha256 },
      segmentId: request.segmentId, startSeconds: request.startSeconds, endSeconds: request.endSeconds }) as any : null as any };
  const input = { repository, store, tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run',
    budgetLedgerRef: 'ledger:original-10-cny', productId: 'product', shotId: 'S01', evidence,
    userId: 'system', idempotencyKey: 'footage-prepare', expectedVersion: '7', sourcePlan: plan, ...proof };
  const first = await prepareSocialProductFootageRevision(input);
  assert.equal(first.preparedVersion, '8');
  assert.equal(first.authorizesQueue, false); assert.equal(first.authorizesProvider, false);
  const restartStore = new LangGraphTestStore(file);
  (restartStore as any).supportsAtomicCompareAndSwap = async () => true;
  const restartRepository = createStarter198Repository(restartStore);
  const again = await prepareSocialProductFootageRevision({ ...input, repository: restartRepository, store: restartStore });
  assert.deepEqual(again, first);
  const read = { ...input, repository: restartRepository, store: restartStore, expectedPreparedVersion: '8' };
  const candidate = await readPreparedSocialProductFootageRevision(read);
  assert.equal(candidate.plan.shots[0]?.selectedMaterialSegment?.footageEvidence?.visualFindingId, evidence.visualFindingId);
  assert.equal(candidate.budgetLedgerRef, 'ledger:original-10-cny');
  const task = await restartRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  assert.equal(task?.run_id, 'old-run');
  assert.equal((task?.brief as any).voice, 'voice-original');
  assert.equal((task?.brief as any).perItemBudgetCny, 10);
  assert.equal((await restartStore.list('content_execution_jobs', { where: { tenant_id: 'tenant', task_id: 'task' } })).totalItems, 1);
  let queued = 0;
  await assert.rejects(startSocialContentTask({ repository: restartRepository, tenantId: 'tenant', userId: 'owner',
    taskId: 'task', expectedVersion: '8', idempotencyKey: 'ordinary-start',
    orchestratorQueue: { enqueue: async () => { queued++; return { queueItemId: 'queue', runId: 'new-run' }; } } }),
  /product_footage_revision_start_adapter_required/);
  assert.equal(queued, 0);
  await assert.rejects(prepareSocialProductFootageRevision({ ...input, repository: restartRepository,
    store: restartStore, idempotencyKey: 'new-prepare' }), /source_changed/);
  proofValid = false;
  await assert.rejects(readPreparedSocialProductFootageRevision(read), /review_not_current/);
  proofValid = true;
  await restartStore.create('content_execution_jobs', { id: 'in-flight', tenant_id: 'tenant', task_id: 'task',
    status: 'reconciling', run_id: 'old-run' });
  await assert.rejects(readPreparedSocialProductFootageRevision(read), /execution_active/);
});

test('stale source, changed ledger, active run and tampered marker cannot prepare or be replayed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-revision-stale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json'));
  (store as any).supportsAtomicCompareAndSwap = async () => true;
  const repository = createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant', task_id: 'task',
    version: '7', status: 'attention', run_id: 'old-run', last_operation_id: 'old', brief: { productId: 'product' } });
  await store.create(STARTER_COLLECTIONS.runs, { id: 'old-run', tenant_id: 'tenant', status: 'running',
    starter_context: { socialTaskId: 'task', budgetLedgerRef: 'ledger' } });
  await seedSourceJob(store);
  const base = { repository, store, tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run',
    budgetLedgerRef: 'ledger', productId: 'product', shotId: 'S01', evidence, userId: 'system',
    idempotencyKey: 'prepare-active', expectedVersion: '7', sourcePlan: plan,
    readMaterials: async () => ({ status: 'ready' as const, items: [] }),
    readCurrentPlan: async () => structuredClone(plan), readBudgetLedgerRef: async () => 'ledger',
    readReviewedSegment: async (request: any) => ({ material: { id: request.materialId,
      productId: request.productId, contentSha256: request.expectedContentSha256 }, segmentId: request.segmentId,
      startSeconds: request.startSeconds, endSeconds: request.endSeconds }) as any };
  await assert.rejects(prepareSocialProductFootageRevision(base), /source_run_active/);
  await repository.update(STARTER_COLLECTIONS.runs, 'tenant', 'old-run', { status: 'failed' });
  await assert.rejects(prepareSocialProductFootageRevision({ ...base, idempotencyKey: 'plan-drift',
    readCurrentPlan: async () => ({ ...plan, planVersion: 'other' }) }), /source_plan_changed/);
  await assert.rejects(prepareSocialProductFootageRevision({ ...base, idempotencyKey: 'budget-drift',
    readBudgetLedgerRef: async () => 'another-ledger' }), /budget_changed/);
  const first = await prepareSocialProductFootageRevision({ ...base, idempotencyKey: 'valid' });
  assert.equal(first.preparedVersion, '8');
  const row = await repository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  const changed = structuredClone(row!.brief as any);
  changed._productFootageRevision.revisedPlan.shots[0].productionInstruction = 'tampered';
  changed._productFootageRevision.markerHash = 'f'.repeat(64);
  await repository.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row', { brief: changed });
  await assert.rejects(readPreparedSocialProductFootageRevision({ ...base, expectedPreparedVersion: '8' }), /marker_corrupt/);
  await assert.rejects(prepareSocialProductFootageRevision({ ...base, idempotencyKey: 'valid' }), /marker_corrupt/);
  const selfRehashed = structuredClone(row!.brief as any);
  selfRehashed._productFootageRevision.operationRequestHash = 'e'.repeat(64);
  const { markerHash: _oldHash, ...body } = selfRehashed._productFootageRevision;
  selfRehashed._productFootageRevision.markerHash = socialRequestHash(body);
  await repository.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row', { brief: selfRehashed });
  await assert.rejects(readPreparedSocialProductFootageRevision({ ...base, expectedPreparedVersion: '8' }), /operation_changed/);
});

test('new prepared marker requires independently recoverable source plan and ledger identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-revision-durable-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json'));
  (store as any).supportsAtomicCompareAndSwap = async () => true;
  const repository = createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant',
    task_id: 'task', version: '7', status: 'attention', run_id: 'old-run',
    brief: { productId: 'product' } });
  await store.create(STARTER_COLLECTIONS.runs, { id: 'old-run', tenant_id: 'tenant', status: 'failed',
    starter_context: { socialTaskId: 'task' } });
  const request = { repository, store, tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run',
    budgetLedgerRef: 'ledger', productId: 'product', shotId: 'S01', evidence,
    userId: 'system', idempotencyKey: 'missing-source', expectedVersion: '7', sourcePlan: plan,
    readMaterials: async () => ({ status: 'ready' as const, items: [] }),
    readCurrentPlan: async () => structuredClone(plan), readBudgetLedgerRef: async () => 'ledger',
    readReviewedSegment: async (value: any) => ({ material: { id: value.materialId,
      productId: value.productId, contentSha256: value.expectedContentSha256 },
      segmentId: value.segmentId, startSeconds: value.startSeconds, endSeconds: value.endSeconds }) as any };
  await assert.rejects(prepareSocialProductFootageRevision(request), /frozen_plan_missing/);
  await seedSourceJob(store);
  await assert.rejects(prepareSocialProductFootageRevision({ ...request, idempotencyKey: 'missing-ref' }),
    /budget_ledger_identity_missing_or_changed/);
  const restartedStore = new LangGraphTestStore(path.join(root, 'store.json'));
  (restartedStore as any).supportsAtomicCompareAndSwap = async () => true;
  const restartedRepository = createStarter198Repository(restartedStore);
  await assert.rejects(prepareSocialProductFootageRevision({ ...request,
    repository: restartedRepository, store: restartedStore, idempotencyKey: 'missing-ref-after-restart' }),
  /budget_ledger_identity_missing_or_changed/);
  const blocked = await restartedRepository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  assert.equal(blocked?.version, '7');
  assert.equal((blocked?.brief as any)?._productFootageRevision, undefined);
  await store.update(STARTER_COLLECTIONS.runs, 'old-run', {
    starter_context: { socialTaskId: 'task', budgetLedgerRef: 'ledger' } });
  await store.update('content_execution_jobs', 'source-job', {
    checkpoints: { 'social.executor': { version: '1', inputHash: 'f'.repeat(64),
      payload: { inputHash: 'f'.repeat(64), approvedContext: {
        assetSupplyPlan: { ...structuredClone(plan), planVersion: 'other' } } },
      updatedAt: new Date().toISOString() } } });
  await assert.rejects(prepareSocialProductFootageRevision({ ...request, idempotencyKey: 'changed-plan' }),
    /frozen_plan_changed/);
  const unchanged = await repository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  assert.equal(unchanged?.version, '7');
  assert.equal((unchanged?.brief as any)?._productFootageRevision, undefined);
});

test('original budget ref is read-only recoverable from complete frozen checkpoint and ledger after restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-ledger-attestation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json'), ledgerRoot = path.join(root, 'ledger');
  const store = new LangGraphTestStore(file), repository = createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.runs, { id: 'old-run', tenant_id: 'tenant', status: 'failed',
    starter_context: { socialTaskId: 'task' } });
  await seedSourceJob(store);
  const scope = { tenantId: 'tenant', taskId: 'task', runId: 'old-run', planHash: 'f'.repeat(64) };
  const intent = { operationId: 'original-paid-operation', provider: 'qwen', model: 'model',
    accountRef: 'account', stage: 'material_video_analysis', shotId: 'S01',
    inputContractHash: 'a'.repeat(64), maximumUnits: { requests: 1 } };
  const operation = socialPaidIntentOperation(scope, intent);
  const budget = new SocialContentTaskBudget(ledgerRoot, { assertCurrent: async () => {},
    authorization: async () => ({ maximumCny: 10, authorizationRef: 'original-authority' }),
    quote: async () => ({ upperBoundCny: 2, quoteRef: 'original-quote', validUntil: '2099-01-01T00:00:00Z' }),
    verifyRejection: async () => false });
  await budget.reserveBatch(scope, [operation]);
  const expected = 'ledger:' + createHash('sha256').update(JSON.stringify([
    'tenant', 'task', 'old-run', scope.planHash, 'original-authority'])).digest('hex');
  const reader = (targetStore: LangGraphTestStore) => createDurableProductFootageRevisionReaders({
    repository: createStarter198Repository(targetStore), tenantId: 'tenant', taskId: 'task',
    sourceRunId: 'old-run', expectedSourcePlanHash: socialAssetSupplyPlanIdentityHash(plan),
    expectedBudgetLedgerRef: expected, ledgerRoot });
  // A reserved (possibly unknown-billed) amount without a frozen checkpoint
  // cannot be interpreted as free budget or as an authorized revision.
  await assert.rejects(reader(new LangGraphTestStore(file)).assertDurableSource(), /budget_ledger_identity_missing_or_changed/);
  const job = (await store.list<any>('content_execution_jobs', { where: { id: 'source-job' } })).items[0];
  await store.update('content_execution_jobs', 'source-job', { checkpoints: { ...job!.checkpoints,
    'social.whole_film_budget': { version: '1', inputHash: scope.planHash,
      payload: { scopeHash: paidProductionHash(scope), operationIds: [operation.operationId], plan: { scope, authorizationRef: 'original-authority',
        maximumCny: 10, paidOperations: [intent] } }, updatedAt: new Date().toISOString() } } });
  assert.equal((await reader(new LangGraphTestStore(file)).assertDurableSource()).budgetLedgerRef, expected);
  await budget.markOutcome(scope, operation.operationId, 'unknown', 'provider-maybe-accepted');
  assert.equal((await reader(new LangGraphTestStore(file)).assertDurableSource()).budgetLedgerRef, expected);
  assert.equal(budget.attestOriginalReservation({ ...scope, runId: 'other-run' },
    'original-authority', [operation]), null);
  const ledgerFile = path.join(ledgerRoot, fs.readdirSync(ledgerRoot).find(name => name.endsWith('.json'))!);
  const historical = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  for (const entry of Object.values(historical.entries) as any[]) delete entry.authorizationRef;
  fs.writeFileSync(ledgerFile, JSON.stringify(historical));
  assert.equal(budget.status(scope)?.retainedCny, 2);
  await assert.rejects(reader(new LangGraphTestStore(file)).assertDurableSource(),
    /budget_ledger_identity_missing_or_changed/);
  const changed = (await store.list<any>('content_execution_jobs', { where: { id: 'source-job' } })).items[0];
  await store.update('content_execution_jobs', 'source-job', { checkpoints: { ...changed!.checkpoints,
    'social.whole_film_budget': { ...changed!.checkpoints['social.whole_film_budget'],
      payload: { ...changed!.checkpoints['social.whole_film_budget'].payload,
        operationIds: ['different-operation'] } } } });
  await assert.rejects(reader(new LangGraphTestStore(file)).assertDurableSource(), /budget_ledger_identity_missing_or_changed/);
});

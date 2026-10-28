import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {createProductionTestStore} from '../production/testStore.js';
import {createStarter198Repository} from './repository.js';
import type {MaterialRecord} from '../lib/materialLibrary.js';
import {socialRequestHash} from './socialContentValidation.js';
import {recoverSocialContentExecution} from './socialContentExecutionRecovery.js';
import {applyInitialMaterialRecovery, materialRecoveryScopeHash, validateMeasuredMaterialRecovery} from './socialContentMaterialRecovery.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';

test('only a matching tenant-owned replacement can resume the original blocked job and preserves prior receipts', async () => {
 const store = createProductionTestStore();
 const hash = 'a'.repeat(64);
 const analysis = buildMaterialScriptAnalysis({materialId: 'new', name: '产品展示', sourceRevision: hash,
  duration: 5, segments: [{start: 0, end: 5, observedFacts: '产品展示', subject: '产品', confidence: .95}],
  visualObservations: ['产品展示']});
 const record: MaterialRecord = {id: 'new', type: 'video', tenantId: 'tenant', name: '产品展示', duration: 5,
  sourceRevision: hash, scriptAnalysis: analysis, materialRoles: ['product'], rightsStatus: 'owned',
  rightsEvidenceRef: 'ownership:new', commercialUseApproved: true, derivativeUseAllowed: true,
  visualObservations: ['产品展示'], segments: [{start: 0, end: 5}]};
 const repository = {...createStarter198Repository(store), materialLibrary: async () => ({status: 'ready' as const, items: [record], sources: []})};
 await store.create('starter_social_content_tasks', {tenant_id: 'tenant', task_id: 'task', run_id: 'run', version: '14'});
 const evidence = {schemaVersion: 'social-measured-local-materials.v1', tenantId: 'tenant', taskId: 'task', runId: 'run',
  originalPlanHash: hash, voiceSha256: hash, timeline: [{shotId: 'slot', start: 0, end: 4}], candidateHash: hash,
  sourceBytes: [], changes: [], pending: [{shotId: 'slot', theme: 'product', requiredSeconds: 4, pendingReason: 'awaiting_theme_material'}]};
 const plan = {materialRoutingPolicyVersion: 'type-aware.v3', shots: [{shotId: 'slot', function: 'value',
  materialRouting: {materialType: 'product', pendingReason: 'awaiting_theme_material'}}]};
 const checkpoint = {version: '1', inputHash: socialRequestHash(evidence), updatedAt: '2026-10-28T00:00:00.000Z',
  payload: {...evidence, status: 'blocked', effectivePlan: plan, sourceResult: {execution: {shots: [{sceneId: 'done'}]}}}};
 const receipt = {provider: 'heygen', requestId: 'old', state: 'completed', providerTaskId: 'original',
  firstRecordedAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z'};
 const row = await store.create<any>('content_execution_jobs', {tenant_id: 'tenant', task_id: 'task', run_id: 'run',
  job_key: 'original', user_id: 'owner', account_id: '_unassigned', task_type: 'social_content_instant', status: 'blocked',
  provider_state: 'completed', provider_receipts: [receipt], checkpoints: {'social.measured_local_materials': checkpoint}});
 const command = {action: 'resume_material_supply' as const, jobId: row.id, runId: 'run', expectedVersion: '14',
  slotId: 'slot', materialId: 'new'};
 const input = {repository, tenantId: 'tenant', userId: 'owner', taskId: 'task', idempotencyKey: 'resume', command};
 await assert.rejects(recoverSocialContentExecution({...input, tenantId: 'other'}), /task_not_found/);
 await assert.rejects(recoverSocialContentExecution({...input, command: {...command, slotId: 'other'}}), /slot_not_pending/);
 await assert.rejects(recoverSocialContentExecution({...input, command: {...command, materialId: 'other'}}), /material_not_eligible/);
 record.tenantId = 'other';
 await assert.rejects(recoverSocialContentExecution(input), /material_not_eligible/);
 record.tenantId = 'tenant';
 record.materialRoles = ['factory'];
 // Existing semantic analysis still says product; change both trusted tags below.
 record.rightsStatus = 'unknown';
 await assert.rejects(recoverSocialContentExecution(input), /material_not_eligible/);
 record.materialRoles = ['product']; record.rightsStatus = 'owned';
 await store.update('content_execution_jobs', row.id, {provider_state: 'unknown', provider_receipts: [{...receipt, state: 'unknown'}]});
 await assert.rejects(recoverSocialContentExecution(input), /original_receipt_required/);
 await store.update('content_execution_jobs', row.id, {provider_state: 'completed', provider_receipts: [receipt]});
 const result = await recoverSocialContentExecution(input);
 assert.equal(result.jobId, row.id); assert.equal(result.runId, 'run'); assert.equal(result.status, 'queued');
 const saved = await store.getById<any>('content_execution_jobs', row.id);
 assert.deepEqual(saved.provider_receipts, [receipt]);
 assert.deepEqual(saved.checkpoints['social.measured_local_materials'], checkpoint);
 assert.deepEqual(saved.checkpoints['social.material_recovery_selection'].payload.selections.slot,
  {materialId: 'new', originalPlanHash: hash, phase: 'measured', sourceRevision: hash});
 assert.equal((await recoverSocialContentExecution(input)).status, 'queued');
 await assert.rejects(recoverSocialContentExecution({...input, command: {...command, materialId: 'other'}}), /binding_changed/);
 const evidence2 = {...evidence, timeline: [...evidence.timeline, {shotId: 'slot2', start: 4, end: 8}],
  pending: [{shotId: 'slot2', theme: 'product', requiredSeconds: 4, pendingReason: 'awaiting_theme_material'}]};
 const plan2 = {...plan, shots: [...plan.shots, {...plan.shots[0]!, shotId: 'slot2'}]};
 const checkpoint2 = {...checkpoint, inputHash: socialRequestHash(evidence2),
  payload: {...evidence2, status: 'blocked', effectivePlan: plan2, sourceResult: checkpoint.payload.sourceResult}};
 await store.update('content_execution_jobs', row.id, {status: 'blocked',
  checkpoints: {...saved.checkpoints, 'social.measured_local_materials': checkpoint2}});
 const second = await recoverSocialContentExecution({...input, command: {...command, slotId: 'slot2'}});
 assert.equal(second.status, 'queued');
 const saved2 = await store.getById<any>('content_execution_jobs', row.id);
 assert.deepEqual(saved2.checkpoints['social.material_recovery_selection'].payload.selections,
  {slot: {materialId: 'new', originalPlanHash: hash, phase: 'measured', sourceRevision: hash},
   slot2: {materialId: 'new', originalPlanHash: hash, phase: 'measured', sourceRevision: hash}});
 assert.deepEqual(saved2.checkpoints['social.measured_local_materials'].payload.sourceResult, checkpoint.payload.sourceResult);
});

test('initial non-human selection is rebound to the same slot and leaves other missing slots blocked', async () => {
 const store = createProductionTestStore();
 const hash = 'b'.repeat(64);
 const analysis = buildMaterialScriptAnalysis({materialId: 'chosen', name: '产品主题素材', sourceRevision: hash,
  duration: 6, segments: [{start: 0, end: 6, observedFacts: '产品展示', subject: '产品', confidence: .95}],
  visualObservations: ['产品展示']});
 const record: MaterialRecord = {id: 'chosen', type: 'video', tenantId: 'tenant', name: '产品主题素材', duration: 6,
  sourceRevision: hash, scriptAnalysis: analysis, materialRoles: ['product'], rightsStatus: 'owned',
  rightsEvidenceRef: 'ownership:chosen', commercialUseApproved: true, derivativeUseAllowed: true,
  visualObservations: ['产品展示'], segments: [{start: 0, end: 6}]};
 const repository = {...createStarter198Repository(store), materialLibrary: async () =>
  ({status: 'ready' as const, items: [record], sources: []})};
 const plan = {materialRoutingPolicyVersion: 'type-aware.v3', shots: [
  {shotId: 'product-slot', function: 'value', sourceStrategy: 'customer_real_asset', sourceRefs: [],
   materialRouting: {materialType: 'product', policy: 'local_only', pendingReason: 'awaiting_theme_material',
    localMatch: {state: 'missing', sourceRefs: [], evidenceRef: null}}},
  {shotId: 'factory-slot', function: 'proof', sourceStrategy: 'customer_real_asset', sourceRefs: [],
   materialRouting: {materialType: 'factory', policy: 'local_only', pendingReason: 'awaiting_theme_material',
    localMatch: {state: 'missing', sourceRefs: [], evidenceRef: null}}},
 ]} as unknown as SocialAssetSupplyPlan;
 const originalPlanHash = socialRequestHash(plan);
 const initial = {schemaVersion: 'social-initial-material-block.v1', tenantId: 'tenant', taskId: 'task', runId: 'run',
  taskVersion: '1', planHash: originalPlanHash, status: 'blocked', pending: [
   {shotId: 'product-slot', materialType: 'product', reason: 'awaiting_theme_material', referenceDurationSeconds: 4},
   {shotId: 'factory-slot', materialType: 'factory', reason: 'awaiting_theme_material', referenceDurationSeconds: 2},
  ]};
 const initialCheckpoint = {version: '1', inputHash: socialRequestHash(initial), payload: initial,
  updatedAt: '2026-10-28T00:00:00.000Z'};
 const job = {checkpoints: {'social.initial_material_block': initialCheckpoint}} as never;
 assert.deepEqual(await validateMeasuredMaterialRecovery({repository, tenantId: 'tenant', taskId: 'task', runId: 'run',
  job, slotId: 'product-slot', materialId: 'chosen', currentPlan: plan}),
  {originalPlanHash, phase: 'initial', sourceRevision: hash, requiredSeconds: 4});
 const recovery = {tenantId: 'tenant', taskId: 'task', runId: 'run', selections: {
  'product-slot': {materialId: 'chosen', originalPlanHash, sourceRevision: hash, requiredSeconds: 4,
   phase: 'initial' as const}}};
 const checkpoints = {'social.initial_material_block': initialCheckpoint, 'social.material_recovery_selection': {
  version: '1', inputHash: materialRecoveryScopeHash('tenant', 'task', 'run'), payload: recovery,
  updatedAt: '2026-10-28T00:00:00.000Z'}};
 const rebound = await runWithContentExecutionContext({dataStore: store, jobId: 'job', checkpoints,
  action: () => applyInitialMaterialRecovery({repository, tenantId: 'tenant', taskId: 'task', runId: 'run',taskVersion:'1',plan})});
 assert.equal(rebound.originalPlanHash, originalPlanHash);
 assert.equal(rebound.plan.shots[0]?.materialRouting?.pendingReason, undefined);
 assert.equal(rebound.plan.shots[0]?.selectedMaterialSegment?.sourceRef, 'chosen');
 assert.equal(rebound.plan.shots[1]?.materialRouting?.pendingReason, 'awaiting_theme_material');
 assert.equal(socialRequestHash(plan), originalPlanHash, 'the frozen task plan stays unchanged');
});

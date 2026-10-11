import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import type { WeeklyOperatingPackage, WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { planWeeklyExecutionTasks } from '../socialPrograms/executionTasks.js';
import { createAssignedPublicationPackage, persistPublicationAssignment, markPublicationAssignmentPackageReady, executeWeeklyPublication, type StoredPublicationAssignment, type WeeklyPublishingProviderAdapter } from '../publishing/weeklyLineage.js';
import { createSocialWeeklyPublicationAdapter } from './socialWeeklyPublicationAdapter.js';
import {readStarterPublicationPackage} from '../publishing/starterPublicationPackage.js';
import {assertWeeklyPublicationG6Admission} from './weeklyPublicationG6Admission.js';
import {SOCIAL_WEEKLY_G6_REVIEWS} from '../starter198/socialWeeklyG6ReviewService.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  const list = async <T>(collection: string, query: ListQuery = {}) => {
    let items = [...(rows.get(collection) || [])];
    for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
    if (query.sort) {
      const descending = query.sort.startsWith('-'), key = descending ? query.sort.slice(1) : query.sort;
      items.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1, perPage = query.perPage ?? 500, totalItems = items.length;
    return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
  };
  return {
    // Explicit isolated, controlled provider fixture capability.
    supportsAtomicOperationLease: () => true,
    rows, list,
    async getById<T>(collection: string, id: string) { return ((rows.get(collection) || []).find(item => item.id === id) as T | undefined) ?? null; },
    async create<T>(collection: string, data: Record<string, unknown>) { const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data }; rows.set(collection, [...(rows.get(collection) || []), item]); return item as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const item = (rows.get(collection) || []).find(row => row.id === id); if (!item) return false; Object.assign(item, data); return true; },
    async delete(collection: string, id: string) { const current = rows.get(collection) || []; const next = current.filter(item => item.id !== id); rows.set(collection, next); return next.length !== current.length; },
  };
}

const task = { publicationTaskId: 'weekly-item-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'youtube' as const, accountId: 'account-1', accountPositioning: 'proof', businessProposition: 'verified fact', cta: 'contact us', factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 3 }], metricTargets: ['inquiries'], publishWindow: '2026-09-22T10:00:00Z', status: 'ready' as const };
const weekly = {
  packageId: 'weekly-package-1', programId: 'program-1', version: 2, status: 'active', weekStart: '2026-09-22', weekEnd: '2026-09-28', objective: 'test',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 4 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 2 }, monthlyPlanRef: null,
  workflows: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: null,
  workflowTasks: [{ taskId: 'workflow-publishing', kind: 'publishing', taskRef: { type: 'weekly_workflow_task', id: 'workflow-publishing', version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null }],
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'weekly-package-1', version: 2, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [task], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1'], maxPublishItems: 1, weekStart: '2026-09-22', weekEnd: '2026-09-28', allowRealPublishing: true, authorizedBy: 'operator-1', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: [], changeReason: null, previousVersion: 1, createdBy: 'operator-1', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
} satisfies WeeklyOperatingPackage;
const production: PublishableProductionResult = { productionResultId: 'production-1', contentId: 'content-1', contentVersion: 'v3', contentHash: 'a'.repeat(64), title: 'Title', body: 'Body', assets: [{ kind: 'video', fileName: 'video.mp4', downloadUrl: '/api/overseas/files/video.mp4', contentHash: 'b'.repeat(64) }], sourceRefs: [{ type: 'director_brief', id: 'brief-1', version: 2 }], acceptedAt: '2026-09-21T10:00:00Z' };


async function setup(context: TestContext) {
  const bytes = Buffer.from('isolated published-media acceptance fixture');
  const mediaHash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.resolve('data/social-content-sources', `weekly-publish-test-${randomUUID()}`);
  const local = path.join(folder, `${mediaHash}.mp4`);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(local, bytes);
  context.after(() => fs.rm(folder, { recursive: true, force: true }));
  const dataStore = memoryStore();
  await dataStore.create('social_weekly_operating_packages', { tenant_id: 'tenant-a', program_id: weekly.programId, package_id: weekly.packageId, version: weekly.version, payload: weekly });
  const tasks = planWeeklyExecutionTasks('tenant-a', weekly);
  const publicationTask = tasks.find(item => item.schedule.stepKind === 'publishing')!;
  const approval = tasks.find(item => item.schedule.stepKind === 'user_approval')!;
  await dataStore.create('social_weekly_execution_tasks', { tenant_id: 'tenant-a', package_id: weekly.packageId, package_version: weekly.version, payload: { ...approval, status: 'succeeded', resultRefs: [{ type: 'user_content_approval', id: 'approval-1', version: 1 }, { type: 'starter_social_content_artifact', id: 'accepted-artifact', version: 3 }] } });
  await dataStore.create('starter_social_content_tasks', { tenant_id: 'tenant-a', task_id: 'production-task', status: 'asset_review', run_id: 'production-run', brief: { programRef: { id: weekly.programId } }, create_idempotency_key: `weekly-production:${weekly.packageId}:${weekly.version}:${task.publicationTaskId}` });
  await dataStore.create('workflow_runs', { id: 'production-run', tenant_id: 'tenant-a', status: 'succeeded' });
  await dataStore.create('starter_social_content_files', { tenant_id: 'tenant-a', task_id: 'production-task', file_id: 'accepted-file', usage: 'artifact_media', content_sha256: mediaHash, byte_size: bytes.length, storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), local), name: 'video.mp4', mime_type: 'video/mp4' });
  await dataStore.create('starter_social_content_artifacts', { tenant_id: 'tenant-a', task_id: 'production-task', artifact_id: 'accepted-artifact', artifact_kind: 'short_video', origin: 'agent', status: 'approved', version: '3', resource_ref: 'socialfile:accepted-file', content: { render: { completed: true }, mediaStorage: { video: { fileId: 'accepted-file', sha256: mediaHash, url: '/video.mp4' } }, productionResult: { productionResultId: production.productionResultId, technicalReview: { approved: true }, creativeReview: { approved: true } } } });
  const assignment = buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weekly, publicationTask: task, productionResult: production });
  await persistPublicationAssignment(assignment, dataStore);
  await createAssignedPublicationPackage({ assignment, productionResult: production }, dataStore);
  await markPublicationAssignmentPackageReady('tenant-a', assignment.assignmentId, dataStore);
  return { dataStore, tasks, publicationTask, assignment };
}

test('actual weekly adapter refuses a new publish without a current G6 proof and performs zero provider POSTs',async context=>{
 const {dataStore,publicationTask}=await setup(context);let submissions=0,reconciliations=0;
 const provider:WeeklyPublishingProviderAdapter={provider:'controlled-provider',platform:'youtube',capability:'available',async publish(){submissions++;throw Error('must not POST without G6');},async reconcile(){reconciliations++;throw Error('no original attempt');}};
 const result=await createSocialWeeklyPublicationAdapter(dataStore,{now:()=>new Date('2026-09-26T12:00:00Z'),publishingEnabled:()=>true,adapterFactory:async()=>provider}).execute(publicationTask);
 assert.equal(result.status,'blocked');if(result.status==='blocked')assert.equal(result.code,'weekly_g6_current_preflight_required');
 assert.equal(submissions,0);assert.equal(reconciliations,0);assert.equal(dataStore.rows.get('social_publication_attempts')?.length??0,0);
});

test('G6 admission rejects missing reviews, altered scope/manifest and fake passed metadata without a true receipt',async context=>{
 const {dataStore,publicationTask,assignment}=await setup(context);
 const actual=(await dataStore.list<StoredPublicationAssignment>('social_publication_assignments',{where:{tenant_id:'tenant-a',assignment_id:assignment.assignmentId}})).items[0]!;
 const publicationPackage=await readStarterPublicationPackage('tenant-a',assignment.packageId,dataStore);assert.ok(publicationPackage);
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,publicationTask,actual,publicationPackage),{code:'weekly_g6_current_preflight_required'});
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,{...publicationTask,tenantId:'foreign'},actual,publicationPackage),{code:'weekly_g6_assignment_scope_changed'});
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,{...publicationTask,accountId:'different-account'},actual,publicationPackage),{code:'weekly_g6_assignment_scope_changed'});
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,publicationTask,{...actual,assignment_hash:'0'.repeat(64)},publicationPackage),{code:'weekly_g6_assignment_lineage_changed'});
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,publicationTask,actual,{...publicationPackage,tenantId:'foreign'}),{code:'weekly_g6_publication_package_changed'});
 const payload={review:{status:'passed',tenantId:'tenant-a',programId:publicationTask.programId,packageId:publicationTask.packageId,packageVersion:publicationTask.packageVersion,publicationTaskId:publicationTask.publicationTaskId,receiptId:'invented-receipt'}};
 await dataStore.create(SOCIAL_WEEKLY_G6_REVIEWS,{tenant_id:'tenant-a',program_id:publicationTask.programId,package_id:publicationTask.packageId,package_version:publicationTask.packageVersion,publication_task_id:publicationTask.publicationTaskId,payload,content_hash:socialRequestHash(payload)});
 await assert.rejects(assertWeeklyPublicationG6Admission(dataStore,publicationTask,actual,publicationPackage),{code:'weekly_g6_current_preflight_required'});
});

test('weekly publishing persists unknown receipt and restarts with reconciliation only', async context => {
  const { dataStore, publicationTask,assignment } = await setup(context);
  let submissions = 0, reconciliations = 0;
  const provider: WeeklyPublishingProviderAdapter = {
    provider: 'isolated-provider', platform: 'youtube', capability: 'available',
    async publish() { submissions += 1; return { status: 'unknown', providerReceiptId: 'accepted-id' }; },
    async reconcile() { reconciliations += 1; return { status: 'published', providerReceiptId: 'receipt-1', platformPostId: 'post-1' }; },
  };
  const options = { now: () => new Date('2026-09-26T12:00:00Z'), publishingEnabled: () => true, adapterFactory: async () => provider };
  // Historical attempt is produced by the actual durable publisher with a controlled
  // provider. The current weekly adapter may only reconcile it, never create one.
  const publicationPackage=await readStarterPublicationPackage('tenant-a',assignment.packageId,dataStore);assert.ok(publicationPackage);
  assert.equal((await executeWeeklyPublication({assignment,publicationPackage,contentPackage:weekly.socialContentPackage,adapter:provider,existingPublishedCount:0,dataStore,now:options.now()})).status,'unknown');
  const weeklyRow = dataStore.rows.get('social_weekly_operating_packages')![0]!;
  weeklyRow.payload = structuredClone(weeklyRow.payload);
  weeklyRow.payload.socialContentPackage.publicationTasks[0].receptionRequirement = { required: true, bindingId: null };
  const completed = await createSocialWeeklyPublicationAdapter(dataStore, options).execute(publicationTask);
  assert.equal(completed.status, 'succeeded');
  assert.equal(submissions, 1);
  assert.equal(reconciliations, 1);
  assert.deepEqual(await createSocialWeeklyPublicationAdapter(dataStore, options).execute(publicationTask), completed);
  assert.equal(submissions, 1);
  assert.equal(reconciliations, 1);
});

test('an actual in-flight historical attempt keeps status-only reconciliation without a new G6 publish',async context=>{
 const {dataStore,publicationTask,assignment}=await setup(context);
 const publicationPackage=await readStarterPublicationPackage('tenant-a',assignment.packageId,dataStore);assert.ok(publicationPackage);
 let submissions=0,reconciliations=0;let finishPublish:((value:{status:'published';providerReceiptId:string;platformPostId:string})=>void)|undefined;
 let started:()=>void=()=>{};const publishStarted=new Promise<void>(resolve=>{started=resolve;});
 const result={status:'published' as const,providerReceiptId:'actual-inflight-receipt',platformPostId:'actual-inflight-post'};
 const provider:WeeklyPublishingProviderAdapter={provider:'controlled-inflight-provider',platform:'youtube',capability:'available',async publish(){submissions++;started();return new Promise<Awaited<ReturnType<WeeklyPublishingProviderAdapter['publish']>>>(resolve=>{finishPublish=resolve;});},async reconcile(){reconciliations++;return result;}};
 const original=executeWeeklyPublication({assignment,publicationPackage,contentPackage:weekly.socialContentPackage,adapter:provider,existingPublishedCount:0,dataStore,now:new Date('2026-09-26T12:00:00Z')});
 await publishStarted;assert.equal(dataStore.rows.get('social_publication_attempts')![0]!.status,'in_flight');
 const observed=await createSocialWeeklyPublicationAdapter(dataStore,{now:()=>new Date('2026-09-26T12:00:00Z'),publishingEnabled:()=>true,adapterFactory:async()=>provider}).execute(publicationTask);
 assert.equal(observed.status,'succeeded');assert.equal(submissions,1);assert.equal(reconciliations,1);
 assert.ok(finishPublish);finishPublish(result);await original;
 assert.equal(dataStore.rows.get('social_publication_attempts')!.length,1);assert.equal(dataStore.rows.get(SOCIAL_WEEKLY_G6_REVIEWS)?.length??0,0);
});

test('publishing gates remain independent of content acceptance and provider state', async context => {
  for (const gate of ['disabled', 'approval', 'authorization', 'revoked', 'not-due', 'credentials', 'missing-media', 'wrong-artifact'] as const) {
    const { dataStore, publicationTask, assignment } = await setup(context);
    let submissions = 0;
    const provider: WeeklyPublishingProviderAdapter = { provider: 'isolated', platform: 'youtube', capability: gate === 'credentials' ? 'unavailable' : 'available', async publish() { submissions++; return { status: 'published', providerReceiptId: 'receipt', platformPostId: 'post' }; }, async reconcile() { throw new Error('unexpected'); } };
    if (gate === 'approval') dataStore.rows.get('social_weekly_execution_tasks')![0]!.payload.status = 'queued';
    if (gate === 'authorization') dataStore.rows.get('social_weekly_operating_packages')![0]!.payload = { ...weekly, socialContentPackage: { ...weekly.socialContentPackage, authorization: { ...weekly.socialContentPackage.authorization, allowRealPublishing: false } } };
    if (gate === 'missing-media') dataStore.rows.set('starter_social_content_files', []);
    if (gate === 'wrong-artifact') dataStore.rows.get('starter_social_content_artifacts')![0]!.content.productionResult.productionResultId = 'forged';
    if (gate === 'revoked') dataStore.rows.get('social_publication_assignments')![0]!.status = 'revoked';
    const adapter = createSocialWeeklyPublicationAdapter(dataStore, { publishingEnabled: () => gate !== 'disabled', now: () => new Date(gate === 'not-due' ? '2026-09-22T09:00:00Z' : '2026-09-26T12:00:00Z'), adapterFactory: async () => provider });
    const result = await adapter.execute(publicationTask);
    assert.notEqual(result.status, 'succeeded', gate);
    assert.equal(submissions, 0, gate);
  }
});

test('required reception without an explicit binding cannot submit a new publication', async context => {
  const { dataStore, publicationTask } = await setup(context);
  const row = dataStore.rows.get('social_weekly_operating_packages')![0]!;
  row.payload = structuredClone(row.payload);
  row.payload.socialContentPackage.publicationTasks[0].receptionRequirement = { required: true, bindingId: null };
  let submissions = 0;
  const provider: WeeklyPublishingProviderAdapter = { provider: 'isolated', platform: 'youtube', capability: 'available', async publish() { submissions++; throw new Error('Missing reception cannot publish'); }, async reconcile() { throw new Error('No attempt'); } };
  const result = await createSocialWeeklyPublicationAdapter(dataStore, { publishingEnabled: () => true, now: () => new Date('2026-09-26T12:00:00Z'), adapterFactory: async () => provider }).execute(publicationTask);
  assert.equal(result.status, 'blocked');
  assert.equal('code' in result ? result.code : '', 'reception_binding_required');
  assert.equal(submissions, 0);
});

test('publication rejects ambiguous or normalized invalid timestamps before submitting to a provider', async context => {
  for (const publishWindow of ['2026-09-22', '2026-09-22T10:00:00', '2026-02-30T10:00:00Z', '2026-09-22T24:00:00Z']) {
    const { dataStore, publicationTask } = await setup(context);
    const row = dataStore.rows.get('social_weekly_operating_packages')![0]!;
    row.payload = structuredClone(row.payload);
    row.payload.socialContentPackage.publicationTasks[0].publishWindow = publishWindow;
    let submissions = 0;
    const provider: WeeklyPublishingProviderAdapter = { provider: 'isolated', platform: 'youtube', capability: 'available', async publish() { submissions++; throw new Error('Invalid timestamp must not publish'); }, async reconcile() { throw new Error('No existing attempt'); } };
    const result = await createSocialWeeklyPublicationAdapter(dataStore, { publishingEnabled: () => true, now: () => new Date('2026-09-26T12:00:00Z'), adapterFactory: async () => provider }).execute(publicationTask);
    assert.equal(result.status, 'blocked', publishWindow);
    assert.equal('code' in result ? result.code : '', 'publish_window_invalid');
    assert.equal(submissions, 0);
  }
});

test('performance completion requires actual in-window owned numeric metric data', async context => {
  // Produce the historical provider receipt under its actual controlled clock;
  // never rewrite a persisted receipt timestamp to fit the metric window.
  context.mock.timers.enable({apis:['Date'],now:new Date('2026-09-24T12:00:00Z')});
  const { dataStore, tasks, assignment } = await setup(context);
  const task = tasks.find(item => item.schedule.stepKind === 'performance_monitoring')!;
  const adapter = createSocialWeeklyPublicationAdapter(dataStore, { now: () => new Date('2026-09-26T12:00:00Z') });
  assert.equal((await adapter.execute(task)).status, 'pending');
  await dataStore.create('social_metric_snapshots', { tenant_id: 'tenant-b', account_id: 'account-1', captured_at: '2026-09-25T10:00:00Z', metrics: { views: 10 } });
  await dataStore.create('social_metric_snapshots', { tenant_id: 'tenant-a', account_id: 'account-1', captured_at: '2026-09-20T10:00:00Z', metrics: { views: 10 } });
  assert.equal((await adapter.execute(task)).status, 'pending');
  await dataStore.create('social_metric_snapshots', { tenant_id: 'tenant-a', account_id: 'account-1', platform:'youtube',content_id:'old-history-post',captured_at: '2026-09-25T10:00:00Z', metrics: { views: 0 } });assert.equal((await adapter.execute(task)).status,'pending','historical posts sampled this week cannot fulfill current delivery');
  const provider:WeeklyPublishingProviderAdapter={provider:'youtube-data-api',platform:'youtube',capability:'available',publish:async()=>({status:'published',providerReceiptId:'receipt-real',platformPostId:'post-real'}),reconcile:async()=>{throw Error('not needed');}};const publicationPackage=await readStarterPublicationPackage('tenant-a',assignment.packageId,dataStore);assert.ok(publicationPackage);assert.equal((await executeWeeklyPublication({assignment,publicationPackage,contentPackage:weekly.socialContentPackage,adapter:provider,existingPublishedCount:0,dataStore,now:new Date('2026-09-24T12:00:00Z')})).status,'published');
  for(let index=0;index<110;index++)await dataStore.create('social_metric_snapshots',{tenant_id:'tenant-a',account_id:'account-1',platform:'youtube',content_id:`unrelated-${index}`,captured_at:'2026-09-26T10:00:00Z',metrics:{views:10}});
  await dataStore.create('social_metric_snapshots', { tenant_id: 'tenant-a', account_id: 'account-1',id:'zz-real-current',platform:'youtube',content_id:'post-real', captured_at: '2026-09-25T10:00:00Z', metrics: { views: 0,likes:null } });
  const result=await adapter.execute(task);assert.equal(result.status,'succeeded');if(result.status==='succeeded'){assert.equal(result.resultRefs.length,1);const {validateWeeklyPublicationMetricRefs}=await import('./weeklyPublicationMetricEvidence.js');await validateWeeklyPublicationMetricRefs(dataStore,task,result.resultRefs,new Date('2026-09-26T12:00:00Z'));const {validateWeeklyExecutionResults}=await import('./socialWeeklyResultValidation.js');await validateWeeklyExecutionResults(dataStore,task,result.resultRefs,new Date('2026-09-26T12:00:00Z'));await assert.rejects(()=>validateWeeklyExecutionResults(dataStore,{...task,workflowKind:'content'},result.resultRefs,new Date('2026-09-26T12:00:00Z')),{code:'weekly_metrics_task_scope_invalid'});const unrelated=dataStore.rows.get('social_metric_snapshots')!.find(row=>row.content_id==='old-history-post')!;await assert.rejects(()=>validateWeeklyPublicationMetricRefs(dataStore,task,[{type:'social_metric_snapshot',id:unrelated.id,version:1}],new Date('2026-09-26T12:00:00Z')),{code:'weekly_metrics_publication_attribution_required'});}const actual=dataStore.rows.get('social_metric_snapshots')!.find(row=>row.id==='zz-real-current')!;actual.captured_at='2026-09-23T10:00:00Z';assert.equal((await adapter.execute(task)).status,'pending','sampling before actual publication cannot count');actual.captured_at='2026-09-25T10:00:00Z';actual.mock=true;assert.equal((await adapter.execute(task)).status,'pending');actual.mock=false;const weeklyRow=dataStore.rows.get('social_weekly_operating_packages')![0]!;weeklyRow.payload=structuredClone(weeklyRow.payload);weeklyRow.payload.socialContentPackage.publicationTasks.push({...weeklyRow.payload.socialContentPackage.publicationTasks[0],publicationTaskId:'still-unpublished',motherContentId:'second-mother'});assert.equal((await adapter.execute(task)).status,'pending','one delivered video cannot complete monitoring for a second required weekly video');const truncatedStore:DataStore={...dataStore,list:async<T>(collection:string,query:ListQuery={})=>{const result=await dataStore.list<T>(collection,query);return collection==='social_metric_snapshots'&&query.page===2?{...result,items:[]}:result;}};const truncated=await createSocialWeeklyPublicationAdapter(truncatedStore,{now:()=>new Date('2026-09-26T12:00:00Z')}).execute(task);assert.equal(truncated.status,'blocked');assert.equal('code' in truncated?truncated.code:'','weekly_metrics_scan_incomplete');
});

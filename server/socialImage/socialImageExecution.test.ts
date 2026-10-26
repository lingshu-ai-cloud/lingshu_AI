import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {analyzeSocialImageReference,inspectSocialImageAsset,socialImageAssetAuthorization} from './socialImageEvidenceWorker.js';
import {recordSocialImageBusinessContext,recordSocialImageNodeOutput,runSocialImageDirectorReview} from './socialImageProductionRun.js';
import {compileSocialImageReferencePlan,prepareSocialImageReferenceStrategy} from './socialImageReferenceStrategy.js';
import {compileSocialImageV3PaidPlan,recordSocialImageV3DirectorBrief} from './socialImageFormalPlan.js';
import {socialImageV3PaidPrerequisiteIssue,socialImageV3SingleRenderInput} from './socialImagePaidPrerequisites.js';
import {admitSocialImageV3QueuedJob,completeSocialImagePaidJob} from './socialImagePaidJob.js';
import {renderSocialImagePaidWorker} from './socialImagePaidWorkerRender.js';
import {planStudioPoster,PosterPlanningError} from './studioPosterPlanning.js';
import {projectSocialImageProductionSnapshot} from './socialImageProductionRuntime.js';
import {renderSocialImageLayerGraph} from './layerRenderer.js';
import {SOCIAL_IMAGE_HARD_CHECKS} from '../../shared/contracts/socialImageCreation.js';
import assert from 'node:assert/strict';
process.env.SUBSCRIPTION_ENFORCED='false';
import test from 'node:test';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import {SOCIAL_WORK_PACKAGE_KINDS} from '../../shared/contracts/socialContentWorkflow.js';
import {defaultBrief} from '../starter198/socialContentTaskSupport.js';
import {STARTER_COLLECTIONS} from '../starter198/repository.js';
import {createOrResumeBoundSocialImageRun} from './socialImageProductionRun.js';
import {readSocialImageTask,updateSocialImageTask} from './socialImageTask.js';
import {enqueueImageExecution,readImageExecutionJob} from './socialImageExecutionQueue.js';
import {executeImageProduction,type ImageExecutionPorts} from './socialImageExecution.js';
import {DurableContentExecutionWorker} from '../contentExecution/durableQueue.js';
import {hydrateSocialContentExecutionSummaries} from '../starter198/socialContentQueueProjection.js';
import {socialTaskSummary} from '../starter198/socialContentRecords.js';
import express from 'express';
import {registerSocialImageExecutionRoutes} from '../routes/socialImageExecutionRoutes.js';
import type {SocialContentTaskSummary} from '../../shared/contracts/socialContentWorkflow.js';
class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Record_[]>();
  supportsAtomicCompareAndSwapFor = async () => true;
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection) || []).find(item => item.id === id) as T || null;
  }
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.rows.get(collection) || [];
    const id = String(data.id || `row-${++this.sequence}`);
    if (rows.some(item => item.id === id)) return null;
    const record = { id, ...structuredClone(data) } as Record_;
    this.rows.set(collection, [...rows, record]);
    return record as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) || [];
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }
  async compareAndSwap(collection: string, id: string, expected: Record<string, unknown>, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) || [];
    const index = rows.findIndex(item => item.id === id);
    const current = rows[index];
    if (!current || Object.entries(expected).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))) return false;
    rows[index] = { ...current, ...structuredClone(data) };
    return true;
  }
  async delete(collection:string,id:string):Promise<boolean>{const rows=this.rows.get(collection)||[];const next=rows.filter(row=>row.id!==id);this.rows.set(collection,next);return next.length!==rows.length;}
  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const all = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return { items: all as T[], totalItems: all.length, totalPages: all.length ? 1 : 0,
      page: query.page || 1, perPage: query.perPage || 20 };
  }
}

async function fixture() {
  const store = new MemoryStore();
  const now = '2026-10-24T02:00:00.000Z';
  await store.create(STARTER_COLLECTIONS.socialContentTasks, {
    id: 'content-row', tenant_id: 'tenant-a', task_id: 'content-a', status: 'plan_review', version: '7',
    brief: defaultBrief({ title: '秋季产品主视觉', objective: '让品牌采购理解产品低敏定位', mode: 'instant',
      productId: 'product-a', productRef: '产品 A', audience: '品牌采购', platforms: ['instagram'], languages: ['zh'],
      formats: ['social_image'], aspectRatio: '1:1', creationMode: 'viral_replication' }),
    task_mode: 'instant', theme_selection: '', script_baseline: '', director_plan: '', material_requirements: [],
    package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
    run_id: '', weekly_plan_id: '', source_count: 0, knowledge_source_count: 0, material_source_count: 0,
    artifact_count: 0, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0,
    metric_submission_count: 0, created_at: now, updated_at: now,
  });
  await store.create('tenant_profiles', { id:'profile-a', tenant_id:'tenant-a',
    profile:{ factVersion:{ id:'enterprise-facts-v1', revision:1, contentHash:'f'.repeat(64), confirmedAt:now, confirmedBy:'owner' } } });
  return { store, now };
}


async function setup(){
 const {store}=await fixture();
 const created=await createOrResumeBoundSocialImageRun(store,'tenant-a',{contentTaskId:'content-a',expectedContentTaskVersion:'7',idempotencyKey:'image-queue-test-001',entrySource:'assistant',imageType:'product_poster'});
 const result=await updateSocialImageTask(store,'tenant-a',created.task.id,created.task.version,{referenceUrls:['/reference.png'],referenceSnapshot:{imageUrls:['/reference.png'],collectedAt:new Date().toISOString(),fingerprint:''}});
 if(result.kind!=='updated')throw Error('fixture failed');
 return {store,task:result.task,input:{store,tenantId:'tenant-a',userId:'owner',taskId:result.task.id,expectedVersion:result.task.version}};
}
async function settle(store:DataStore,task:Awaited<ReturnType<typeof setup>>['task']){
 for(let i=0;i<200;i++){const job=await readImageExecutionJob(store,'tenant-a',task);if(job&&['blocked','succeeded'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('worker did not settle');
}
test('confirmation persists one receipt; replay after reload does not enqueue or retry twice',async()=>{
 const {store,task,input}=await setup();const first=await enqueueImageExecution(input);
 const second=await enqueueImageExecution({...input,expectedVersion:1});assert.equal(first.execution.jobId,second.execution.jobId);
 assert.equal(first.execution.status,'queued');assert.equal((await readImageExecutionJob(store,'tenant-a',task))?.attempt,0);
 await assert.rejects(enqueueImageExecution({...input,tenantId:'tenant-b'}),/social_image_task_missing/);
 const rows=await store.list('content_execution_jobs');assert.equal(rows.totalItems,1);
});
test('stale inputs and cancelled canonical task cannot create a dispatch job',async()=>{
 const {store,input}=await setup();await assert.rejects(enqueueImageExecution({...input,expectedVersion:1}),/version_conflict/);
 await store.update(STARTER_COLLECTIONS.socialContentTasks,'content-row',{status:'cancelled'});
 await assert.rejects(enqueueImageExecution(input),/not_executable/);assert.equal((await store.list('content_execution_jobs')).totalItems,0);
});
test('a new worker claims the durable image job without the browser and records a stable block, without paid retry',async()=>{
 const {store,task,input}=await setup();const queued=await enqueueImageExecution(input);let calls=0;
 const stop=async()=>{calls++;throw Error('social_image_required_asset_rights_unverified');};
 const ports:ImageExecutionPorts={prepare:stop,plan:stop,render:stop,quality:stop};
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[queued.execution.jobId],execute:job=>executeImageProduction(store,job,ports)});
 await worker.drain();const job=await settle(store,task);assert.equal(job.status,'blocked');assert.equal(job.attempt,1);assert.equal(calls,1);
 await worker.drain();assert.equal(calls,1);const replay=await enqueueImageExecution(input);assert.equal(replay.execution.status,'blocked');
 assert.equal(replay.execution.lastError,'social_image_required_asset_rights_unverified');worker.stop();
});
test('changes after queue confirmation are fenced before the first production command',async()=>{
 const {store,task,input}=await setup();const queued=await enqueueImageExecution(input);
 const changed=await updateSocialImageTask(store,'tenant-a',task.id,task.version,{contentBrief:{...task.contentBrief,coreClaim:'changed'}});assert.equal(changed.kind,'updated');
 let calls=0;const operation=async()=>{calls++;};
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[queued.execution.jobId],execute:job=>executeImageProduction(store,job,{prepare:operation,plan:operation,render:operation,quality:operation})});
 await worker.drain();const job=await settle(store,task);assert.equal(calls,0);assert.match(job.lastError||'',/confirmed_inputs_changed/);worker.stop();
});
test('canonical list hydration uses image run receipt while leaving video run pointer empty',async()=>{
 const {store,input}=await setup();const queued=await enqueueImageExecution(input);
 const raw=(await store.list<Record_>(STARTER_COLLECTIONS.socialContentTasks)).items[0];
 const summary=socialTaskSummary(raw as Parameters<typeof socialTaskSummary>[0]);
 const [item]=await hydrateSocialContentExecutionSummaries({store,tenantId:'tenant-a',items:[summary]});
 assert.equal(item.runId,null);assert.equal(item.execution?.id,queued.execution.jobId);assert.equal(item.execution?.status,'queued');
});
test('HTTP confirms with 202 only after persistence; content deep link restores the same queue receipt',async()=>{
 const {store,task}=await setup();const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals={tenantId:'tenant-a',userId:'owner'};next();});registerSocialImageExecutionRoutes(app,store);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('listen');const origin=`http://127.0.0.1:${address.port}`;
 try{let response=await fetch(`${origin}/tasks/${task.id}/execution`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:task.version})});assert.equal(response.status,202);const receipt=await response.json();
 response=await fetch(`${origin}/content-tasks/content-a/execution`);assert.equal(response.status,200);const restored=await response.json();assert.equal(restored.execution.jobId,receipt.execution.jobId);assert.equal(restored.task.id,task.id);
 response=await fetch(`${origin}/tasks/${task.id}/execution`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:'wrong'})});assert.equal(response.status,400);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const now = '2026-10-24T02:00:00.000Z';

async function referenceImage(focal: 'top_left' | 'bottom_right', background: string) {
  const grid = await sharp(Buffer.from(`<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="#ffffff"/><path d="M0 0L100 100M100 0L0 100" stroke="#000000" stroke-width="24"/>
    <circle cx="50" cy="50" r="20" fill="#000000"/></svg>`)).png().toBuffer();
  const base = sharp({ create: { width: 300, height: 300, channels: 3, background } });
  return base.composite([{ input: grid, left: focal === 'top_left' ? 0 : 200,
    top: focal === 'top_left' ? 0 : 200 }]).png().toBuffer();
}

function textBox(focal: 'top_left' | 'bottom_right') {
  return focal === 'top_left'
    ? { x: .72, y: .72, width: .22, height: .09 }
    : { x: .05, y: .05, width: .22, height: .09 };
}

async function inventoryFor(bytes: Buffer, focal: 'top_left' | 'bottom_right') {
  return analyzeSocialImageReference({ bytes, mimeType: 'image/png', referenceId: `reference-${focal}`,
    ocr: async () => [{ text: 'OLD BRAND', bbox: textBox(focal), confidence: .94 }] });
}

async function preparedViralTask(imageType: 'product_poster' | 'carousel' = 'product_poster', route: 'local' | 'paid' = 'local') {
  const referenceBytes = await referenceImage('top_left', '#123358');
  const inventory = await inventoryFor(referenceBytes, 'top_left');
  const productBytes = await sharp({ create: { width: 180, height: 260, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const {store}=await fixture(); const {task:created}=await createOrResumeBoundSocialImageRun(store,'tenant-a',{contentTaskId:'content-a',expectedContentTaskVersion:'7',idempotencyKey:'prepared-queue-001',entrySource:'assistant',imageType});
  assert.equal(created.creationPath, 'viral_replication');
  const setReference = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    referenceSnapshot: { sourceRecordId: 'reference-top_left', imageUrls: ['/tenant-owned/reference.png'],
      collectedAt: now, fingerprint: digest(referenceBytes) },
  });
  assert.equal(setReference.kind, 'updated');
  if (setReference.kind !== 'updated') throw new Error('reference_fixture_update_failed');
  let task = await recordSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: setReference.task.version, now });
  const asset = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes: productBytes, mimeType: 'image/png', authorization: socialImageAssetAuthorization({
      id: 'product-a', tenantId: 'tenant-a', scope: 'own', rightsStatus: 'authorized',
      rightsEvidenceRef: 'license:product-a', commercialUseApproved: true,
      derivativesApproved: true, rawLibraryUseApproved: true,
    }, 'tenant-a') });
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'asset_manifest', status: 'completed', value: { enterpriseFactSnapshotRef: null,
      assets: [asset], requiredEvidence: ['product-a'], missingCapabilities: [], prohibitedClaims: [] },
    inputRefs: [], evidenceRefs: [{ objectType: 'enterprise-image-asset', id: asset.assetId,
      version: asset.version, contentHash: asset.contentHash }],
    createdBy: { kind: 'worker', id: 'offline_product_fixture' }, now });
  const referenceRef = { objectType: 'social-image-reference', id: 'reference-top_left', version: 1, contentHash: digest(referenceBytes) };
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'reference_snapshot', status: 'completed', value: { referenceId: referenceRef.id,
      sourceUrl: '/tenant-owned/reference.png', sourceRecordId: referenceRef.id, imageAssetRef: referenceRef,
      platform: null, account: null, publishedAt: null, rightsPolicy: 'structure_only', performanceEvidence: [],
      relativePerformance: null, referencePurpose: ['structure', 'visual_hook'], fingerprint: referenceRef.contentHash },
    inputRefs: [], evidenceRefs: [referenceRef], createdBy: { kind: 'worker', id: 'offline_reference_fixture' }, now });
  const snapshotNode = task.productionRuntime!.nodeOutputs.filter(node => node.nodeId === 'reference_snapshot').at(-1)!;
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'element_inventory', status: 'completed', value: inventory,
    inputRefs: [{ objectType: snapshotNode.schemaVersion, id: snapshotNode.id,
      version: snapshotNode.version, contentHash: snapshotNode.contentHash }],
    evidenceRefs: inventory.regions.map(region => region.evidenceRef),
    createdBy: { kind: 'worker', id: 'real_pixel_analysis' }, now });
  task = await prepareSocialImageReferenceStrategy({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version });
  assert.equal(projectSocialImageProductionSnapshot(task).currentNode, 'director_brief');
  assert.equal(task.hookFactorSpec?.factors.length, 2);
  assert.equal(task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'hook_factors').at(-1)?.status, 'completed');
  assert.equal(task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'adaptation').at(-1)?.status, 'completed');
  if (route === 'paid') return { store, task, productBytes, referenceBytes };
  const planned = await compileSocialImageReferencePlan({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version, productName: '产品 A', now });
  task = planned.task;
  return { store, task, planned, productBytes, referenceBytes };
}

test('viral image task freezes the existing GPT Image 2 route without sending a paid request', async () => {
  const {store,task}=await preparedViralTask('product_poster','paid');
  const director=await recordSocialImageV3DirectorBrief({store,tenantId:'tenant-a',taskId:task.id,
    expectedVersion:task.version,result:{poster:{headline:'产品 A',subheadline:'简明产品展示',originBadge:'',
      trustBadges:[],sellingPoints:[],process:[],categories:[],bottomBar:[],cta:'联系了解'},
      caption:'产品 A 简介',hashtags:[],fieldsToConfirm:[],provenance:'ai'}});
  const planned=await compileSocialImageV3PaidPlan({store,tenantId:'tenant-a',taskId:director.id,
    expectedVersion:director.version});
  assert.equal(socialImageV3PaidPrerequisiteIssue(planned,'execute'),null);
  assert.equal(planned.layerGraph,undefined);
  const execution=planned.productionRuntime!.nodeOutputs.filter(node=>node.nodeId==='execution_plan').at(-1)!.value as {renderRoute:string};
  assert.equal(execution.renderRoute,'/api/overseas/studio/fb-poster/render');
  const spec=planned.productionRuntime!.nodeOutputs.filter(node=>node.nodeId==='render_spec').at(-1)!.value as {idempotencyKey:string};
  const now=new Date().toISOString();
  const patch=await admitSocialImageV3QueuedJob(store,'tenant-a',planned,{status:'generating',step:'generate',
    generationJobs:[...planned.generationJobs,{id:'paid-unit',idempotencyKey:spec.idempotencyKey,
      status:'queued',attempt:0,outputNodeIds:[],createdAt:now,updatedAt:now}]});
  const saved=await updateSocialImageTask(store,'tenant-a',planned.id,planned.version,patch);
  assert.equal(saved.kind,'updated');
  if(saved.kind==='updated'){
    const frozen=socialImageV3SingleRenderInput(saved.task,'paid-unit');
    assert.equal(frozen?.referenceImageUrls.length,0,'structure-only crawled bytes must not go to image provider');
    assert.match(frozen?.imagePrompt||'',/Reference layout measurements/);
  }
});

test('a timed-out bound planner keeps the director node unapproved and exposes the provider uncertainty', async () => {
  const {store,task}=await preparedViralTask('product_poster','paid');
  let submissions=0;
  await assert.rejects(planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    enterpriseCtx:async()=>`公司名称：示例企业\n产品1：${task.contentBrief.productNames[0]}`,
    allowPaidCall:async()=>true,
    callPlanner:async()=>{submissions++;throw new Error('qwen LLM request timed out after 90s');},
  }),error=>error instanceof PosterPlanningError && error.body.code==='social_image_planning_provider_outcome_unknown');
  assert.equal(submissions,1);
  const persisted=await readSocialImageTask(store,'tenant-a',task.id);
  assert.equal(persisted?.productionRuntime?.nodes.find(node=>node.nodeId==='director_brief')?.status,'waiting');
  assert.equal(persisted?.generationJobs.length,0);
});

test('durable image worker claims one frozen GPT Image 2 unit and never submits it twice', async () => {
  const {store,task,productBytes,referenceBytes}=await preparedViralTask('product_poster','paid');
  const director=await recordSocialImageV3DirectorBrief({store,tenantId:'tenant-a',taskId:task.id,
    expectedVersion:task.version,result:{poster:{headline:'产品 A',subheadline:'产品展示',originBadge:'',
      trustBadges:[],sellingPoints:[],process:[],categories:[],bottomBar:[],cta:'联系了解'},
      caption:'产品 A 简介',hashtags:[],fieldsToConfirm:[],provenance:'ai'}});
  const planned=await compileSocialImageV3PaidPlan({store,tenantId:'tenant-a',taskId:director.id,
    expectedVersion:director.version});
  let submitted=0;
  const input={store,tenantId:'tenant-a',taskId:planned.id,expectedVersion:planned.version,
    enterpriseProductAsset:async()=>({name:'产品 A',bytes:productBytes}),allowPaidCall:async()=>true,
    ports:{enterpriseContext:async()=>`公司名称：示例企业\n产品1：${planned.contentBrief.productNames[0]}`,
      referenceBytes:async()=>({bytes:referenceBytes,mimeType:'image/png'}),
      submit:async(request:Parameters<typeof import('./socialImagePaidSingleRender.js').submitClaimedSocialImageSingleRender>[0])=>{
        submitted++;
        assert.equal(request.references.length,1,'structure-only competitor pixels must not be submitted');
        assert.match(request.prompt,/Reference layout measurements/);
        assert.equal(request.task.generationJobs.at(-1)?.status,'running');
        const saved=await completeSocialImagePaidJob({store,tenantId:'tenant-a',taskId:request.task.id,
          jobId:request.jobId,inputHash:request.inputHash,provider:'openai',output:{id:'candidate-paid',
            role:'single',label:'主视觉',state:'quality_checking',version:1,materialId:'material-owned',
            mediaUrl:'/media/fixture.png',contentHash:'a'.repeat(64),qualityChecks:[]}});
        return {task:saved};
      }}};
  const rendered=await renderSocialImagePaidWorker(input);
  assert.equal(rendered.outputs.length,1);
  assert.equal(rendered.generationJobs[0]?.status,'quality_checking');
  await assert.rejects(renderSocialImagePaidWorker({...input,expectedVersion:rendered.version}),/prior_paid_job_unresolved/);
  assert.equal(submitted,1);
});


test('persisted worker resumes a frozen plan, renders real pixels, and never repeats completed work after restart (visual QA fixture)',async()=>{
 const {store,task,productBytes}=await preparedViralTask();
 const queued=await enqueueImageExecution({store,tenantId:'tenant-a',userId:'owner',taskId:task.id,expectedVersion:task.version});let renders=0,qa=0;
 const ports:ImageExecutionPorts={prepare:async()=>{throw Error('must reuse evidence');},plan:async()=>{throw Error('must reuse plan');},
 render:async current=>{renders++;const rendered=await renderSocialImageLayerGraph({graph:current.layerGraph!,assets:new Map([['product-a',productBytes]])});assert.ok(rendered.bytes.length>100);
 const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{status:'review_required',step:'review',outputs:[{id:'candidate-queue',role:'single',label:'主视觉',state:'quality_checking',version:1,mediaUrl:'/fixture-candidate.png',contentHash:digest(rendered.bytes),qualityChecks:[]}]});assert.equal(saved.kind,'updated');},
 quality:async current=>{qa++;const checks=current.outputs.map(output=>({...output,qualityChecks:[{key:'reference_structure_similarity' as const,verdict:'pass' as const,severity:'soft' as const,note:'offline structural QA fixture'},...SOCIAL_IMAGE_HARD_CHECKS.map(key=>({key,verdict:'pass' as const,severity:'hard' as const,note:'offline visual fixture'})),...(current.hookFactorSpec?.factors||[]).map(factor=>({key:`hook_factor:${factor.factorId}` as const,verdict:'pass' as const,severity:'soft' as const,note:'offline factor fixture',evidence:[`candidate-sha256:${output.contentHash}`,...factor.evidenceRefs.map(ref=>`reference-region-sha256:${ref.contentHash}`)]}))]}));
 const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{outputs:checks});if(saved.kind!=='updated')throw Error('quality save');
 await runSocialImageDirectorReview({store,tenantId:'tenant-a',taskId:current.id,expectedVersion:saved.task.version,candidateId:'candidate-queue',candidateVersion:1});}};
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[queued.execution.jobId],execute:job=>executeImageProduction(store,job,ports)});await worker.drain();const job=await settle(store,task);const checked=await readSocialImageTask(store,'tenant-a',task.id);assert.equal(job.status,'succeeded',JSON.stringify({error:job.lastError,decision:checked?.directorReviewDecision,qa}));worker.stop();
 const restored=await readSocialImageTask(store,'tenant-a',task.id);assert.equal(restored?.outputs.length,1);assert.equal(restored?.approvedArtifact,undefined);
 const restarted=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[job.id],execute:j=>executeImageProduction(store,j,ports)});await restarted.drain();restarted.stop();assert.equal(renders,1);assert.equal(qa,1);
});

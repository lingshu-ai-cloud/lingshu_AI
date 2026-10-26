import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {analyzeSocialImageReference,inspectSocialImageAsset,socialImageAssetAuthorization} from './socialImageEvidenceWorker.js';
import {recordSocialImageBusinessContext,recordSocialImageNodeOutput,runSocialImageDirectorReview} from './socialImageProductionRun.js';
import {compileSocialImageReferencePlan,prepareSocialImageReferenceStrategy} from './socialImageReferenceStrategy.js';
import {compileSocialImageV3PaidPlan,recordSocialImageV3DirectorBrief,socialImageV3TrustedPlanningRequest} from './socialImageFormalPlan.js';
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
import {enqueueImageExecution,imageExecutionReceipt,readImageExecutionJob} from './socialImageExecutionQueue.js';
import {executeImageProduction,type ImageExecutionPorts} from './socialImageExecution.js';
import {localCompositeRepairCandidate,repairSocialImageLocalComposite} from './socialImageLocalCompositeRepair.js';
import {tenantAssetRelativePath} from '../lib/assetAccess.js';
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

async function fixture(language: 'zh' | 'en' = 'zh') {
  const store = new MemoryStore();
  const now = '2026-10-24T02:00:00.000Z';
  await store.create(STARTER_COLLECTIONS.socialContentTasks, {
    id: 'content-row', tenant_id: 'tenant-a', task_id: 'content-a', status: 'plan_review', version: '7',
    brief: defaultBrief({ title: '秋季产品主视觉', objective: '让品牌采购理解产品低敏定位', mode: 'instant',
      productId: 'product-a', productRef: '产品 A', audience: '品牌采购', platforms: ['instagram'], languages: [language],
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
test('legacy timed-out planning receipt identifies the unknown provider outcome without replaying it',async()=>{
 const {store,input}=await setup();const queued=await enqueueImageExecution(input);
 const raw=await store.getById<Record_>('content_execution_jobs',queued.execution.jobId);
 assert.ok(raw);
 const changed={...raw,status:'blocked',last_error:'user_input_required:social_image_planner_result_requires_review',
  checkpoints:{...(raw.checkpoints as Record<string,unknown>),'image.planning':{version:'1',inputHash:'a'.repeat(64),updatedAt:now,
   payload:{state:'started'}}}};
 await store.update('content_execution_jobs',queued.execution.jobId,changed);
 const job=await readImageExecutionJob(store,'tenant-a',queued.task);
 assert.ok(job);assert.equal(imageExecutionReceipt(job).lastError,'social_image_planning_outcome_requires_review');
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
test('one local repair reuses the saved plate and frozen product, then cannot repair again',async()=>{
 const {store,task}=await setup();
 const product=await sharp({create:{width:80,height:100,channels:3,background:'#f5f5f5'}}).png().toBuffer();
 const plate=await sharp({create:{width:1200,height:1200,channels:3,background:'#809caa'}}).png().toBuffer();
 const original=await sharp({create:{width:1200,height:1200,channels:3,background:'#576870'}}).png().toBuffer();
 const jobId='paid-job-1',inputHash='a'.repeat(64),oldId='output-1';
 const material=(id:string,bytes:Buffer,sourceType:string,provenance:Record<string,unknown>)=>({
  id,type:'image',scope:'own',tenantId:'tenant-a',sourceType,contentSha256:digest(bytes),provenance,
  file:tenantAssetRelativePath('tenant-a',`${id}.png`),
 });
 const plateRecord=material('plate',plate,'ai_generated_background_plate',{
  socialImageTaskId:task.id,socialImageJobId:jobId,socialImageInputHash:inputHash,model:'gpt-image-2'});
 const originalRecord=material('original',original,'ai_generated_marketing_image',{
  socialImageTaskId:task.id,socialImageJobId:jobId,socialImageInputHash:inputHash,
  backgroundMaterialId:'plate',plateSha256:digest(plate),productSha256:digest(product),
  localComposition:'fixed-product-and-copy-v1',
 });
 const changed=await updateSocialImageTask(store,'tenant-a',task.id,task.version,{
  status:'review_required',step:'review',
  renderBrief:{headline:'Visible headline',subheadline:'Fresh copy',originBadge:'',trustBadges:[],sellingPoints:[],
   process:[],categories:[],bottomBar:[],cta:''},
  replicationRecipe:{contentArchetype:'poster',imageCopyRelation:'image_contextualizes_copy',preserve:[],replace:[],
   palette:[],layoutRegions:[],protectedSubjects:[],overlayZones:[]},
  generationJobs:[{id:jobId,idempotencyKey:'one',inputHash,status:'completed',attempt:1,outputNodeIds:[oldId],
   createdAt:now,updatedAt:now}],
  outputs:[{id:oldId,role:'single',label:'主视觉',state:'repair_required',version:1,materialId:'original',
   contentHash:digest(original),qualityChecks:[{key:'label_ocr',verdict:'fail',severity:'hard',note:'clipped'}],
   qualityPreflight:{inputHash:'b'.repeat(64),status:'completed',claimedAt:now,completedAt:now,visualChecks:[]}}],
  repairInstructions:[{id:'repair-1',outputNodeId:oldId,failedChecks:['label_ocr'],targetLayer:'typography',
   instruction:'fix copy',status:'pending',fromVersion:1}],
 });
 assert.equal(changed.kind,'updated');if(changed.kind!=='updated')return;
 assert.equal(localCompositeRepairCandidate(changed.task)?.id,oldId);
 let writes=0;
 const repaired=await repairSocialImageLocalComposite({store,tenantId:'tenant-a',taskId:task.id,
  expectedVersion:changed.task.version,materials:[plateRecord,originalRecord],
  enterpriseProductAsset:async()=>({name:'Product A',bytes:product}),
  readBytes:async item=>({bytes:item.id==='plate'?plate:original,mimeType:'image/png'}),
  writeMaterial:async input=>{writes++;return {...material('repaired',input.bytes,'ai_generated_marketing_image',input.provenance||{}),
   sourceProvider:'deterministic-compositor'} as any;},
 });
 assert.equal(writes,1);assert.equal(repaired.additionalPaidQualityRequired,true);
 assert.equal(repaired.task.outputs[0]?.state,'superseded');
 assert.equal(repaired.task.outputs[1]?.state,'quality_checking');
 assert.equal(repaired.task.repairInstructions[0]?.status,'completed');
 assert.equal(localCompositeRepairCandidate(repaired.task),null);
 await assert.rejects(repairSocialImageLocalComposite({store,tenantId:'tenant-a',taskId:task.id,
  expectedVersion:repaired.task.version,materials:[plateRecord,originalRecord],
  enterpriseProductAsset:async()=>({name:'Product A',bytes:product})}),/not_eligible/);
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

async function preparedViralTask(imageType: 'product_poster' | 'carousel' = 'product_poster', route: 'local' | 'paid' = 'local', language: 'zh' | 'en' = 'zh') {
  const referenceBytes = await referenceImage('top_left', '#123358');
  const inventory = await inventoryFor(referenceBytes, 'top_left');
  const productBytes = await sharp({ create: { width: 180, height: 260, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const {store}=await fixture(language); const {task:created}=await createOrResumeBoundSocialImageRun(store,'tenant-a',{contentTaskId:'content-a',expectedContentTaskVersion:'7',idempotencyKey:'prepared-queue-001',entrySource:'assistant',imageType});
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

test('structure-only benchmark copy is excluded from the paid planning request', async () => {
  const {task}=await preparedViralTask('product_poster','paid');
  const tainted={...task,referenceSnapshot:{...task.referenceSnapshot!,
    title:'Competitor OEM private label export',caption:'OEM wholesale claims from competitor'}};
  const request=socialImageV3TrustedPlanningRequest(tainted);
  assert.doesNotMatch(JSON.stringify(request),/Competitor|wholesale|private label/);
  assert.match(request.referenceNotes,/Structure:/);
  assert.equal(request.posterStyle,'product-reference-structure');
  assert.equal(request.targetMarket,'');
});

test('invented model commercial claims are removed without asking the customer to confirm them',async()=>{
  const {store,task}=await preparedViralTask('product_poster','paid');
  const response=await planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    enterpriseCtx:async()=>`公司名称：示例企业\n产品1：${task.contentBrief.productNames[0]}`,
    allowPaidCall:async()=>true,
    callPlanner:async()=>JSON.stringify({poster:{headline:'产品 A',
      subheadline:'OEM private label production',cta:'Learn more'},
      caption:'产品 A 产品介绍。',hashtags:[]}),
  });
  assert.deepEqual(response?.fieldsToConfirm,[]);
  const saved=await readSocialImageTask(store,'tenant-a',task.id);
  assert.equal(saved?.productionRuntime?.nodes.find(node=>node.nodeId==='director_brief')?.status,'completed');
  assert.doesNotMatch(JSON.stringify(response?.poster),/OEM|private label|Wholesale|wholesale/i);
});

test('bound English poster rejects a different package variant and mixed-language clinical copy before image payment',async()=>{
  const {store,task}=await preparedViralTask('product_poster','paid','en');
  const response=await planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    packagingHint:'CLOUD FOAM CLEANSING HONEY',
    enterpriseCtx:async()=>`公司名称：示例企业\n产品1：${task.contentBrief.productNames[0]}`,
    allowPaidCall:async()=>true,
    callPlanner:async()=>JSON.stringify({poster:{headline:'Cloud Foam Cleansing Mousse',
      subheadline:'Gentle cleansing',cta:'Explore the product'},
      caption:'Ophthalmologist-tested 卸妆 product.',hashtags:['#卸妆','#Beauty']}),
  });
  assert.equal(response?.poster.headline,'Product overview');
  assert.equal(response?.caption,'Explore this product and its packaging. Contact us for verified commercial details.');
  assert.deepEqual(response?.fieldsToConfirm,[]);
  assert.doesNotMatch(JSON.stringify(response),/Mousse|Ophthalmologist|卸妆 product/);
});

test('a bound task does not turn broad model marketing claims into confirmed image copy',async()=>{
  const {store,task}=await preparedViralTask('product_poster','paid','en');
  const response=await planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    packagingHint:'CLOUD FOAM CLEANSING HONEY',
    enterpriseCtx:async()=>`公司名称：示例企业\n产品1：${task.contentBrief.productNames[0]}`,
    allowPaidCall:async()=>true,
    callPlanner:async()=>JSON.stringify({poster:{headline:'CLOUD FOAM CLEANSING HONEY',
      subheadline:'Barrier-strengthening with rare polar botanicals',cta:'Inquire for B2B terms'},
      caption:'Clinically aligned, OEM-ready, and available across North America.',hashtags:['#OEMBeauty']}),
  });
  assert.equal(response?.poster.headline,'CLOUD FOAM CLEANSING HONEY');
  assert.equal(response?.poster.subheadline,'Product and packaging overview');
  assert.equal(response?.caption,'Explore this product and its packaging. Contact us for verified commercial details.');
  assert.doesNotMatch(JSON.stringify(response?.hashtags),/OEM|private.label|wholesale/i);
});

test('a timed-out bound planner keeps the director node unapproved and exposes the provider uncertainty', async () => {
  const {store,task}=await preparedViralTask('product_poster','paid');
  let submissions=0,claims=0;
  await assert.rejects(planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    enterpriseCtx:async()=>`公司名称：示例企业\n产品1：${task.contentBrief.productNames[0]}`,
    allowPaidCall:async()=>true,
    beforeProviderCall:async()=>{claims++;},
    callPlanner:async()=>{submissions++;throw new Error('qwen LLM request timed out after 90s');},
  }),error=>error instanceof PosterPlanningError && error.body.code==='social_image_planning_provider_outcome_unknown');
  assert.equal(submissions,1);assert.equal(claims,1);
  const persisted=await readSocialImageTask(store,'tenant-a',task.id);
  assert.equal(persisted?.productionRuntime?.nodes.find(node=>node.nodeId==='director_brief')?.status,'waiting');
  assert.equal(persisted?.generationJobs.length,0);
});
test('planner input rejection never claims an external request',async()=>{
  const {store,task}=await preparedViralTask('product_poster','paid');let claims=0,submissions=0;
  await assert.rejects(planStudioPoster({store,tenantId:'tenant-a',
    body:{imageTaskId:task.id,expectedImageTaskVersion:task.version},
    enterpriseCtx:async()=>'',allowPaidCall:async()=>true,
    beforeProviderCall:async()=>{claims++;},callPlanner:async()=>{submissions++;return '{}';},
  }),error=>error instanceof PosterPlanningError && error.body.code==='ENTERPRISE_PROFILE_REQUIRED');
  assert.equal(claims,0);assert.equal(submissions,0);
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
        assert.equal(request.references.length, 2, 'the model receives the product before the benchmark');
        assert.equal(Buffer.from(request.references[0]!.base64, 'base64').compare(productBytes), 0);
        assert.equal(Buffer.from(request.references[1]!.base64, 'base64').compare(referenceBytes), 0);
        assert.match(request.prompt,/one photograph/);
        assert.doesNotMatch(request.prompt,/BACKGROUND ONLY/);
        assert.ok(request.composition?.productBytes.equals(productBytes));
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

test('worker uses one local repair after free OCR failure and only then runs visual QA',async()=>{
 const {store,task}=await preparedViralTask();
 const queued=await enqueueImageExecution({store,tenantId:'tenant-a',userId:'owner',taskId:task.id,expectedVersion:task.version});
 let renders=0,qualityCalls=0,repairs=0;
 const ports:ImageExecutionPorts={prepare:async()=>{throw Error('evidence already ready');},
  plan:async()=>{throw Error('plan already ready');},
  render:async current=>{renders++;const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{
   status:'review_required',step:'review',outputs:[{id:'candidate-1',role:'single',label:'主视觉',state:'quality_checking',
    version:1,materialId:'old-material',contentHash:'a'.repeat(64),qualityChecks:[]}]});assert.equal(saved.kind,'updated');},
  quality:async current=>{qualityCalls++;
   if(qualityCalls===1){const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{
    outputs:current.outputs.map(output=>({...output,state:'repair_required' as const,
     qualityChecks:[{key:'label_ocr' as const,verdict:'fail' as const,severity:'hard' as const,note:'clipped'}]})),
    repairInstructions:[{id:'one-repair',outputNodeId:'candidate-1',failedChecks:['label_ocr'],
     targetLayer:'typography',instruction:'reflow',status:'pending',fromVersion:1}]});assert.equal(saved.kind,'updated');return;}
   const checks=current.outputs.map(output=>output.state==='superseded'?output:{...output,
    qualityChecks:[{key:'reference_structure_similarity' as const,verdict:'uncertain' as const,severity:'soft' as const,
     note:'needs customer judgment'},...SOCIAL_IMAGE_HARD_CHECKS.map(key=>({key,verdict:'pass' as const,
     severity:'hard' as const,note:'verified'})),...(current.hookFactorSpec?.factors||[]).map(factor=>({
     key:`hook_factor:${factor.factorId}` as const,verdict:'pass' as const,severity:'soft' as const,
     note:'verified',evidence:[`candidate-sha256:${output.contentHash}`,...factor.evidenceRefs.map(ref=>`reference-region-sha256:${ref.contentHash}`)]}))]});
   const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{outputs:checks});
   assert.equal(saved.kind,'updated');if(saved.kind==='updated')await runSocialImageDirectorReview({store,
    tenantId:'tenant-a',taskId:current.id,expectedVersion:saved.task.version,candidateId:'candidate-2',candidateVersion:2});},
  repair:async current=>{repairs++;const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{
   outputs:[...current.outputs.map(output=>({...output,state:'superseded' as const})),
    {id:'candidate-2',role:'single',label:'主视觉',state:'quality_checking',version:2,materialId:'new-material',
     contentHash:'b'.repeat(64),qualityChecks:[]}],
   repairInstructions:current.repairInstructions.map(item=>({...item,status:'completed' as const,toVersion:2}))});
   assert.equal(saved.kind,'updated');return {additionalPaidQualityRequired:false};}};
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[queued.execution.jobId],
  execute:job=>executeImageProduction(store,job,ports)});
 await worker.drain();const job=await settle(store,task);worker.stop();
 assert.equal(job.status,'succeeded',job.lastError||'');assert.equal(renders,1);assert.equal(repairs,1);
 assert.equal(qualityCalls,2);assert.equal((await readSocialImageTask(store,'tenant-a',task.id))?.outputs[0]?.state,'superseded');
});
test('an already-paid QA cannot silently trigger another paid QA after local repair',async()=>{
 const {store,task}=await preparedViralTask();
 const queued=await enqueueImageExecution({store,tenantId:'tenant-a',userId:'owner',taskId:task.id,expectedVersion:task.version});
 const staged=await updateSocialImageTask(store,'tenant-a',task.id,task.version,{status:'review_required',step:'review',
  outputs:[{id:'old',role:'single',label:'主视觉',state:'repair_required',version:1,materialId:'old-material',
   contentHash:'a'.repeat(64),qualityChecks:[{key:'label_ocr',verdict:'fail',severity:'hard',note:'clipped'}],
   qualityPreflight:{inputHash:'b'.repeat(64),status:'completed',claimedAt:now,completedAt:now,visualChecks:[]}}],
  repairInstructions:[{id:'fix',outputNodeId:'old',failedChecks:['label_ocr'],targetLayer:'typography',
   instruction:'reflow',status:'pending',fromVersion:1}]});
 assert.equal(staged.kind,'updated');
 let qa=0,repair=0;
 const ports:ImageExecutionPorts={prepare:async()=>{throw Error('unexpected prepare');},
  plan:async()=>{throw Error('unexpected plan');},render:async()=>{throw Error('unexpected render');},
  quality:async()=>{qa++;},repair:async current=>{repair++;
   const saved=await updateSocialImageTask(store,'tenant-a',current.id,current.version,{
    outputs:[...current.outputs.map(output=>({...output,state:'superseded' as const})),
     {id:'new',role:'single',label:'主视觉',state:'quality_checking',version:2,materialId:'new-material',
      contentHash:'c'.repeat(64),qualityChecks:[]}],
    repairInstructions:current.repairInstructions.map(item=>({...item,status:'completed' as const,toVersion:2}))});
   assert.equal(saved.kind,'updated');return {additionalPaidQualityRequired:true};}};
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[queued.execution.jobId],
  execute:job=>executeImageProduction(store,job,ports)});
 await worker.drain();const job=await settle(store,task);worker.stop();
 assert.equal(job.status,'blocked');assert.match(job.lastError||'',/social_image_repair_quality_budget_unverified/);
 assert.equal(qa,0);assert.equal(repair,1);
 // A later dispatch must reach the same budget gate before invoking QA.
 const persisted=await readImageExecutionJob(store,'tenant-a',task);
 assert.ok(persisted);
 await assert.rejects(executeImageProduction(store,persisted!,ports),/social_image_repair_quality_budget_unverified/);
 assert.equal(qa,0);assert.equal(repair,1);
});

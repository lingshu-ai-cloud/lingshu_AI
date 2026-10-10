import type {OwnedSocialAccount} from '../../shared/contracts/socialProgram.js';
import {fixtureObject} from './weeklyFiveMotherFixtureRecords.js';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {readMaterialLibrary,type MaterialRecord} from '../lib/materialLibrary.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {setContentExecutionLimit} from '../contentExecution/durableQueue.js';
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {prepareFiveMotherDistinctReferenceSeeds} from './weeklyFiveMotherDistinctReferences.fixture.js';
import {prepareFiveMotherProductionFixture} from './weeklyFiveMotherProduction.fixture.js';
import {createSocialProgramService} from '../socialPrograms/service.js';
import {createSocialWeeklyProductionAdapter,weeklyProductionBindingKey} from './socialWeeklyProductionAdapter.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';

/** Formal five-mother factory with two actual owned accounts and independent
 * historical source identities. All content tasks remain before paid execution. */
export async function prepareHMultiAccountFixture(t:TestContext,ownedPercent:20|40){
 const seed=await prepareFiveMotherDistinctReferenceSeeds(t,{ownedPercent,weeklyBudgetCny:100});
 const {f}=seed;
 assert(ffmpeg);const directory=await mkdtemp(path.join(tmpdir(),'five-mother-execution-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const mediaFolder=path.resolve('data/media/tenants/t',path.basename(directory));await mkdir(mediaFolder,{recursive:true});t.after(()=>rm(mediaFolder,{recursive:true,force:true}));const imagePath=path.join(mediaFolder,'identity.png');await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=white:s=240x320','-vf','drawbox=x=90:y=60:w=60:h=200:color=blue:t=fill','-frames:v','1','-y',imagePath]);
 const imageSha=createHash('sha256').update(await readFile(imagePath)).digest('hex');
 const image:MaterialRecord={id:'actual-owned-product-identity',tenantId:'t',type:'image',name:'企业产品包装身份',productId:'owned-product',productName:'企业产品',productRef:'企业产品',scope:'tenant',url:`/media/tenants/t/${path.basename(directory)}/identity.png`,contentSha256:imageSha,rightsStatus:'authorized',rightsEvidenceRef:'actual-upload-owner-confirmation',source:'tenant_upload',sourceRevision:imageSha,scriptAnalysis:buildMaterialScriptAnalysis({materialId:'actual-owned-product-identity',name:'企业产品包装身份',sourceRevision:imageSha,duration:0,productId:'owned-product',productRef:'企业产品',productPolicy:'locked',productPolicySource:'user_explicit',visualObservations:['白底蓝色矩形包装产品，固定正面产品外观；受控上传者选择的身份图片'],analyzedAt:'2026-10-01T00:00:00Z'})};
 seed.repository=createStarter198Repository(seed.f.store,{materialLibrary:tenantId=>readMaterialLibrary(tenantId,{local:()=>[image],cloud:async()=>({items:[],source:{source:'database',state:'ready',message:'受控隔离空云素材'}})})});
 const {enterpriseFactContentHash}=await import('../routes/enterprise.js');seed.f.profile.products.items=[{id:'owned-product',name:'企业产品',sku:'FIVE-OWNED-001',category:'工业产品'}];seed.f.profile.factVersion!.contentHash=enterpriseFactContentHash(seed.f.profile);

 seed.pkg.referenceSourcePolicy={profile:'b2b_established',allocationUnit:'mother_content',ownedPercent,externalPercent:100-ownedPercent};
 const initialSecondAccount:OwnedSocialAccount={accountId:'account-b',programId:'p',version:1,status:'active',platform:'tiktok',displayName:'受控企业第二账号',handle:null,businessRole:'核心账号',audiencePromise:'企业采购',contentPromise:'已核实企业产品事实',connectionId:null,connectionCapabilities:[],playbookRef:null,conversionRoute:null,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
 await f.store.create('social_owned_accounts',{tenant_id:'t',program_id:'p',account_id:initialSecondAccount.accountId,version:initialSecondAccount.version,status:initialSecondAccount.status,payload:initialSecondAccount});
 await createSocialProgramService(f.store).savePlaybook('t','owner','p','account-b',{expectedAccountVersion:1,activate:true,audience:['企业采购'],pillars:['产品介绍'],evidenceRules:['仅展示已确认产品资料'],visualRules:['保留清晰产品外观'],languageRules:['英文说明'],conversionRoute:{entryType:'direct_message',callToAction:'Contact sales'}});
 if(ownedPercent===40){
  const ownedId=seed.ownedReferenceIds[1]!;
  for(const row of f.tables.social_external_contents??[])if(row.external_content_id===ownedId){row.account_id='account-b';fixtureObject(row.content).accountId='account-b';}
  for(const row of f.tables.social_channel_metric_snapshots??[])if(row.external_content_id===ownedId){row.account_id='account-b';fixtureObject(row.snapshot).accountId='account-b';}
 }
 const original=seed.pkg.socialContentPackage.publicationTasks[0]!;
 seed.pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,index)=>({...structuredClone(original),accountId:index%2?'account-b':'account',publicationTaskId:`multi-seed-${index}`,motherContentId:`multi-mother-${index}`}));
 const accounts=await f.store.list<Record<string,unknown>>('social_owned_accounts',{where:{tenant_id:'t',program_id:'p'},perPage:10});
 assert.equal(accounts.totalItems,2);
 await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope:'account',scopeKey:'account-b',maxRunning:1,updatedBy:'owner',now:new Date('2026-10-10T01:00:00Z')});
 const setup=await prepareFiveMotherProductionFixture(t,seed,{accounts:accounts.items.map(row=>{assert.equal(typeof row.account_id,'string');const payload=fixtureObject(row.payload);assert.equal(payload.accountId,row.account_id);assert.ok(typeof payload.version==='number'&&Number.isSafeInteger(payload.version)&&payload.version>0);return {accountId:String(row.account_id),version:payload.version,weeklyPublicationCapacity:row.account_id==='account'?3:2};}),consumerRequirement:async({setup:early,tasks,pkg})=>{const preliminary=createSocialWeeklyProductionAdapter(early.f.store,{repository:early.repository});const descriptors:Record<string,string>={};for(const preparation of tasks.filter(task=>task.schedule.stepKind==='material_preparation')){await preliminary.execute(preparation);const created=early.f.tables.starter_social_content_tasks!.find(row=>row.create_idempotency_key===`weekly-production:${pkg.packageId}:${pkg.version}:${preparation.publicationTaskId}`);assert(created);const {assessWeeklyOwnedProductIdentity}=await import('./weeklyOwnedProductIdentityDemand.js');const actual=await assessWeeklyOwnedProductIdentity(early.f.store,{tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:preparation.publicationTaskId!,contentTaskId:String(created.task_id)},{repository:early.repository});assert.equal(actual.requirements.length,1);descriptors[preparation.publicationTaskId!]=`${actual.requirements[0]!.requirementId}：${actual.requirements[0]!.description}`;}return descriptors;}});
 assert.equal(setup.dispatched.skeleton.slots.length,5);assert.equal(setup.dispatched.skeleton.slots.filter(slot=>slot.referenceSource==='owned').length,ownedPercent/20);
 const adapter=createSocialWeeklyProductionAdapter(f.store,{repository:setup.repository});
 const bindings=[];
 for(const publication of setup.pkg.socialContentPackage.publicationTasks){
  const task=setup.tasks.find(row=>row.publicationTaskId===publication.publicationTaskId&&row.schedule.stepKind==='material_readiness')!;assert.ok(task);
  const output=await adapter.execute(task);assert.equal(output.status,'blocked');assert.equal(output.status==='blocked'?output.code:null,'weekly_required_materials_missing');
  const records=f.tables.starter_social_content_tasks!.filter(row=>row.create_idempotency_key===weeklyProductionBindingKey(task));assert.equal(records.length,1);const record=records[0]!;
  const detail=await readSocialTaskDetail({repository:setup.repository,tenantId:'t',taskId:String(record.task_id)});assert.ok(detail);
  const slot=setup.dispatched.skeleton.slots.find(row=>row.publicationTaskIds.includes(publication.publicationTaskId))!;
  const analysis=setup.dispatched.directorAnalyses.find(row=>row.slotId===slot.slotId)!;
  if(slot.referenceSource==='owned')assert.equal(analysis.benchmarkAccountRefs[0]!.id,publication.accountId,'owned source belongs to its actual target account');
  bindings.push({task,publication,record,detail,slot,analysis});
 }
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 return {...setup,seed,adapter,bindings,imagePath,directory};
}

/** Actual material verification and scheduler-created content/run/job identities;
 * no supplier work, artifact completion or workflow success is manufactured. */
export async function prepareHCanonicalQueuedRuns(t:TestContext,ownedPercent:20|40){
 const setup=await prepareHMultiAccountFixture(t,ownedPercent),{f,repository,pkg}=setup;
 const {createWeeklyMaterialRequestService}=await import('../socialPrograms/weeklyMaterialRequests.js');
 const {createWeeklyRequiredMaterialAdmission}=await import('../socialPrograms/weeklyRequiredMaterialAdmission.js');
 const {scheduleSocialContentWork}=await import('../starter198/socialContentScheduler.js');
 const {assessWeeklyOwnedProductIdentity,bindWeeklyOwnedProductIdentity}=await import('./weeklyOwnedProductIdentityDemand.js');
 const bytes=await readFile(setup.imagePath),sha=createHash('sha256').update(bytes).digest('hex'),recordId='material0000005',sourceRef=`socialmaterial:${Buffer.from(`pb-${recordId}`).toString('base64url')}`;
 const raw={id:recordId,tenantId:'t',scope:'own',type:'image',sha256:sha,sizeBytes:bytes.length,videoFile:'shared.png',sourceType:'licensed_upload'};
 const materialPorts={getMaterial:async(tenant:string,id:string)=>tenant==='t'&&id===recordId?raw:null,materialBytes:{fetch:async()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}})}};
 const service=createWeeklyMaterialRequestService(f.store,materialPorts);
 await service.submit({tenantId:'t',programId:'p',requestId:setup.request.requestId,actorUserId:'owner',materialRecordIds:[recordId],expectedSubmissionVersion:0});
 await service.review({tenantId:'t',programId:'p',requestId:setup.request.requestId,actorUserId:'owner',submissionVersion:1,consumerDecisions:setup.request.consumers.map(consumer=>({taskId:consumer.taskId,accepted:true,factCheck:'受控上传者选定企业产品身份图',rightsCheck:'本地合成授权图形',visualCheck:'实际上传字节核验'}))});
 const ports={repository,materialPorts,getMaterial:async(id:string,tenant:string)=>materialPorts.getMaterial(tenant,id),sourceOptions:{resolve:async()=>({optionId:'shared-option',kind:'material' as const,sourceRef,sourceVersion:sha,label:'受控企业身份图',type:'image' as const,thumbnailHref:null}),list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20,status:'ready' as const})}};
 const keys=['SEEDANCE_VIDEO_ENABLED','SEEDANCE_API_KEY','SEEDREAM_API_KEY'];const env=keys.map(key=>process.env[key]);t.after(()=>{for(const [index,key] of keys.entries()){if(env[index]===undefined)delete process.env[key];else process.env[key]=env[index];}});process.env.SEEDANCE_VIDEO_ENABLED='true';process.env.SEEDANCE_API_KEY='controlled-unused';process.env.SEEDREAM_API_KEY='controlled-unused';
 const adapter=createSocialWeeklyProductionAdapter(f.store,{repository,sourceOptions:ports.sourceOptions,materialRecord:ports.getMaterial,materialAdmission:createWeeklyRequiredMaterialAdmission(f.store,materialPorts),ownedProductIdentity:ports,orchestratorQueue:{enqueue:queue=>scheduleSocialContentWork({repository,queue,now:new Date(setup.clock),materialEvidencePorts:ports,productionRunner:async()=>{}})}});
 for(const binding of setup.bindings){
  const preparation=setup.tasks.find(task=>task.publicationTaskId===binding.publication.publicationTaskId&&task.schedule.stepKind==='material_preparation')!;
  const scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:binding.publication.publicationTaskId,contentTaskId:String(binding.record.task_id)};
  const assessed=await assessWeeklyOwnedProductIdentity(f.store,scope,ports);assert.equal(assessed.requirements.length,1);
  await bindWeeklyOwnedProductIdentity(f.store,scope,{actorUserId:'owner',expectedTaskVersion:assessed.contentTaskVersion,expectedRequirementHash:assessed.requirementHash,bindings:[{requirementId:assessed.requirements[0]!.requirementId,requestId:setup.request.requestId}]},ports);
  const prepared=await adapter.execute(preparation);assert.equal(prepared.status,'succeeded',JSON.stringify(prepared));
  const script=setup.tasks.find(task=>task.publicationTaskId===binding.publication.publicationTaskId&&task.schedule.stepKind==='script')!;
  const started=await adapter.execute(script);assert.equal(started.status,'pending',JSON.stringify(started));
 }
 const canonical=setup.bindings.map(binding=>{const row=f.tables.starter_social_content_tasks!.find(row=>row.task_id===binding.record.task_id)!;assert.ok(row.run_id);const run=f.tables.workflow_runs!.find(run=>run.id===row.run_id)!;assert.ok(run);assert.equal(run.tenant_id,'t');assert.equal(fixtureObject(run.starter_context).socialTaskId,row.task_id);return {taskId:String(row.task_id),runId:String(row.run_id),accountId:binding.publication.accountId};});
 assert.equal(new Set(canonical.map(row=>row.taskId)).size,5);assert.equal(new Set(canonical.map(row=>row.runId)).size,5);
 return {...setup,adapter,ports,canonical};
}

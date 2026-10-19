import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {initialSocialContentOrder,registerPreparedProductAssetRevisionDispatch} from './socialContentOrderAdmission.js';
import {prepareSocialProductAssetFallback} from './socialContentProductAssetRevisionPrepare.js';
import {socialContentQueueItemId} from './socialContentScheduler.js';
import {socialRequestHash} from './socialContentValidation.js';
import {freezeSocialProductAssetRevisionStart} from './socialContentAssetRevisionStart.js';
import {scheduleSocialProductAssetRevision} from './socialContentAssetRevisionScheduler.js';

test('prepared same-task image revision uses the original quota slot across disk restart and rejects identity drift',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-revision-dispatch-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'store.json'),first=new LangGraphTestStore(file),repository=createStarter198Repository(first);
 (first as any).supportsAtomicCompareAndSwap=async()=>true;
 const scope={tenantId:'tenant',programId:'program',weekStart:'2026-10-12'};
 const quota=createContentCreationQuotaService({store:first,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false});
 await first.create('social_programs',{id:'program-row',tenant_id:'tenant',program_id:'program'});
 const originalQueue:any={tenantId:'tenant',userId:'owner',commandId:'source-start',idempotencyKey:'source-start',
  workflowScope:'social_content',input:'source',subject:{type:'social_content_task',id:'task',admissionVersion:'1',version:'1'}};
 const originalBody:any={schemaVersion:'social-content-dispatch.v1',commandId:'source-start',userId:'owner',expectedVersion:'1',idempotencyKey:'source-start',queueRequest:originalQueue};
 const original={...originalBody,requestHash:socialRequestHash(originalBody)};
 await quota.reserve(scope,{commandId:'source-start',actorId:'owner',reason:'confirmed_content_start'},
  {contentId:'task',entry:'workspace'});
 await first.create(STARTER_COLLECTIONS.socialContentOperations,{id:'source-operation',tenant_id:'tenant',operation_id:'source-start',
  operation:'start_social_content_task',target_id:'task',created_by:'owner',idempotency_key:'source-start',
  request_hash:socialRequestHash({expectedVersion:'1'}),status:'succeeded'});
 await first.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'tenant',task_id:'task',version:'7',status:'attention',
  run_id:'source-run',orchestrator_item_id:socialContentQueueItemId(originalQueue),last_operation_id:'source-start',
  content_order:{...initialSocialContentOrder('task'),programId:'program',originWeek:'2026-10-12',dispatch:original},
  brief:{productId:'product',voice:'voice',perItemBudgetCny:10}});
 await first.create(STARTER_COLLECTIONS.runs,{id:'source-run',tenant_id:'tenant',status:'failed',
  starter_context:{schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:'task'}});
 const bytes=await sharp({create:{width:80,height:80,channels:3,background:'#ccc'}}).png().toBuffer();
 const digest=createHash('sha256').update(bytes).digest('hex');
 const primary:any={id:'primary',tenantId:'tenant',productId:'product',type:'image',scope:'own',
  sourceType:'enterprise_product_table',contentSha256:digest,rightsStatus:'authorized',rightsEvidenceRef:'primary-right',commercialUseApproved:true};
 const backup:any={...primary,id:'backup',rightsEvidenceRef:'backup-right'};
 const plan:any={planVersion:'7',shots:[{shotId:'shot',sourceRefs:['primary'],materialRouting:{generation:{productImageRefs:['primary']}}}]};
 await prepareSocialProductAssetFallback({repository,tenantId:'tenant',userId:'system',taskId:'task',expectedVersion:'7',sourceRunId:'source-run',
  productId:'product',failedAssetId:'primary',sourcePlan:plan,materials:[primary,backup],budgetLedgerRef:'ledger:task',
  idempotencyKey:'prepare-asset',readCurrentPlan:async()=>structuredClone(plan),
  loadBytes:async item=>{if(item.id==='primary')throw Error('gone');return bytes;}});
 const second=new LangGraphTestStore(file),restarted=createStarter198Repository(second);
 (second as any).supportsAtomicCompareAndSwap=async()=>true;
 const prepared={repository:restarted,tenantId:'tenant',taskId:'task',expectedPreparedVersion:'8',sourceRunId:'source-run',
  budgetLedgerRef:'ledger:task',readBudgetLedgerRef:async()=> 'ledger:task',readReplacementMaterial:async()=>backup,
  readReplacementBytes:async()=>bytes};
 const revisionQueue:any={...originalQueue,commandId:'revision-start',idempotencyKey:'revision-start',
  subject:{...originalQueue.subject,admissionVersion:'8',version:'8'}};
 const body:any={...originalBody,commandId:'revision-start',expectedVersion:'8',idempotencyKey:'revision-start',queueRequest:revisionQueue};
 const dispatch={...body,requestHash:socialRequestHash(body)};
 const request={repository:restarted,tenantId:'tenant',userId:'owner',taskId:'task',commandId:'revision-start',dispatch,prepared};
 const before=await quota.read(scope);
 const cas=second.compareAndSwap.bind(second);
 let crash=true;
 second.compareAndSwap=async(collection,id,expected,patch)=>{
  if(collection==='social_content_creation_quotas'&&crash){crash=false;throw Error('controlled-quota-crash');}
  return cas(collection,id,expected,patch);
 };
 await assert.rejects(registerPreparedProductAssetRevisionDispatch(request),/controlled-quota-crash/);
 const afterCrash=await second.getById<any>(STARTER_COLLECTIONS.socialContentTasks,'task-row');
 assert.equal(afterCrash?.content_order.dispatch.commandId,'revision-start');
 const recoveryStore=new LangGraphTestStore(file),recoveryRepository=createStarter198Repository(recoveryStore);
 (recoveryStore as any).supportsAtomicCompareAndSwap=async()=>true;
 const firstResult=await registerPreparedProductAssetRevisionDispatch({...request,repository:recoveryRepository,
  prepared:{...prepared,repository:recoveryRepository}});
 assert.equal(firstResult.authorizesProvider,false);
 const third=new LangGraphTestStore(file),again=createStarter198Repository(third);
 (third as any).supportsAtomicCompareAndSwap=async()=>true;
 const replay=await registerPreparedProductAssetRevisionDispatch({...request,repository:again,prepared:{...prepared,repository:again}});
 assert.equal(replay.lineage.lineageHash,firstResult.lineage.lineageHash);
 const after=await createContentCreationQuotaService({store:third,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false}).read(scope);
 assert.equal(after?.slots.filter(slot=>slot.contentId).length,1);
 assert.equal(after?.orders.task.slotId,before?.orders.task.slotId);
 assert.equal(after?.orders.task.revisions?.length,1);
 assert.equal(after?.outbox.filter(item=>item.commandId==='revision-start').length,1);
 const freezeInput={repository:again,tenantId:'tenant',userId:'owner',taskId:'task',commandId:'revision-start',
  idempotencyKey:'freeze-revision-start',prepared:{...prepared,repository:again}};
 const frozen=await freezeSocialProductAssetRevisionStart(freezeInput);
 assert.equal(frozen.authorizesQueue,false);
 assert.equal(frozen.authorizesProvider,false);
 const frozenRestartStore=new LangGraphTestStore(file),frozenRestartRepository=createStarter198Repository(frozenRestartStore);
 (frozenRestartStore as any).supportsAtomicCompareAndSwap=async()=>true;
 const frozenReplay=await freezeSocialProductAssetRevisionStart({...freezeInput,repository:frozenRestartRepository,
  prepared:{...prepared,repository:frozenRestartRepository}});
 assert.equal(frozenReplay.operationRepeated,true);
 assert.equal(frozenReplay.lineage.lineageHash,frozen.lineage.lineageHash);
 const frozenOps=await frozenRestartStore.list<any>(STARTER_COLLECTIONS.socialContentOperations,
  {where:{tenant_id:'tenant',idempotency_key:'freeze-revision-start'},perPage:2});
 assert.equal(frozenOps.totalItems,1);
 assert.equal(frozenOps.items[0].operation,'freeze_social_product_asset_revision_start');
 const revisionSubject:any={type:'social_product_asset_revision',id:'task',sourceRunId:'source-run',
  preparedVersion:'8',revisedPlanHash:frozen.lineage.revisedPlanHash,lineageHash:frozen.lineage.lineageHash,
  freezeOperationId:frozenOps.items[0].operation_id,freezeIdempotencyKey:'freeze-revision-start'};
 const admissionQueue:any={...revisionQueue,subject:revisionSubject};
 const admissionInput={repository:frozenRestartRepository,queue:admissionQueue,
  prepared:{...prepared,repository:frozenRestartRepository}};
 const admitted=await scheduleSocialProductAssetRevision(admissionInput);
 assert.equal(admitted.authorizesProvider,false);assert.equal(admitted.authorizesProduction,false);
 const scheduledRun=await frozenRestartRepository.get(STARTER_COLLECTIONS.runs,'tenant',admitted.runId);
 assert.equal(scheduledRun?.status,'waiting_external');
 assert.notEqual(admitted.runId,'source-run');
 assert.equal((await frozenRestartRepository.get(STARTER_COLLECTIONS.socialContentTasks,'tenant','task-row'))?.run_id,'source-run');
 const queueRows=await frozenRestartStore.list<any>(STARTER_COLLECTIONS.tasks,{where:{tenant_id:'tenant',run_id:admitted.runId},perPage:2});
 assert.equal(queueRows.totalItems,1);assert.equal(queueRows.items[0].status,'blocked');
 assert.equal(queueRows.items[0].automatic_execution_allowed,false);
 const admittedAgain=await scheduleSocialProductAssetRevision(admissionInput);
 assert.deepEqual(admittedAgain,admitted);
 const postScheduleStore=new LangGraphTestStore(file),postScheduleRepository=createStarter198Repository(postScheduleStore);
 (postScheduleStore as any).supportsAtomicCompareAndSwap=async()=>true;
 const restartedAdmission=await scheduleSocialProductAssetRevision({repository:postScheduleRepository,queue:admissionQueue,
  prepared:{...prepared,repository:postScheduleRepository}});
 assert.deepEqual(restartedAdmission,admitted);
 assert.equal((await postScheduleStore.list<any>('content_execution_jobs',{where:{tenant_id:'tenant',task_id:'task'},perPage:2})).totalItems,0);
 const afterSchedule=await createContentCreationQuotaService({store:frozenRestartStore,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false}).read(scope);
 assert.equal(afterSchedule?.orders.task.revisions?.length,1);
 assert.equal(afterSchedule?.outbox.filter(item=>item.commandId==='revision-start').length,1);
 await assert.rejects(scheduleSocialProductAssetRevision({...admissionInput,queue:{...admissionQueue,subject:{...revisionSubject,revisedPlanHash:'wrong'}}}),/schedule_prepared_changed/);
 await assert.rejects(scheduleSocialProductAssetRevision({...admissionInput,queue:{...admissionQueue,subject:{...revisionSubject,freezeOperationId:'other'}}}),/schedule_freeze_changed/);
 await assert.rejects(freezeSocialProductAssetRevisionStart({...freezeInput,repository:frozenRestartRepository,
  commandId:'source-start',prepared:{...prepared,repository:frozenRestartRepository}}),/registered_dispatch_invalid/);
 await assert.rejects(registerPreparedProductAssetRevisionDispatch({...request,repository:again,prepared:{...prepared,repository:again,
  readBudgetLedgerRef:async()=> 'ledger:other'}}),/product_asset_fallback_budget_changed/);
 const task=await again.get(STARTER_COLLECTIONS.socialContentTasks,'tenant','task-row');
 await again.update(STARTER_COLLECTIONS.socialContentTasks,'tenant','task-row',{orchestrator_item_id:'other'});
 await assert.rejects(registerPreparedProductAssetRevisionDispatch({...request,repository:again,prepared:{...prepared,repository:again}}),/original_dispatch_invalid/);
 assert.equal((await again.get(STARTER_COLLECTIONS.socialContentTasks,'tenant','task-row'))?.version,task?.version);
});

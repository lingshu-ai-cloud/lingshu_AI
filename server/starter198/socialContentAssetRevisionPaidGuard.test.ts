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
import {freezeSocialProductAssetRevisionPaidGuard,readSocialProductAssetRevisionPaidGuard} from './socialContentAssetRevisionPaidGuard.js';
import {reserveSocialProductAssetRevisionBudget} from './socialContentAssetRevisionBudgetReserve.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {handoffSocialProductAssetRevision} from './socialContentAssetRevisionHandoff.js';
import {startSocialContentTask,recoverSocialContentOrderDispatch} from './socialContentTasks.js';
import {createPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {createPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';
import {createSocialProductAssetRevisionPaidPermit} from './socialContentAssetRevisionPaidPermit.js';

test('paid-worker handoff survives disk restart and task run CAS without inheriting old approval or losing retained unknown budget',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-revision-paid-guard-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'store.json'),ledgerRoot=path.join(dir,'ledger'),store=new LangGraphTestStore(file);
 (store as any).supportsAtomicCompareAndSwap=async()=>true;
 const repository=createStarter198Repository(store),tenantId='tenant',taskId='task',sourceRunId='source-run';
 await store.create('social_programs',{id:'program-row',tenant_id:tenantId,program_id:'program'});
 const scope={tenantId,programId:'program',weekStart:'2026-10-12'};
 const quota=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false});
 await quota.reserve(scope,{commandId:'source-start',actorId:'owner',reason:'confirmed_content_start'},{contentId:taskId,entry:'workspace'});
 const sourceQueue:any={tenantId,userId:'owner',commandId:'source-start',idempotencyKey:'source-start',workflowScope:'social_content',input:'source',subject:{type:'social_content_task',id:taskId,admissionVersion:'1',version:'1'}};
 const sourceBody:any={schemaVersion:'social-content-dispatch.v1',commandId:'source-start',userId:'owner',expectedVersion:'1',idempotencyKey:'source-start',queueRequest:sourceQueue};
 const sourceDispatch={...sourceBody,requestHash:socialRequestHash(sourceBody)};
 await store.create(STARTER_COLLECTIONS.socialContentOperations,{id:'source-operation',tenant_id:tenantId,operation_id:'source-start',operation:'start_social_content_task',target_id:taskId,created_by:'owner',idempotency_key:'source-start',request_hash:socialRequestHash({expectedVersion:'1'}),status:'succeeded'});
 await store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:tenantId,task_id:taskId,version:'7',status:'attention',run_id:sourceRunId,orchestrator_item_id:socialContentQueueItemId(sourceQueue),last_operation_id:'source-start',content_order:{...initialSocialContentOrder(taskId),programId:'program',originWeek:'2026-10-12',dispatch:sourceDispatch},brief:{productId:'product',voice:'voice',perItemBudgetCny:10}});
 await store.create(STARTER_COLLECTIONS.runs,{id:sourceRunId,tenant_id:tenantId,status:'failed',starter_context:{schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:taskId}});
 const bytes=await sharp({create:{width:80,height:80,channels:3,background:'#ccc'}}).png().toBuffer(),digest=createHash('sha256').update(bytes).digest('hex');
 const primary:any={id:'primary',tenantId,productId:'product',type:'image',scope:'own',sourceType:'enterprise_product_table',contentSha256:digest,rightsStatus:'authorized',rightsEvidenceRef:'primary-right',commercialUseApproved:true};
 const backup:any={...primary,id:'backup',rightsEvidenceRef:'backup-right'};
 const plan:any={planVersion:'7',shots:[{shotId:'shot',sourceRefs:['primary'],materialRouting:{generation:{productImageRefs:['primary']}}}]};
 await prepareSocialProductAssetFallback({repository,tenantId,userId:'system',taskId,expectedVersion:'7',sourceRunId,productId:'product',failedAssetId:'primary',sourcePlan:plan,materials:[primary,backup],budgetLedgerRef:'ledger:task',idempotencyKey:'prepare-asset',readCurrentPlan:async()=>structuredClone(plan),loadBytes:async item=>{if(item.id==='primary')throw Error('gone');return bytes;}});
 const prepared={repository,tenantId,taskId,expectedPreparedVersion:'8',sourceRunId,budgetLedgerRef:'ledger:task',readBudgetLedgerRef:async()=> 'ledger:task',readReplacementMaterial:async()=>backup,readReplacementBytes:async()=>bytes};
 const revisionQueue:any={...sourceQueue,commandId:'revision-start',idempotencyKey:'revision-start',subject:{...sourceQueue.subject,admissionVersion:'8',version:'8'}};
 const dispatchBody:any={...sourceBody,commandId:'revision-start',expectedVersion:'8',idempotencyKey:'revision-start',queueRequest:revisionQueue};
 await registerPreparedProductAssetRevisionDispatch({repository,tenantId,userId:'owner',taskId,commandId:'revision-start',dispatch:{...dispatchBody,requestHash:socialRequestHash(dispatchBody)},prepared});
 const freeze=await freezeSocialProductAssetRevisionStart({repository,tenantId,userId:'owner',taskId,commandId:'revision-start',idempotencyKey:'freeze-revision-start',prepared});
 const frozenOps=await store.list<any>(STARTER_COLLECTIONS.socialContentOperations,{where:{tenant_id:tenantId,idempotency_key:'freeze-revision-start'},perPage:2});
 const subject:any={type:'social_product_asset_revision',id:taskId,sourceRunId,preparedVersion:'8',revisedPlanHash:freeze.lineage.revisedPlanHash,lineageHash:freeze.lineage.lineageHash,freezeOperationId:frozenOps.items[0].operation_id,freezeIdempotencyKey:'freeze-revision-start'};
 const admitted=await scheduleSocialProductAssetRevision({repository,queue:{...revisionQueue,subject},prepared});
 const budgetScope={tenantId,taskId,runId:sourceRunId,planHash:'a'.repeat(64)};
 await assert.rejects(freezeSocialProductAssetRevisionPaidGuard({repository,tenantId,taskId,revisionRunId:admitted.runId,prepared,ledgerRoot}),/original_ten_yuan_ledger_missing/);
 const budget=new SocialContentTaskBudget(ledgerRoot,{authorization:async()=>({maximumCny:15,authorizationRef:'original-ten-yuan'}),
  quote:async()=>({upperBoundCny:4,quoteRef:'old-paid-request',validUntil:new Date(Date.now()+60000).toISOString()}),
  assertCurrent:async()=>{},verifyRejection:async()=>false});
 await budget.reserveBatch(budgetScope,[{operationId:'old-first-frame',fingerprint:'b'.repeat(64),provider:'seedream',model:'test',accountRef:'old',stage:'first_frame',shotId:'shot'}]);
 await budget.markOutcome(budgetScope,'old-first-frame','unknown','supplier-outcome-unknown');
 const input={repository,tenantId,taskId,revisionRunId:admitted.runId,prepared,ledgerRoot};
 const first=await freezeSocialProductAssetRevisionPaidGuard(input);assert.equal(first.authorizesProvider,false);assert.equal(first.remainingCny,11);
 const freshStore=new LangGraphTestStore(file),freshRepository=createStarter198Repository(freshStore);
 (freshStore as any).supportsAtomicCompareAndSwap=async()=>true;
 const restarted={...input,repository:freshRepository,prepared:{...prepared,repository:freshRepository}};
 const checked=await readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash});assert.equal(checked.authorizesProduction,false);
 const row=await freshRepository.get(STARTER_COLLECTIONS.socialContentTasks,tenantId,'task-row');
 const handoffInput={repository:freshRepository,guard:{...restarted,expectedRecordHash:first.recordHash},
  queueItemId:admitted.queueItemId,actorId:'system'};
 const handoff=await handoffSocialProductAssetRevision(handoffInput);
 assert.equal(handoff.runId,admitted.runId);assert.equal(handoff.taskVersion,'9');
 assert.equal(handoff.authorizesProvider,false);
 const afterHandoff=await freshRepository.get(STARTER_COLLECTIONS.socialContentTasks,tenantId,'task-row');
 assert.equal(afterHandoff?.status,'paused');assert.equal(afterHandoff?.run_id,admitted.runId);
 const recoveredStore=new LangGraphTestStore(file),recoveredRepository=createStarter198Repository(recoveredStore);
 (recoveredStore as any).supportsAtomicCompareAndSwap=async()=>true;
 const replay=await handoffSocialProductAssetRevision({repository:recoveredRepository,
  guard:{...restarted,repository:recoveredRepository,prepared:{...restarted.prepared,repository:recoveredRepository},expectedRecordHash:first.recordHash},
  queueItemId:admitted.queueItemId,actorId:'system'});
 assert.equal(replay.repeated,true);assert.equal(replay.taskVersion,'9');
 assert.equal((await recoveredRepository.get(STARTER_COLLECTIONS.runs,tenantId,sourceRunId))?.status,'failed');
 await assert.rejects(startSocialContentTask({repository:recoveredRepository,tenantId,userId:'owner',taskId,
  expectedVersion:'9',idempotencyKey:'ordinary-bypass',orchestratorQueue:{enqueue:async()=>{throw Error('should-not-enqueue');}} as any}),
  /product_asset_fallback_start_adapter_required/);
 await assert.rejects(recoverSocialContentOrderDispatch({repository:recoveredRepository,tenantId,taskId,
  commandId:'revision-start',orchestratorQueue:{enqueue:async()=>{throw Error('should-not-enqueue');}} as any}),
  /social_content_order_original_start_required/);
 const queueRows=await recoveredStore.list<any>(STARTER_COLLECTIONS.tasks,{where:{tenant_id:tenantId,run_id:admitted.runId},perPage:2});
 assert.equal(queueRows.totalItems,1);
 await recoveredStore.update(STARTER_COLLECTIONS.tasks,queueRows.items[0].id,{status:'running'});
 await assert.rejects(handoffSocialProductAssetRevision({repository:recoveredRepository,
  guard:{...restarted,repository:recoveredRepository,prepared:{...restarted.prepared,repository:recoveredRepository},expectedRecordHash:first.recordHash},
  queueItemId:admitted.queueItemId,actorId:'system'}),/handoff_schedule_changed/);
 await recoveredStore.update(STARTER_COLLECTIONS.tasks,queueRows.items[0].id,{status:'blocked'});
 assert.equal((await readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash})).authorizesProvider,false);
 const reservationInput={repository:freshRepository,guard:{...restarted,expectedRecordHash:first.recordHash},ledgerRoot,ports:{
  assertCurrent:async()=>{},verifyRejection:async()=>false,
  readApprovedPlan:async(scope:any)=>({scope,authorizationRef:`asset-revision:${first.recordHash}`,maximumCny:15,
   revisionGuardHash:first.recordHash,replacementSha256:digest,paidOperations:[{operationId:'revision-first-frame',
    provider:'seedream',model:'test',accountRef:'revision',stage:'first_frame',shotId:'shot',
    inputContractHash:freeze.lineage.revisedPlanHash,maximumUnits:{requests:1}}]}),
  readVerifiedTariff:async()=>({provider:'seedream',model:'test',accountRef:'revision',stage:'first_frame',
   currency:'CNY' as const,verifiedAccountPrice:true,evidenceRef:'verified-account-pricing',
   checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),
   meters:{requests:{priceCny:1,unitsPerPrice:1,minimumUnits:1,increment:1}}})}};
 await assert.rejects(reserveSocialProductAssetRevisionBudget({...reservationInput,ports:{...reservationInput.ports,
  readVerifiedTariff:async()=>({...await reservationInput.ports.readVerifiedTariff(),
   meters:{requests:{priceCny:12,unitsPerPrice:1,minimumUnits:1,increment:1}}})}}),/production_budget_decision_required/);
 assert.equal(budget.status(budgetScope)?.retainedCny,4);
 const reserved=await reserveSocialProductAssetRevisionBudget(reservationInput);
 assert.equal(reserved.authorizesProvider,false);assert.equal(reserved.retainedCny,5);
 let canonicalPlanReads=0;
 await assert.rejects(createSocialProductAssetRevisionPaidPermit({repository:freshRepository,
  guard:{...restarted,expectedRecordHash:first.recordHash},ledgerRoot,
  readCanonicalPlan:async()=>{canonicalPlanReads++;throw Error('blocked worker must never read plan');}}),
  /canonical_worker_admission_missing/);
 assert.equal(canonicalPlanReads,0);
 assert.equal((await reserveSocialProductAssetRevisionBudget(reservationInput)).retainedCny,5);
 assert.equal((await readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash} )).remainingCny,10);
 await assert.rejects(reserveSocialProductAssetRevisionBudget({...reservationInput,ports:{...reservationInput.ports,
  readApprovedPlan:async(scope:any)=>({...await reservationInput.ports.readApprovedPlan(scope),maximumCny:16})}}),/approved_plan_invalid/);
 await assert.rejects(readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash,prepared:{...restarted.prepared,readReplacementBytes:async()=>Buffer.from('wrong')}}),/replacement_changed/);
 const wrongPlanFile=path.join(dir,'wrong-plan-store.json');fs.copyFileSync(file,wrongPlanFile);
 const wrongPlanStore=new LangGraphTestStore(wrongPlanFile),wrongPlanRepository=createStarter198Repository(wrongPlanStore);
 const provenance=createPresenterFirstFrameAssetProvenance({presenter:{assetId:'presenter',assetVersion:1,referenceAssetIds:['person'],referenceSha256s:[digest]},
  products:[{productId:'product',enterpriseFactRef:'fact',enterpriseFactVersion:'1',referenceImageIds:['backup'],referenceImageSha256s:[digest]}],
  background:{referenceSourceId:'reference',referenceShotId:'shot',startSeconds:0,endSeconds:2,referenceFirstFrameRef:'frame',referenceFirstFrameSha256:digest}});
 await createPresenterFirstFrameApproval(wrongPlanStore,{tenantId,taskId,runId:admitted.runId,planHash:'f'.repeat(64),groupId:'group',
  presenterGroupContractHash:digest,referenceCompositionHashes:[digest],backgroundPlateSha256:digest,
  personRemovalEvidence:{receiptRef:'removal',sourceSha256:digest,outputSha256:digest},assetProvenance:provenance,
  presenter:{assetId:'presenter',assetVersion:1,authorizationRef:'rights',consentRef:'consent',providerId:'seedance',
   identityMode:'enterprise_asset_first_frame',providerPresenterId:null,providerVoiceId:null},
  compositeFirstFrameSha256:digest,compositeFirstFrameUrl:'/media/tenants/tenant/frame.png',
  qa:{passed:true,receiptRef:'qa',reportHash:digest},createdAt:new Date().toISOString()});
 await assert.rejects(readSocialProductAssetRevisionPaidGuard({...restarted,repository:wrongPlanRepository,
  prepared:{...restarted.prepared,repository:wrongPlanRepository},expectedRecordHash:first.recordHash}),/new_approval_invalid/);
 await budget.reserveBatch(budgetScope,[{operationId:'late-bill',fingerprint:'c'.repeat(64),provider:'qwen',model:'test',accountRef:'old',stage:'analysis',shotId:null}]);
 await assert.rejects(readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash}),/ledger_changed/);
 await freshStore.update(STARTER_COLLECTIONS.socialContentTasks,'task-row',{brief:{...(row?.brief as Record<string,unknown>),voice:'changed'}});
 await assert.rejects(readSocialProductAssetRevisionPaidGuard({...restarted,expectedRecordHash:first.recordHash}),/task_changed/);
});

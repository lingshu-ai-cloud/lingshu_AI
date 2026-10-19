import test from 'node:test';
import express from 'express';
import {createSocialContentOrderOperationsRouter} from './socialContentOrderOperationsRouter.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStarter198Repository} from './repository.js';
import {initialSocialContentOrder} from './socialContentOrderAdmission.js';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {cancelSocialContentOrder,recoverPendingSocialContentOrderCancellations,socialContentCancellationGroupHash} from './socialContentOrderCancellation.js';
import {issueWeeklyCreativeRepairAuthority} from '../runtime/weeklyCreativeRepairAuthority.js';
import {bindSocialContentRevisionOrder} from './socialContentCostLineage.js';
import {socialRequestHash} from './socialContentValidation.js';
import {admitContentExecutionJob,controlContentExecutionJob} from '../contentExecution/durableQueue.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {acquireDurableOperationLease,releaseDurableOperationLease} from '../runtime/durableLease.js';

async function fixture(){
 const tables:Record<string,any[]>={};let serial=0;
 const table=(c:string)=>tables[c]??=[];
 const store:any={supportsAtomicCompareAndSwap:()=>true,
  getById:async(c:string,id:string)=>structuredClone(table(c).find(r=>r.id===id)??null),
  create:async(c:string,v:any)=>{const id=v.id??`row-${++serial}`;if(table(c).some(r=>r.id===id))return null;const r={...structuredClone(v),id};table(c).push(r);return structuredClone(r);},
  update:async(c:string,id:string,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r)return null;Object.assign(r,structuredClone(p));return structuredClone(r);},
  delete:async(c:string,id:string)=>{const i=table(c).findIndex(r=>r.id===id);if(i<0)return false;table(c).splice(i,1);return true;},
  compareAndSwap:async(c:string,id:string,e:any,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r||Object.entries(e).some(([k,v])=>JSON.stringify(r[k])!==JSON.stringify(v)))return false;Object.assign(r,structuredClone(p));return true;},
  list:async(c:string,q:any={})=>{const rows=table(c).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items:structuredClone(rows.slice(0,q.perPage??1000)),totalItems:rows.length};}};
 const scope={tenantId:'tenant',programId:'program',weekStart:'2026-10-12'};
 const task={id:'task',tenant_id:'tenant',task_id:'content',status:'draft',version:'1',brief:{},content_order:{...initialSocialContentOrder('content'),programId:'program',originWeek:scope.weekStart}};
 tables.starter_social_content_tasks=[task];
 const quota=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:false,inFlight:false,paid:false,unknown:false}),verifyDelivery:async()=>false});
 await quota.reserve(scope,{commandId:'original-start',actorId:'owner',reason:'start'},{contentId:'content',entry:'workspace'});
 const repository=createStarter198Repository(store),budgetRoot=fs.mkdtempSync(path.join(os.tmpdir(),'cancel-order-'));
 const cancel=(extra:any={})=>cancelSocialContentOrder({repository,tenantId:'tenant',userId:'owner',taskId:'content',expectedVersion:'1',idempotencyKey:'cancel-1',reason:'User scope reduction',budgetRoot,...extra});
 return{store,repository,tables,table,task,quota,scope,cancel,budgetRoot,clean:()=>fs.rmSync(budgetRoot,{recursive:true,force:true})};
}
test('cancel unused reserved order releases one slot and pending outbox cannot regain allowance; replay is identical',async()=>{
 const f=await fixture();try{
  const first=await f.cancel();assert.equal(first.quotaReleased,true);assert.deepEqual(first.retainedReasons,[]);
  assert.equal(f.task.status,'cancelled');const pool=await f.quota.read(f.scope);assert.equal(pool!.orders.content.state,'released');
  assert.equal(pool!.outbox[0].state,'pending');assert.equal(pool!.audit.filter(a=>a.action==='released').length,1);
  assert.deepEqual(await f.cancel(),first);assert.equal((await f.quota.read(f.scope))!.audit.filter(a=>a.action==='released').length,1);
  await assert.rejects(f.cancel({userId:'another-owner'}),/idempotency_conflict/);
  await assert.rejects(f.quota.reserve(f.scope,{commandId:'retry-start',actorId:'owner',reason:'start again'},{contentId:'content',entry:'workspace'}),/released_content/);
 }finally{f.clean();}
});
test('real queued durable job is stopped without dropping queue/run history or receipts',async()=>{
 const f=await fixture();try{
  const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'run',taskType:'social_content_instant'});
  f.task.status='running';(f.task as any).run_id='run';f.tables.workflow_runs=[{id:'run',tenant_id:'tenant',status:'running',starter_context:{socialTaskId:'content'}}];
  const result=await f.cancel();assert.equal(result.quotaReleased,true);
  assert.equal(f.table('content_execution_jobs')[0].id,job.id);assert.equal(f.table('content_execution_jobs')[0].status,'cancelled');
  assert.deepEqual(f.table('content_execution_jobs')[0].provider_receipts,[]);assert.equal(f.tables.workflow_runs[0].status,'cancelled');
  await assert.rejects(controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'resume'}),/order_cancelled_or_replaced/);
  await assert.rejects(controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'retry'}),/order_cancelled_or_replaced/);
 }finally{f.clean();}
});
test('expired worker and unknown provider receipt retain allowance and all billing evidence',async()=>{
 const f=await fixture();try{
  await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'run',taskType:'social_content_instant'});
  const job=f.table('content_execution_jobs')[0];Object.assign(job,{status:'running',worker_id:'historical-worker',lease_expires_at:'2020-01-01T00:00:00Z',attempt:1,last_started_at:'2020-01-01T00:00:00Z',provider_state:'unknown',provider_receipts:[{provider:'seedance',state:'unknown',requestId:'original-request'}]});
  const before=structuredClone(job.provider_receipts),result=await f.cancel();assert.equal(result.quotaReleased,false);
  assert.ok(result.retainedReasons.includes('leaseActive'));assert.ok(result.retainedReasons.includes('unknown'));
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');assert.deepEqual(job.provider_receipts,before);assert.equal(job.worker_id,'historical-worker');
 }finally{f.clean();}
});
test('retained paid ledger is never refunded or deleted by cancellation',async()=>{
 const f=await fixture();try{
  const scope={tenantId:'tenant',taskId:'content',runId:'run',planHash:'a'.repeat(64)};
  const ledger=new SocialContentTaskBudget(f.budgetRoot,{authorization:async()=>({maximumCny:15,authorizationRef:'actual-authority'}),quote:async()=>({upperBoundCny:2,quoteRef:'actual-price',validUntil:'2099-01-01T00:00:00Z'}),assertCurrent:async()=>{},verifyRejection:async()=>false});
  await ledger.reserveBatch(scope,[{operationId:'paid-original',fingerprint:'b'.repeat(64),provider:'seedance',model:'video',accountRef:'account',stage:'video',shotId:'shot'}]);
  const before=ledger.status(scope),result=await f.cancel();assert.equal(result.quotaReleased,false);assert.ok(result.retainedReasons.includes('paid'));assert.deepEqual(ledger.status(scope),before);
 }finally{f.clean();}
});
test('orphan orchestrator admission without its durable job is unknown, not an unused refundable slot',async()=>{
 const f=await fixture();try{
  (f.task as any).orchestrator_item_id='original-queue-admission';
  const result=await f.cancel();assert.equal(result.quotaReleased,false);assert.ok(result.retainedReasons.includes('unknown'));
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
 }finally{f.clean();}
});
test('scheduler race and mid-cancel failure recover original command with a persistent stop fence',async()=>{
 const f=await fixture();try{
  const lease=await acquireDurableOperationLease({dataStore:f.store,tenantId:'__system__',scope:'content_queue_scheduler',subjectId:'global',ownerId:'other-worker',leaseDurationMs:60000});
  await assert.rejects(f.cancel(),/scheduler_busy/);assert.equal(f.task.status,'cancelling');assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
  await releaseDurableOperationLease({dataStore:f.store,lease:lease!});const result=await f.cancel();assert.equal(result.quotaReleased,true);assert.equal(f.table('starter_social_content_operations').length,1);
 }finally{f.clean();}
});
test('foreign tenant, stale version and repair child cannot cancel original allowance',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.cancel({tenantId:'other'}),/not_found/);
  await assert.rejects(f.cancel({expectedVersion:'9',idempotencyKey:'stale'}),/version_conflict/);
  (f.task.content_order as any).contentId='parent';await assert.rejects(f.cancel({idempotencyKey:'child'}),/root_order_required/);
  assert.equal(f.task.status,'draft');assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
 }finally{f.clean();}
});
test('background recovers exact original cancellation after crash, rejects forged actor, and does not repeat completed commands',async()=>{
 const f=await fixture();try{
  const lease=await acquireDurableOperationLease({dataStore:f.store,tenantId:'__system__',scope:'content_queue_scheduler',subjectId:'global',ownerId:'other-worker',leaseDurationMs:60000});
  await assert.rejects(f.cancel(),/scheduler_busy/);await releaseDurableOperationLease({dataStore:f.store,lease:lease!});
  const cancellation=(f.task.content_order as any).cancellation;cancellation.actorId='forged';
  assert.deepEqual(await recoverPendingSocialContentOrderCancellations({repository:f.repository,budgetRoot:f.budgetRoot}),{recovered:0,failed:1,truncated:false});
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');cancellation.actorId='owner';
  assert.deepEqual(await recoverPendingSocialContentOrderCancellations({repository:f.repository,budgetRoot:f.budgetRoot}),{recovered:1,failed:0,truncated:false});
  assert.deepEqual(await recoverPendingSocialContentOrderCancellations({repository:f.repository,budgetRoot:f.budgetRoot}),{recovered:0,failed:0,truncated:false});
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'released');
 }finally{f.clean();}
});
test('completed or verified delivered content is not relabeled cancelled',async()=>{
 const f=await fixture();try{
  f.task.status='completed';await assert.rejects(f.cancel(),/already_completed/);assert.equal(f.task.status,'completed');
  f.task.status='asset_review';const row=f.table('social_content_creation_quotas')[0];row.payload.orders.content.state='delivered';row.payload.orders.content.deliveryRef='actual-delivery';
  await assert.rejects(f.cancel({idempotencyKey:'delivered'}),/already_delivered/);
  assert.equal(f.task.status,'asset_review');assert.equal(row.payload.orders.content.deliveryRef,'actual-delivery');
 }finally{f.clean();}
});
test('queue controls reject a released quota even before replacement projection is restored',async()=>{
 const f=await fixture();try{
  const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'run',taskType:'social_content_instant'});
  await controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'pause'});
  f.table('social_content_creation_quotas')[0].payload.orders.content.state='released';
  await assert.rejects(controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'resume'}),/order_not_reserved/);
  assert.equal(f.table('content_execution_jobs')[0].status,'paused');
 }finally{f.clean();}
});
test('registered revisions require current explicit group confirmation and reject forged children',async()=>{
 const f=await fixture();try{
  f.table('social_content_creation_quotas')[0].payload.orders.content.revisions=[{executionTaskId:'repair',lineageHash:'a'.repeat(64),commandId:'repair-start'}];
  await assert.rejects(f.cancel(),/group_changed/);assert.equal(f.task.status,'draft');
  await assert.rejects(f.cancel({idempotencyKey:'confirmed-forged',expectedGroupHash:socialContentCancellationGroupHash('content',f.table('social_content_creation_quotas')[0].payload.orders.content.revisions)}),/not_found/);
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
 }finally{f.clean();}
});

async function repairFixture(){
 const f=await fixture(),now=new Date('2026-10-16T02:00:00Z');
 const weeklyPackage={programId:'program',packageId:'package',version:3};
 const authority={weeklyPackage,programRef:{type:'social_program',id:'program',version:2},publicationTask:{publicationTaskId:'publication'},weeklyWorkflowTask:{taskRef:{type:'weekly_workflow_task',id:'workflow',version:3}}};
 Object.assign(f.task,{run_id:'original-run',weekly_plan_id:'package',create_idempotency_key:'weekly-production:package:3:publication',brief:{_weeklyAuthority:authority}});
 const content={productionResult:{id:'historical-original'}},artifactHash=socialRequestHash({resourceRef:'socialfile:original',content});
 f.tables.starter_social_content_artifacts=[{id:'original-artifact',tenant_id:'tenant',task_id:'content',artifact_id:'artifact',version:'1',status:'changes_requested',last_operation_id:'decision',resource_ref:'socialfile:original',content,content_hash:artifactHash}];
 f.tables.starter_social_content_operations=[{id:'decision-row',tenant_id:'tenant',operation_id:'decision',operation:'decide_social_content_artifact',target_id:'content',request_hash:'decision-hash',status:'succeeded'}];
 f.tables.social_weekly_operating_packages=[{id:'package-row',tenant_id:'tenant',program_id:'program',package_id:'package',version:3,payload:{...weeklyPackage,status:'active',executionGraphVersion:3}}];
 const body:any={schemaVersion:'weekly-production-repair-case.v1',caseId:'case',version:1,requestId:'request',requestHash:'request-hash',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:3,publicationTaskId:'publication',accountId:'account',qualityTaskId:'quality',approvalTaskId:'approval',kind:'creative_revision',trigger:{type:'user_changes_requested',operationId:'decision',operationRequestHash:'decision-hash',artifactDecisionVersion:1,note:'adjust opening',noteHash:socialRequestHash('adjust opening')},parent:{taskId:'content',runId:'original-run',artifactRef:{type:'starter_social_content_artifact',id:'artifact',version:1},artifactHash,sceneCacheHash:'cache'},affectedSceneIds:[],ownerUserId:'owner',reviewerUserId:'reviewer',deadlineAt:'2026-10-17T12:00:00Z',affectedPublishWindow:'2026-10-18T12:00:00Z',estimatedDurationMinutes:60,maximumCostCny:10,configurationGaps:[],state:'ready',admission:null,execution:null,childArtifactRef:null,createdBy:'reviewer',createdAt:now.toISOString(),updatedAt:now.toISOString()};
 const item={...body,recordHash:socialRequestHash(body)};
 const configBody:any={type:'weekly_creative_repair_configuration',version:1,tenantId:'tenant',caseId:'case',parentArtifactHash:artifactHash,decisionOperationId:'decision',feedbackHash:item.trigger.noteHash,revisionScope:'adjust opening',estimatedDurationMinutes:60,maximumCostCny:10,deadlineAt:item.deadlineAt,ownerUserId:'owner',reviewerUserId:'reviewer',confirmedBy:'owner',confirmedAt:now.toISOString()};
 const config={...configBody,recordHash:socialRequestHash(configBody)};
 f.tables.social_weekly_production_repair_cases=[{id:'case-row',tenant_id:'tenant',case_id:'case',content_hash:socialRequestHash(item),payload:item}];
 f.tables.social_weekly_creative_repair_configurations=[{id:'config-row',tenant_id:'tenant',case_id:'case',content_hash:socialRequestHash(config),payload:config}];
 const issued=await issueWeeklyCreativeRepairAuthority({store:f.store,tenantId:'tenant',caseId:'case',childTaskId:'repair',expectedCaseHash:item.recordHash,expectedConfigurationHash:config.recordHash,now});
 const child:any={id:'repair-row',tenant_id:'tenant',task_id:'repair',status:'draft',version:'1',run_id:'',brief:{_weeklyAuthority:issued.authority,_weeklyCreativeRepairProof:issued.proof},create_idempotency_key:issued.bindingKey,content_order:initialSocialContentOrder('repair')};
 f.table('starter_social_content_tasks').push(child);
 const lineage=await bindSocialContentRevisionOrder({repository:f.repository,tenantId:'tenant',taskId:'repair',now});
 const dispatchBody={schemaVersion:'social-content-dispatch.v1',commandId:'repair-start',userId:'owner',expectedVersion:'1',idempotencyKey:'repair-start',queueRequest:{tenantId:'tenant',userId:'owner',commandId:'repair-start',input:'repair',idempotencyKey:'repair-start',subject:{type:'social_content_task',id:'repair'}}};
 child.content_order.dispatch={...dispatchBody,requestHash:socialRequestHash(dispatchBody)};
 const order=f.table('social_content_creation_quotas')[0].payload.orders.content;
 order.revisions=[{executionTaskId:'repair',lineageHash:lineage.lineageHash,commandId:'repair-start'}];
 // Original run is complete and retained; an unstarted child is a separate
 // execution, not an invented new video or receipt.
 f.tables.workflow_runs=[{id:'original-run',tenant_id:'tenant',status:'completed',starter_context:{socialTaskId:'content'}}];
 await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'original-run',taskType:'social_content_instant'});
 Object.assign(f.table('content_execution_jobs')[0],{status:'succeeded',attempt:1,last_started_at:'2026-10-16T01:00:00Z'});
 const groupCancel=(extra:any={})=>f.cancel({now,expectedGroupHash:socialContentCancellationGroupHash('content',order.revisions),...extra});
 return{...f,child,order,now,groupCancel};
}
test('verified registered repair and root stop together, retaining completed run and one original allowance',async()=>{
 const f=await repairFixture();try{
  const childJob=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'repair',runId:'queued-repair',taskType:'social_content_instant'});
  const result=await f.groupCancel();assert.equal(result.executionStopped,true);assert.equal(result.quotaReleased,false);
  assert.ok(result.retainedReasons.includes('unknown'));
  assert.deepEqual(result.participants.map((p:any)=>p.taskId),['content','repair']);
  assert.equal(f.child.status,'cancelled');assert.equal(f.task.status,'cancelled');
  assert.equal(f.table('content_execution_jobs').find(j=>j.id===childJob.id).status,'cancelled');
  assert.equal(f.tables.workflow_runs[0].status,'completed');assert.equal(f.table('content_execution_jobs')[0].status,'succeeded');
  assert.equal(f.order.revisions.length,1);assert.deepEqual(await f.groupCancel(),result);
 }finally{f.clean();}
});
test('child lease race leaves durable group fence and resumes exact original command without partial success',async()=>{
 const f=await repairFixture();try{
  const lease=await acquireDurableOperationLease({dataStore:f.store,tenantId:'tenant',scope:'starter-social-content',subjectId:'repair',ownerId:'existing-child-start',leaseDurationMs:60000});
  await assert.rejects(f.groupCancel(),/child_busy/);assert.equal(f.task.status,'cancelling');assert.equal(f.child.status,'draft');
  assert.equal(f.table('starter_social_content_operations').find(o=>o.operation==='cancel_social_content_order').status,'processing');
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
  await releaseDurableOperationLease({dataStore:f.store,lease:lease!});
  assert.deepEqual(await recoverPendingSocialContentOrderCancellations({repository:f.repository,budgetRoot:f.budgetRoot,now:f.now}),{recovered:1,failed:0,truncated:false});
  assert.equal(f.child.status,'cancelled');assert.equal(f.task.status,'cancelled');
 }finally{f.clean();}
});
test('delivered root retains its receipt while repair unknown provider and shared costs remain unsettled',async()=>{
 const f=await repairFixture();try{
  f.task.status='completed';f.order.state='delivered';f.order.deliveryRef='historical-real-delivery';
  const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'repair',runId:'repair-run',taskType:'social_content_instant'});
  const row=f.table('content_execution_jobs').find(j=>j.id===job.id);Object.assign(row,{status:'reconciling',attempt:1,last_started_at:'2026-10-16T01:00:00Z',worker_id:'worker',lease_expires_at:'2026-10-16T03:00:00Z',provider_state:'unknown',provider_receipts:[{provider:'seedance',state:'unknown',requestId:'original-external-request'}]});
  const before=structuredClone(row.provider_receipts),result=await f.groupCancel();
  assert.equal(result.status,'completed');assert.equal(result.quotaReleased,false);assert.equal(result.externalSettlementPending,true);
  assert.ok(result.participants.find((p:any)=>p.taskId==='repair').retainedReasons.includes('unknown'));
  assert.equal(f.child.status,'cancelled');assert.equal(f.task.status,'completed');
  assert.equal((await f.quota.read(f.scope))!.orders.content.deliveryRef,'historical-real-delivery');
  assert.equal((await f.quota.read(f.scope))!.orders.content.state,'delivered');assert.deepEqual(row.provider_receipts,before);assert.equal(row.worker_id,'worker');
 }finally{f.clean();}
});
test('group cancellation retains shared revision budget bytes and does not release a charged original',async()=>{
 const f=await repairFixture();try{
  const scope={tenantId:'tenant',taskId:'repair',budgetTaskId:'content',runId:'repair-run',planHash:'a'.repeat(64)};
  const ledger=new SocialContentTaskBudget(f.budgetRoot,{authorization:async()=>({maximumCny:15,authorizationRef:'verified-original-order'}),quote:async()=>({upperBoundCny:2,quoteRef:'verified-price',validUntil:'2099-01-01T00:00:00Z'}),assertCurrent:async()=>{},verifyRejection:async()=>false});
  await ledger.reserveBatch(scope,[{operationId:'original-repair-request',fingerprint:'b'.repeat(64),provider:'seedance',model:'video',accountRef:'account',stage:'video',shotId:'shot'}]);
  const before=ledger.status(scope),result=await f.groupCancel();
  assert.equal(result.quotaReleased,false);assert.equal(result.externalSettlementPending,true);assert.ok(result.retainedReasons.includes('paid'));
  assert.deepEqual(ledger.status(scope),before);assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
  assert.equal(f.child.status,'cancelled');assert.equal(f.task.status,'cancelled');
 }finally{f.clean();}
});
test('group projection crash recovers frozen participants without releasing historical quota or losing child history',async()=>{
 const f=await repairFixture();try{
  const original=f.store.compareAndSwap;let crash=true;
  f.store.compareAndSwap=async(c:string,id:string,e:any,p:any)=>{if(crash&&c==='starter_social_content_tasks'&&id==='task'&&p.content_order?.cancellation?.result){crash=false;throw Error('simulated-root-projection-crash');}return original(c,id,e,p);};
  await assert.rejects(f.groupCancel(),/simulated-root-projection-crash/);
  assert.equal(f.task.status,'cancelling');assert.equal(f.child.status,'cancelled');assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');
  const result=await f.groupCancel();assert.equal(result.participants.length,2);assert.equal(result.quotaReleased,false);
  assert.equal((await f.quota.read(f.scope))!.audit.filter(a=>a.action==='released').length,0);
  assert.equal(f.table('starter_social_content_operations').filter(o=>o.operation==='cancel_social_content_order').length,1);
  assert.equal(f.tables.workflow_runs[0].status,'completed');
 }finally{f.clean();}
});
test('terminal historical jobs with missing start and accounting evidence never release the original slot',async()=>{
 for(const status of ['succeeded','dead_letter']){
  const f=await fixture();try{
   const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'legacy-run',taskType:'social_content_instant'});
   const row=f.table('content_execution_jobs').find(j=>j.id===job.id);Object.assign(row,{status,attempt:0,last_started_at:'',provider_receipts:[]});
   const result=await f.cancel();assert.equal(result.quotaReleased,false);assert.ok(result.retainedReasons.includes('unknown'));
   assert.equal((await f.quota.read(f.scope))!.orders.content.state,'reserved');assert.equal(row.status,status);
  }finally{f.clean();}
 }
});
test('changed group since preview and tampered frozen child dispatch fail before any stop fence',async()=>{
 const f=await repairFixture();try{
  await assert.rejects(f.groupCancel({expectedGroupHash:socialContentCancellationGroupHash('content',[])}),/group_changed/);
  assert.equal(f.task.status,'draft');assert.equal(f.child.status,'draft');
  f.child.content_order.dispatch.queueRequest.input='mutated-after-preview';
  await assert.rejects(f.groupCancel({idempotencyKey:'changed-dispatch'}),/participant_dispatch_invalid/);
  assert.equal(f.task.status,'draft');assert.equal(f.child.status,'draft');
 }finally{f.clean();}
});
test('background resumes delivered root group despite preserved completed status and expired child execution deadline',async()=>{
 const f=await repairFixture();try{
  f.task.status='completed';f.order.state='delivered';f.order.deliveryRef='historical-real-delivery';
  const scheduler=await acquireDurableOperationLease({dataStore:f.store,tenantId:'__system__',scope:'content_queue_scheduler',subjectId:'global',ownerId:'busy',leaseDurationMs:60000});
  await assert.rejects(f.groupCancel({now:new Date('2026-10-20T02:00:00Z')}),/scheduler_busy/);
  assert.equal(f.task.status,'completed');assert.equal(f.child.status,'cancelling');
  await releaseDurableOperationLease({dataStore:f.store,lease:scheduler!});
  assert.deepEqual(await recoverPendingSocialContentOrderCancellations({repository:f.repository,budgetRoot:f.budgetRoot,now:new Date('2026-10-20T02:00:00Z')}),{recovered:1,failed:0,truncated:false});
  assert.equal(f.task.status,'completed');assert.equal(f.child.status,'cancelled');assert.equal((await f.quota.read(f.scope))!.orders.content.deliveryRef,'historical-real-delivery');
 }finally{f.clean();}
});
test('post-delivery awaiting_metrics root preserves its lifecycle and quota receipt when revision group stops',async()=>{
 const f=await repairFixture();try{
  f.task.status='awaiting_metrics';f.order.state='delivered';f.order.deliveryRef='historical-published-delivery';
  const result=await f.groupCancel();
  assert.equal(result.status,'awaiting_metrics');assert.equal(result.quotaReleased,false);
  assert.equal(result.participants.find((p:any)=>p.taskId==='content').preservedStatus,'awaiting_metrics');
  assert.equal(f.task.status,'awaiting_metrics');assert.equal(f.child.status,'cancelled');
  const order=(await f.quota.read(f.scope))!.orders.content;
  assert.equal(order.state,'delivered');assert.equal(order.deliveryRef,'historical-published-delivery');
  assert.equal(f.tables.workflow_runs[0].status,'completed');assert.equal(f.table('content_execution_jobs')[0].status,'succeeded');
 }finally{f.clean();}
});
test('real HTTP group preview, stale scope refusal, explicit cancel and historical readback use the same root order',async t=>{
 const f=await repairFixture();t.after(f.clean);
 f.tables.social_programs=[{id:'program',tenant_id:'tenant',program_id:'program'}];
 f.task.status='awaiting_metrics';f.order.state='delivered';f.order.deliveryRef='original-delivery';
 f.task.brief={...f.task.brief,title:'原始产品视频'} as any;f.child.brief.title='开场修订';
 const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'repair',runId:'repair-running',taskType:'social_content_instant'});
 const jobRow=f.table('content_execution_jobs').find(j=>j.id===job.id);Object.assign(jobRow,{status:'reconciling',attempt:1,provider_state:'unknown',provider_receipts:[{provider:'seedance',requestId:'unchanged-original',state:'unknown'}]});
 const app=express();app.use(express.json());
 app.use(createSocialContentOrderOperationsRouter({repository:f.repository,budgetRoot:f.budgetRoot,now:()=>f.now,authorize:async()=>({tenantId:'tenant',userId:'owner'})}));
 const server=app.listen(0);t.after(()=>server.close());const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}`;
 const preview=await (await fetch(`${base}/tasks/content/order-planning`)).json();
 assert.equal(preview.cancelable,true);assert.equal(preview.cancelTarget.taskId,'content');
 assert.deepEqual(preview.cancelTarget.participants.map((p:any)=>p.title),['原始产品视频','开场修订']);
 const post=(expectedGroupHash:string,key:string)=>fetch(`${base}/tasks/content/cancel-order`,{method:'POST',headers:{'Content-Type':'application/json','idempotency-key':key},body:JSON.stringify({expectedVersion:preview.cancelTarget.taskVersion,expectedGroupHash,reason:'停止本条内容后续修订'})});
 assert.equal((await post('0'.repeat(64),'stale-preview-command')).status,409);assert.equal(f.child.status,'draft');
 const response=await post(preview.cancelTarget.groupHash,'confirmed-group-command');assert.equal(response.status,200);
 const outcome=(await response.json()).item;assert.equal(outcome.executionStopped,true);assert.equal(outcome.externalSettlementPending,true);assert.equal(outcome.quotaReleased,false);
 assert.equal(outcome.status,'awaiting_metrics');assert.equal(f.child.status,'cancelled');
 assert.deepEqual(jobRow.provider_receipts,[{provider:'seedance',requestId:'unchanged-original',state:'unknown'}]);
 const final=await (await fetch(`${base}/tasks/content/order-planning`)).json();
 assert.equal(final.cancelable,false);assert.equal(final.cancellationPending,false);assert.equal(final.cancellation.participants.length,2);
 assert.equal(final.cancellation.externalSettlementPending,true);assert.equal(final.cancelTarget.participants[0].status,'awaiting_metrics');
 assert.equal((await f.quota.read(f.scope))!.orders.content.deliveryRef,'original-delivery');
 assert.equal((await post(preview.cancelTarget.groupHash,'confirmed-group-command')).status,200);
});
test('repair job cannot resume after root cancellation even if child itself was not fenced',async()=>{
 const f=await fixture();try{
  const child={...structuredClone(f.task),id:'repair-row',task_id:'repair',status:'paused'};f.table('starter_social_content_tasks').push(child);
  const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'repair',runId:'repair-run',taskType:'social_content_instant'});
  await controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'pause'});
  f.task.status='cancelled';
  await assert.rejects(controlContentExecutionJob({dataStore:f.store,tenantId:'tenant',jobId:job.id,action:'resume'}),/order_cancelled_or_replaced/);
  assert.equal(f.table('content_execution_jobs')[0].status,'paused');
 }finally{f.clean();}
});

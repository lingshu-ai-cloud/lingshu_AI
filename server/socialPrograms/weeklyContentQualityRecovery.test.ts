import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyQualityRecoveryFixture,prepareWeeklyHardQualityRepairFixture} from './weeklyContentQualityRecovery.fixture.js';
import {createWeeklyContentQualityRecoveryService,WEEKLY_QUALITY_REVIEW_BLOCK} from './weeklyContentQualityRecovery.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {SocialProgramError} from './service.js';
import {acquireDurableOperationLease,releaseDurableOperationLease} from '../runtime/durableLease.js';

test('actual G4/G5 recovery clears only original quality blocker and persists an idempotent readonly receipt without production',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 const before=await f.service.context(f.scope,'owner');assert.equal(before.consumers[0]!.resumeAvailable,false);
 const requestId='quality-recovery-explicit-0001';
 await assert.rejects(f.service.resume(f.scope,'owner',{executionTaskId:f.task.taskId,requestId,expectedContextHash:before.consumers[0]!.contextHash}));
 await f.completeG5();const ready=await f.service.context(f.scope,'owner');assert.equal(ready.consumers[0]!.resumeAvailable,true);
 const body={executionTaskId:f.task.taskId,requestId,expectedContextHash:ready.consumers[0]!.contextHash};
 const result=await f.service.resume(f.scope,'owner',body);assert.ok(result.item);assert.equal(result.task.taskId,f.task.taskId);assert.equal(result.task.status,'queued');assert.deepEqual(result.task.resultRefs,[]);assert.equal(result.task.schedule.actualFinishedAt,null);assert.equal(result.task.lastError,null);assert.equal(result.currentSourceVerified,true);
 const {recordHash,...receipt}=result.item;assert.equal(recordHash,socialRequestHash(receipt));
 const restart=createWeeklyContentQualityRecoveryService(f.store);assert.deepEqual((await restart.read(f.scope,'owner',f.task.taskId,requestId)).item,result.item);assert.deepEqual((await restart.resume(f.scope,'owner',body)).item,result.item);
 assert.equal(f.current().qualityRecoveries!.length,1);assert.equal(f.tables.starter_social_content_tasks!.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
 await assert.rejects(restart.resume(f.scope,'owner',{...body,expectedContextHash:'0'.repeat(64)}));
 f.pkg.status='retired';const withdrawn=await restart.read(f.scope,'owner',f.task.taskId,requestId);assert.deepEqual(withdrawn.item,result.item);assert.equal(withdrawn.currentSourceVerified,false);
});

test('quality recovery retains all other own and real inherited blockers',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);await f.completeG5();
 const receipts=f.tables.starter_social_production_receipts!;f.tables.starter_social_production_receipts=receipts.filter(row=>row.gate!=='G4');assert.equal((await f.service.context(f.scope,'owner')).consumers[0]!.resumeAvailable,false);f.tables.starter_social_production_receipts=receipts;
 f.task.ownBlockingReasons.push('human_required_fact_review');f.task.dependsOnTaskIds=['upstream-real'];f.task.inheritedBlockingTaskIds=['upstream-real'];
 const upstream={...f.task,taskId:'upstream-real',status:'queued' as const,dependsOnTaskIds:[],inheritedBlockingTaskIds:[],ownBlockingReasons:[],idempotencyKey:'upstream-real'};
 f.tables.social_weekly_execution_tasks!.push({id:'upstream-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:upstream.taskId,payload:upstream});
 const ctx=await f.service.context(f.scope,'owner');const result=await f.service.resume(f.scope,'owner',{executionTaskId:f.task.taskId,requestId:'quality-recovery-other-blocks-0001',expectedContextHash:ctx.consumers.find(c=>c.executionTaskId===f.task.taskId)!.contextHash});
 assert.equal(result.task.status,'blocked');assert.deepEqual(result.task.ownBlockingReasons,['human_required_fact_review']);assert.deepEqual(result.task.inheritedBlockingTaskIds,['upstream-real']);assert.equal(result.task.ownBlockingReasons.includes(WEEKLY_QUALITY_REVIEW_BLOCK),false);
});

test('fresh scope, source audit, package withdrawal and actual task leases refuse recovery',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);await f.completeG5();
 await assert.rejects(f.service.context({...f.scope,tenantId:'foreign'},'owner'));await assert.rejects(f.service.context({...f.scope,runId:'foreign-run'},'owner'));
 for(const status of ['leased','succeeded','cancelled','dead_letter'] as const){f.task.status=status;assert.equal((await f.service.context(f.scope,'owner')).consumers[0]!.resumeAvailable,false);}f.task.status='blocked';
 f.task.lease={leaseId:'actual-lease',token:'actual-token',workerId:'worker',acquiredAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 assert.equal((await f.service.context(f.scope,'owner')).consumers[0]!.resumeAvailable,false);f.task.lease=null;
 const ready=(await f.service.context(f.scope,'owner')).consumers[0]!;f.profile.brand.tone='真实企业事实变化';
 await assert.rejects(f.service.resume(f.scope,'owner',{executionTaskId:f.task.taskId,requestId:'quality-recovery-stale-evidence-0001',expectedContextHash:ready.contextHash}));f.profile.brand.tone='专业简洁';
 f.pkg.status='retired';assert.equal((await f.service.context(f.scope,'owner')).consumers[0]!.resumeAvailable,false);
 await assert.rejects(f.service.resume(f.scope,'owner',{executionTaskId:f.task.taskId,requestId:'quality-recovery-revoked-0001',expectedContextHash:ready.contextHash}),error=>error instanceof SocialProgramError||error instanceof Error);
 assert.equal(f.current().qualityRecoveries?.length??0,0);
});

for(const failure of ['aggregate_update','aggregate_lease'] as const)test(`persisted quality recovery survives ${failure} failure and readonly original-request recovery`,async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);await f.completeG5();
 const downstream={...f.task,taskId:'actual-downstream-approval',workflowKind:'content' as const,dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[f.task.taskId],ownBlockingReasons:[],idempotencyKey:'actual-downstream-approval',schedule:{...f.task.schedule,stepKind:'user_approval' as const,responsibleActor:'user' as const}};
 f.tables.social_weekly_execution_tasks!.push({id:'downstream-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:downstream.taskId,payload:downstream});
 const ctx=await f.service.context(f.scope,'owner');const body={executionTaskId:f.task.taskId,requestId:`quality-recovery-${failure}-0001`,expectedContextHash:ctx.consumers[0]!.contextHash};
 const update=f.store.update;let rejectedUpdate=false;
 const lease=failure==='aggregate_lease'?await acquireDurableOperationLease({dataStore:f.store,tenantId:'t',scope:'social-weekly-execution-package',subjectId:'week1:1',ownerId:'actual-other-aggregate-worker',leaseDurationMs:30000}):null;
 if(failure==='aggregate_lease')assert.ok(lease);
 if(failure==='aggregate_update')f.store.update=async(collection,id,value)=>{if(collection==='social_weekly_execution_tasks'&&id==='downstream-row'){rejectedUpdate=true;return false;}return update(collection,id,value);};
 try{await assert.rejects(f.service.resume(f.scope,'owner',body));}finally{f.store.update=update;if(lease)await releaseDurableOperationLease({dataStore:f.store,lease});}
 if(failure==='aggregate_update')assert.equal(rejectedUpdate,true);
 assert.equal(f.current().status,'queued');assert.deepEqual(f.current().ownBlockingReasons,[]);assert.equal(f.current().qualityRecoveries!.length,1);assert.deepEqual(f.current().resultRefs,[]);assert.equal(f.current().schedule.actualFinishedAt,null);
 const restart=createWeeklyContentQualityRecoveryService(f.store),read=await restart.read(f.scope,'owner',f.task.taskId,body.requestId);assert.ok(read.item);assert.equal(read.currentSourceVerified,true);assert.equal(read.task.status,'queued');
 assert.deepEqual((await restart.resume(f.scope,'owner',body)).item,read.item);assert.equal(f.current().qualityRecoveries!.length,1);
 assert.equal(f.tables.starter_social_content_tasks!.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
});


test('hard-failed original artifact cannot be recovered by adding real audits to the same artifact',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture({hardFailure:true});t.after(f.cleanup);
 await f.completeG5();
 const context=await f.service.context(f.scope,'owner'),consumer=context.consumers.find(c=>c.executionTaskId===f.task.taskId);
 assert.ok(consumer);assert.equal(consumer.resumeAvailable,false);
 const body={executionTaskId:f.task.taskId,requestId:'hard-failure-original-artifact-0001',expectedContextHash:consumer.contextHash};
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(f.service.resume(f.scope,'owner',body));
 assert.equal(f.current().status,'blocked');assert.deepEqual(f.current().ownBlockingReasons,['weekly_quality_audit_actual_repair_required']);
 assert.equal(f.current().qualityRecoveries?.length??0,0);assert.deepEqual(f.current().resultRefs,[]);
 assert.equal(f.tables.starter_social_content_artifacts!.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('hard failure context identifies that a verified descendant repair artifact is required',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture({hardFailure:true});t.after(f.cleanup);await f.completeG5();
 const context=await f.service.context(f.scope,'owner'),consumer=context.consumers.find(c=>c.executionTaskId===f.task.taskId);assert.ok(consumer);
 // A passing audit of the original output is deliberately insufficient. The service
 // must expose the repair-parent requirement, rather than treating this as an unrelated blocker.
 assert.equal(consumer.gap?.code,'weekly_quality_recovery_repair_artifact_required');
});


test('actual locally rendered child with fresh G4/G5 repairs the original hard-blocked quality task idempotently',async t=>{
 const f=await prepareWeeklyHardQualityRepairFixture();t.after(f.cleanup);
 assert.equal((await f.service.context(f.childScope,'owner')).consumers[0]!.resumeAvailable,false);
 await f.auditChildG4();
 // Original G5 cannot be borrowed by the new artifact: no child audit has been submitted.
 assert.equal((await f.service.context(f.childScope,'owner')).consumers[0]!.resumeAvailable,false);
 await f.auditChildG5();const ctx=await f.service.context(f.childScope,'owner'),consumer=ctx.consumers.find(c=>c.executionTaskId===f.task.taskId);assert.ok(consumer);assert.equal(consumer.resumeAvailable,true);
 const body={executionTaskId:f.task.taskId,requestId:'actual-child-hard-recovery-0001',expectedContextHash:consumer.contextHash};
 const resumed=await f.service.resume(f.childScope,'owner',body);assert.ok(resumed.item);assert.equal(resumed.item.clearedBlocker,'weekly_quality_audit_actual_repair_required');assert.deepEqual(resumed.item.repairParentArtifactRef,{type:'starter_social_content_artifact',id:'artifact',version:1});assert.equal(resumed.task.status,'queued');assert.equal(resumed.task.taskId,f.task.taskId);assert.deepEqual(resumed.task.resultRefs,[]);
 const count=f.supplierCalls();assert.deepEqual((await f.service.resume(f.childScope,'owner',body)).item,resumed.item);assert.equal(f.supplierCalls(),count);assert.equal(count,1);assert.equal(f.tables.content_execution_jobs!.length,1);assert.equal(f.current().qualityRecoveries!.length,1);
 assert.equal(f.tables.starter_social_content_tasks![0]!.run_id,'run');assert.notEqual(f.childScope.runId,'run');
});


test('real audited repair child cannot recover quality after its actual parent header is forged',async t=>{
 const f=await prepareWeeklyHardQualityRepairFixture();t.after(f.cleanup);await f.auditChildG4();await f.auditChildG5();
 const ctx=await f.service.context(f.childScope,'owner'),consumer=ctx.consumers.find(c=>c.executionTaskId===f.task.taskId);assert.ok(consumer);assert.equal(consumer.resumeAvailable,true);
 const child=f.tables.starter_social_content_artifacts!.find(row=>row.artifact_id===f.result.artifactId);assert.ok(child);
 const actualParent=child.parent_artifact_id;child.parent_artifact_id='unrelated-artifact';
 const body={executionTaskId:f.task.taskId,requestId:'actual-child-wrong-parent-0001',expectedContextHash:consumer.contextHash};
 await assert.rejects(f.service.resume(f.childScope,'owner',body));
 assert.equal(f.current().status,'blocked');assert.equal(f.current().qualityRecoveries?.length??0,0);assert.deepEqual(f.current().ownBlockingReasons,['weekly_quality_audit_actual_repair_required']);
 assert.equal(f.supplierCalls(),1);child.parent_artifact_id=actualParent;
});

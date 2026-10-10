import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyG6Fixture} from '../starter198/socialWeeklyG6ReviewService.fixture.js';
import {createSocialWeeklyProductionAdapter} from '../runtime/socialWeeklyProductionAdapter.js';
import {createSocialWeeklyPublicationAdapter} from '../runtime/socialWeeklyPublicationAdapter.js';
import {createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {runWeeklyPublicationPackageScan} from './weeklyPublicationWorker.js';
import {runWeeklyPublicationExecutionScan} from './weeklyPublicationExecutionWorker.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import type {WeeklyPublishingProviderAdapter} from './weeklyLineage.js';

test('actual formal approved production cannot fallback when its consumer is missing or corrupt; existing unknown only reconciles',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-02T12:00:00Z')});const f=await prepareWeeklyG6Fixture();t.after(f.cleanup);
 f.pkg.workflowTasks.push({taskId:'actual-publishing-workflow',kind:'publishing',taskRef:{type:'weekly_workflow_task',id:'actual-publishing-workflow',version:1},dependsOnTaskIds:['content-workflow'],subjectRefs:[{type:'weekly_publication_task',id:'pub',version:1}],status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[],carriedFromTaskId:null});
 const ctx=await f.service.context(f.scope,'owner');await f.service.check(f.scope,'owner',{programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,requestId:'formal-scan-g6-pass-0001',expectedContextHash:ctx.contextHash});
 assert.equal((await createSocialWeeklyProductionAdapter(f.store,{start:async()=>{throw Error('no new production');},create:async()=>{throw Error('no duplicate production');}}).execute(f.task)).status,'succeeded');
 const dependency:WeeklyExecutionTask={...f.task,taskId:'formal-quality-completed',status:'succeeded',dependsOnTaskIds:[],inheritedBlockingTaskIds:[],ownBlockingReasons:[],resultRefs:[f.ref],inputSnapshot:{}};
 const approval:WeeklyExecutionTask={...dependency,taskId:'formal-final-approval',status:'blocked',dependsOnTaskIds:[dependency.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 const row=(task:WeeklyExecutionTask)=>({id:task.taskId,tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,payload:task});
 f.tables.social_weekly_execution_tasks=[row(dependency),row(approval)];f.tables.starter_social_content_tasks![0]!.weekly_plan_id=f.pkg.packageId;
 await createWeeklyExecutionTaskService(f.store).approve('t','p','week1',approval.taskId,'owner');assert.equal(f.artifact.status,'approved');
 const packages=await runWeeklyPublicationPackageScan({dataStore:f.store,tenantId:'t',taskId:'content'});assert.equal(packages.createdAssignments,1);assert.deepEqual(packages.errors,[]);
 const approvedGraph=structuredClone(f.tables.social_weekly_execution_tasks);
 let posts=0,lookups=0;const provider:WeeklyPublishingProviderAdapter={provider:'controlled-formal-boundary',platform:'tiktok',capability:'available',async publish(){posts++;return {status:'accepted',providerReceiptId:'actual-original-request'};},async reconcile(){lookups++;return {status:'published',providerReceiptId:'actual-original-request',platformPostId:'actual-original-post'};}};
 f.tables.social_weekly_execution_tasks=[];
 let scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,adapterFactory:async()=>provider});assert.ok(scan.errors.some(e=>e.code==='weekly_formal_publishing_consumer_missing'),JSON.stringify(scan));assert.equal(posts,0);assert.equal(lookups,0);assert.equal((f.tables.social_publication_attempts??[]).length,0);
 const publishing:WeeklyExecutionTask={...dependency,taskId:'formal-publishing',workflowKind:'publishing',status:'queued',dependsOnTaskIds:[approval.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'publishing',responsibleActor:'publishing_agent'}};
 f.tables.social_weekly_execution_tasks=[{...row(publishing),payload:{...publishing,tenantId:'foreign-tenant'}}];scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,adapterFactory:async()=>provider});assert.ok(scan.errors.some(e=>e.code==='weekly_formal_consumer_scope_invalid'),JSON.stringify(scan));assert.equal(posts,0);
 f.tables.social_weekly_execution_tasks=[...approvedGraph!,row(publishing)];scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,adapterFactory:async()=>provider});assert.equal(scan.skipped,1);assert.equal(posts,0);
 const first=await createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider}).execute(publishing);assert.equal(first.status,'pending',JSON.stringify(first));assert.equal(first.code,'publication_receipt_reconciliation_pending');assert.equal(posts,1);assert.equal(f.tables.social_publication_attempts![0]!.status,'unknown');
 f.tables.social_weekly_execution_tasks=[];
 const assignment=f.tables.social_publication_assignments![0]!,payload=assignment.payload as Record<string,unknown>;
 for(const [object,key,value] of [[payload,'accountId','foreign-account'],[payload,'tenantId','foreign-tenant'],[f.pkg,'programId','foreign-program'],[f.pkg,'packageId','foreign-package']] as Array<[Record<string,unknown>,string,string]>){const original=object[key];object[key]=value;scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,adapterFactory:async()=>provider});assert.ok(scan.errors.some(e=>e.code==='weekly_publication_assignment_scope_invalid'),JSON.stringify(scan));assert.equal(posts,1);assert.equal(lookups,0);object[key]=original;}
 // Observing the original provider request stays legal after this week's authorization is withdrawn.
 f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.revokedBy='owner';f.pkg.socialContentPackage.authorization.revokedAt='2026-10-02T12:01:00Z';
 scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,adapterFactory:async()=>provider});assert.deepEqual(scan.errors,[]);assert.equal(scan.published,1);assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts!.length,1);
});

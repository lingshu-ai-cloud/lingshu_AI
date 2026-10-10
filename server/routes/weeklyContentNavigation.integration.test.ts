import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDefaultPublication} from '../runtime/weeklyDefaultPublication.fixture.js';
import express from 'express';
import {createSocialProgramsRouter} from './socialPrograms.js';
import {parseWeeklyContentNavigation,weeklyContentNavigationDetail} from '../../src/lib/weeklyContentNavigationApi.js';
import {createTikTokWeeklyPublishingAdapter} from '../publishing/tiktokWeeklyPublishingAdapter.js';
import {createSocialWeeklyPublicationAdapter} from '../runtime/socialWeeklyPublicationAdapter.js';
import {runSocialWeeklyExecutionScan} from '../runtime/socialWeeklyExecutionRuntime.js';
import {getWeeklyExecutionTaskRow,writeWeeklyExecutionTask} from '../socialPrograms/executionTasks.js';
import {refreshPlatformCapabilityEvidence} from '../publishing/platformCapabilities.js';

test('actual completed content, approval and publishing tasks share verified original owned production navigation',async t=>{
 const {f,publishing,assignment}=await prepareDefaultPublication(t);
 for(const row of f.tables.social_weekly_execution_tasks!){const task=row.payload as typeof publishing;row.status=task.status;row.created_at=task.createdAt??new Date().toISOString();}
 const actual=await getWeeklyExecutionTaskRow(f.store,'t',publishing.taskId);await writeWeeklyExecutionTask(f.store,actual,{...actual.payload,schedule:{...actual.payload.schedule,estimatedStartAt:'2026-10-02T11:00:00Z',estimatedFinishAt:'2026-10-02T13:00:00Z'},nextAttemptAt:null});
 let posts=0,lookups=0;const provider=await createTikTokWeeklyPublishingAdapter({tenantId:'t',accountId:assignment.account_id,dataStore:f.store,ports:{async publish(){posts++;return {video:{},tracking:{id:'nav',tenant_id:'t',platform:'tiktok',track_code:'nav'},publishRecord:null,platformPostId:'',providerReceiptId:'navigation-original',deliveryStatus:'provider_accepted'};},async reconcile(input){lookups++;return {status:'published',providerReceiptId:input.providerReceiptId,platformPostId:'navigation-post',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}}});
 const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider});
 assert.equal((await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{publishing:adapter},maxTasksPerTenant:1,now:new Date()})).pending,1);
 await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:assignment.account_id,platform:'tiktok',capability:'publishing.receipt_lookup',receiptId:'navigation-original',dataStore:f.store,providers:{async youtube(){throw Error('unused');},async facebook(){throw Error('unused');},async instagram(){throw Error('unused');},async tiktok(){throw Error('unused');},async tiktokReceipt(){return {publishId:'navigation-original'};}}});
 t.mock.timers.tick(31000);assert.equal((await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{publishing:adapter},maxTasksPerTenant:1,now:new Date()})).succeeded,1);
 const app=express();app.use((_req,res,next)=>{res.locals.tenantId=_req.header('x-test-tenant')??'t';res.locals.userId='owner';next();});app.use('/api/overseas/social-programs',createSocialProgramsRouter(f.store,false));const server=app.listen(0);await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));const address=server.address();assert.ok(address&&typeof address==='object');
 const base=`http://127.0.0.1:${address.port}/api/overseas/social-programs`;
 const read=async(scope:{tenantId:string;programId:string;packageId:string;packageVersion:number;executionTaskId:string})=>{const response=await fetch(`${base}/${scope.programId}/operating-packages/${scope.packageId}/execution-tasks/${scope.executionTaskId}/production-navigation?version=${scope.packageVersion}`);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return parseWeeklyContentNavigation((await response.json()).item,scope);};
 for(const taskId of ['actual-quality-completed','actual-final-human-approval',publishing.taskId]){
 const scope={tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,executionTaskId:taskId};
 const binding=await read(scope);
 assert.equal(binding.contentTaskId,'content');assert.equal(binding.runId,'run');assert.equal(binding.artifactRef?.id,'artifact');assert.equal(binding.source,'completed_artifact');assert.deepEqual(binding.gaps,[]);const detail=weeklyContentNavigationDetail(binding);assert.equal(detail.socialContentTaskId,'content');assert.deepEqual(detail.weeklyContentTarget,binding);
 }
 for(const [program,version,tenant] of [['foreign-program',1,'t'],['p',2,'t'],['p',1,'foreign-tenant']] as const){const response=await fetch(`${base}/${program}/operating-packages/week1/execution-tasks/${publishing.taskId}/production-navigation?version=${version}`,{headers:{'x-test-tenant':tenant}});assert.notEqual(response.status,200);}
 const stored=f.tables.social_weekly_execution_tasks!.find(row=>row.task_id===publishing.taskId)!;const payload=stored.payload as typeof publishing;
 for(const field of ['accountId','publicationTaskId'] as const){const old=payload[field];payload[field]='foreign-identity';try{const response=await fetch(`${base}/p/operating-packages/week1/execution-tasks/${publishing.taskId}/production-navigation?version=1`);assert.notEqual(response.status,200);}finally{payload[field]=old;}}
 const originalRun=f.tables.workflow_runs!.find(row=>row.id==='run')!;const oldTenant=originalRun.tenant_id;originalRun.tenant_id='foreign-tenant';try{const response=await fetch(`${base}/p/operating-packages/week1/execution-tasks/${publishing.taskId}/production-navigation?version=1`);assert.notEqual(response.status,200);}finally{originalRun.tenant_id=oldTenant;}
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,1);assert.equal(posts,1);assert.equal(lookups,1);
});

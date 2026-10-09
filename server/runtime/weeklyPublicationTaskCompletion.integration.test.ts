import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDefaultPublication} from './weeklyDefaultPublication.fixture.js';
import {createTikTokWeeklyPublishingAdapter} from '../publishing/tiktokWeeklyPublishingAdapter.js';
import {refreshPlatformCapabilityEvidence} from '../publishing/platformCapabilities.js';
import {createSocialWeeklyPublicationAdapter} from './socialWeeklyPublicationAdapter.js';
import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';
import {getWeeklyExecutionTaskRow,writeWeeklyExecutionTask} from '../socialPrograms/executionTasks.js';
import {projectExecutionCalendar} from '../../src/components/socialProgram/weeklyExecutionCalendar.js';
import {STEP_LABEL} from '../../src/components/socialProgram/weeklyExecutionLabels.js';

test('actual weekly scan defers original unknown then completes same default-provider attempt and calendar card',async t=>{
 const {f,assignment,publishing}=await prepareDefaultPublication(t);
 for(const row of f.tables.social_weekly_execution_tasks!){const task=row.payload as typeof publishing;row.status=task.status;row.created_at=task.createdAt??new Date().toISOString();}
 const taskRow=await getWeeklyExecutionTaskRow(f.store,'t',publishing.taskId);
 await writeWeeklyExecutionTask(f.store,taskRow,{...taskRow.payload,schedule:{...taskRow.payload.schedule,estimatedStartAt:'2026-10-02T11:00:00Z',estimatedFinishAt:'2026-10-02T13:00:00Z',latestFinishAt:'2026-10-02T13:00:00Z'},nextAttemptAt:null});
 let posts=0,lookups=0;
 const provider=await createTikTokWeeklyPublishingAdapter({tenantId:'t',accountId:assignment.account_id,dataStore:f.store,ports:{
 async publish(){posts++;return {video:{},tracking:{id:'scan-tracking',tenant_id:'t',platform:'tiktok',track_code:'scan'},publishRecord:null,platformPostId:'',providerReceiptId:'scan-original-receipt',deliveryStatus:'provider_accepted'};},
 async reconcile(input){lookups++;assert.equal(input.providerReceiptId,'scan-original-receipt');return {status:'published',providerReceiptId:input.providerReceiptId,platformPostId:'scan-original-post',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}}});
 const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider});
 const first=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{publishing:adapter},maxTasksPerTenant:1,now:new Date()});
 assert.equal(first.pending,1,JSON.stringify({first,tasks:f.tables.social_weekly_execution_tasks}));assert.equal(posts,1);
 const deferred=(await getWeeklyExecutionTaskRow(f.store,'t',publishing.taskId)).payload;assert.equal(deferred.status,'queued');assert.deepEqual(deferred.resultRefs,[]);assert.equal(deferred.schedule.actualFinishedAt??null,null);
 const originalAttempt=f.tables.social_publication_attempts![0]!.attempt_id;
 await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:assignment.account_id,platform:'tiktok',capability:'publishing.receipt_lookup',receiptId:'scan-original-receipt',dataStore:f.store,providers:{async youtube(){throw Error('unused');},async facebook(){throw Error('unused');},async instagram(){throw Error('unused');},async tiktok(){throw Error('unused');},async tiktokReceipt(){return {publishId:'scan-original-receipt'};}}});
 t.mock.timers.tick(31000);const finishedAt=new Date().toISOString();
 const second=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{publishing:adapter},maxTasksPerTenant:1,now:new Date()});
 assert.equal(second.succeeded,1,JSON.stringify({second,tasks:f.tables.social_weekly_execution_tasks}));
 const completed=(await getWeeklyExecutionTaskRow(f.store,'t',publishing.taskId)).payload;
 assert.equal(completed.status,'succeeded');assert.equal(completed.schedule.actualFinishedAt,finishedAt);assert.ok(completed.resultRefs.some(ref=>ref.id===originalAttempt));assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts!.length,1);
 const cards=projectExecutionCalendar([completed],STEP_LABEL);assert.equal(cards.length,1);assert.equal(cards[0]!.status,'completed');assert.equal(cards[0]!.actualFinishedAt,finishedAt);
});

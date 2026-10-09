import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDefaultPublication} from '../runtime/weeklyDefaultPublication.fixture.js';
import {createSocialWeeklyPublicationAdapter} from '../runtime/socialWeeklyPublicationAdapter.js';
import {createTikTokWeeklyPublishingAdapter} from './tiktokWeeklyPublishingAdapter.js';
import {refreshPlatformCapabilityEvidence} from './platformCapabilities.js';
import {reconcileWeeklyCancellation} from '../socialPrograms/weeklyCancellation.js';
import {runWeeklyPublicationExecutionScan} from './weeklyPublicationExecutionWorker.js';

for (const originalStatus of ['unknown', 'in_flight'] as const) test(`actual cancellation preserves ${originalStatus} receipt and automatic scan only reconciles original request`, async t => {
 const {f,assignment,publishing}=await prepareDefaultPublication(t);
 let posts=0,gets=0;
 const ports={async publish(){posts++;return {video:{},tracking:{id:'scan-tracking',tenant_id:'t',platform:'tiktok',track_code:'scan'},publishRecord:null,platformPostId:'',providerReceiptId:'actual-cancel-scan-receipt',deliveryStatus:'provider_accepted' as const};},async reconcile(input:{providerReceiptId:string}){gets++;assert.equal(input.providerReceiptId,'actual-cancel-scan-receipt');return {status:'published' as const,providerReceiptId:input.providerReceiptId,platformPostId:'actual-cancel-scan-post',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}};
 const provider=await createTikTokWeeklyPublishingAdapter({tenantId:'t',accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports});
 const submitted=await createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider}).execute(publishing);
 assert.equal(submitted.status,'pending');assert.equal(posts,1);
 const attempt=f.tables.social_publication_attempts![0]!;attempt.status=originalStatus;const originalId=attempt.id;
 await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:assignment.account_id,platform:'tiktok',capability:'publishing.receipt_lookup',receiptId:'actual-cancel-scan-receipt',dataStore:f.store,providers:{async youtube(){throw Error('unused');},async facebook(){throw Error('unused');},async instagram(){throw Error('unused');},async tiktok(){throw Error('unused');},async tiktokReceipt(_token,id){return {publishId:id};}}});
 const receipt=await reconcileWeeklyCancellation({dataStore:f.store,tenantId:'t',programId:'p',packageId:f.pkg.packageId,packageVersion:f.pkg.version,reason:'user-withdrawal',now:new Date().toISOString(),cancelPending:async()=>{for(const row of f.tables.social_weekly_execution_tasks!) {const task=row.payload as typeof publishing;if(task.taskId===publishing.taskId)task.status='cancelled';}}});
 assert.equal(assignment.status,'revoked');assert.equal((assignment as unknown as Record<string,unknown>).receipt_recovery_required,true);
 const effects=JSON.stringify(receipt.effects);f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.allowRealPublishing=false;
 const scan=await runWeeklyPublicationExecutionScan({dataStore:f.store,limit:1,now:new Date(),adapterFactory:async row=>createTikTokWeeklyPublishingAdapter({tenantId:row.tenant_id,accountId:row.account_id,dataStore:f.store,now:new Date(),purpose:'receipt_lookup',providerReceiptId:'actual-cancel-scan-receipt',ports})});
 assert.deepEqual(scan.errors,[]);assert.equal(scan.published,1);assert.equal(posts,1);assert.equal(gets,1);
 assert.equal(attempt.id,originalId);assert.equal(attempt.status,'published');assert.equal(assignment.status,'revoked');assert.equal((assignment as unknown as Record<string,unknown>).receipt_recovery_required,false);
 assert.equal(f.pkg.socialContentPackage.authorization.allowRealPublishing,false);assert.equal(publishing.status,'cancelled');assert.equal(JSON.stringify(receipt.effects),effects);
 await runWeeklyPublicationExecutionScan({dataStore:f.store,limit:1,adapterFactory:async()=>{throw Error('terminal recovery must not instantiate provider');}});assert.equal(posts,1);assert.equal(gets,1);
});

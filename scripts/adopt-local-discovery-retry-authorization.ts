/** Adopt this chat's explicit, one-time authorization only. This script does
 * not connect consumers, scan tasks, call providers or change task/run states. */
import '../server/loadEnvironment.js';
import assert from 'node:assert/strict';
import {store} from '../server/storage/index.js';
import {runWithDataAuthority} from '../server/storage/dataAuthority.js';
import {recordCollectionRetryGrant} from '../server/socialDiscovery/collectionRetryGrant.js';
import {collectionBusinessDate} from '../server/socialDiscovery/dailyCollectionQuota.js';
import {socialRequestHash} from '../server/starter198/socialContentValidation.js';
import type {SocialInspirationCollectionRun} from '../shared/contracts/socialContentWorkflow.js';
assert.equal(process.env.LINGSHU_LOCAL_PREVIEW,'1','explicit local data domain required');
await runWithDataAuthority('local',async()=>{
 const tenantId='local_tenant_preview_beauty_showcase_local_test';
 const parentRunId='weekly_discovery_6dfd2936fb46632c36009109dbb5e3bdb0d9a405227cd41e90a4dface4eda8ae';
 const rows=await store.list<SocialInspirationCollectionRun>('social_discovery_runs',{where:{tenant_id:tenantId,runId:parentRunId},perPage:2});
 assert.equal(rows.totalItems,1,'original failed run must be unique');
 const now=new Date();assert.equal(collectionBusinessDate(now),'2026-10-16','one-time authorization cannot silently roll into another day');
 const grant=await recordCollectionRetryGrant(store,{tenantId,programId:'7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',packageId:'f839bcd8-af1e-4068-a229-08e245a6b0ca',packageVersion:2,taskId:'wet_3b1b85a4f0656462ab9d039c',parentRunId,parentRunHash:socialRequestHash(rows.items[0]),count:10,businessDate:collectionBusinessDate(now),actorUserId:'local_user_preview_beauty_showcase_local_test',authorizedAt:now.toISOString(),authorizationRef:'codex-thread:01a13e58-b62c-7bf2-ac77-b7d7e57215cf:2026-10-16:one-time-extra-10',authorizationText:'用户明确选择“仅本次额外允许最多10条”，并再次要求“把本次额外10条授权接入并留痕”；仅针对本次已核验402拒绝来源，不授予发布、消息发送或其他生产许可。'});
 console.log(JSON.stringify({operation:'adopt-explicit-retry-authorization',grantId:grant.grantId,count:grant.count,businessDate:grant.businessDate,packageVersion:grant.packageVersion,parentRunId:grant.parentRunId,source:grant.source,taskStatesModified:false,providerCalled:false}));
});

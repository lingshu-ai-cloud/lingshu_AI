/** Configuration adoption from an explicit human choice, not task execution.
 * No scan, provider request, download or task-state mutation is invoked. */
import '../server/loadEnvironment.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {store} from '../server/storage/index.js';
import {runWithDataAuthority} from '../server/storage/dataAuthority.js';
import {getQwenProviderBinding} from '../server/agents/qwen.js';
import {recordCandidateModelRevision} from '../server/runtime/weeklyCandidateModelRevision.js';
import type {WeeklyPreproductionRetryAttempt} from '../server/runtime/weeklyPreproductionRetryAttempts.js';
assert.equal(process.env.LINGSHU_LOCAL_PREVIEW,'1','explicit local data authority required');
await runWithDataAuthority('local',async()=>{
 const row=await store.getById<{payload:WeeklyPreproductionRetryAttempt}>('social_weekly_preproduction_retry_attempts','2d044cbcba38332');
 const job=row?.payload;assert.ok(job);
 assert.equal(job.packageId,'f839bcd8-af1e-4068-a229-08e245a6b0ca');assert.equal(job.packageVersion,2);
 assert.equal(job.tenantId,'local_tenant_preview_beauty_showcase_local_test');
 const binding=getQwenProviderBinding(),mediaRoot=fileURLToPath(new URL('../data/media/',import.meta.url));
 assert.equal(new URL(binding.baseUrl).origin,'https://dashscope.aliyuncs.com');
 const revision=await recordCandidateModelRevision(store,job,{configuration:{endpoint:binding.baseUrl,model:'qwen3-vl-plus',credentialDigest:binding.credentialSha256},candidateIds:['trend_videos_0102c45cfb56465ab73dca7c3c3cb23d','trend_videos_01fdad211d0749febd1095545846ea3c','trend_videos_3b17b0fb08964adc9897b154355af7fa','trend_videos_71680deb85134ece87862f02282c2af2'],actorUserId:'local_user_preview_beauty_showcase_local_test',authorizationRef:'codex-thread:01a13e58-b62c-7bf2-ac77-b7d7e57215cf:2026-10-16:explicit-reference-plus',authorizationText:'用户明确选择“允许改用并验证 qwen3-vl-plus”；仅针对本次原404失败的参考视频分析，复用已下载媒体，保留旧失败、费用及未知回执，不重新采集、不授予成片验收或发布权限。',authorizedAt:new Date().toISOString()},path.resolve(mediaRoot));
 console.log(JSON.stringify({operation:'adopt-explicit-reference-model-revision',revisionId:revision.revisionId,model:revision.configuration.model,candidates:revision.candidateProofs.length,providerCalled:false,taskStatesModified:false,globalModelConfigurationModified:false}));
});

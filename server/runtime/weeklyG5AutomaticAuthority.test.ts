import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDirectorG5Fixture,g5FixtureScope,passedDirectorChecks} from '../starter198/socialDirectorG5ReviewService.fixture.js';
import {advanceWeeklyAutomaticG5,assertWeeklyG5RuntimeMatchesOriginalHold,readWeeklyG5AutomaticAuthority,weeklyG5HistoricalTimeValid} from './weeklyG5AutomaticAuthority.js';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {WEEKLY_AUTOMATIC_PRODUCTION_INTENTS} from '../socialPrograms/weeklyAutomaticProductionPlanning.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

test('weekly G5 runtime cannot exchange the original film model held under ten yuan',()=>{
 assert.doesNotThrow(()=>assertWeeklyG5RuntimeMatchesOriginalHold('qwen3-vl-plus','qwen3-vl-plus'));
 assert.throws(()=>assertWeeklyG5RuntimeMatchesOriginalHold('qwen3-vl-flash','qwen3-vl-plus'),/runtime_model_changed/);
});

test('historical G5 read requires an original-week authorization after its run began and an actual post-week observation',()=>{
 const authorized='2026-10-16T08:00:00Z',started='2026-10-16T07:00:00Z',observed='2026-10-19T00:00:00Z';
 assert.equal(weeklyG5HistoricalTimeValid(authorized,started,observed,'2026-10-18'),true);
 for(const [auth,run,seen] of [
  ['2026-10-16T06:59:59Z',started,observed],
  ['2026-10-19T00:00:00Z',started,observed],
  [authorized,started,'2026-10-18T15:59:59Z'],
  [authorized,started,'2026-10-16T07:59:59Z'],
  ['invalid',started,observed],
  [authorized,'invalid',observed],
 ])assert.equal(weeklyG5HistoricalTimeValid(auth,run,seen,'2026-10-18'),false,`${auth}/${run}/${seen}`);
});

test('a rendered artifact and passing G4 do not mint a weekly G5 policy without the exact automatic quality task',async t=>{
 const f=await prepareDirectorG5Fixture();t.after(f.cleanup);
 const before=f.tables.starter_social_director_g5_reviews?.length??0;
 await assert.rejects(readWeeklyG5AutomaticAuthority(f.store,g5FixtureScope,'not-a-current-weekly-quality-task'),/quality_task_required/);
 const context=await f.g5.context(g5FixtureScope,'owner');
 await assert.rejects(f.g5.authorizeWeeklyExecution(g5FixtureScope,'owner',{expectedContextHash:context.contextHash,weeklyExecutionTaskId:'not-a-current-weekly-quality-task'}),/quality_task_required/);
 assert.equal(f.tables.starter_social_director_g5_reviews?.length??0,before);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

test('same stored output, G4 and upstream completion still stop before G5 when no accepted automatic production intent exists',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const upstream={...f.task,taskId:'g5-upstream-video',status:'succeeded' as const,resultRefs:[f.ref],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'g5-quality-worker',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const}};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`g5-weekly-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 const before=f.tables.starter_social_director_g5_reviews?.length??0;
 await assert.rejects(readWeeklyG5AutomaticAuthority(f.store,g5FixtureScope,quality.taskId),/automatic_intent_required/);
 await assert.rejects(advanceWeeklyAutomaticG5(f.store,quality,{...f.ref,type:'starter_social_content_artifact'},'owner'),/automatic_intent_required/);
 assert.equal(f.tables.starter_social_director_g5_reviews?.length??0,before);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

test('a post-hoc v3 intent row cannot convert manually confirmed planning into automatic paid G5 authority',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const upstream={...f.task,taskId:'g5-manual-upstream-video',status:'succeeded' as const,resultRefs:[f.ref],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'g5-manual-quality',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const}};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`g5-manual-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 const planning=(f.tables.social_weekly_agent_planning![0]!.payload as Record<string,unknown>);
 assert.ok(planning.userConfirmation,'the seed schedule represents an ordinary human confirmation, not v3 template acceptance');
 const scope={tenantId:'t',programId:'p',packageId:'week1',packageVersion:1};
 const intent={intentId:socialRequestHash([scope,'forged-adoption']),scope,source:'automatic_template',templateVersion:'weekly-automation.v3',adoptedAt:new Date().toISOString(),userApproval:null,actorUserId:'owner',planningAdoptionHash:'forged-adoption',productionAuthorityProofId:'not-issued',capacityProofId:'not-issued',dispatchHash:socialRequestHash(planning.dispatch),selectedPublicationTaskIds:['pub'],authorizesPublishing:false,authorizesContentAcceptance:false,authorizesCustomerMessages:false};
 f.tables[WEEKLY_AUTOMATIC_PRODUCTION_INTENTS]=[{id:intent.intentId,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,payload:intent,content_hash:socialRequestHash(intent)}];
 const before=f.tables.starter_social_director_g5_reviews?.length??0;
 await assert.rejects(readWeeklyG5AutomaticAuthority(f.store,g5FixtureScope,quality.taskId),/automatic_intent_required/);
 await assert.rejects(advanceWeeklyAutomaticG5(f.store,quality,{...f.ref,type:'starter_social_content_artifact'},'owner'),/automatic_intent_required/);
 assert.equal(f.tables.starter_social_director_g5_reviews?.length??0,before);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

test('a failed independent G5 audit is preserved for repair and cannot trigger a new automatic review',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const upstream={...f.task,taskId:'g5-failed-upstream',status:'succeeded' as const,resultRefs:[f.ref],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'g5-failed-quality',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const}};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`g5-failed-weekly-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});
 const context=await f.g5.context(g5FixtureScope,'owner');
 const checks=passedDirectorChecks(context).map((check,index)=>index===0?{...check,outcome:'failed' as const}:check);
 const review=await f.g5.human(g5FixtureScope,'owner',{requestId:'weekly-failed-g5-review-0001',expectedContextHash:context.contextHash,checks});
 assert.equal(review.item?.status,'failed');
 const before=f.tables.starter_social_director_g5_reviews?.length??0;
 await assert.rejects(advanceWeeklyAutomaticG5(f.store,quality,{...f.ref,type:'starter_social_content_artifact'},'owner'),/latest_g5_not_passed/);
 assert.equal(f.tables.starter_social_director_g5_reviews?.length??0,before);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

test('a forged or stale post-audit recovery child cannot authorize the first paid G5 review',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const upstream={...f.task,taskId:'g5-repair-parent-video',status:'succeeded' as const,resultRefs:[{...f.ref,id:'older-parent'}],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'g5-repair-child-quality',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const},qualityRecoveries:[{artifactRef:f.ref,artifactId:f.ref.id,runId:g5FixtureScope.runId}] as typeof f.task.qualityRecoveries};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`g5-repair-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 const before=f.tables.starter_social_director_g5_reviews?.length??0;
 await assert.rejects(readWeeklyG5AutomaticAuthority(f.store,g5FixtureScope,quality.taskId),/upstream_artifact_changed/);
 assert.equal(f.tables.starter_social_director_g5_reviews?.length??0,before);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

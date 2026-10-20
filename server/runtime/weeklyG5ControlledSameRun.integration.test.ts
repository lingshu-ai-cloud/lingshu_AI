import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {readWeeklyContentQualityAuditContext,readVerifiedWeeklyContentQualityAudit} from './weeklyContentQualityAudit.js';
import {passedDirectorChecks,g5FixtureScope} from '../starter198/socialDirectorG5ReviewService.fixture.js';
import type {DirectorG5RuntimePort} from '../starter198/socialDirectorG5Runtime.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {validateWeeklyExecutionResults} from './socialWeeklyResultValidation.js';

/** Controlled provider, not a weekly automatic-intent or paid-provider test. */
test('director-agent G5 response is read by weekly QA on its actual G4 media and original run',async t=>{
 let providerCalls=0;
 const runtime:DirectorG5RuntimePort={
  descriptor:()=>({configured:true,model:'controlled-director-vl',reservedCostCny:.25,inputPricePerMillion:1,outputPricePerMillion:2}),
  execute:async input=>{providerCalls++;const checks=passedDirectorChecks(input.context);return {model:'controlled-director-vl',providerResponseId:'controlled-weekly-original-response',inputTokens:100,outputTokens:20,cacheTokens:0,checks,rawOutput:JSON.stringify({checks})};},
 };
 const f=await prepareWeeklyQualityAuditFixture(undefined,{}, {runtime});t.after(f.cleanup);
 const upstream={...f.task,taskId:'controlled-weekly-video',status:'succeeded' as const,resultRefs:[f.ref],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'controlled-weekly-quality',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const}};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`controlled-weekly-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 const before=await readWeeklyContentQualityAuditContext(f.store,quality,f.ref);
 assert.equal(before.scope.runId,g5FixtureScope.runId);
 await assert.rejects(readVerifiedWeeklyContentQualityAudit(f.store,quality,f.ref),/latest_g5_missing/);
 let context=await f.g5.context(g5FixtureScope,'owner');
 await f.g5.authorizeExecution(g5FixtureScope,'owner',{expectedContextHash:context.contextHash,model:'controlled-director-vl',maximumCostCny:.5,budgetBucket:'content',purpose:'director_review'});
 context=await f.g5.context(g5FixtureScope,'owner');
 const response=await f.g5.agent(g5FixtureScope,'owner',{requestId:'controlled-weekly-g5-same-run-0001',expectedContextHash:context.contextHash});
 assert.equal(response.item?.status,'passed');
 assert.equal(response.projectionStatus,'applied');
 assert.equal(providerCalls,1);
 const verified=await readVerifiedWeeklyContentQualityAudit(f.store,quality,f.ref);
 assert.equal(verified.reviewId,response.item?.reviewId);
 assert.equal(providerCalls,1);
 await assert.rejects(f.g5.context({...g5FixtureScope,runId:'different-run'},'owner'));
 assert.equal(providerCalls,1);
});

test('weekly quality adapter returns the pinned artifact and its verified G5 receipt',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const upstream={...f.task,taskId:'quality-adapter-video',status:'succeeded' as const,resultRefs:[f.ref],dependsOnTaskIds:[],schedule:{...f.task.schedule,stepKind:'video_generation' as const}};
 const quality={...f.task,taskId:'quality-adapter-quality',status:'leased' as const,dependsOnTaskIds:[upstream.taskId],resultRefs:[],schedule:{...f.task.schedule,stepKind:'quality_check' as const}};
 f.tables.social_weekly_execution_tasks=[upstream,quality].map((payload,index)=>({id:`quality-adapter-${index}`,tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:payload.taskId,payload}));
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});
 const context=await f.g5.context(g5FixtureScope,'owner');
 const review=await f.g5.human(g5FixtureScope,'owner',{requestId:'quality-adapter-human-g5-0001',expectedContextHash:context.contextHash,checks:passedDirectorChecks(context)});
 assert.equal(review.item?.status,'passed');
 const verified=await readVerifiedWeeklyContentQualityAudit(f.store,quality,f.ref);
 const result=await createSocialWeeklyProductionAdapter(f.store).execute(quality);
 assert.equal(result.status,'succeeded',JSON.stringify(result));
 if(result.status!=='succeeded')return;
 assert.deepEqual(result.resultRefs,[f.ref,{type:'quality_receipt',id:verified.receiptId,version:1}]);
 await validateWeeklyExecutionResults(f.store,quality,result.resultRefs);
});

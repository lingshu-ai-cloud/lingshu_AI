import test from 'node:test';import assert from 'node:assert/strict';import {prepareWeeklyNonPresenterProductionFixture} from './weeklyNonPresenterProduction.fixture.js';
// Real local source/frames and explicit human review; controlled source-provider
// contract is not a live model proof. No paid generation or queue runner invoked.
test('actual frozen non-presenter planning resolves ready source but default start rejects absent executable replication capability',async t=>{
 const {f,actual,detail,created}=await prepareWeeklyNonPresenterProductionFixture(t);
 assert.equal(detail.referenceVideoAnalysis?.status,'ready');
 assert.equal(actual.lastError?.code,'social_content_execution_director_review_required');
 assert.ok(detail.agentWorkflow?.executionPlanReview.reasonCodes.includes('capability_mismatch'));
 assert.ok(detail.agentWorkflow?.executionPlanReview.sceneResults.every(scene=>scene.failedCriteria.includes('没有可执行的推荐候选')));
 assert.ok(!created.run_id);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
 assert.ok(!detail.agentWorkflow?.executionPlanReview.failedCriteria.includes('参考视频的逐句时间码、分镜证据或授权尚未通过生产门禁'));
});

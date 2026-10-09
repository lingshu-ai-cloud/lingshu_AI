import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
test('formal source-backed generated script remains blocked at actual director capability review, never fakes material or queue readiness',async t=>{
 const {f,created,detail,referenceReviewHandoff}=await prepareWeeklyPlanningProductionFixture(t);
 assert.equal(referenceReviewHandoff.productionExecutionAllowed,false);assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='shot_media_missing'));assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='hook_script_incomplete'));
 const review=detail.agentWorkflow?.executionPlanReview;assert.ok(review);assert.equal(review.approved,false);assert.ok(review.failedCriteria.length>0,JSON.stringify(review));assert.ok(review.reasonCodes.includes('expression_failed'));assert.ok(review.failedCriteria.some(issue=>issue.includes('参考视频')));assert.ok(review.sceneResults.every(scene=>scene.approved),'global evidence gap cannot be disguised as scene capability failure');
 assert.ok(detail.replicationScript);assert.equal(detail.sources.filter(s=>s.kind==='reference_link'&&s.status==='active').length,1);assert.ok(!created.run_id);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

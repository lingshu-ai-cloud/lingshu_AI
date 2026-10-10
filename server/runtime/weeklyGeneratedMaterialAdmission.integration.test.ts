import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
test('formal source-backed generated script remains blocked at independent person evidence, never fakes material or queue readiness',async t=>{
 const {f,created,detail,actual,referenceReviewHandoff}=await prepareWeeklyPlanningProductionFixture(t);
 assert.equal(referenceReviewHandoff.productionExecutionAllowed,false);assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='shot_media_missing'));assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='hook_script_incomplete'));
 assert.equal(detail,null,'strict person evidence fails before downstream execution-plan construction');
 assert.equal(actual.lastError?.code,'reference_person_automatic_analysis_required');
 assert.ok(actual.lastError?.message.includes('镜头 replication-reference-shot-1'));
 assert.ok(actual.lastError?.message.includes('独立人物分析'));
 assert.ok(!created.run_id);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

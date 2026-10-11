import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
test('formal source-backed planning remains blocked at missing source evidence, never fakes material or queue readiness',async t=>{
 const {f,created,detail,actual,referenceReviewHandoff}=await prepareWeeklyPlanningProductionFixture(t);
 assert.equal(referenceReviewHandoff.productionExecutionAllowed,false);assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='shot_media_missing'));assert.ok(referenceReviewHandoff.issues.some(issue=>issue.code==='hook_script_incomplete'));
 assert.ok(detail,'readonly planning may return a detail without authorizing execution');assert.equal(detail.runId,null);
 assert.equal(actual.lastError?.code,'weekly_reference_source_evidence_required');
 assert.ok(actual.lastError?.message.includes('原片字节校验'));
 assert.ok(!created.run_id);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

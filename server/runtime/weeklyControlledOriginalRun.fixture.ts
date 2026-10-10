import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {socialTaskSummary,socialTaskSource} from '../starter198/socialContentRecords.js';
import {STARTER_COLLECTIONS} from '../starter198/repository.js';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
/** Controlled persisted preexisting scheduler run for recovery contracts only.
 * This is explicitly not evidence that the default director review admitted production. */
export async function prepareWeeklyControlledOriginalRunFixture(t:TestContext){
 const prepared=await prepareWeeklyPlanningProductionFixture(t);const {f,created}=prepared;
 const task=socialTaskSummary(created);const sourceRows=await f.repository.list(STARTER_COLLECTIONS.socialTaskSources,'t',{where:{task_id:task.taskId},perPage:100});const sources=sourceRows.items.map(socialTaskSource);assert.equal(sources.filter(source=>source.status==='active').length,1);
 const context={schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:task.taskId,socialTaskVersion:task.version,sourceRefs:sources.filter(s=>s.status==='active').map(s=>({id:s.sourceId,...(s.sourceVersion?{version:s.sourceVersion}:{})})),packageSelection:task.packageSelection};
 const run=await f.store.create('workflow_runs',{tenant_id:'t',status:'running',starter_context:context});assert.ok(run);
 await f.store.create('workflow_tasks',{tenant_id:'t',run_id:run.id,task_key:'social_content_auto_production',owner_id:'owner',status:'running',external_effect:'none',output:context});
 created.run_id=run.id;created.status='producing';created.orchestrator_item_id='controlled-preexisting-orchestrator';
 return prepared;
}

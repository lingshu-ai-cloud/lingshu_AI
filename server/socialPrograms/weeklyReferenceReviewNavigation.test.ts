import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from '../runtime/weeklyPlanningProduction.fixture.js';
import {readWeeklyReferenceReviewNavigation} from './weeklyReferenceReviewNavigation.js';
test('actual planning and default create bind exact reference review read-only; drift never borrows a source',async t=>{
 const {f,pkg,actual,created}=await prepareWeeklyPlanningProductionFixture(t);
 const scope={tenantId:actual.tenantId,programId:actual.programId,packageId:pkg.packageId,packageVersion:pkg.version,executionTaskId:actual.taskId};
 const before=JSON.stringify(f.tables);
 const target=await readWeeklyReferenceReviewNavigation(f.store,scope,'decorative-reference');
 assert.equal(target.recordId,'decorative-reference');assert.equal(target.contentTaskId,created.task_id);assert.match(target.sourceVersion,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(f.tables),before);
 await assert.rejects(readWeeklyReferenceReviewNavigation(f.store,scope,'unselected'));
 await assert.rejects(readWeeklyReferenceReviewNavigation(f.store,{...scope,tenantId:'foreign'},'decorative-reference'));
 const ref=f.tables.trend_videos!.find(row=>row.id==='decorative-reference')!;ref.referenceShotReview={edited:'new-review'};
 await assert.rejects(readWeeklyReferenceReviewNavigation(f.store,scope,'decorative-reference'),(error:unknown)=>error instanceof Error&&'code' in error&&error.code==='weekly_reference_version_changed');
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

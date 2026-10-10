import test from 'node:test';import assert from 'node:assert/strict';
import {prepareDefaultPublication} from '../../server/runtime/weeklyDefaultPublication.fixture.js';
import {readWeeklyContentNavigation} from '../../server/socialPrograms/weeklyContentNavigation.js';
import {readSocialTaskDetail} from '../../server/starter198/socialContentRecords.js';
import {readSocialSceneReworkAvailability} from '../../server/starter198/socialContentSceneReworkRead.js';
import {loadWeeklyContentProductionView} from './weeklyContentProductionView.js';
import {weeklyContentReviewScope} from './weeklyContentReviewScope.js';
test('actual formal weekly card original media opens exact review scope; foreign and historical sources never edit',async t=>{
 const {f,publishing}=await prepareDefaultPublication(t);const scope={tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,executionTaskId:publishing.taskId};
 const read=()=>readWeeklyContentNavigation(f.store,scope);const target=await read();const view=await loadWeeklyContentProductionView(target,{read,task:async id=>{const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:id});assert.ok(detail);return detail;},scenes:async s=>{assert.equal(typeof s.tenantId,'string');if(typeof s.tenantId!=='string')throw Error('actual scene tenant missing');return readSocialSceneReworkAvailability({repository:f.repository,tenantId:s.tenantId,taskId:s.taskId,parentArtifactId:s.parentArtifactId});}});
 assert.deepEqual(weeklyContentReviewScope(view),{tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact'});const review=weeklyContentReviewScope(view);assert.ok(review);const context=await f.g5.context(review,'owner');assert.equal(context.artifactId,'artifact');assert.ok(context.requirements.script.length);assert.equal(context.g4.ready,true);assert.ok(view.scenes);const scenes=view.scenes;assert.throws(()=>weeklyContentReviewScope({...view,scenes:{...scenes,tenantId:'foreign'}}));assert.throws(()=>weeklyContentReviewScope({...view,scenes:{...scenes,sourceRunId:'latest'}}));assert.equal(weeklyContentReviewScope({...view,historical:true}),null);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
});

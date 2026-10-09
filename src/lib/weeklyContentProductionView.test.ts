import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {prepareDefaultPublication} from '../../server/runtime/weeklyDefaultPublication.fixture.js';
import {createSocialProgramsRouter} from '../../server/routes/socialPrograms.js';
import {readSocialTaskDetail} from '../../server/starter198/socialContentRecords.js';
import {readSocialSceneReworkAvailability} from '../../server/starter198/socialContentSceneReworkRead.js';
import {parseWeeklyContentNavigation} from './weeklyContentNavigationApi.js';
import {loadWeeklyContentProductionView} from './weeklyContentProductionView.js';

test('actual HTTP binding and persisted ordinary cache retain original historical artifact and reject absent evidence',async t=>{
 const {f,publishing}=await prepareDefaultPublication(t);const scope={tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,executionTaskId:publishing.taskId};
 const app=express();app.use((_q,r,n)=>{r.locals.tenantId='t';r.locals.userId='owner';n();});app.use('/api/overseas/social-programs',createSocialProgramsRouter(f.store,false));const server=app.listen(0);await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));const address=server.address();assert.ok(address&&typeof address==='object');
 let reads=0,taskReads=0,sceneReads=0;const read=async()=>{reads++;const response=await fetch(`http://127.0.0.1:${address.port}/api/overseas/social-programs/p/operating-packages/week1/execution-tasks/${publishing.taskId}/production-navigation?version=1`);assert.equal(response.status,200);return parseWeeklyContentNavigation((await response.json()).item,scope);};
 const target=await read();const content=f.tables.starter_social_content_tasks!.find(row=>row.task_id===target.contentTaskId)!;content.run_id='new-current-run';f.tables.workflow_runs!.push({id:'new-current-run',tenant_id:'t',task_id:'content',status:'running'});
 const ports={read,task:async(taskId:string)=>{taskReads++;const task=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId});assert.ok(task);return task;},scenes:async(s:{tenantId:string;taskId:string;sourceRunId:string;parentArtifactId:string})=>{sceneReads++;return readSocialSceneReworkAvailability({repository:f.repository,tenantId:s.tenantId,taskId:s.taskId,parentArtifactId:s.parentArtifactId});}};
 const view=await loadWeeklyContentProductionView(target,ports);assert.equal(view.historical,true);assert.equal(view.task.runId,'new-current-run');assert.equal(view.binding.runId,'run');assert.equal(view.artifact?.artifactId,'artifact');assert.equal(view.scenes?.sourceRunId,'run');assert.equal(sceneReads,1);
 await assert.rejects(loadWeeklyContentProductionView({...target,runId:'new-current-run'},ports));await assert.rejects(loadWeeklyContentProductionView({...target,artifactRef:{type:'starter_social_content_artifact',id:'foreign-artifact',version:2}},ports));assert.equal(taskReads,1);assert.equal(sceneReads,1);assert.equal(reads,4);
 const cache=f.tables.starter_social_scene_media_caches!;f.tables.starter_social_scene_media_caches=[];try{await assert.rejects(loadWeeklyContentProductionView(target,ports));}finally{f.tables.starter_social_scene_media_caches=cache;}assert.equal(taskReads,1);assert.equal(sceneReads,1);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});

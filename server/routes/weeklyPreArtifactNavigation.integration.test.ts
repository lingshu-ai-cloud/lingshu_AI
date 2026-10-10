import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {prepareDefaultPublication} from '../runtime/weeklyDefaultPublication.fixture.js';
import {createSocialContentTask} from '../starter198/socialContentTasks.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {createSocialProgramsRouter} from './socialPrograms.js';
import {parseWeeklyContentNavigation} from '../../src/lib/weeklyContentNavigationApi.js';
import {loadWeeklyContentProductionView} from '../../src/lib/weeklyContentProductionView.js';

test('actual newly created unstarted content binds material input card through readonly HTTP and loader without starting production',async t=>{
 const {f,publishing}=await prepareDefaultPublication(t);
 const old=f.tables.starter_social_content_tasks!.find(row=>row.task_id==='content')!;const binding=String(old.create_idempotency_key);old.create_idempotency_key='prior-owned-production';
 const created=await createSocialContentTask({repository:f.repository,tenantId:'t',userId:'owner',idempotencyKey:binding,value:{title:'本周未开工任务',objective:'核对产品内容输入',mode:'weekly',platforms:['tiktok'],languages:['en'],formats:['short_video'],requestedOutputCount:1,programRef:{objectType:'social_program',id:'p',version:'1'}}});
 assert.equal(created.runId,null);assert.equal(created.artifacts.length,0);
 const stored=f.tables.starter_social_content_tasks!.find(row=>row.task_id===created.taskId)!;
 const originalBrief=old.brief as Record<string,unknown>;stored.brief={...(stored.brief as object),_weeklyAuthority:structuredClone(originalBrief._weeklyAuthority)};
 const card=f.tables.social_weekly_execution_tasks!.find(row=>row.task_id===publishing.taskId)!;const task=card.payload as typeof publishing;task.workflowKind='content';task.schedule.stepKind='material_readiness';task.resultRefs=[];task.productionProgress={contentTaskId:created.taskId,runId:null,step:'material_readiness',activity:'等待真实素材输入',updatedAt:new Date().toISOString()};task.dependsOnTaskIds=[];
 f.tables.social_weekly_execution_tasks=[card];
 const scope={tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,executionTaskId:task.taskId};
 const app=express();app.use((_q,r,n)=>{r.locals.tenantId='t';r.locals.userId='owner';n();});app.use('/api/overseas/social-programs',createSocialProgramsRouter(f.store,false));const server=app.listen(0);await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));const address=server.address();assert.ok(address&&typeof address==='object');
 const read=async()=>{const response=await fetch(`http://127.0.0.1:${address.port}/api/overseas/social-programs/p/operating-packages/week1/execution-tasks/${task.taskId}/production-navigation?version=1`);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return parseWeeklyContentNavigation((await response.json()).item,scope);};
 const target=await read();assert.equal(target.runId,null);assert.equal(target.artifactRef,null);
 const view=await loadWeeklyContentProductionView(target,{read,task:async taskId=>{const actual=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId});assert.ok(actual);return actual;},scenes:async()=>{throw Error('unstarted input page must not load nonexistent scenes');}});
 assert.equal(view.task.taskId,created.taskId);assert.equal(view.task.runId,null);assert.equal(view.artifact,null);assert.equal(view.historical,false);assert.throws(()=>parseWeeklyContentNavigation({...target,source:'completed_artifact',artifactRef:{type:'starter_social_content_artifact',id:'missing',version:1}},scope));
 const savedStatus=stored.status;stored.status='producing';try{await assert.rejects(read());}finally{stored.status=savedStatus;}
 stored.run_id='later-owned-run';f.tables.workflow_runs!.push({id:'later-owned-run',tenant_id:'t',task_id:created.taskId,status:'running'});try{await assert.rejects(loadWeeklyContentProductionView(target,{read,task:async taskId=>{const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId});assert.ok(detail);return detail;},scenes:async()=>{throw Error('no scenes');}}));task.productionProgress={...task.productionProgress!,runId:'later-owned-run'};const runningTarget=await read();assert.equal(runningTarget.runId,'later-owned-run');const running=await loadWeeklyContentProductionView(runningTarget,{read,task:async taskId=>{const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId});assert.ok(detail);return detail;},scenes:async()=>{throw Error('no scenes before artifact');}});assert.equal(running.task.runId,'later-owned-run');assert.equal(running.artifact,null);assert.equal(running.historical,false);}finally{stored.run_id='';}
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
});

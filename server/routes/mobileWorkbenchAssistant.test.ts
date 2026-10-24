import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { answerMobileAssistant, buildMobileAssistantContext, mobileContentTaskReadFailure, previewMobileAssistantAction, readMobileCurrentContentTask } from './mobileWorkbenchAssistant.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { socialTaskSummary } from '../starter198/socialContentRecords.js';
function store(subject?: Record<string, unknown>): DataStore {
 return { getById: async <T>() => subject as T || null, list: async <T>() => ({items:[] as T[],totalItems:0,totalPages:1,page:1,perPage:200}),create:async()=>null,update:async()=>false,delete:async()=>false };
}
test('weekly queries use authoritative aggregate and unknown exposure stays unknown',async()=>{
 const context=await buildMobileAssistantContext(store(),'tenant-a','user-a',new Date('2026-10-10T00:00:00Z'));
 assert.match(answerMobileAssistant(context,'weekly_progress').text,/0 项/);
 assert.match(answerMobileAssistant(context,'exposure').text,/暂时无法核实/);
 assert.equal(answerMobileAssistant(context,'weekly_progress').performedAction,false);
 assert.equal(context.quickQuestions.length,5);
});
test('mobile context projects the latest instant ContentTask with its server version',async()=>{
 const db=store();
 const taskRow={
  id:'row',tenant_id:'tenant-a',task_id:'content-1',task_mode:'instant',status:'needs_input',version:'7',run_id:'',weekly_plan_id:'',
  brief:defaultBrief({title:'单条海报',objective:'制作产品海报',productRef:'产品 A',formats:['图文'],platforms:['instagram']}),
  package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),theme_selection:null,
  material_requirements:[],script_baseline:null,director_plan:null,source_count:0,knowledge_source_count:0,material_source_count:0,
  artifact_count:0,approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
  created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T01:00:00Z',
 };
 db.list=async<T>(collection:string)=>({items:(collection==='assistant_threads'?[{
  id:'thread-a',tenantId:'tenant-a',userId:'user-a',agentId:'business',source:'desktop',
  focusedTaskId:'social-content:content-1',taskCards:{'social-content:content-1':{}},updatedAt:'2026-10-24T01:00:00Z',
 }] : collection==='starter_social_content_tasks'?[{...taskRow,created_by:'user-a'}] : []) as T[],totalItems:['assistant_threads','starter_social_content_tasks'].includes(collection)?1:0,totalPages:1,page:1,perPage:20});
 const projection=await readMobileCurrentContentTask(db,'tenant-a','user-a',async input=>{
  assert.equal(input.taskId,'content-1');
  return socialTaskSummary(taskRow as never) as never;
 });
 assert.equal(projection.availability,'available');
 assert.equal(projection.card?.contentTaskId,'content-1');
 assert.equal(projection.card?.cardVersion,'7');
 assert.equal(projection.card?.recoveryCursor.kind,'task_version');
 assert.equal(projection.card?.recoveryCursor.value,'content-1@7');
 assert.equal(projection.card?.outputType,'image');
});
test('mobile current task is selected from the signed-in users authoritative assistant thread',async()=>{
 const db=store();
 db.list=async<T>(collection:string)=>({items:(collection==='assistant_threads'?[
  {id:'thread-b',tenantId:'tenant-a',userId:'user-b',agentId:'business',source:'desktop',focusedTaskId:'social-content:task-b',taskCards:{'social-content:task-b':{}},updatedAt:'2026-10-24T03:00:00Z'},
  {id:'thread-a',tenantId:'tenant-a',userId:'user-a',agentId:'business',source:'desktop',focusedTaskId:'social-content:task-a',taskCards:{'social-content:task-a':{}},updatedAt:'2026-10-24T01:00:00Z'},
 ]:collection==='starter_social_content_tasks'?[{id:'row-a',tenant_id:'tenant-a',task_id:'task-a',task_mode:'instant',created_by:'user-a'}]:[]) as T[],totalItems:collection==='assistant_threads'?2:collection==='starter_social_content_tasks'?1:0,totalPages:1,page:1,perPage:20});
 let selected='';
 const result=await readMobileCurrentContentTask(db,'tenant-a','user-a',async input=>{
  selected=input.taskId;
  return null;
 });
 assert.equal(selected,'task-a');
 assert.equal(result.availability,'unavailable');
});
test('a user thread cannot expose another users task inside the same tenant',async()=>{
 const db=store();
 db.list=async<T>(collection:string)=>({items:(collection==='assistant_threads'?[{
  id:'thread-a',tenantId:'tenant-a',userId:'user-a',agentId:'business',source:'desktop',
  focusedTaskId:'social-content:task-b',taskCards:{'social-content:task-b':{}},
 }] : collection==='starter_social_content_tasks'?[{
  id:'task-row-b',tenant_id:'tenant-a',task_id:'task-b',task_mode:'instant',created_by:'user-b',
 }] : []) as T[],totalItems:1,totalPages:1,page:1,perPage:20});
 let detailReads=0;
 const result=await readMobileCurrentContentTask(db,'tenant-a','user-a',async()=>{
  detailReads+=1;
  return null;
 });
 assert.equal(result.availability,'unavailable');
 assert.equal(detailReads,0);
});
test('mobile task detail distinguishes absence from a temporary read failure',()=>{
 assert.equal(mobileContentTaskReadFailure(new SocialContentWorkflowError('social_content_task_not_found',404)).status,404);
 const unavailable=mobileContentTaskReadFailure(new Error('storage unavailable'));
 assert.equal(unavailable.status,503);
 assert.equal(unavailable.body.error,'content_task_read_unavailable');
 assert.match(unavailable.body.message,/暂时无法读取/);
});
test('preview is scoped versioned and never executes',async()=>{
 const db=store({id:'task-a',tenant_id:'a',status:'failed',task_version:3,title:'失败任务'});
 const identity={tenantId:'a',userId:'u'};
 const preview=await previewMobileAssistantAction(db,identity,{kind:'retry_task',targetId:'task-a',payload:{rerunDownstream:false}},{authorizeAction:async()=>true});
 assert.equal(preview.action.expectedVersion,'3'); assert.equal(preview.performedAction,false); assert.equal(preview.confirmation.route,'/actions');
 assert.equal(preview.cost.availability,'unknown');
 await assert.rejects(previewMobileAssistantAction(db,{...identity,tenantId:'b'},{kind:'retry_task',targetId:'task-a',payload:{}}),/not_found/);
 await assert.rejects(previewMobileAssistantAction(db,identity,{kind:'retry_task',targetId:'task-a',payload:{}}),/forbidden/);
 await assert.rejects(previewMobileAssistantAction(db,{...identity,supportAccess:{requestId:'s',adminEmail:'x',tenantName:'a'}},{kind:'retry_task',targetId:'task-a',payload:{}},{authorizeAction:async()=>true}),/forbidden/);
});
test('free text cannot be an executable action or smuggle budget',async()=>{
 await assert.rejects(previewMobileAssistantAction(store(),{tenantId:'a',userId:'u'},'直接加预算'),/invalid/);
 await assert.rejects(previewMobileAssistantAction(store(),{tenantId:'a',userId:'u'},{kind:'retry_task',targetId:'task-a',payload:{budget:100}}),/invalid/);
});
test('action candidates isolate tenant and readonly roles',async()=>{
 const {mobileAssistantActionCandidates}=await import('./mobileWorkbenchAssistant.js');
 const db=store(); db.list=async<T>(collection:string)=>({items:(collection==='approval_requests'?[{id:'a',tenant_id:'a',status:'pending'},{id:'secret',tenant_id:'b',status:'pending'}]:[]) as T[],totalItems:2,totalPages:1,page:1,perPage:200});
 const candidates=await mobileAssistantActionCandidates(db,{tenantId:'a',userId:'u'},'admin');
 assert.equal(candidates.length,1); assert.equal(candidates[0].matterId,'approval:a');
 assert.deepEqual(await mobileAssistantActionCandidates(db,{tenantId:'a',userId:'u'},null),[]);
});

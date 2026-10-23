import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { answerMobileAssistant, buildMobileAssistantContext, previewMobileAssistantAction, readMobileCurrentContentTask } from './mobileWorkbenchAssistant.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
function store(subject?: Record<string, unknown>): DataStore {
 return { getById: async <T>() => subject as T || null, list: async <T>() => ({items:[] as T[],totalItems:0,totalPages:1,page:1,perPage:200}),create:async()=>null,update:async()=>false,delete:async()=>false };
}
test('weekly queries use authoritative aggregate and unknown exposure stays unknown',async()=>{
 const context=await buildMobileAssistantContext(store(),'tenant-a',new Date('2026-10-10T00:00:00Z'));
 assert.match(answerMobileAssistant(context,'weekly_progress').text,/0 项/);
 assert.match(answerMobileAssistant(context,'exposure').text,/暂时无法核实/);
 assert.equal(answerMobileAssistant(context,'weekly_progress').performedAction,false);
 assert.equal(context.quickQuestions.length,5);
});
test('mobile context projects the latest instant ContentTask with its server version',async()=>{
 const db=store();
 db.list=async<T>(collection:string)=>({items:(collection==='starter_social_content_tasks'?[{
  id:'row',tenant_id:'tenant-a',task_id:'content-1',task_mode:'instant',status:'needs_input',version:'7',run_id:'',weekly_plan_id:'',
  brief:defaultBrief({title:'单条海报',objective:'制作产品海报',productRef:'产品 A',formats:['图文'],platforms:['instagram']}),
  package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),theme_selection:null,
  material_requirements:[],script_baseline:null,director_plan:null,source_count:0,knowledge_source_count:0,material_source_count:0,
  artifact_count:0,approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
  created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T01:00:00Z',
 }] : []) as T[],totalItems:collection==='starter_social_content_tasks'?1:0,totalPages:1,page:1,perPage:50});
 const projection=await readMobileCurrentContentTask(db,'tenant-a');
 assert.equal(projection.availability,'available');
 assert.equal(projection.card?.contentTaskId,'content-1');
 assert.equal(projection.card?.cardVersion,'7');
 assert.equal(projection.card?.recoveryCursor.kind,'task_projection');
 assert.equal(projection.card?.recoveryCursor.value,'content-1@7#2026-10-24T01:00:00Z');
 assert.equal(projection.card?.outputType,'image');
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

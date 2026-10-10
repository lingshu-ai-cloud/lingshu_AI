import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { answerMobileAssistant, buildMobileAssistantContext, previewMobileAssistantAction } from './mobileWorkbenchAssistant.js';
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

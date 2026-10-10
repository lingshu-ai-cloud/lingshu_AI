import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCustomerWorkspaceIdentity} from './customerWorkspaceIdentity';
import type {DigitalEmployeeDeepLink} from './digitalEmployees';
const link:DigitalEmployeeDeepLink={page:'conversion',runId:'run',taskId:'task',businessRef:{taskKey:'followup_batch_draft'}};
const original={scope:{tenantId:'tenant',runId:'run'},tasks:[{id:'task',run_id:'run',task_key:'followup_batch_draft'}],segment:{id:'segment',tenant_id:'tenant',run_id:'run'},batch:{id:'batch',tenant_id:'tenant',run_id:'run',segment_id:'segment'},members:[{id:'member',tenant_id:'tenant',segment_id:'segment',customer_id:'buyer',membership:'included'}],items:[{id:'item',tenant_id:'tenant',batch_id:'batch',segment_member_id:'member',customer_id:'buyer',draft_body:'original'}]};
test('workspace rejects foreign run, tenant, batch, member and customer rows before drafts are displayed',()=>{
 assert.doesNotThrow(()=>assertCustomerWorkspaceIdentity(original,link));
 const changes=[(v:any)=>v.scope.runId='foreign',(v:any)=>v.scope.tenantId='foreign',(v:any)=>v.tasks[0].run_id='foreign',(v:any)=>v.tasks[0].id='foreign',(v:any)=>v.segment.run_id='foreign',(v:any)=>v.batch.segment_id='foreign',(v:any)=>v.members[0].id='foreign',(v:any)=>v.members[0].customer_id='foreign',(v:any)=>v.items[0].customer_id='foreign',(v:any)=>v.items[0].tenant_id='foreign',(v:any)=>v.items[0].batch_id='foreign',(v:any)=>v.items[0].segment_member_id='foreign'];
 for(const change of changes){const data=structuredClone(original);change(data);assert.throws(()=>assertCustomerWorkspaceIdentity(data,link),/不一致/);}
 assert.throws(()=>assertCustomerWorkspaceIdentity({...original,scope:undefined},link),/不一致/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter198Repository} from './repository.js';
import {inspectSocialContentLegacyOrderMigration,applySocialContentLegacyOrderMigration} from './socialContentLegacyOrderMigration.js';
import {cancelSocialContentOrder,socialContentCancellationGroupHash} from './socialContentOrderCancellation.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function fixture(){
 const tables:Record<string,any[]>={};let serial=0;const table=(c:string)=>tables[c]??=[];
 const store:any={supportsAtomicCompareAndSwap:()=>true,getById:async(c:string,id:string)=>structuredClone(table(c).find(r=>r.id===id)??null),
 create:async(c:string,v:any)=>{const id=v.id??`row-${++serial}`;if(table(c).some(r=>r.id===id))return null;const r={...structuredClone(v),id};table(c).push(r);return structuredClone(r);},
 update:async(c:string,id:string,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r)return false;Object.assign(r,structuredClone(p));return true;},
 delete:async(c:string,id:string)=>{const i=table(c).findIndex(r=>r.id===id);if(i<0)return false;table(c).splice(i,1);return true;},
 compareAndSwap:async(c:string,id:string,e:any,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r||Object.entries(e).some(([k,v])=>JSON.stringify(r[k])!==JSON.stringify(v)))return false;Object.assign(r,structuredClone(p));return true;},
 list:async(c:string,q:any={})=>{const rows=table(c).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items:structuredClone(rows.slice(0,q.perPage??1000)),totalItems:rows.length};}};
 const task={id:'row',task_id:'original',tenant_id:'tenant',created_by:'owner',created_at:'2026-10-14T09:00:00Z',version:'1',status:'plan_review',run_id:'',brief:{title:'Repeated title'},create_idempotency_key:'assistant-production-original',create_request_hash:'frozen-create-hash'};
 table('starter_social_content_tasks').push(task);
 table('starter_social_content_operations').push({id:'op',tenant_id:'tenant',operation_id:'create-op',idempotency_key:task.create_idempotency_key,created_by:'owner',request_hash:task.create_request_hash,operation:'create_social_content_task',target_id:'task-collection',status:'succeeded',result:{schemaVersion:'social-content.operation-result.v1',operationId:'create-op',targetId:'task-collection'}});
 table('social_programs').push({id:'program',tenant_id:'tenant',program_id:'p',created_at:'2026-10-01T00:00:00Z'});
 const input={repository:createStarter198Repository(store),tenantId:'tenant',taskId:'original',inspectLegacyExecutionEvidence:async()=>({verified:true,missingProofs:[],evidence:{studioProjects:[],budgetLedgers:[],audit:'isolated-authoritative-inventory'}})};
 return{input,task,table,store};
}
test('proven independent draft recovers original identities/week without reserve, queue or fee mutations; replay is stable',async()=>{
 const f=fixture(),plan=await inspectSocialContentLegacyOrderMigration(f.input);assert.equal(plan.status,'eligible');
 assert.equal(plan.binding?.originWeek,'2026-10-12');assert.equal(plan.binding?.entry,'assistant');
 const old=structuredClone(f.task),result=await applySocialContentLegacyOrderMigration({...f.input,actorId:'auditor',expectedEvidenceHash:plan.evidenceHash});
 assert.equal(result.binding?.contentId,'original');assert.equal(result.binding?.budgetTaskId,'original');
 const persisted:any=f.task;assert.equal(persisted.content_order.legacyMigration.snapshot.contentOrder,null);
 assert.deepEqual({...persisted,content_order:undefined},{...old,content_order:undefined});
 await applySocialContentLegacyOrderMigration({...f.input,actorId:'auditor',expectedEvidenceHash:plan.evidenceHash});
 assert.equal(f.table('social_content_creation_quotas').length,0);assert.equal(f.table('content_execution_jobs').length,0);
});
test('same title and same request hash but different creation commands remain independent originals',async()=>{
 const f=fixture(),second={...f.task,id:'row2',task_id:'second',create_idempotency_key:'assistant-production-second'};
 f.table('starter_social_content_tasks').push(second);
 const op=f.table('starter_social_content_operations')[0];f.table('starter_social_content_operations').push({...op,id:'op2',operation_id:'create-op2',idempotency_key:second.create_idempotency_key,result:{...op.result,operationId:'create-op2'}});
 const p=await inspectSocialContentLegacyOrderMigration({...f.input,taskId:'second'});assert.equal(p.status,'eligible');assert.equal(p.binding?.contentId,'second');
});
test('unverified finance/Studio, unknown receipt, started, revision and ambiguous program block only affected task',async()=>{
 for(const mutate of [
  (f:any)=>{f.input.inspectLegacyExecutionEvidence=async()=>({verified:false,missingProofs:['unverified_studio_paid_receipt'],evidence:{unknown:true}});},
  (f:any)=>{f.task.run_id='old-run';},(f:any)=>{f.task.brief._productionRevision={parentTaskId:'not-proof'};},
  (f:any)=>{f.table('starter_social_content_operations')[0].result.operationId='tampered';},
  (f:any)=>{f.table('social_programs').push({id:'p2',tenant_id:'tenant',program_id:'second',created_at:'2026-10-01'});},
  (f:any)=>{f.table('content_execution_jobs').push({id:'j',tenant_id:'tenant',task_id:'original',status:'unknown'});},
  (f:any)=>{f.table('social_programs')[0].created_at='2026-10-19';},
  (f:any)=>{f.table('social_content_creation_quotas').push({id:'q',tenant_id:'tenant',payload:{orders:{original:{contentId:'original',state:'running'}}}});},
 ]){const f=fixture();mutate(f);const plan=await inspectSocialContentLegacyOrderMigration(f.input);assert.equal(plan.status,'blocked');assert.ok(plan.missingProofs.length);await assert.rejects(applySocialContentLegacyOrderMigration({...f.input,actorId:'auditor',expectedEvidenceHash:plan.evidenceHash}),/unverified/);assert.equal((f.task as any).content_order,undefined);}
 const f=fixture();assert.equal((await inspectSocialContentLegacyOrderMigration({...f.input,inspectLegacyExecutionEvidence:undefined})).status,'blocked');
});
test('evidence drift and failed CAS do not partially write provenance or delete history',async()=>{
 const f=fixture(),plan=await inspectSocialContentLegacyOrderMigration(f.input);f.table('starter_social_content_operations')[0].created_by='changed';
 await assert.rejects(applySocialContentLegacyOrderMigration({...f.input,actorId:'auditor',expectedEvidenceHash:plan.evidenceHash}),/evidence_changed/);
 const g=fixture(),p=await inspectSocialContentLegacyOrderMigration(g.input),cas=g.store.compareAndSwap;
 g.store.compareAndSwap=async(c:string,...args:any[])=>c==='starter_social_content_tasks'?false:cas(c,...args);
 await assert.rejects(applySocialContentLegacyOrderMigration({...g.input,actorId:'auditor',expectedEvidenceHash:p.evidenceHash}),/conflict/);assert.equal((g.task as any).content_order,undefined);
});
test('migrated original can stop through real group cancellation without inventing quota or deleting audit evidence',async()=>{
 const f=fixture(),plan=await inspectSocialContentLegacyOrderMigration(f.input);
 await applySocialContentLegacyOrderMigration({...f.input,actorId:'maintenance',expectedEvidenceHash:plan.evidenceHash});
 const proof=structuredClone((f.task as any).content_order.legacyMigration);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-cancel-'));
 try{
  const result=await cancelSocialContentOrder({repository:f.input.repository,tenantId:'tenant',userId:'owner',taskId:'original',expectedVersion:'1',idempotencyKey:'stop-migrated',reason:'Explicit test stop',expectedGroupHash:socialContentCancellationGroupHash('original',[]),budgetRoot:root});
  assert.equal(result.status,'cancelled');assert.equal(result.quotaReleased,false);
  assert.deepEqual((f.task as any).content_order.legacyMigration,proof);
  assert.equal(f.table('social_content_creation_quotas').length,0);
  assert.equal(f.table('content_execution_jobs').length,0);
  assert.equal(f.table('starter_social_content_operations')[0].status,'succeeded');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

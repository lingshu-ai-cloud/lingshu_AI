import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSocialContentOrderOperationsRouter} from './socialContentOrderOperationsRouter.js';
import {createStarter198Repository} from './repository.js';
import {initialSocialContentOrder} from './socialContentOrderAdmission.js';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {SocialContentWorkflowError} from './socialContentValidation.js';

async function fixture(t:any){
 const tables:Record<string,any[]>={};let serial=0;const table=(name:string)=>tables[name]??=[];
 const store:any={supportsAtomicCompareAndSwap:()=>true,
  getById:async(c:string,id:string)=>structuredClone(table(c).find(r=>r.id===id)??null),
  create:async(c:string,value:any)=>{const row={...structuredClone(value),id:value.id??`row-${++serial}`};if(table(c).some(r=>r.id===row.id))return null;table(c).push(row);return structuredClone(row);},
  update:async(c:string,id:string,value:any)=>{const row=table(c).find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(value));return true;},
  delete:async(c:string,id:string)=>{const i=table(c).findIndex(r=>r.id===id);if(i<0)return false;table(c).splice(i,1);return true;},
  compareAndSwap:async(c:string,id:string,expected:any,value:any)=>{const row=table(c).find(r=>r.id===id);if(!row||Object.entries(expected).some(([k,v])=>JSON.stringify(row[k])!==JSON.stringify(v)))return false;Object.assign(row,structuredClone(value));return true;},
  list:async(c:string,q:any={})=>{const rows=table(c).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items:structuredClone(rows.slice(0,q.perPage??1000)),totalItems:rows.length,totalPages:1,page:1,perPage:q.perPage??1000};}};
 const scope={tenantId:'http-tenant',programId:'program',weekStart:'2026-10-12'};
 table('social_programs').push({id:'program',tenant_id:scope.tenantId,program_id:scope.programId});
 const add=(id:string,entry:'weekly_package'|'workspace',tenant=scope.tenantId)=>{const row={id,tenant_id:tenant,task_id:id,status:'draft',version:'1',brief:{title:`真实任务 ${id}`},content_order:{...initialSocialContentOrder(id,entry),programId:scope.programId,originWeek:scope.weekStart}};table('starter_social_content_tasks').push(row);return row;};
 const old=add('old','weekly_package'),replacement=add('new','workspace');add('foreign','workspace','other');
 const repository=createStarter198Repository(store),quota=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:false,inFlight:false,paid:false,unknown:false}),verifyDelivery:async()=>false});
 await quota.plan(scope,{commandId:'plan',actorId:'policy',reason:'actual original plan'},{contentId:'old',entry:'weekly_package',packageId:'pkg',packageVersion:1});
 const budgetRoot=fs.mkdtempSync(path.join(os.tmpdir(),'order-http-'));
 const levels:string[]=[],app=express();app.use(express.json());
 app.use(createSocialContentOrderOperationsRouter({repository,budgetRoot,now:()=>new Date('2026-10-16T12:00:00+08:00'),authorize:async(req,_res,level)=>{
  levels.push(level);if(req.headers.authorization!=='Bearer owner')throw new SocialContentWorkflowError('social_content_write_forbidden',403);
  return{tenantId:scope.tenantId,userId:'owner'};
 }}));
 const server=app.listen(0);t.after(()=>{server.close();fs.rmSync(budgetRoot,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const get=(url:string,auth=true)=>fetch(`${base}${url}`,{headers:auth?{authorization:'Bearer owner'}:{}});
 const post=(url:string,body:any,key:string,auth=true)=>fetch(`${base}${url}`,{method:'POST',headers:{'Content-Type':'application/json','idempotency-key':`${key}-command`,...(auth?{authorization:'Bearer owner'}:{})},body:JSON.stringify({...body,...(typeof body.commandId==='string'?{commandId:`${body.commandId}-command`}:{})})});
 return{table,scope,quota,old,replacement,get,post,levels};
}

test('actual HTTP read is scoped and read-only; target revision is explicit, versioned and idempotent',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.table('social_content_creation_quotas'));
 const response=await f.get('/tasks/new/order-planning');assert.equal(response.status,200);
 const read=await response.json();assert.equal(read.taskId,'new');assert.equal(read.planning.revision,1);assert.equal(read.cancelable,true);
 assert.deepEqual(read.replacementTasks,[{taskId:'new',title:'真实任务 new'}]);assert.equal(JSON.stringify(f.table('social_content_creation_quotas')),before);
 assert.equal((await f.get('/tasks/foreign/order-planning')).status,404);
 const body={programId:f.scope.programId,weekStart:f.scope.weekStart,commandId:'increase',reason:'新增一条原创',expectedRevision:1,newLimit:6,confirmed:true};
 assert.equal((await f.post('/order-planning/increase-target',body,'increase',false)).status,403);
 assert.equal((await f.post('/order-planning/increase-target',{...body,confirmed:false},'increase')).status,400);
 assert.equal((await f.post('/order-planning/increase-target',{...body,tenantId:'foreign'},'increase')).status,400);
 const done=await f.post('/order-planning/increase-target',body,'increase');assert.equal(done.status,200);assert.equal((await done.json()).item.limit,6);
 assert.equal((await f.post('/order-planning/increase-target',body,'increase')).status,200);
 assert.equal((await f.post('/order-planning/increase-target',{...body,commandId:'stale',newLimit:7},'stale')).status,409);
 const pool=await f.quota.read(f.scope);assert.equal(pool!.limit,6);assert.equal(pool!.audit.filter(a=>a.action==='target_increased').length,1);
 assert.equal(f.table('content_execution_jobs').length,0);assert.equal(f.table('starter_usage_ledger').length,0);
});

test('actual HTTP replacement selects one plan, persists history and never dispatches; cancellation safely releases',async t=>{
 const f=await fixture(t),body={programId:f.scope.programId,weekStart:f.scope.weekStart,commandId:'replace',reason:'承接未开始的自动计划',expectedRevision:1,selectedContentId:'old',replacementTaskId:'new'};
 assert.equal((await f.post('/order-planning/replace',{...body,replacementTaskId:'foreign'},'replace')).status,409);
 assert.equal((await f.post('/order-planning/replace',body,'wrong-key')).status,400);
 assert.equal((await f.post('/order-planning/replace',body,'replace')).status,200);
 assert.equal((await f.post('/order-planning/replace',body,'replace')).status,200);assert.equal(f.old.status,'cancelled');
 const pool=await f.quota.read(f.scope);assert.equal(pool!.orders.old.state,'released');assert.equal(pool!.orders.new.state,'planned');
 assert.equal(pool!.orders.new.replacesContentId,'old');assert.equal(pool!.outbox.filter(o=>o.kind==='dispatch').length,0);
 assert.equal(f.table('content_execution_jobs').length,0);
 const cancel={expectedVersion:'1',reason:'取消本次范围'};
 assert.equal((await f.post('/tasks/new/cancel-order',{...cancel,quotaReleased:true},'cancel')).status,400);
 const response=await f.post('/tasks/new/cancel-order',cancel,'cancel');assert.equal(response.status,200);
 const result=(await response.json()).item;assert.equal(result.status,'cancelled');assert.equal(result.quotaReleased,true);
 assert.equal((await f.post('/tasks/new/cancel-order',cancel,'cancel')).status,200);
 assert.equal((await f.quota.read(f.scope))!.orders.new.state,'released');assert.equal(f.replacement.status,'cancelled');
 assert.equal(f.table('starter_social_content_tasks').length,3);assert.equal(f.table('starter_usage_ledger').length,0);
});

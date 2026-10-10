import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, Record_, ListQuery } from '../storage/datastore.js';
import { createMobileWorkbenchQueueRouter } from './mobileWorkbenchQueue.js';
test('queue and durable preferences isolate tenants and users; failed writes do not succeed', async () => {
  const records = new Map<string, Record_>();
  const put = (collection:string, data:Record_) => records.set(collection+'/'+data.id,data);
  put('workflow_tasks',{id:'a',tenant_id:'A',status:'failed',title:'补救'});
  put('workflow_tasks',{id:'b',tenant_id:'B',status:'failed',title:'private'});
  put('workflow_tasks',{id:'done',tenant_id:'A',status:'succeeded'});
  put('approval_requests',{id:'approval',tenant_id:'A',status:'pending',task_id:'a'});
  let failWrite=false; let competingInsert=false;
  const store: DataStore = {
    getById: async <T>(c:string,id:string)=> (records.get(c+'/'+id) || null) as T|null,
    create:async <T>(c:string,d:Record<string,unknown>)=> {if(failWrite)throw Error('offline');put(c,d as Record_);if(competingInsert){competingInsert=false;throw Error('unique key conflict')}return d as T},
    update:async(c,id,d)=> {if(failWrite)return false;const old=records.get(c+'/'+id);if(!old)return false;put(c,{...old,...d});return true},
    delete:async(c,id)=>records.delete(c+'/'+id),
    list:async<T>(c:string,q?:ListQuery)=>{ const items=[...records.entries()].filter(([k,v])=>k.startsWith(c+'/')&&Object.entries(q?.where||{}).every(([f,x])=>v[f]===x)).map(([,v])=>v as T);return {items,totalItems:items.length,totalPages:1,page:1,perPage:200} },
  };
  const app=express();app.use((req,res,next)=>{if(!req.headers['x-tenant']){res.sendStatus(401);return;}res.locals.tenantId=req.headers['x-tenant'];res.locals.userId=req.headers['x-user']||'u1';if(req.headers['x-support'])res.locals.supportAccess={};next()});
  app.use('/mobile',createMobileWorkbenchQueueRouter(store));
  app.use('/denied',createMobileWorkbenchQueueRouter(store,async()=>{throw Error('starter_198_role_required')}));
  app.use('/other',createMobileWorkbenchQueueRouter(store,async()=>({today:{nextSteps:[]},decisions:[{id:'approval:a'}]})));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call=(route:string,body?:unknown,tenant='A',user='u1',support=false)=>fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(tenant?{'x-tenant':tenant}:{}),'x-user':user,...(support?{'x-support':'true'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try {
    assert.equal((await call('/mobile/queue',undefined,'')).status,401);
    assert.equal((await call('/denied/queue')).status,403);
    assert.equal((await call('/denied/snooze',{matterId:'starter:approval:a',until:Date.now()+3600000})).status,403);
    const queue=await (await call('/mobile/queue')).json();assert.deepEqual(queue.tasks.map((t:any)=>t.id),['a']);assert.equal(queue.approvals.length,1);
    const until=Date.now()+3600000;
    assert.equal((await call('/mobile/snooze',{matterId:'task:b',until})).status,404);
    assert.equal((await call('/mobile/snooze',{matterId:'task:done',until})).status,409);
    put('approval_requests',{id:'settled',tenant_id:'A',status:'approved',task_id:'a'});
    assert.equal((await call('/mobile/snooze',{matterId:'approval:settled',until})).status,409);
    // Simulate an insert that another process commits before this process sees a conflict.
    competingInsert=true;
    assert.equal((await call('/mobile/snooze',{matterId:'task:a',until:Date.now()-1})).status,400);
    assert.equal((await call('/mobile/snooze',{matterId:'task:a',until},'A','u1',true)).status,403);
    assert.equal((await call('/mobile/snooze',{matterId:'task:a',until})).status,200);
    assert.equal((await (await call('/mobile/queue')).json()).snoozes['task:a'],until);
    assert.deepEqual((await (await call('/mobile/queue',undefined,'A','u2')).json()).snoozes,{});
    assert.deepEqual((await (await call('/mobile/queue',undefined,'B')).json()).snoozes,{});
    failWrite=true;assert.equal((await call('/mobile/snooze',{matterId:'task:a',until:0})).status,503);failWrite=false;
    assert.equal((await call('/mobile/snooze',{matterId:'task:a',until:0})).status,200);
    assert.deepEqual((await (await call('/mobile/queue')).json()).snoozes,{});
    assert.equal((await call('/other/snooze',{matterId:'starter:approval:missing',until})).status,404);
    assert.equal((await call('/other/snooze',{matterId:'starter:approval:a',until})).status,200);
    assert.equal((await (await call('/other/queue')).json()).snoozes['starter:approval:a'],until);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
});

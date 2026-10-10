import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { recordDecisionMemory, updateDecisionMemory, revokeDecisionMemory, listDecisionMemories } from './decisionMemory.js';
class MemoryStore implements DataStore {
 rows: Record<string, unknown>[]=[];
 async getById<T>(_:string,id:string) { return this.rows.find(r=>r.id===id) as T || null; }
 async create<T>(_:string,r:Record<string,unknown>) { if(this.rows.some(x=>x.id===r.id))return null; this.rows.push(structuredClone(r));return r as T; }
 async update() { return false; } async delete() { return false; }
 async list<T>(_:string,q:ListQuery={}) { const rows=this.rows.filter(r=>Object.entries(q.where||{}).every(([k,v])=>r[k]===v)).sort((a,b)=>{const k=(q.sort||'').replace(/^-/,'');return a[k]!<b[k]!?1:a[k]!>b[k]!?-1:0;});return {items:rows.slice(0,q.perPage||20) as T[],totalItems:rows.length,totalPages:1,page:1,perPage:q.perPage||20}; }
}
const scope={tenantId:'a',userId:'u'};
const input={content:'预算 1000 元',sourceMessageId:'msg-1',explicitlyConfirmed:true as const};
test('isolation, explicit confirmation, provenance, revisions and revoke',async()=>{
 const db=new MemoryStore();const first=await recordDecisionMemory(scope,input,db);
 assert.equal((await listDecisionMemories(scope,{},db)).length,1);
 assert.deepEqual(await listDecisionMemories({...scope,tenantId:'b'},{},db),[]);
 assert.deepEqual(await listDecisionMemories({...scope,userId:'other'},{},db),[]);
 await assert.rejects(recordDecisionMemory(scope,{...input,explicitlyConfirmed:false as unknown as true},db),/confirmation/);
 await assert.rejects(recordDecisionMemory(scope,{...input,expiresAt:'bad'},db),/invalid_decision_expiry/);
 await assert.rejects(updateDecisionMemory(scope,first.memory_id,NaN,input,db),/version/);
 const second=await updateDecisionMemory(scope,first.memory_id,1,{...input,content:'预算 2000 元',sourceMessageId:'msg-2'},db);
 assert.equal(second.version,2);assert.equal(db.rows[0].content,input.content);
 await assert.rejects(updateDecisionMemory(scope,first.memory_id,1,input,db),/conflict/);
 await revokeDecisionMemory(scope,first.memory_id,2,'msg-3',db);
 assert.deepEqual(await listDecisionMemories(scope,{},db),[]);
 assert.equal((await listDecisionMemories(scope,{includeRevoked:true},db))[0].status,'revoked');
});
test('expires, bounds and concurrent revisions',async()=>{
 const db=new MemoryStore();const first=await recordDecisionMemory(scope,{...input,expiresAt:'2090-01-01'},db);
 assert.deepEqual(await listDecisionMemories(scope,{now:new Date('2091-01-01')},db),[]);
 const results=await Promise.allSettled([updateDecisionMemory(scope,first.memory_id,1,input,db),updateDecisionMemory(scope,first.memory_id,1,input,db)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 for(let i=0;i<25;i++)await recordDecisionMemory(scope,input,db);
 assert.equal((await listDecisionMemories(scope,{limit:100},db)).length,20);
 await assert.rejects(listDecisionMemories(scope,{limit:NaN},db),/limit/);
});
test('defensive isolation rejects a store returning other tenant rows',async()=>{
 const db=new MemoryStore();const other=await recordDecisionMemory({...scope,tenantId:'other'},input,db);
 db.list=async<T>()=>({items:db.rows as T[],totalItems:1,totalPages:1,page:1,perPage:1});
 assert.deepEqual(await listDecisionMemories(scope,{},db),[]);
 await assert.rejects(updateDecisionMemory(scope,other.memory_id,1,input,db),/not_found/);
});

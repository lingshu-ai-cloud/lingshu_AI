import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { createFollowupBatch, getFollowupBatchItems } from './customerWorkflow.js';

test('real batch generator hashes the frozen persisted schedules and survives reversed storage order', async () => {
  const tenant = 'isolated-followup-freeze';
  const records: Record<string,any[]> = {
    customer_segments: [{id:'segment',tenant_id:tenant,run_id:'run',status:'generated'}],
    customer_segment_members: ['a','b'].map(id => ({id:`member-${id}`,tenant_id:tenant,segment_id:'segment',customer_id:id,membership:'included',customer_snapshot:{id},risk_level:'low',created_at:'2026-10-05T00:00:00Z'})),
  };
  const original = { list:store.list,getById:store.getById,create:store.create,update:store.update };
  let sequence=0;
  store.list=(async(collection:string,query:any={})=>{const found=(records[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));const items=collection==='followup_batch_items'?[...found].reverse():found;return {items:structuredClone(items),totalItems:items.length,totalPages:1,page:1,perPage:1000};}) as typeof store.list;
  store.getById=(async(collection:string,id:string)=>structuredClone(records[collection]?.find(row=>row.id===id)??null)) as typeof store.getById;
  store.create=(async(collection:string,data:any)=>{const row={id:`generated-${++sequence}`,...structuredClone(data)};(records[collection]??=[]).push(row);return structuredClone(row);}) as typeof store.create;
  store.update=(async()=>{throw Error('new batch must not mutate or send customer messages');}) as typeof store.update;
  try {
    const generated = await createFollowupBatch({tenantId:tenant,goalId:'goal',runId:'run',taskId:'draft-task',segmentId:'segment',userId:'owner',draftOverrides:{a:'Hello, what specifications do you need?',b:'Hello, which product would you like to discuss?'}},()=>['a','b'].map(id=>({id,timeZone:'UTC',waNumber:`1555000000${id}`,language:'en',lastInboundAt:new Date().toISOString(),intentScore:50})));
    const policy=generated.batch.delivery_policy as any;
    assert.equal(policy.hashAlgorithm,'stable_customer_body_schedule_v1');
    assert.deepEqual(policy.frozenMemberOrder,['member-a','member-b']);
    const ordered=await getFollowupBatchItems(tenant,generated.batch.id);
    assert.deepEqual(ordered.map(item=>item.customer_id),['a','b']);
    const expectedHash=createHash('sha256').update(JSON.stringify(ordered.map(item=>({body:item.draft_body,customerId:item.customer_id,scheduledAt:item.scheduled_at})))).digest('hex');
    assert.equal(generated.batch.content_hash,expectedHash);
    assert.ok(ordered.every(item=>Number.isFinite(Date.parse(item.scheduled_at))));
    assert.ok(ordered.every(item=>!item.provider_message_id&&!item.sent_at));
  } finally {Object.assign(store,original);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyFollowups, dailyFollowupReaders, prioritizeDailyCustomers } from './dailyFollowups.js';

const now = new Date('2026-10-27T09:00:00Z');
const customers = Array.from({ length: 12 }, (_, i) => ({ id: `buyer-${String(i).padStart(2, '0')}`, name: `Customer ${i}`, source: 'messenger', intentScore: 100 - i, timeline: [{ actor: 'buyer', body: 'Please send your catalog', timestamp: now.getTime() - i * 60000 }] }));
test('daily five rotate only after verified sends, preserve unhandled rows and use Beijing day', () => {
  const first = prioritizeDailyCustomers(customers, new Set(), now);
  assert.equal(first.day, '2026-10-27'); assert.equal(first.customers.length, 5);
  const completed = new Set(first.customers.map(c => c.id));
  const second = prioritizeDailyCustomers(customers, completed, now);
  assert.deepEqual(second.customers.map(c => c.id), customers.slice(5, 10).map(c => c.id));
  assert.equal(second.remaining, 7);
  assert.equal(prioritizeDailyCustomers(customers, new Set(customers.slice(0, 10).map(c => c.id)), now).customers.length, 2);
  assert.equal(prioritizeDailyCustomers(customers, new Set(customers.map(c => c.id)), now).customers.length, 0);
  assert.deepEqual(prioritizeDailyCustomers(customers, completed, now), second, 'refresh must preserve the same unhandled clients');
  assert.equal(prioritizeDailyCustomers([], new Set(), new Date('2026-10-27T16:00:00Z')).day, '2026-10-28');
});
test('historical, read-only, opted-out and simulated clients never become send targets', () => {
  const result = prioritizeDailyCustomers([{ ...customers[0], isMock: true }, { ...customers[1], readOnly: true }, { ...customers[2], optedOut: true }, { ...customers[3], isHistorical: true }, customers[4]], new Set(), now);
  assert.deepEqual(result.customers.map(c => c.id), [customers[4].id]);
});
test('queued, failed, unknown and yesterday receipts do not remove clients; accepted identity is revalidated', async () => {
  let reads = 0;
  const payloads = ['accepted', 'unknown', 'failed', 'yesterday', 'missing-id'].map((status, i) => ({ customerId: customers[i].id, requestId: status, channel: 'messenger', settledAt: status === 'yesterday' ? '2026-10-26T00:00:00Z' : now.toISOString() }));
  const read = { ...dailyFollowupReaders, profile: async () => ({ enterprise: '', factVersion: undefined }), customers: async () => customers,
    scan: async () => payloads.map((payload, i) => ({ id: String(i), payload })),
    receipt: async (_store: unknown, tenant: string, channel: string, id: string) => {
      reads++; assert.equal(tenant, 'tenant-a'); assert.equal(channel, 'messenger');
      const p = payloads.find(p => p.requestId === id)!;
      return { customerId: p.customerId, status: id === 'unknown' ? 'unknown' : 'accepted', providerMessageId: id === 'missing-id' ? null : 'provider-message', deliveryStatus: id === 'failed' ? 'failed' : 'sent' };
    },
  } as unknown as typeof dailyFollowupReaders;
  const result = await dailyFollowups({ tenantId: 'tenant-a', userId: 'user-a', role: 'admin' }, now, read);
  assert.equal(reads, 4); assert.equal(result.completed, 1);
  assert.ok(!result.customers.some(c => c.id === customers[0].id));
  assert.ok(result.customers.some(c => c.id === customers[1].id));
});

test('local exercise copies require explicit preview mode and never become native-channel customers', () => {
  const copy = {...customers[0],id:'preview_followup_existing',source:'local_followup',isMock:true,localFollowupPreview:true};
  assert.equal(prioritizeDailyCustomers([copy],new Set(),now).customers.length,0);
  const preview = prioritizeDailyCustomers([copy,{...copy,id:'unscoped-mock'}],new Set(),now,true);
  assert.equal(preview.customers.length,1);assert.equal(preview.customers[0].channel,'本地演练');
  assert.equal(prioritizeDailyCustomers([copy],new Set([copy.id]),now,true).customers.length,0);
});

test('a locally persisted exercise reply removes only that exercise copy from the current day', async () => {
  const prior={NODE_ENV:process.env.NODE_ENV,LINGSHU_LISTEN_HOST:process.env.LINGSHU_LISTEN_HOST,LOCAL_FOLLOWUP_PREVIEW_TENANT_ID:process.env.LOCAL_FOLLOWUP_PREVIEW_TENANT_ID};
  Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LISTEN_HOST:'127.0.0.1',LOCAL_FOLLOWUP_PREVIEW_TENANT_ID:'local-tenant'});
  try {
    const copies=customers.slice(0,5).map((c,i)=>({...c,id:`preview_followup_${i}`,source:'local_followup',isMock:true,localFollowupPreview:true}));
    copies[0].timeline.push({actor:'seller',body:'Edited and saved locally',timestamp:now.getTime(),sendStatus:'sent',localPreviewReceipt:true} as any);
    const read={...dailyFollowupReaders,profile:async()=>({}),customers:async()=>copies,scan:async()=>[]} as unknown as typeof dailyFollowupReaders;
    const result=await dailyFollowups({tenantId:'local-tenant',userId:'user',role:'admin'},now,read);
    assert.equal(result.completed,1);assert.equal(result.remaining,4);assert.ok(!result.customers.some(c=>c.id===copies[0].id));
  } finally {for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

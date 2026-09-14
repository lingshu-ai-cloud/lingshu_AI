import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { createCustomerSegmentSnapshot, createFollowupBatch, getCustomerSegment } from './customerWorkflow.js';

type CustomerFixture = { id: string; name: string; wa_number: string; last_inbound_at: string; draft_body: string; tags?: string[] };
const fixture: { tenant_id: string; clock: string; customers: CustomerFixture[] } = {
  tenant_id: 'isolated-customer-creation-mock',
  clock: '2026-09-06T12:00:00.000Z',
  customers: [
    { id: 'mock_customer_recent', name: 'MOCK recent buyer', wa_number: '+12025550101', last_inbound_at: '2026-09-06T06:00:00.000Z', draft_body: 'MOCK TEST: Here is the requested product information.' },
    { id: 'mock_customer_template', name: 'MOCK earlier buyer', wa_number: '+12025550102', last_inbound_at: '2026-09-04T06:00:00.000Z', draft_body: 'MOCK TEST: May we follow up with the requested product details?' },
    { id: 'mock_customer_optout', name: 'MOCK opted-out buyer', wa_number: '+12025550103', last_inbound_at: '2026-09-06T08:00:00.000Z', tags: ['opt-out'], draft_body: 'MOCK TEST: This draft must never be queued.' },
  ],
};
const enterprise = { profile: { company: { name: 'MOCK company', industry: 'Clothing' }, products: { items: [{ name: 'MOCK cotton shirt' }] }, knowledge: {} } };
const tenantId = fixture.tenant_id;
const now = Date.now();
const fixtureClock = Date.parse(fixture.clock);
const customers = fixture.customers.map(customer => ({
  ...customer, tenantId, waNumber: customer.wa_number, timeZone: 'Asia/Shanghai',
  handlingMode: 'ai', stage: 'inquiry', intentScore: 65,
  timeline: [{ actor: 'buyer', timestamp: now - (fixtureClock - Date.parse(customer.last_inbound_at)), body: 'MOCK product enquiry' }],
}));
const rows: Record<string, any[]> = { tenant_profiles: [{ id: 'profile', tenant_id: tenantId, profile: enterprise.profile }] };
const original = { list: store.list, getById: store.getById, create: store.create, update: store.update };
const originalFetch = globalThis.fetch;
let networkCalls = 0;
let nextId = 0;
store.list = (async (collection: string, options: any = {}) => {
  let items = (rows[collection] || []).filter(row => Object.entries(options.where || {}).every(([key, value]) => row[key] === value));
  const sort = options.sort || '';
  if (sort) { const field = sort.replace(/^-/, ''); items = [...items].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (sort.startsWith('-') ? -1 : 1)); }
  const page = options.page || 1; const perPage = options.perPage || 100;
  return { items: items.slice((page - 1) * perPage, page * perPage), page, perPage, totalItems: items.length, totalPages: Math.ceil(items.length / perPage) };
}) as typeof store.list;
store.getById = (async (collection: string, id: string) => (rows[collection] || []).find(row => row.id === id) || null) as typeof store.getById;
store.create = (async (collection: string, payload: any) => {
  const row = { ...payload, id: `mock_${collection}_${++nextId}` };
  (rows[collection] ||= []).push(row); return row;
}) as typeof store.create;
store.update = (async (collection: string, id: string, payload: any) => {
  const row = (rows[collection] || []).find(row => row.id === id); if (!row) return false;
  Object.assign(row, payload); return true;
}) as typeof store.update;
globalThis.fetch = (async () => { networkCalls++; throw Error('Network prohibited in customer creation mock test'); }) as typeof fetch;
const customerProvider = (requestedTenant: string) => {
  assert.equal(requestedTenant, tenantId, 'customer provider must be tenant scoped'); return customers;
};
const segmentInput = { tenantId, runId: 'mock_run', goalId: 'mock_goal', taskId: 'mock_segment_task', userId: 'mock_operator' };
try {
  const segment = await createCustomerSegmentSnapshot(segmentInput, customerProvider);
  assert.equal(segment.created, true);
  assert.equal(segment.segment.member_count, 2, 'opted-out customer must not be included in actionable segment');
  assert.equal(segment.segment.excluded_count, 1);
  assert.equal(segment.members.find(row => row.customer_id === 'mock_customer_recent')?.membership, 'included');
  assert.equal(segment.members.find(row => row.customer_id === 'mock_customer_template')?.membership, 'included');
  assert.equal(segment.members.find(row => row.customer_id === 'mock_customer_optout')?.membership, 'excluded');
  const sameSegment = await createCustomerSegmentSnapshot(segmentInput, customerProvider);
  assert.equal(sameSegment.created, false); assert.equal(sameSegment.segment.id, segment.segment.id);
  assert.equal(rows.customer_segments.length, 1); assert.equal(rows.customer_segment_members.length, 3);
  assert.equal(await getCustomerSegment('other_tenant', segment.segment.id), null);
  const batchInput = { ...segmentInput, taskId: 'mock_draft_task', segmentId: segment.segment.id,
    draftOverrides: Object.fromEntries(customers.map(customer => [customer.id, customer.draft_body || 'MOCK TEST: What product information would be useful?'])),
  };
  await assert.rejects(() => createFollowupBatch({ ...batchInput, tenantId: 'other_tenant' }, customerProvider), /customer_segment_not_found/);
  await assert.rejects(() => createFollowupBatch({ ...batchInput, runId: 'wrong_run' }, customerProvider), /customer_segment_not_found/);
  const batch = await createFollowupBatch(batchInput, customerProvider);
  assert.equal(batch.created, true); assert.equal(batch.items.length, 2);
  const recent = batch.items.find(row => row.customer_id === 'mock_customer_recent')!;
  const old = batch.items.find(row => row.customer_id === 'mock_customer_template')!;
  assert.equal(recent.status, 'draft'); assert.equal(recent.outside_24h, false); assert.equal(recent.send_mode, 'session_message');
  assert.equal(old.status, 'blocked'); assert.equal(old.send_mode, 'template_required');
  assert.match(old.exclusion_reason, /whatsapp_template_required/);
  assert.equal(batch.items.some(row => row.customer_id === 'mock_customer_optout'), false);
  assert.equal(batch.batch.approved_version, 0);
  const sameBatch = await createFollowupBatch(batchInput, customerProvider);
  assert.equal(sameBatch.created, false); assert.equal(sameBatch.batch.id, batch.batch.id);
  assert.equal(rows.followup_batches.length, 1); assert.equal(rows.followup_batch_items.length, 2);
  assert.ok(batch.items.every(row => row.attempts === 0 && !row.provider_message_id && !row.sent_at));
  assert.equal(networkCalls, 0, 'draft overrides must bypass all LLM/network calls');
  console.log('Mock customer creation passed: actual segmentation, persisted drafts, opt-out exclusion, 24h template gate, sequential idempotency and tenant/run isolation; no network or real storage');
} finally { Object.assign(store, original); globalThis.fetch = originalFetch; }

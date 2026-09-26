import assert from 'node:assert/strict';
import fs from 'node:fs';
import { store } from '../storage/index.js';
import { confirmSalesQualification, createCreativeLearning, listCreativeLearnings, listInteractionWritebacks, normalizeInteractionWriteback, writebackInteraction } from './writeback.js';

type Row = { id: string; [key: string]: unknown };
const records = new Map<string, Row[]>();
const original = { list: store.list, create: store.create, update: store.update, getById: store.getById };
const routeSource = fs.readFileSync('server/routes/socialEngagement.ts', 'utf8');
assert.match(routeSource, /requestOrganizationRoleStrict/, 'human qualification must resolve a trusted organization role');
assert.match(routeSource, /trusted_crm_integration_required/, 'a browser caller must not impersonate a trusted CRM');
assert.match(routeSource, /authority: 'sales'/, 'authorized human qualification is recorded as sales authority');
assert.match(routeSource, /creative_learning_write_forbidden/, 'customer-service users must not author director learnings');
assert.match(routeSource, /interaction_writeback_forbidden/, 'interaction ingestion must reject unresolved organization roles');

(store as any).list = async (collection: string, query: any = {}) => {
  let items = [...(records.get(collection) || [])];
  for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
  if (query.sort?.startsWith('-')) items.reverse();
  return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage || 500 };
};
(store as any).create = async (collection: string, data: Omit<Row, 'id'>) => {
  const item = { id: `${collection}-${(records.get(collection)?.length || 0) + 1}`, ...data };
  records.set(collection, [...(records.get(collection) || []), item]); return item;
};
(store as any).getById = async (collection: string, id: string) => (records.get(collection) || []).find(item => item.id === id) || null;
(store as any).update = async (collection: string, id: string, data: Row) => {
  const items = records.get(collection) || []; const index = items.findIndex(item => item.id === id);
  if (index < 0) return false; items[index] = { ...items[index], ...data }; return true;
};

try {
  assert.throws(() => normalizeInteractionWriteback({ kind: 'comment', platform: 'youtube', providerEventId: 'c1', accountId: 'a1', body: 'Price?', occurredAt: '2026-09-26T00:00:00Z' }), /comment_content_required/);
  assert.throws(() => normalizeInteractionWriteback({ kind: 'comment', platform: 'youtube', providerEventId: 'c0', contentId: 'video-1', body: 'Price?', occurredAt: '2026-09-26T00:00:00Z' }), /comment_account_required/);

  const comment = await writebackInteraction('tenant-a', { kind: 'comment', platform: 'youtube', providerEventId: 'c1', accountId: 'a1', contentId: 'video-1', body: 'Price?', occurredAt: '2026-09-26T00:00:00Z' });
  assert.equal(comment.item.source_confidence, 'confirmed');
  assert.equal((await writebackInteraction('tenant-a', { kind: 'comment', platform: 'youtube', providerEventId: 'c1', accountId: 'a1', contentId: 'video-1', body: 'Changed upstream text', occurredAt: '2026-09-26T00:00:00Z' })).repeated, true, 'provider events are idempotent');
  assert.equal((await writebackInteraction('tenant-b', { kind: 'comment', platform: 'youtube', providerEventId: 'c1', accountId: 'a1', contentId: 'video-1', body: 'Same provider event in another tenant', occurredAt: '2026-09-26T00:00:00Z' })).repeated, false, 'idempotency keys remain tenant isolated');
  assert.equal((await listInteractionWritebacks('tenant-a', 'comment')).length, 1, 'interaction reads remain tenant and kind scoped');

  const inquiry = await writebackInteraction('tenant-a', { kind: 'inquiry', platform: 'whatsapp', providerEventId: 'm1', accountId: 'wa-business-1', body: 'Need 1000 custom bottles for UAE', occurredAt: '2026-09-26T01:00:00Z' });
  assert.equal(inquiry.item.contentId, undefined, 'an inquiry is retained without invented content attribution');
  assert.equal(inquiry.item.source_confidence, 'unknown');
  const unattributedDm = await writebackInteraction('tenant-a', { kind: 'direct_message', platform: 'instagram', providerEventId: 'dm-1', body: 'Please send a catalog', occurredAt: '2026-09-26T01:05:00Z' });
  assert.equal(unattributedDm.item.accountId, 'unknown', 'unattributed DMs are retained rather than discarded');
  assert.equal(unattributedDm.item.source_confidence, 'unknown');
  await assert.rejects(confirmSalesQualification({ tenantId: 'tenant-a', interactionId: inquiry.item.id, status: 'qualified', authority: 'agent' as any, actorId: 'u1', reason: 'BANT looks high' }), /qualification_authority_required/);
  await assert.rejects(confirmSalesQualification({ tenantId: 'tenant-a', interactionId: inquiry.item.id, status: 'candidate' as any, authority: 'sales', actorId: 'u1', reason: 'Not a final decision' }), /qualification_status_required/);
  const qualified = await confirmSalesQualification({ tenantId: 'tenant-a', interactionId: inquiry.item.id, status: 'qualified', authority: 'sales', actorId: 'sales-1', reason: 'Sales verified buyer, quantity and destination' });
  assert.equal(qualified.sourceContentId, null);
  assert.equal((records.get('social_interaction_writebacks') || []).find(row => row.id === inquiry.item.id)?.qualification_status, 'qualified');
  await confirmSalesQualification({ tenantId: 'tenant-a', interactionId: inquiry.item.id, status: 'disqualified', authority: 'sales', actorId: 'sales-1', reason: 'Buyer withdrew and sales closed the lead' });
  assert.equal((records.get('social_sales_qualifications') || []).length, 2, 'sales decisions are append-only audit records');
  assert.equal((records.get('social_interaction_writebacks') || []).find(row => row.id === inquiry.item.id)?.qualification_status, 'disqualified');
  await assert.rejects(confirmSalesQualification({ tenantId: 'tenant-b', interactionId: inquiry.item.id, status: 'qualified', authority: 'sales', actorId: 'sales-2', reason: 'Cross tenant attempt' }), /inquiry_not_found/);

  await assert.rejects(createCreativeLearning('tenant-a', 'director-1', { evidenceKind: undefined as any, scope: { contentIds: [] }, observation: 'Hook worked', evidenceRefs: ['post-1'], sample: { startsAt: '2026-09-20', endsAt: '2026-09-26', size: 1 }, boundaries: [], nextAction: 'Repeat' }), /creative_learning_kind_required/);
  await assert.rejects(createCreativeLearning('tenant-a', 'director-1', { evidenceKind: 'external_reference', scope: { contentIds: [] }, observation: 'Hook worked', evidenceRefs: [], sample: { startsAt: '2026-09-20', endsAt: '2026-09-26', size: 0 }, boundaries: [], nextAction: 'Repeat' }), /creative_learning_evidence_required/);
  await assert.rejects(createCreativeLearning('tenant-a', 'director-1', { evidenceKind: 'external_reference', scope: { contentIds: [] }, observation: 'Hook worked', evidenceRefs: ['post-1'], sample: { startsAt: '2026-09-27', endsAt: '2026-09-26', size: 1 }, boundaries: [], nextAction: 'Repeat' }), /creative_learning_sample_range_invalid/);
  const learning = await createCreativeLearning('tenant-a', 'director-1', { evidenceKind: 'owned_content_result', scope: { platform: 'tiktok', accountId: 'a1', contentIds: ['video-1'], businessDirection: 'sampling' }, observation: 'Sample comparison produced more complete inquiry fields.', evidenceRefs: ['video-1', inquiry.item.id], sample: { startsAt: '2026-09-20', endsAt: '2026-09-26', size: 12 }, boundaries: ['Short sample; no deal attribution'], nextAction: 'Test a checklist CTA.' });
  assert.equal((learning as any).version, 1);
  assert.equal((learning as any).evidence_kind, 'owned_content_result');
  const learningV2 = await createCreativeLearning('tenant-a', 'director-1', { learningId: (learning as any).learning_id, evidenceKind: 'owned_content_result', scope: { platform: 'tiktok', accountId: 'a1', contentIds: ['video-1'], businessDirection: 'sampling' }, observation: 'The follow-up sample retained the same signal.', evidenceRefs: ['video-1', inquiry.item.id], sample: { startsAt: '2026-09-20', endsAt: '2026-09-27', size: 18 }, boundaries: ['Still no deal attribution'], nextAction: 'Run one controlled CTA variant.' });
  assert.equal((learningV2 as any).version, 2, 'an explicit learning id creates an immutable next version');
  assert.equal((await listCreativeLearnings('tenant-a')).length, 2, 'all immutable learning versions remain readable');
  assert.equal((await listCreativeLearnings('tenant-b')).length, 0, 'creative learning reads remain tenant scoped');
  assert.deepEqual((learning as any).sample, { startsAt: '2026-09-20T00:00:00.000Z', endsAt: '2026-09-26T00:00:00.000Z', size: 12 });
} finally {
  Object.assign(store, original);
}

console.log('social interaction writeback tests passed');

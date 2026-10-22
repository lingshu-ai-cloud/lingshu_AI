import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { reserveImageEvidencePaidCall } from '../agents/imageEvidencePaidContext.js';
import { imagePostSourceHash } from './imagePostReanalysis.js';
import {
  approveImageEvidenceReview, createImageEvidenceApprovalAssertions,
  imageEvidenceReviewApprovalId, readCurrentImageEvidenceReviewApproval,
  revokeImageEvidenceReview, IMAGE_EVIDENCE_REVIEW_APPROVALS, IMAGE_EVIDENCE_REVIEW_REVOCATIONS,
} from './imageEvidenceReviewApproval.js';

const now = Date.parse('2026-10-23T08:00:00Z');
function fixture() {
  const rows = new Map<string, Record_[]>();
  const insert = (collection: string, row: Record_) => rows.set(collection,
    [...(rows.get(collection) ?? []), structuredClone(row)]);
  const record: Record_ = { id: 'image-a', tenantId: 'tenant-a', contentFormat: 'image',
    sourceUrl: 'https://example.test/post', thumbnailUrl: 'https://example.test/cover.jpg',
    aiAnalysis: { contentFormat: 'image', caption: 'Bottle', imageUrls: ['https://example.test/a.jpg'] } };
  insert('trend_videos', record);
  insert('users', { id: 'owner', tenantId: 'tenant-a', role: 'social_operator', active: true });
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id)
      ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (rows.get(collection)?.some(row => row.id === data.id)) return null;
      const row = structuredClone(data) as Record_;
      insert(collection, row);
      return row as T;
    },
    async update(collection, id, data) {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      return true;
    },
    async list<T>(collection: string, query: ListQuery = {}) {
      const all = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: structuredClone(all.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)), page, perPage };
    },
    async delete() { return false; },
  };
  const recordSha256 = imagePostSourceHash(record);
  const approvalId = imageEvidenceReviewApprovalId('tenant-a', record.id, recordSha256);
  const intent = { operationId: `image-evidence-review:${approvalId}`, provider: 'openai',
    model: 'gpt-4.1-mini', accountRef: 'openai:verified-account',
    stage: 'image_post_evidence_review', shotId: null,
    inputContractHash: 'b'.repeat(64), maximumUnits: { inputTokens: 1000, outputTokens: 7000 } };
  const request = { store, tenantId: 'tenant-a', recordId: record.id, recordSha256,
    maximumCny: 5, intent, approvedBy: 'owner',
    expiresAt: new Date(now + 60_000).toISOString(), now: () => now };
  return { store, rows, record, request };
}

test('one human approval freezes exact image source, request and CNY ceiling', async () => {
  const f = fixture();
  const result = await Promise.allSettled([approveImageEvidenceReview(f.request),
    approveImageEvidenceReview(f.request)]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  const approved = result.find(item => item.status === 'fulfilled');
  assert.ok(approved && approved.status === 'fulfilled');
  const item = approved.value;
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 1);
  assert.equal(item.plan.scope.taskId, `image-evidence:image-a:${f.request.recordSha256}`);
  assert.equal(item.plan.maximumCny, 5);
  const ports = createImageEvidenceApprovalAssertions({ store: f.store, approval: item,
    now: () => now + 1 });
  assert.deepEqual(await ports.readApprovedPlan(item.plan.scope), item.plan);
  await ports.assertApproved({ scope: item.plan.scope, authorizationRef: item.approvalId });
  await ports.assertRecordCurrent({ tenantId: item.tenantId, recordId: item.recordId,
    recordSha256: item.recordSha256 });
  await assert.rejects(ports.readApprovedPlan({ ...item.plan.scope, tenantId: 'tenant-b' }), /scope_changed/);
  await assert.rejects(ports.assertApproved({ scope: item.plan.scope,
    authorizationRef: 'browser-claim' }), /scope_changed/);
});

test('approval rejects cross-tenant actor, changed source and unbounded plan before storage', async () => {
  const f = fixture();
  await f.store.update('users', 'owner', { tenantId: 'tenant-b' });
  await assert.rejects(approveImageEvidenceReview(f.request), /actor_invalid/);
  await f.store.update('users', 'owner', { tenantId: 'tenant-a' });
  await assert.rejects(approveImageEvidenceReview({ ...f.request, maximumCny: 16 }), /plan_invalid/);
  await assert.rejects(approveImageEvidenceReview({ ...f.request, intent: {
    ...f.request.intent, maximumUnits: { inputTokens: 1000, outputTokens: 7001 },
  } }), /plan_invalid/);
  await f.store.update('trend_videos', 'image-a', { thumbnailUrl: 'https://example.test/new.jpg' });
  await assert.rejects(approveImageEvidenceReview(f.request), /source_changed/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

test('source change, expiry, tampering and revocation each close the approved plan', async () => {
  const f = fixture();
  const approved = await approveImageEvidenceReview(f.request);
  const read = () => readCurrentImageEvidenceReviewApproval({ store: f.store,
    approval: approved, now: now + 1 });
  await read();
  await assert.rejects(readCurrentImageEvidenceReviewApproval({ store: f.store,
    approval: approved, now: now + 60_001 }), /changed_or_expired/);
  await f.store.update('trend_videos', 'image-a', { thumbnailUrl: 'https://example.test/new.jpg' });
  await assert.rejects(read(), /source_changed/);
  await f.store.update('trend_videos', 'image-a', { thumbnailUrl: f.record.thumbnailUrl });
  const row = f.rows.get(IMAGE_EVIDENCE_REVIEW_APPROVALS)![0]!;
  const original = structuredClone(row);
  (row.payload as { plan: { maximumCny: number } }).plan.maximumCny = 15;
  await assert.rejects(read(), /changed_or_expired/);
  Object.assign(row, original);
  await revokeImageEvidenceReview({ store: f.store, approval: approved,
    actorUserId: 'owner', reason: 'withdrawn', now: () => now + 1 });
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_REVOCATIONS)).totalItems, 1);
  await assert.rejects(read(), /revoked/);
});

test('stored approval feeds the existing budget permit and revocation blocks a later claim', async () => {
  const f = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-approval-permit-'));
  try {
    const approval = await approveImageEvidenceReview(f.request);
    const assertions = createImageEvidenceApprovalAssertions({ store: f.store,
      approval, now: () => now + 1 });
    const scope = approval.plan.scope;
    const input = { scope, recordId: approval.recordId, recordSha256: approval.recordSha256,
      requestSha256: f.request.intent.inputContractHash,
      ledgerRoot: path.join(root, 'ledger'), permitRoot: path.join(root, 'permits'),
      receiptRoot: path.join(root, 'receipts'),
      ports: { ...assertions, async assertSharedVolume() {}, async assertProviderBinding() {},
        async measureInputTokens() { return 100; },
        async readVerifiedTariff() { return { provider: 'openai', model: f.request.intent.model,
          accountRef: f.request.intent.accountRef, stage: f.request.intent.stage, currency: 'CNY' as const,
          verifiedAccountPrice: true, evidenceRef: 'offline-verified-tariff',
          checkedAt: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
          meters: { inputTokens: { priceCny: .1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 },
            outputTokens: { priceCny: .1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 } } }; },
      } };
    const call = await reserveImageEvidencePaidCall(input);
    assert.equal(call.intent.operationId, f.request.intent.operationId);
    await revokeImageEvidenceReview({ store: f.store, approval,
      actorUserId: 'owner', reason: 'withdrawn', now: () => now + 1 });
    await assert.rejects(reserveImageEvidencePaidCall(input), /revoked/);
    const { maximumUnits: _, ...binding } = call.intent;
    await assert.rejects(call.permit.beforeSubmit({ ...binding,
      actualUnits: { inputTokens: 100, outputTokens: 7000 } }), /revoked/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

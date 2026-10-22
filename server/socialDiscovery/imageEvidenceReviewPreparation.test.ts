import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { SocialPaidOperationIntent, SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { buildOpenAiImageEvidenceRequest } from '../agents/openaiImageEvidence.js';
import { IMAGE_EVIDENCE_REVIEW_APPROVALS } from './imageEvidenceReviewApproval.js';
import { prepareAndApproveImageEvidenceReview, quoteImageEvidenceReview } from './imageEvidenceReviewPreparation.js';

const now = Date.parse('2026-10-23T08:00:00Z');
const image = { base64: Buffer.from('fixture-image-bytes').toString('base64'), mimeType: 'image/png', imageIndex: 1 };

function fixture() {
  const rows = new Map<string, Record_[]>();
  const insert = (collection: string, row: Record_) => rows.set(collection, [...(rows.get(collection) ?? []), structuredClone(row)]);
  insert('trend_videos', { id: 'image-a', tenantId: 'tenant-a', contentFormat: 'image',
    sourceUrl: 'https://example.test/post', thumbnailUrl: 'https://example.test/cover.png',
    platform: 'instagram', title: 'Bottle', tags: ['sample'],
    aiAnalysis: { contentFormat: 'image', caption: 'Visible bottle', imageUrls: ['https://example.test/cover.png'],
      imageAnalysisStatus: 'analyzed' } });
  insert('users', { id: 'owner', tenantId: 'tenant-a', role: 'social_operator', active: true });
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
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
  const tariff = (intent: SocialPaidOperationIntent): SocialVerifiedAccountTariff => ({
    provider: intent.provider, model: intent.model, accountRef: intent.accountRef, stage: intent.stage,
    currency: 'CNY', verifiedAccountPrice: true, evidenceRef: 'offline-account-evidence',
    checkedAt: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
    meters: { inputTokens: { priceCny: .1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 },
      outputTokens: { priceCny: .1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 } },
  });
  const ports = {
    async readProviderBinding() { return { model: 'gpt-4.1-mini', accountRef: 'openai:verified-test' }; },
    async readSourceImages(_record: Record_, urls: string[]) {
      assert.deepEqual(urls, ['https://example.test/cover.png']);
      return [image];
    },
    async measureInputTokenUpperBound() { return 1000; },
    async readVerifiedTariff(intent: SocialPaidOperationIntent) { return tariff(intent); },
  };
  const input = { store, tenantId: 'tenant-a', recordId: 'image-a', approvedBy: 'owner',
    maximumCny: 5, expiresAt: new Date(now + 60_000).toISOString(), now: () => now,
    expectedQuoteFingerprint: 'f'.repeat(64), ports };
  return { rows, store, input, ports };
}

test('trusted preparation freezes source, exact multimodal request, metered envelope and one approval', async () => {
  const f = fixture();
  const shown = await quoteImageEvidenceReview(f.input);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
  assert.match(shown.quoteFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(shown.model, 'gpt-4.1-mini');
  f.input.expectedQuoteFingerprint = shown.quoteFingerprint;
  const result = await prepareAndApproveImageEvidenceReview(f.input);
  assert.deepEqual(result.reviewReasons, ['primary_evidence_unavailable']);
  assert.equal(result.approval.plan.paidOperations[0]?.maximumUnits.inputTokens, 1000);
  assert.equal(result.approval.plan.paidOperations[0]?.maximumUnits.outputTokens, 7000);
  assert.ok(result.quotedUpperBoundCny > 0 && result.quotedUpperBoundCny < 5);
  assert.equal(result.approval.plan.paidOperations[0]?.inputContractHash, result.requestSha256);
  const expected = buildOpenAiImageEvidenceRequest({ images: [image], title: 'Bottle',
    caption: 'Visible bottle', platform: 'instagram', tags: ['sample'],
    reviewReasons: ['primary_evidence_unavailable'] }, 'gpt-4.1-mini');
  assert.equal(result.requestSha256, expected.requestSha256);
  assert.equal(result.quoteFingerprint, shown.quoteFingerprint);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 1);
});

test('approval rejects missing, changed-price and changed-source quote fingerprints without writing', async () => {
  const f = fixture();
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /quote_changed/);
  const shown = await quoteImageEvidenceReview(f.input);
  f.input.expectedQuoteFingerprint = shown.quoteFingerprint;
  const originalTariff = f.ports.readVerifiedTariff;
  f.ports.readVerifiedTariff = async intent => ({ ...(await originalTariff(intent)), evidenceRef: 'new-account-price' });
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /quote_changed/);
  f.ports.readVerifiedTariff = originalTariff;
  await f.store.update('trend_videos', 'image-a', { thumbnailUrl: 'https://example.test/other.png' });
  f.ports.readSourceImages = async () => [image];
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /quote_changed/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

test('same source URL with changed image bytes cannot reuse a prior quote', async () => {
  const f = fixture();
  f.input.expectedQuoteFingerprint = (await quoteImageEvidenceReview(f.input)).quoteFingerprint;
  f.ports.readSourceImages = async () => [{ ...image, base64: Buffer.from('different-image-bytes').toString('base64') }];
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /quote_changed/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

test('missing account tariff, token bound and incomplete images never write approval', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.ports.readVerifiedTariff = async () => null as never; },
    (f: ReturnType<typeof fixture>) => { f.ports.measureInputTokenUpperBound = async () => 0; },
    (f: ReturnType<typeof fixture>) => { f.ports.readSourceImages = async () => []; },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(prepareAndApproveImageEvidenceReview(f.input));
    assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
  }
});

test('a valid quote still cannot approve above the explicitly chosen CNY ceiling', async () => {
  const f = fixture();
  f.input.expectedQuoteFingerprint = (await quoteImageEvidenceReview(f.input)).quoteFingerprint;
  f.input.maximumCny = .01;
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /budget_insufficient/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

test('changed source after image retrieval cannot receive an approval', async () => {
  const f = fixture();
  f.ports.readSourceImages = async () => {
    await f.store.update('trend_videos', 'image-a', { thumbnailUrl: 'https://example.test/changed.png' });
    return [image];
  };
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /source_changed/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

test('complete high-confidence primary evidence does not create an unnecessary paid review', async () => {
  const f = fixture();
  const record = await f.store.getById<Record_>('trend_videos', 'image-a');
  assert.ok(record);
  await f.store.update('trend_videos', 'image-a', { aiAnalysis: {
    ...(record.aiAnalysis as Record<string, unknown>), imageEvidence: {
      version: 2, status: 'analyzed', observedFacts: [{ imageIndex: 1, confidence: .9 }],
      carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [],
      layerBlueprints: [{ imageIndex: 1, layers: [{ id: 'background', role: 'background',
        zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: .9 }], masks: [] }],
      uncertainties: [],
    },
  } });
  await assert.rejects(prepareAndApproveImageEvidenceReview(f.input), /not_required/);
  assert.equal((await f.store.list(IMAGE_EVIDENCE_REVIEW_APPROVALS)).totalItems, 0);
});

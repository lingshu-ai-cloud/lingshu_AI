import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { buildFrozenWeeklyReview, savePromotionLoop } from './service.js';
import { PerformanceEvaluator } from './performanceEvaluator.js';
import { PromotionAllocator } from './promotionAllocator.js';

const snapshot = buildFrozenWeeklyReview({
  tenantId: 'tenant-a', actorId: 'operator', weekRef: '2026-W39',
  startsAt: '2026-09-20T00:00:00Z', endsAt: '2026-09-27T00:00:00Z', frozenAt: '2026-09-27T00:01:00Z', minimumOwnedContent: 1,
  contents: [
    { businessDirection: 'sampling', platform: 'tiktok', accountId: 'a1', contentId: 'owned-1', evidenceKind: 'owned_content_result', publicationReceiptRefs: ['receipt-1'], attributionStatus: 'attributed', baseline: { views: 100 } },
    { businessDirection: 'sampling', platform: 'tiktok', accountId: 'a1', contentId: 'external-1', evidenceKind: 'external_reference', attributionStatus: 'unknown', baseline: { views: 10 } },
  ],
  metricSnapshots: [
    { id: 'm1', platform: 'tiktok', accountId: 'a1', contentId: 'owned-1', capturedAt: '2026-09-20T00:00:00Z', metrics: { views: 100, comments: 2 } },
    { id: 'm2', platform: 'tiktok', accountId: 'a1', contentId: 'owned-1', capturedAt: '2026-09-26T12:00:00Z', metrics: { views: 260, comments: 8 } },
    { id: 'm3', platform: 'tiktok', accountId: 'a1', contentId: 'external-1', capturedAt: '2026-09-20T00:00:00Z', metrics: { views: 1000 } },
    { id: 'm4', platform: 'tiktok', accountId: 'a1', contentId: 'external-1', capturedAt: '2026-09-26T12:00:00Z', metrics: { views: 9000 } },
    { id: 'late', platform: 'tiktok', accountId: 'a1', contentId: 'owned-1', capturedAt: '2026-09-28T12:00:00Z', metrics: { views: 99999 } },
  ],
  unavailableMetricKeys: ['reach'], maintenance: [{ ref: 'work-1', minutes: 45 }],
});

assert.equal(snapshot.contents[0].metrics.views?.value, 8000, 'content order is stable and cumulative values are differenced');
const owned = snapshot.contents.find(item => item.contentId === 'owned-1')!;
assert.equal(owned.metrics.views?.value, 160, 'post-cutoff metrics cannot mutate a frozen window');
assert.equal(owned.metrics.shares?.availability, 'unknown', 'missing fields stay unknown rather than zero');
assert.equal(owned.metrics.reach?.availability, 'unavailable', 'disconnected fields remain unavailable');
assert.equal(snapshot.maintenanceEffort.minutes, 45);
assert.deepEqual(snapshot.evidenceBoundary, { externalReferenceContentIds: ['external-1'], ownedContentIds: ['owned-1'] });
assert.equal(snapshot.sampleSufficiency.status, 'sufficient');
assert.throws(() => buildFrozenWeeklyReview({ ...({} as any), ...{ tenantId: 't', actorId: 'a', weekRef: 'w', startsAt: '2026-09-20', endsAt: '2026-09-27', frozenAt: '2026-09-26', contents: [], metricSnapshots: [] } }), /weekly_review_window_invalid/);

const evaluator = new PerformanceEvaluator();
assert.equal(evaluator.evaluate(owned).action, 'scale', 'owned attributable performance is compared to its baseline');
assert.equal(evaluator.evaluate(snapshot.contents.find(item => item.contentId === 'external-1')!).action, 'observe', 'external popularity cannot promote customer work');
assert.equal(evaluator.evaluate({ ...owned, attributionStatus: 'unknown' }).action, 'observe', 'unattributable results cannot promote');
assert.equal(evaluator.evaluate({ ...owned, baseline: {} }).action, 'observe', 'missing relative baseline cannot promote');
assert.equal(evaluator.evaluate({ ...owned, confounders: ['paid_boost_overlap'] }).action, 'observe', 'confounded results cannot promote');

const first = new PromotionAllocator().allocate(snapshot);
assert.equal(first.decisions.find(item => item.contentId === 'owned-1')?.action, 'scale');
assert.equal(first.decisions.some(item => item.contentId === 'external-1'), false, 'external references never enter promotion allocation');
assert.equal(first.quota.version, 1);
assert.equal(first.quota.allocations[0].contentCount, 2);
const second = new PromotionAllocator().allocate(snapshot, first.quota);
assert.equal(second.quota.version, 2);
assert.equal(second.quota.previousQuotaRef, `${first.quota.quotaId}:v1`);
assert.equal(second.quota.sourceSnapshotId, snapshot.snapshotId, 'next-week quota remains consumable by versioned snapshot reference');
const insufficient = { ...snapshot, sampleSufficiency: { ...snapshot.sampleSufficiency, status: 'insufficient' as const, reasons: ['owned_content_sample_too_small'] } };
assert.equal(new PromotionAllocator().allocate(insufficient).decisions[0].action, 'observe', 'weekly sample gate blocks otherwise strong content');

test('promotion persistence resumes after interruption between decisions and quota commit', async () => {
  const rows = new Map<string, Record_[]>();
  let sequence = 0;
  let failQuotaOnce = true;
  let decisionCreates = 0;
  const dataStore: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === 'social_weekly_promotion_decisions') decisionCreates += 1;
      if (collection === 'social_weekly_quota_references' && failQuotaOnce) {
        failQuotaOnce = false;
        return null;
      }
      const row = { id: `row-${++sequence}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update() { return false; },
    async delete() { return false; },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      const items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      return { items: structuredClone(items) as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage ?? 30 };
    },
  };
  const allocation = new PromotionAllocator().allocate(snapshot);
  await dataStore.create('social_weekly_review_snapshots', {
    tenant_id: snapshot.tenantId, week_ref: snapshot.weekRef, snapshot_id: snapshot.snapshotId,
    source_digest: snapshot.sourceDigest, snapshot,
  });
  await assert.rejects(
    savePromotionLoop({ tenantId: 'tenant-a', snapshot, ...allocation }, dataStore),
    /promotion_quota_write_unavailable/,
  );
  const recovered = await savePromotionLoop({ tenantId: 'tenant-a', snapshot, ...allocation }, dataStore);
  assert.equal(recovered.repeated, false);
  assert.equal(decisionCreates, allocation.decisions.length, 'retry reuses decisions committed before interruption');
  const replay = await savePromotionLoop({ tenantId: 'tenant-a', snapshot, ...allocation }, dataStore);
  assert.equal(replay.repeated, true);
});

console.log('social review and promotion loop passed');

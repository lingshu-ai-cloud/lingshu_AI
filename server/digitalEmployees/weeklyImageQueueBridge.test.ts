import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { newContentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { ensureWeeklyImageQueue, preflightWeeklyImageQueue, weeklyImageProgress, weeklyImageQueueFailure, weeklyImageScope } from './weeklyImageQueueBridge.js';
import { assertWeeklyImageAuthority, weeklyImageTaskId } from './weeklyImageAuthority.js';

const tenantId = 'tenant-one';
const planId = 'plan-one';
const image = (id: string) => ({ id, tenantId, contentFormat: 'image', status: 'analyzed',
  title: `Reference ${id}`, sourceUrl: `https://example.com/posts/${id}`,
  aiAnalysis: JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed',
    imageUrls: [`/api/overseas/videos/${id}/images/0`],
    imageEvidence: { version: 2, status: 'analyzed', observedFacts: [{ subjects: ['product'] }],
      productionLabels: [{ kind: 'product_only', productPresence: 'present', confidence: .9, evidence: 'Visible bottle' }] } }) });
const slot = (id: string, productId: string) => ({ slotId: id, accountId: 'account', platform: 'facebook' as const,
  kind: 'image' as const, presentation: 'image' as const, productionRole: 'original' as const,
  originalSlotId: id, productId, productName: `Product ${productId}`, referenceId: id,
  referenceSourceUrl: `https://example.com/posts/${id}` });
const pack = { tasks: [], mixedContentSlots: [slot('a', 'p1'), slot('b', 'p2'),
  slot('c', 'p3'), slot('d', 'p1')] } as unknown as WeeklyPackage;
const records: Record<string, Record<string, unknown>> = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, image(id)]));
const plan = { id: planId, tenant_id: tenantId, goal_id: 'goal-one', status: 'approved', plan: {
  businessPackage: pack, contentGenerationAuthorization: newContentGenerationAuthorization(),
  packageApprovedBy: 'user-one', packageApprovedAt: '2026-10-29T00:00:00.000Z',
} };
function fixture(): DataStore {
  return {
    async getById<T>(collection: string, id: string) {
      const value = collection === 'trend_videos' ? records[id]
        : collection === 'weekly_plans' ? plan : collection === 'weekly_goals'
          ? { id: 'goal-one', tenant_id: tenantId, status: 'active' } : null;
      return (value || null) as T | null;
    },
    async list<T>(collection: string) {
      const value = collection === 'starter_social_content_tasks'
        ? [{ tenant_id: tenantId, task_id: weeklyImageTaskId(tenantId, planId, 'a'), weekly_plan_id: planId }]
        : collection === 'workflow_runs' ? [{ tenant_id: tenantId, plan_id: planId, status: 'initializing' }] : [];
      return { items: value as T[], totalItems: value.length, totalPages: 1, page: 1, perPage: 2 };
    },
  } as DataStore;
}

test('strict image reference diagnostic recognizes four frozen single-image references', async () => {
  const checked = await preflightWeeklyImageQueue(fixture(), tenantId, pack);
  assert.equal(checked.length, 4);
  assert.deepEqual(checked.map(item => item.imageUrl), ['a', 'b', 'c', 'd']
    .map(id => `/api/overseas/videos/${id}/images/0`));
  const changed = { ...pack, mixedContentSlots: pack.mixedContentSlots!.map((item, index) =>
    index === 0 ? { ...item, referenceSourceUrl: 'https://example.com/changed' } : item) };
  await assert.rejects(preflightWeeklyImageQueue(fixture(), tenantId, changed), { code: 'weekly_image_reference_changed' });
  const saved = records.a;
  records.a = { ...image('a'), aiAnalysis: JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed',
    imageUrls: ['/api/overseas/videos/a/images/0'], imageEvidence: { status: 'analyzed', observedFacts: ['product'] } }) };
  await assert.rejects(preflightWeeklyImageQueue(fixture(), tenantId, pack), { code: 'weekly_image_reference_analysis_incomplete' });
  records.a = saved!;
  const missingOneProduct = { ...pack, mixedContentSlots: pack.mixedContentSlots!.map((item, index) =>
    index === 0 ? { ...item, productId: undefined } : item) };
  assert.equal(weeklyImageScope(missingOneProduct).length, 4, 'a missing product is an item-level wait after activation');
  await assert.rejects(preflightWeeklyImageQueue(fixture(), tenantId, missingOneProduct),
    { code: 'weekly_image_scope_incomplete' });
  assert.equal(weeklyImageTaskId(tenantId, planId, 'a'), weeklyImageTaskId(tenantId, planId, 'a'));
  assert.notEqual(weeklyImageTaskId(tenantId, planId, 'a'), weeklyImageTaskId(tenantId, planId, 'b'));
});

test('paid weekly image admission requires the exact approved product and reference', async () => {
  const task = { contentBrief: { productRefs: ['p1'] }, referenceSnapshot: {
    sourceRecordId: 'a', sourceUrl: 'https://example.com/posts/a',
    imageUrls: ['/api/overseas/videos/a/images/0'],
  }, productionRuntime: { binding: {
    contentTaskId: weeklyImageTaskId(tenantId, planId, 'a'), deliverableKey: 'a',
  } } } as SocialImageCreationTask;
  await assert.doesNotReject(assertWeeklyImageAuthority(fixture(), tenantId, task));
  await assert.rejects(assertWeeklyImageAuthority(fixture(), tenantId, {
    ...task, contentBrief: { ...task.contentBrief, productRefs: ['p2'] },
  }), { code: 'weekly_image_approval_scope_changed' });
  await assert.rejects(assertWeeklyImageAuthority(fixture(), 'other-tenant', task), {
    code: 'weekly_image_approval_missing',
  });
  assert.equal(weeklyImageQueueFailure(new Error('hidden storage failure')).body.error, 'weekly_image_queue_unavailable');
});

test('an active weekly image prevents admitting another; a blocked sibling does not freeze the next', async () => {
  let lease: Record<string, unknown> | null = null;
  const jobs = (statuses: Array<[string, string]>) => statuses.map(([slotId, status], index) => ({
    id: `job-${index}`, tenant_id: tenantId, job_key: `job-key-${index}`,
    task_id: weeklyImageTaskId(tenantId, planId, slotId), run_id: `image-run-${index}`,
    user_id: 'user-one', account_id: 'account', task_type: 'social_image_replication', status,
    provider_receipts: [], checkpoints: {},
  }));
  let executionJobs = jobs([['a', 'queued']]);
  const store = {
    ...fixture(),
    async getById<T>(collection: string, id: string) {
      if (collection === 'durable_operation_leases') return (lease?.id === id ? lease : null) as T | null;
      return fixture().getById<T>(collection, id);
    },
    async list<T>(collection: string, query: { where?: Record<string, unknown> } = {}) {
      const source = collection === 'content_execution_jobs' ? executionJobs
        : collection === 'durable_operation_leases' ? (lease ? [lease] : []) : [];
      const items = source.filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: 500 };
    },
    async create<T>(collection: string, value: Record<string, unknown>) {
      assert.equal(collection, 'durable_operation_leases');
      lease = { id: 'lease-1', ...value };
      return lease as T;
    },
    async delete(collection: string) { assert.equal(collection, 'durable_operation_leases'); lease = null; return true; },
  } as unknown as DataStore;
  const run = { id: 'weekly-run', tenant_id: tenantId, plan_id: planId, status: 'planning' };
  const queued = await ensureWeeklyImageQueue({ store, tenantId, userId: 'user-one', plan: plan as never, run: run as never });
  assert.deepEqual(queued.map(item => item.slotId), ['a']);
  assert.equal((await weeklyImageProgress(store, tenantId, plan as never)).active, 1);
  executionJobs = jobs([['a', 'blocked'], ['b', 'running']]);
  const next = await ensureWeeklyImageQueue({ store, tenantId, userId: 'user-one', plan: plan as never, run: run as never });
  assert.deepEqual(next.map(item => item.slotId), ['b']);
  assert.equal((await weeklyImageProgress(store, tenantId, plan as never)).blocked, 1);
  executionJobs = jobs([['a', 'queued'], ['b', 'running']]);
  await assert.rejects(ensureWeeklyImageQueue({ store, tenantId, userId: 'user-one', plan: plan as never, run: run as never }),
    { code: 'weekly_image_parallel_jobs_require_reconciliation' });
});

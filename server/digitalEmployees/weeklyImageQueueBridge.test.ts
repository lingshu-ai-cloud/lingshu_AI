import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { newContentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { preflightWeeklyImageQueue, weeklyImageQueueFailure } from './weeklyImageQueueBridge.js';
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

test('four weekly image slots bind distinct analyzed single-image references before approval', async () => {
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

import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { consumeAgentNotificationOutboxBatch } from '../notifications/agentNotificationOutbox.js';
import { runWeeklyReviewForPackage, weeklyReviewScheduleDecision } from './weeklyReviewWorker.js';

function memoryStore(): DataStore & { rows: Map<string, Array<Record<string, any>>>; push: (name: string, value: Record<string, any>) => void } {
  const rows = new Map<string, Array<Record<string, any>>>();
  let sequence = 0;
  const collection = (name: string) => rows.get(name) ?? (rows.set(name, []), rows.get(name)!);
  const push = (name: string, value: Record<string, any>) => collection(name).push({ id: value.id || `fixture-${++sequence}`, ...structuredClone(value) });
  return {
    rows, push,
    async getById<T>(name: string, id: string) { return (structuredClone(collection(name).find(item => item.id === id)) as T) ?? null; },
    async create<T>(name: string, data: Record<string, unknown>) {
      const items = collection(name);
      const unique: Record<string, string[]> = {
        durable_operation_leases: ['tenant_id', 'lease_scope', 'subject_id'],
        social_weekly_review_snapshots: ['tenant_id', 'package_id', 'package_version'],
        social_weekly_promotion_decisions: ['tenant_id', 'decision_id'],
        social_weekly_quota_references: ['tenant_id', 'quota_id', 'version'],
        social_creative_learnings: ['tenant_id', 'learning_id', 'version'],
        agent_notification_outbox: ['tenant_id', 'event_id'],
        agent_notifications: ['tenant_id', 'event_key'],
        social_weekly_operating_packages: ['tenant_id', 'package_id', 'version'],
      };
      const keys = unique[name];
      if (keys?.length && items.some(item => keys.every(key => item[key] === data[key]))) return null;
      const item = { id: `row-${++sequence}`, ...structuredClone(data) }; items.push(item); return structuredClone(item) as T;
    },
    async update(name: string, id: string, data: Record<string, unknown>) { const item = collection(name).find(row => row.id === id); if (!item) return false; Object.assign(item, structuredClone(data)); return true; },
    async delete(name: string, id: string) { const items = collection(name); const index = items.findIndex(item => item.id === id); if (index < 0) return false; items.splice(index, 1); return true; },
    async list<T>(name: string, query: ListQuery = {}) {
      let items = collection(name).filter(item => Object.entries(query.where ?? {}).every(([key, value]) => item[key] === value));
      if (query.sort) { const desc = query.sort.startsWith('-'); const key = desc ? query.sort.slice(1) : query.sort; items = [...items].sort((a, b) => (typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : String(a[key] ?? '').localeCompare(String(b[key] ?? ''))) * (desc ? -1 : 1)); }
      const page = query.page ?? 1; const perPage = query.perPage ?? 30; const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

const dataStore = memoryStore();
const publicationTask = {
  publicationTaskId: 'publication-task-a', motherContentId: 'mother-a', adaptationOfPublicationTaskId: null,
  platform: 'tiktok' as const, accountId: 'account-a', accountPositioning: 'sample buyers', businessProposition: 'sampling',
  cta: 'request sample', factRefs: [], metricTargets: ['views', 'qualified_inquiries'], publishWindow: '2026-09-25T10:00:00Z', status: 'published' as const,
};
const weekly: WeeklyOperatingPackage = {
  packageId: 'weekly-a', programId: 'program-a', version: 1, status: 'active', weekStart: '2026-09-21', weekEnd: '2026-09-27', objective: 'sampling',
  enterpriseProfileRef: null, monthlyPlanRef: null, workflows: [],
  workflowTasks: [{ taskId: 'review-task-a', kind: 'review', taskRef: { type: 'weekly_workflow_task', id: 'review-task-a', version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null }],
  appliedWorkflowEvents: [{ eventId: 'publish-complete', taskId: 'publishing-task-a', type: 'complete', occurredAt: '2026-09-27T10:00:00Z' }], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 0,
  socialContentPackage: { contentPackageId: 'content-package-a', operatingPackageId: 'weekly-a', version: 1, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [publicationTask], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-a'], maxPublishItems: 1, weekStart: '2026-09-21', weekEnd: '2026-09-27', allowRealPublishing: true, authorizedBy: 'owner', authorizedAt: '2026-09-20T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: ['qualified inquiry'], changeReason: null, previousVersion: null, createdBy: 'owner', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-27T10:00:00Z',
};
const row = { id: 'weekly-row-a', tenant_id: 'tenant-a', program_id: 'program-a', package_id: weekly.packageId, version: 1, week_start: weekly.weekStart, status: 'active', payload: weekly, updated_at: weekly.updatedAt };
dataStore.push('social_weekly_operating_packages', row);
dataStore.push('starter_publication_packages', {
  tenant_id: 'tenant-a', package_id: 'publication-package-a', idempotency_key: 'weekly:weekly-a:1:publication-task-a:result-a', content_id: 'content-a', status: 'published',
  manifest: { contentId: 'content-a', operatingLineage: { operatingPackageRef: { id: 'weekly-a', version: 1 }, weeklyPublicationTaskRef: { id: 'publication-task-a', version: 1 } } },
  evidence: { verificationStatus: 'verified', verificationReceiptHash: 'receipt-a', sourceReceiptHash: 'source-receipt-a' },
});
dataStore.push('social_metric_snapshots', { tenant_id: 'tenant-a', platform: 'tiktok', account_id: 'account-a', content_id: 'content-a', captured_at: '2026-09-21T00:00:00Z', value_kind: 'cumulative', metrics: { views: 100 } });
dataStore.push('social_metric_snapshots', { tenant_id: 'tenant-a', platform: 'tiktok', account_id: 'account-a', content_id: 'content-a', captured_at: '2026-09-27T12:00:00Z', value_kind: 'cumulative', metrics: { views: 280 } });
dataStore.push('social_interaction_writebacks', { id: 'interaction-a', tenant_id: 'tenant-a', accountId: 'account-a', contentId: 'content-a', occurredAt: '2026-09-27T13:00:00Z', source_confidence: 'confirmed' });
dataStore.push('social_sales_qualifications', { id: 'qualification-a', tenant_id: 'tenant-a', interaction_id: 'interaction-a', status: 'qualified', authority: 'sales', confirmed_at: '2026-09-27T14:00:00Z' });
dataStore.push('social_programs', { tenant_id: 'tenant-a', program_id: 'program-a', payload: { programId: 'program-a', version: 1 } });
dataStore.push('social_owned_accounts', { tenant_id: 'tenant-a', program_id: 'program-a', payload: { accountId: 'account-a', programId: 'program-a', platform: 'tiktok', displayName: 'A', businessRole: 'sampling', audiencePromise: '', contentPromise: '', status: 'active', connectionId: null, connectionCapabilities: [], playbookRef: null, conversionRoute: null, version: 1, createdAt: '', updatedAt: '' } });

assert.equal(weeklyReviewScheduleDecision(weekly, new Date('2026-09-27T23:59:59Z')).status, 'not_due');
const first = await runWeeklyReviewForPackage({ dataStore, row, now: new Date('2026-09-28T00:01:00Z'), minimumOwnedContent: 1 });
assert.equal(first.status, 'completed');
assert.equal(first.snapshot?.sampleSufficiency.status, 'sufficient');
assert.equal(first.snapshot?.contents[0]?.salesQualifiedCount, 1, 'trusted sales confirmation enters the immutable review');
assert.equal(first.quota?.allocations[0]?.action, 'scale');
assert.equal(first.quota?.allocations[0]?.contentCount, 2);

dataStore.push('social_metric_snapshots', { tenant_id: 'tenant-a', platform: 'tiktok', account_id: 'account-a', content_id: 'content-a', captured_at: '2026-09-28T10:00:00Z', value_kind: 'cumulative', metrics: { views: 99999 } });
const replay = await runWeeklyReviewForPackage({ dataStore, row, now: new Date('2026-09-29T00:01:00Z'), minimumOwnedContent: 1 });
assert.equal(replay.repeated, true);
assert.equal(replay.snapshot?.contents[0]?.metrics.views?.value, 180, 'post-freeze metrics cannot rewrite the snapshot');
assert.equal(dataStore.rows.get('social_creative_learnings')?.length, 1, 'learning replay is idempotent');
assert.equal(dataStore.rows.get('social_weekly_promotion_decisions')?.length, 1, 'decision replay is idempotent');
assert.equal(dataStore.rows.get('agent_notification_outbox')?.length, 1, 'review replay produces one durable notification event');
assert.equal((await consumeAgentNotificationOutboxBatch({ dataStore, now: new Date(Date.now() + 1_000) })).delivered, 1);

const planned = await createWeeklyOperatingPackageService(dataStore).create('tenant-a', 'owner', 'program-a', {
  weekStart: '2026-09-28', objective: 'next week', successCriteria: ['use promoted quota'],
  promotionQuotaRef: { type: 'weekly_promotion_quota', id: first.quota!.quotaId, version: first.quota!.version },
});
assert.deepEqual(planned.promotionQuotaRef, { type: 'weekly_promotion_quota', id: first.quota!.quotaId, version: first.quota!.version });
assert.equal(planned.socialContentPackage.publicationTaskTarget, 2, 'qualified quota changes the actual next-week plan');
assert.ok(planned.socialContentPackage.publicationTasks.every(item => item.accountId === 'account-a'));

const unknownWeekly = structuredClone(weekly);
unknownWeekly.packageId = 'weekly-unknown'; unknownWeekly.weekStart = '2026-09-14'; unknownWeekly.weekEnd = '2026-09-20';
unknownWeekly.socialContentPackage.operatingPackageId = 'weekly-unknown'; unknownWeekly.socialContentPackage.publicationTasks[0]!.publicationTaskId = 'unknown-task';
const unknownRow = { ...row, id: 'weekly-row-unknown', package_id: 'weekly-unknown', payload: unknownWeekly, week_start: unknownWeekly.weekStart };
const unknown = await runWeeklyReviewForPackage({ dataStore, row: unknownRow, now: new Date('2026-09-21T00:01:00Z'), minimumOwnedContent: 1 });
assert.equal(unknown.snapshot?.sampleSufficiency.status, 'insufficient');
assert.equal(unknown.quota?.allocations.length, 0, 'unknown publication and metrics remain observe-only');

console.log('weekly review worker, promotion planning and notification loop passed');

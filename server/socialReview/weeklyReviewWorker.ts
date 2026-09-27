import { randomUUID } from 'node:crypto';
import type { MetricSnapshot, MetricValues, SocialMetricKey } from '../socialMetrics/aggregation.js';
import { SOCIAL_METRIC_KEYS } from '../socialMetrics/aggregation.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { FrozenWeeklyReview, ReviewAvailability, ReviewContentInput, VersionedQuotaReference } from '../../shared/contracts/socialReview.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { enqueueAgentNotificationDomainEvent } from '../notifications/agentNotificationOutbox.js';
import { PromotionAllocator } from './promotionAllocator.js';
import {
  freezeWeeklyReview,
  generateWeeklyCreativeLearnings,
  PROMOTION_DECISIONS,
  QUOTA_REFERENCES,
  savePromotionLoop,
  WEEKLY_REVIEWS,
  type FreezeWeeklyReviewInput,
} from './service.js';

const WEEKLY_PACKAGES = 'social_weekly_operating_packages';
const STARTER_PUBLICATION_PACKAGES = 'starter_publication_packages';
const METRIC_SNAPSHOTS = 'social_metric_snapshots';
const STARTER_METRIC_SUBMISSIONS = 'starter_social_metric_submissions';
const INTERACTIONS = 'social_interaction_writebacks';
const QUALIFICATIONS = 'social_sales_qualifications';

type RecordRow = { id: string } & Record<string, any>;
type PackageRow = RecordRow & { tenant_id: string; program_id: string; package_id: string; version: number; status: string; payload: WeeklyOperatingPackage };

const object = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? '').trim();
const inWindow = (value: unknown, startsAt: string, endsAt: string) => {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) && timestamp > Date.parse(startsAt) && timestamp <= Date.parse(endsAt);
};
const weekBounds = (weekly: WeeklyOperatingPackage) => {
  const startsAt = new Date(`${weekly.weekStart}T00:00:00.000Z`);
  const endsAt = new Date(`${weekly.weekEnd}T00:00:00.000Z`);
  endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) throw new Error('weekly_review_window_invalid');
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
};

export type WeeklyReviewScheduleDecision =
  | { status: 'due'; startsAt: string; endsAt: string }
  | { status: 'not_due' | 'ineligible'; reason: string };

/** The package calendar and its real review task are the only schedule authority. */
export function weeklyReviewScheduleDecision(weekly: WeeklyOperatingPackage, now: Date): WeeklyReviewScheduleDecision {
  if (!['active', 'superseded'].includes(weekly.status)) return { status: 'ineligible', reason: 'weekly_package_not_executed' };
  const reviewTask = weekly.workflowTasks.find(task => task.kind === 'review');
  if (!reviewTask || reviewTask.status === 'cancelled') return { status: 'ineligible', reason: 'weekly_review_task_unavailable' };
  const bounds = weekBounds(weekly);
  if (now.getTime() < Date.parse(bounds.endsAt)) return { status: 'not_due', reason: 'weekly_window_open' };
  return { status: 'due', ...bounds };
}

async function safeList(dataStore: DataStore, collection: string, tenantId: string): Promise<{ items: RecordRow[]; available: boolean }> {
  try {
    const result = await dataStore.list<RecordRow>(collection, { where: { tenant_id: tenantId }, page: 1, perPage: 1_000 });
    return { items: result.items, available: true };
  } catch {
    return { items: [], available: false };
  }
}

function sourceAvailability(sourceAvailable: boolean, refs: string[]): ReviewAvailability {
  return !sourceAvailable ? 'unavailable' : refs.length ? 'available' : 'unknown';
}

function normalizeMetricSnapshot(row: RecordRow): MetricSnapshot | null {
  const metrics = object(row.metrics);
  const normalized: MetricValues = {};
  for (const key of SOCIAL_METRIC_KEYS) {
    const value = Number(metrics[key]);
    if (Number.isFinite(value) && value >= 0) normalized[key] = value;
  }
  const capturedAt = text(row.captured_at || row.capturedAt);
  if (!text(row.account_id || row.accountId) || !Number.isFinite(Date.parse(capturedAt))) return null;
  return {
    id: text(row.id || row.snapshot_id || row.submission_id),
    platform: text(row.platform),
    accountId: text(row.account_id || row.accountId),
    contentId: text(row.content_id || row.contentId) || undefined,
    capturedAt: new Date(capturedAt).toISOString(),
    valueKind: row.value_kind === 'daily' ? 'daily' : 'cumulative',
    metrics: normalized,
  };
}

function latestBaseline(rows: MetricSnapshot[], startsAt: string): MetricValues | undefined {
  const baseline = rows.filter(row => Date.parse(row.capturedAt) <= Date.parse(startsAt))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt)).at(-1);
  return baseline?.metrics;
}

function publicationMatches(row: RecordRow, weekly: WeeklyOperatingPackage, publicationTaskId: string): boolean {
  const manifest = object(row.manifest);
  const lineage = object(manifest.operatingLineage);
  const operatingRef = object(lineage.operatingPackageRef);
  const taskRef = object(lineage.weeklyPublicationTaskRef);
  if (operatingRef.id === weekly.packageId && Number(operatingRef.version) === weekly.version && taskRef.id === publicationTaskId) return true;
  const key = text(row.idempotency_key);
  return key.startsWith(`weekly:${weekly.packageId}:${weekly.version}:${publicationTaskId}:`);
}

function verifiedPublication(row: RecordRow): boolean {
  const evidence = object(row.evidence);
  return row.status === 'published' && evidence.verificationStatus === 'verified'
    && Boolean(text(evidence.verificationReceiptHash || evidence.sourceReceiptHash));
}

/**
 * Read model only: it joins the authoritative package to persisted publication,
 * metric, interaction and sales-confirmation rows. It never calls a platform.
 */
export async function collectWeeklyReviewInput(input: {
  dataStore: DataStore;
  row: PackageRow;
  actorId: string;
  now: Date;
  minimumOwnedContent?: number;
}): Promise<FreezeWeeklyReviewInput> {
  const { dataStore, row, actorId, now } = input;
  const weekly = row.payload;
  const schedule = weeklyReviewScheduleDecision(weekly, now);
  if (schedule.status !== 'due') throw new Error(`weekly_review_${schedule.status}:${schedule.reason}`);
  const [publications, metrics, starterMetrics, interactions, qualifications] = await Promise.all([
    safeList(dataStore, STARTER_PUBLICATION_PACKAGES, row.tenant_id),
    safeList(dataStore, METRIC_SNAPSHOTS, row.tenant_id),
    safeList(dataStore, STARTER_METRIC_SUBMISSIONS, row.tenant_id),
    safeList(dataStore, INTERACTIONS, row.tenant_id),
    safeList(dataStore, QUALIFICATIONS, row.tenant_id),
  ]);
  const metricSnapshots = metrics.items.map(normalizeMetricSnapshot).filter((item): item is MetricSnapshot => Boolean(item));
  const qualificationByInteraction = new Map<string, RecordRow>();
  for (const item of qualifications.items.sort((left, right) => Date.parse(text(left.confirmed_at)) - Date.parse(text(right.confirmed_at)))) {
    if (inWindow(item.confirmed_at, schedule.startsAt, schedule.endsAt)) qualificationByInteraction.set(text(item.interaction_id), item);
  }
  const publicationReceiptRefs: string[] = [];
  const interactionRefs: string[] = [];
  const salesQualificationRefs: string[] = [];
  const contents: ReviewContentInput[] = weekly.socialContentPackage.publicationTasks
    .filter(task => task.status !== 'cancelled')
    .map(task => {
      const publication = publications.items.find(item => publicationMatches(item, weekly, task.publicationTaskId));
      const manifest = object(publication?.manifest);
      const contentId = text(publication?.content_id || manifest.contentId || task.motherContentId);
      const receiptRefs = publication && verifiedPublication(publication)
        ? [text(object(publication.evidence).verificationReceiptHash || object(publication.evidence).sourceReceiptHash || publication.package_id)].filter(Boolean)
        : [];
      publicationReceiptRefs.push(...receiptRefs);
      const matchingInteractions = interactions.items.filter(item => text(item.contentId || item.content_id) === contentId
        && text(item.accountId || item.account_id) === task.accountId
        && inWindow(item.occurredAt || item.occurred_at, schedule.startsAt, schedule.endsAt));
      const matchingQualifications = matchingInteractions.map(item => qualificationByInteraction.get(item.id)).filter((item): item is RecordRow => Boolean(item));
      const finalQualified = matchingQualifications.filter(item => item.status === 'qualified' && ['sales', 'crm'].includes(text(item.authority)));
      const contentInteractionRefs = matchingInteractions.map(item => item.id);
      const contentQualificationRefs = matchingQualifications.map(item => item.id);
      interactionRefs.push(...contentInteractionRefs);
      salesQualificationRefs.push(...contentQualificationRefs);
      const contentMetrics = metricSnapshots.filter(item => item.accountId === task.accountId && item.contentId === contentId);
      return {
        businessDirection: task.businessProposition || task.accountPositioning || weekly.objective,
        platform: task.platform,
        accountId: task.accountId,
        contentId,
        evidenceKind: 'owned_content_result' as const,
        publicationTaskId: task.publicationTaskId,
        publicationReceiptRefs: receiptRefs,
        attributionStatus: !publications.available ? 'unavailable' as const : receiptRefs.length ? 'attributed' as const : 'unknown' as const,
        interactionRefs: contentInteractionRefs,
        salesQualificationRefs: contentQualificationRefs,
        salesQualifiedCount: finalQualified.length,
        baseline: latestBaseline(contentMetrics, schedule.startsAt),
      };
    });
  // Starter metric submissions are retained as evidence refs, but they cannot
  // silently become platform metrics without account/content identity.
  const starterMetricRefs = starterMetrics.items
    .filter(item => inWindow(item.captured_at, schedule.startsAt, schedule.endsAt))
    .map(item => text(item.submission_id || item.id)).filter(Boolean);
  const unavailableMetricKeys: SocialMetricKey[] = metrics.available ? [] : [...SOCIAL_METRIC_KEYS];
  const workflowEventRefs = weekly.appliedWorkflowEvents.map(event => event.eventId);
  return {
    tenantId: row.tenant_id,
    actorId,
    programId: weekly.programId,
    weekRef: weekly.weekStart,
    operatingPackageRef: { type: 'weekly_operating_package', id: weekly.packageId, version: weekly.version },
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    frozenAt: now.toISOString(),
    contents,
    metricSnapshots,
    unavailableMetricKeys,
    minimumOwnedContent: input.minimumOwnedContent ?? 2,
    maintenance: workflowEventRefs.map(ref => ({ ref, availability: 'unknown' as const })),
    sourceEvidence: {
      workflowEventRefs,
      publicationReceiptRefs: [...new Set(publicationReceiptRefs)],
      interactionRefs: [...new Set(interactionRefs)],
      salesQualificationRefs: [...new Set(salesQualificationRefs)],
      publishingAvailability: sourceAvailability(publications.available, publicationReceiptRefs),
      engagementAvailability: sourceAvailability(interactions.available, interactionRefs),
      salesConfirmationAvailability: sourceAvailability(qualifications.available, salesQualificationRefs),
    },
    // Preserve manual submissions as source evidence without treating absent
    // platform identity as an attributable metric.
    ...(starterMetricRefs.length ? { maintenance: [
      ...workflowEventRefs.map(ref => ({ ref, availability: 'unknown' as const })),
      ...starterMetricRefs.map(ref => ({ ref, availability: 'unknown' as const })),
    ] } : {}),
  };
}

async function existingSnapshot(dataStore: DataStore, row: PackageRow): Promise<FrozenWeeklyReview | null> {
  const found = await dataStore.list<RecordRow>(WEEKLY_REVIEWS, {
    where: { tenant_id: row.tenant_id, package_id: row.package_id, package_version: row.version }, perPage: 2,
  });
  if (found.items.length > 1) throw new Error('weekly_review_integrity_violation');
  return found.items[0]?.snapshot as FrozenWeeklyReview || null;
}

async function existingQuota(dataStore: DataStore, tenantId: string, snapshotId: string): Promise<VersionedQuotaReference | null> {
  const found = await dataStore.list<RecordRow>(QUOTA_REFERENCES, { where: { tenant_id: tenantId, snapshot_id: snapshotId }, sort: '-version', perPage: 2 });
  if (found.items.length > 1) throw new Error('weekly_review_quota_integrity_violation');
  return found.items[0]?.quota as VersionedQuotaReference || null;
}

async function previousProgramQuota(dataStore: DataStore, tenantId: string, programId: string): Promise<VersionedQuotaReference | undefined> {
  const found = await dataStore.list<RecordRow>(QUOTA_REFERENCES, { where: { tenant_id: tenantId, program_id: programId }, sort: '-version', perPage: 1 });
  return found.items[0]?.quota as VersionedQuotaReference | undefined;
}

export async function runWeeklyReviewForPackage(input: {
  dataStore?: DataStore;
  row: PackageRow;
  actorId?: string;
  now?: Date;
  minimumOwnedContent?: number;
}): Promise<{ status: 'completed' | 'not_due' | 'ineligible'; repeated?: boolean; snapshot?: FrozenWeeklyReview; quota?: VersionedQuotaReference; reason?: string }> {
  const dataStore = input.dataStore ?? store;
  const now = input.now ?? new Date();
  const schedule = weeklyReviewScheduleDecision(input.row.payload, now);
  if (schedule.status !== 'due') return { status: schedule.status, reason: schedule.reason };
  const lease = await acquireDurableOperationLease({
    dataStore, tenantId: input.row.tenant_id, scope: 'social-weekly-review',
    subjectId: `${input.row.package_id}:v${input.row.version}`, ownerId: `weekly-review:${process.pid}:${randomUUID()}`,
    now, leaseDurationMs: 10 * 60_000,
  });
  if (!lease) return { status: 'not_due', reason: 'weekly_review_busy' };
  try {
    let snapshot = await existingSnapshot(dataStore, input.row);
    let repeated = Boolean(snapshot);
    if (!snapshot) {
      const reviewInput = await collectWeeklyReviewInput({ dataStore, row: input.row, actorId: input.actorId || 'social_weekly_review_worker', now, minimumOwnedContent: input.minimumOwnedContent });
      const frozen = await freezeWeeklyReview(reviewInput, dataStore);
      snapshot = frozen.snapshot;
      repeated = frozen.repeated;
    }
    await generateWeeklyCreativeLearnings(snapshot, input.actorId || 'social_weekly_review_worker', dataStore);
    let quota = await existingQuota(dataStore, input.row.tenant_id, snapshot.snapshotId);
    if (!quota) {
      const previous = await previousProgramQuota(dataStore, input.row.tenant_id, input.row.program_id);
      const allocated = new PromotionAllocator().allocate(snapshot, previous);
      await savePromotionLoop({ tenantId: input.row.tenant_id, snapshot, ...allocated }, dataStore);
      quota = allocated.quota;
    }
    await enqueueAgentNotificationDomainEvent({
      eventId: `weekly-review:${snapshot.snapshotId}:${quota.quotaId}:v${quota.version}`,
      kind: 'review.updated', tenantId: input.row.tenant_id, programId: input.row.program_id,
      packageId: input.row.package_id, packageVersion: input.row.version,
      taskId: input.row.payload.workflowTasks.find(task => task.kind === 'review')?.taskId || null,
      entityId: snapshot.snapshotId,
      title: '周末经营复盘已冻结',
      summary: `已依据实际发布、互动与销售确认生成复盘；下周可用配额 ${quota.allocations.reduce((sum, item) => sum + item.contentCount, 0)} 条。`,
      sourceAgent: 'business_agent',
      changes: [
        { field: 'reviewSnapshot', label: '冻结复盘', before: null, after: snapshot.snapshotId },
        { field: 'promotionQuota', label: '下周配额', before: quota.previousQuotaRef || null, after: `${quota.quotaId}:v${quota.version}` },
      ],
      occurredAt: snapshot.window.frozenAt,
    }, dataStore);
    return { status: 'completed', repeated, snapshot, quota };
  } finally {
    await releaseDurableOperationLease({ dataStore, lease });
  }
}

export async function runSocialWeeklyReviewScan(dataStore: DataStore = store, now = new Date()): Promise<{ scanned: number; completed: number; failed: number }> {
  const rows: PackageRow[] = [];
  for (const status of ['active', 'superseded']) {
    const result = await dataStore.list<PackageRow>(WEEKLY_PACKAGES, { where: { status }, sort: 'week_start', page: 1, perPage: 500 });
    rows.push(...result.items);
  }
  const unique = [...new Map(rows.map(row => [`${row.tenant_id}:${row.package_id}:${row.version}`, row])).values()];
  const report = { scanned: unique.length, completed: 0, failed: 0 };
  for (const row of unique) {
    try {
      const result = await runWeeklyReviewForPackage({ dataStore, row, now });
      if (result.status === 'completed') report.completed += 1;
    } catch (error) {
      report.failed += 1;
      console.error('[social-weekly-review]', text(error instanceof Error ? error.message : error).slice(0, 300));
    }
  }
  return report;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function initSocialWeeklyReviewWorker(): void {
  if (timer || process.env.SOCIAL_WEEKLY_REVIEW_WORKER_ENABLED === 'false') return;
  const intervalMs = Math.max(60_000, Number(process.env.SOCIAL_WEEKLY_REVIEW_INTERVAL_MS) || 15 * 60_000);
  const tick = () => {
    if (running) return;
    running = true;
    void runSocialWeeklyReviewScan().finally(() => { running = false; });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

// Public collection names keep R2/R3/R5 adapters narrow and stop them from
// importing the review worker's read model internals.
export const weeklyReviewCollections = {
  packages: WEEKLY_PACKAGES,
  reviews: WEEKLY_REVIEWS,
  decisions: PROMOTION_DECISIONS,
  quotas: QUOTA_REFERENCES,
} as const;

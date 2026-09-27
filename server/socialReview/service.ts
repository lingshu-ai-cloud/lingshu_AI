import { createHash } from 'node:crypto';
import type { MetricSnapshot, SocialMetricKey } from '../socialMetrics/aggregation.js';
import { SOCIAL_METRIC_KEYS } from '../socialMetrics/aggregation.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createCreativeLearning } from '../socialEngagement/writeback.js';
import type { FrozenWeeklyReview, ReviewAggregate, ReviewAvailability, ReviewContentAggregate, ReviewContentInput, ReviewMetric } from '../../shared/contracts/socialReview.js';

export const WEEKLY_REVIEWS = 'social_weekly_review_snapshots';
export const PROMOTION_DECISIONS = 'social_weekly_promotion_decisions';
export const QUOTA_REFERENCES = 'social_weekly_quota_references';

export interface FreezeWeeklyReviewInput {
  tenantId: string;
  actorId: string;
  weekRef: string;
  programId?: string;
  operatingPackageRef?: { type: 'weekly_operating_package'; id: string; version: number };
  startsAt: string;
  endsAt: string;
  frozenAt?: string;
  contents: ReviewContentInput[];
  metricSnapshots: MetricSnapshot[];
  unavailableMetricKeys?: SocialMetricKey[];
  maintenance?: Array<{ ref: string; minutes?: number; availability?: ReviewAvailability }>;
  minimumOwnedContent?: number;
  sourceEvidence?: FrozenWeeklyReview['sourceEvidence'];
}

const iso = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('weekly_review_window_invalid');
  return date.toISOString();
};
const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

function windowMetric(rows: MetricSnapshot[], key: SocialMetricKey, start: number, end: number, unavailable: Set<string>): ReviewMetric {
  if (unavailable.has(key)) return { value: null, availability: 'unavailable', reason: 'source_unavailable' };
  const withMetric = rows.filter(row => typeof row.metrics[key] === 'number').sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const daily = withMetric.filter(row => row.valueKind === 'daily' && Date.parse(row.capturedAt) > start && Date.parse(row.capturedAt) <= end);
  const cumulative = withMetric.filter(row => row.valueKind !== 'daily');
  if (daily.length) return { value: daily.reduce((sum, row) => sum + (row.metrics[key] || 0), 0), availability: 'available' };
  const before = cumulative.filter(row => Date.parse(row.capturedAt) <= start).at(-1);
  const after = cumulative.filter(row => Date.parse(row.capturedAt) > start && Date.parse(row.capturedAt) <= end).at(-1);
  if (before && after) return { value: Math.max(0, (after.metrics[key] || 0) - (before.metrics[key] || 0)), availability: 'available' };
  return { value: null, availability: 'unknown', reason: 'not_returned' };
}

function combineMetrics(contents: ReviewContentAggregate[]): ReviewAggregate['metrics'] {
  const output: ReviewAggregate['metrics'] = {};
  for (const key of SOCIAL_METRIC_KEYS) {
    const values = contents.map(item => item.metrics[key]).filter(Boolean) as ReviewMetric[];
    if (!values.length) continue;
    const nonAvailable = values.find(item => item.availability !== 'available');
    output[key] = nonAvailable
      ? { value: null, availability: nonAvailable.availability, reason: nonAvailable.reason }
      : { value: values.reduce((sum, item) => sum + (item.value || 0), 0), availability: 'available' };
  }
  return output;
}

function aggregate(contents: ReviewContentAggregate[], keyOf: (content: ReviewContentAggregate) => string): ReviewAggregate[] {
  const groups = new Map<string, ReviewContentAggregate[]>();
  for (const content of contents) groups.set(keyOf(content), [...(groups.get(keyOf(content)) || []), content]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => ({
    key, evidenceKinds: [...new Set(items.map(item => item.evidenceKind))].sort(), contentCount: items.length, metrics: combineMetrics(items),
  }));
}

export function buildFrozenWeeklyReview(input: FreezeWeeklyReviewInput): FrozenWeeklyReview {
  const startsAt = iso(input.startsAt); const endsAt = iso(input.endsAt); const frozenAt = iso(input.frozenAt || new Date().toISOString());
  if (Date.parse(startsAt) >= Date.parse(endsAt) || Date.parse(frozenAt) < Date.parse(endsAt)) throw Error('weekly_review_window_invalid');
  const unavailable = new Set(input.unavailableMetricKeys || []);
  const contents = input.contents.map(content => {
    const rows = input.metricSnapshots.filter(row => row.platform === content.platform && row.accountId === content.accountId && row.contentId === content.contentId && Date.parse(row.capturedAt) <= Date.parse(endsAt));
    return { ...content, publicationReceiptRefs: [...new Set(content.publicationReceiptRefs || [])], metricSnapshotRefs: [...new Set(rows.map(row => row.id).filter(Boolean) as string[])], metrics: Object.fromEntries(SOCIAL_METRIC_KEYS.map(key => [key, windowMetric(rows, key, Date.parse(startsAt), Date.parse(endsAt), unavailable)])) } as ReviewContentAggregate;
  }).sort((a, b) => a.contentId.localeCompare(b.contentId));
  const owned = contents.filter(item => item.evidenceKind === 'owned_content_result');
  const attributable = owned.filter(item => item.attributionStatus === 'attributed' && item.publicationReceiptRefs?.length);
  const minimumOwnedContent = Math.max(1, input.minimumOwnedContent || 2);
  const metricReady = owned.filter(item => item.metrics.views?.availability === 'available');
  const reasons = [
    ...(owned.length < minimumOwnedContent ? ['owned_content_sample_too_small'] : []),
    ...(attributable.length < owned.length ? ['owned_content_contains_unknown_or_unavailable_attribution'] : []),
    ...(metricReady.length < owned.length ? ['owned_content_contains_unknown_or_unavailable_metrics'] : []),
  ];
  const maintenanceEntries = input.maintenance || [];
  const maintenanceUnavailable = maintenanceEntries.find(entry => entry.availability === 'unavailable');
  const knownMinutes = maintenanceEntries.filter(entry => typeof entry.minutes === 'number');
  const maintenanceAvailability: ReviewAvailability = maintenanceUnavailable ? 'unavailable' : knownMinutes.length === maintenanceEntries.length && maintenanceEntries.length ? 'available' : 'unknown';
  const source = { weekRef: input.weekRef, programId: input.programId || '', operatingPackageRef: input.operatingPackageRef || null, startsAt, endsAt, contents: input.contents, metricSnapshots: input.metricSnapshots, unavailableMetricKeys: input.unavailableMetricKeys || [], maintenance: maintenanceEntries, sourceEvidence: input.sourceEvidence || null };
  const sourceDigest = digest(source);
  const snapshotId = `wr_${createHash('sha256').update(`${input.tenantId}\0${input.weekRef}\0${endsAt}\0${sourceDigest}`).digest('hex').slice(0, 24)}`;
  return {
    snapshotId, version: 1, tenantId: input.tenantId, ...(input.programId ? { programId: input.programId } : {}), weekRef: input.weekRef, ...(input.operatingPackageRef ? { operatingPackageRef: input.operatingPackageRef } : {}), window: { startsAt, endsAt, frozenAt }, contents,
    byBusinessDirection: aggregate(contents, item => item.businessDirection), byAccount: aggregate(contents, item => `${item.platform}:${item.accountId}`),
    maintenanceEffort: { minutes: maintenanceAvailability === 'available' ? knownMinutes.reduce((sum, entry) => sum + entry.minutes!, 0) : null, availability: maintenanceAvailability, entryRefs: maintenanceEntries.map(entry => entry.ref) },
    sampleSufficiency: { status: owned.length > 0 && owned.every(item => item.metrics.views?.availability === 'unavailable') ? 'unavailable' : reasons.length ? 'insufficient' : 'sufficient', ownedContentCount: owned.length, attributableContentCount: attributable.length, minimumOwnedContent, reasons },
    evidenceBoundary: { externalReferenceContentIds: contents.filter(item => item.evidenceKind === 'external_reference').map(item => item.contentId), ownedContentIds: owned.map(item => item.contentId) }, ...(input.sourceEvidence ? { sourceEvidence: input.sourceEvidence } : {}), sourceDigest,
  };
}

export async function freezeWeeklyReview(input: FreezeWeeklyReviewInput, dataStore: DataStore = store): Promise<{ snapshot: FrozenWeeklyReview; repeated: boolean }> {
  const snapshot = buildFrozenWeeklyReview(input);
  const identity: Record<string, string | number | boolean> = input.operatingPackageRef
    ? { tenant_id: input.tenantId, package_id: input.operatingPackageRef.id, package_version: input.operatingPackageRef.version }
    : { tenant_id: input.tenantId, week_ref: input.weekRef };
  const read = () => dataStore.list<any>(WEEKLY_REVIEWS, { where: identity, perPage: 2 });
  const rows = await read();
  const existing = rows.items[0];
  if (existing) {
    if (existing.source_digest !== snapshot.sourceDigest) throw Error('weekly_review_already_frozen');
    return { snapshot: existing.snapshot as FrozenWeeklyReview, repeated: true };
  }
  let saved = null;
  try {
    saved = await dataStore.create(WEEKLY_REVIEWS, { tenant_id: input.tenantId, week_ref: input.weekRef, program_id: input.programId || '', package_id: input.operatingPackageRef?.id || '', package_version: input.operatingPackageRef?.version || 0, snapshot_id: snapshot.snapshotId, window_ends_at: snapshot.window.endsAt, source_digest: snapshot.sourceDigest, snapshot, frozen_at: snapshot.window.frozenAt, frozen_by: input.actorId });
  } catch {
    saved = null;
  }
  if (!saved) {
    const raced = (await read()).items[0];
    if (raced?.source_digest === snapshot.sourceDigest) return { snapshot: raced.snapshot as FrozenWeeklyReview, repeated: true };
    if (raced) throw Error('weekly_review_already_frozen');
    throw Error('weekly_review_freeze_unavailable');
  }
  return { snapshot, repeated: false };
}

export async function generateWeeklyCreativeLearnings(snapshot: FrozenWeeklyReview, actorId: string, dataStore: DataStore = store) {
  const results = [];
  for (const content of snapshot.contents) {
    const views = content.metrics.views;
    if (views?.availability !== 'available' || !views.value || !(content.metricSnapshotRefs.length || content.publicationReceiptRefs?.length)) continue;
    const boundaries = [content.evidenceKind === 'external_reference' ? 'External reference performance is not customer-owned outcome evidence.' : 'Observation is limited to the frozen weekly window.'];
    if (content.attributionStatus !== 'attributed') boundaries.push('Customer outcome attribution is unknown or unavailable; do not promote from this observation.');
    const learningId = `weekly:${snapshot.snapshotId}:${content.contentId}`;
    const previous = await dataStore.list<any>('social_creative_learnings', { where: { tenant_id: snapshot.tenantId, learning_id: learningId }, sort: '-version', perPage: 1 });
    if (previous.items[0]) { results.push(previous.items[0]); continue; }
    results.push(await createCreativeLearning(snapshot.tenantId, actorId, { learningId, evidenceKind: content.evidenceKind, scope: { platform: content.platform, accountId: content.accountId, contentIds: [content.contentId], businessDirection: content.businessDirection }, observation: `Frozen weekly window recorded ${views.value} attributable-or-observed views for this content.`, evidenceRefs: [...content.metricSnapshotRefs, ...(content.publicationReceiptRefs || []), ...(content.interactionRefs || []), ...(content.salesQualificationRefs || [])], sample: { startsAt: snapshot.window.startsAt, endsAt: snapshot.window.endsAt, size: 1 }, boundaries, nextAction: content.evidenceKind === 'owned_content_result' && content.attributionStatus === 'attributed' ? 'Compare against the customer account baseline before allocating more quota.' : 'Keep as observation only and collect attributable customer-owned results.' }, dataStore));
  }
  return results;
}

export async function savePromotionLoop(
  input: { tenantId: string; snapshot: FrozenWeeklyReview; decisions: import('../../shared/contracts/socialReview.js').WeeklyPromotionDecision[]; quota: import('../../shared/contracts/socialReview.js').VersionedQuotaReference },
  dataStore: DataStore = store,
) {
  if (input.snapshot.tenantId !== input.tenantId || input.quota.sourceSnapshotId !== input.snapshot.snapshotId) throw Error('promotion_lineage_invalid');
  const frozen = await dataStore.list<any>(WEEKLY_REVIEWS, {
    where: { tenant_id: input.tenantId, snapshot_id: input.snapshot.snapshotId }, perPage: 1,
  });
  const frozenRow = frozen.items[0];
  if (!frozenRow) throw Error('promotion_snapshot_not_frozen');
  if (frozenRow.source_digest !== input.snapshot.sourceDigest || digest(frozenRow.snapshot) !== digest(input.snapshot)) {
    throw Error('promotion_snapshot_conflict');
  }
  const decisionIds = new Set(input.decisions.map(decision => decision.decisionId));
  if (input.quota.allocations.some(allocation => allocation.sourceDecisionIds.some(id => !decisionIds.has(id)))) {
    throw Error('promotion_lineage_invalid');
  }
  for (const decision of input.decisions) {
    if (decision.snapshotId !== input.snapshot.snapshotId) throw Error('promotion_lineage_invalid');
    const readDecision = () => dataStore.list<any>(PROMOTION_DECISIONS, {
      where: { tenant_id: input.tenantId, decision_id: decision.decisionId }, perPage: 1,
    });
    const existingDecision = (await readDecision()).items[0];
    if (existingDecision) {
      if (digest(existingDecision.decision) !== digest(decision)) throw Error('promotion_decision_conflict');
      continue;
    }
    let saved = null;
    try {
      saved = await dataStore.create(PROMOTION_DECISIONS, { tenant_id: input.tenantId, decision_id: decision.decisionId, program_id: input.snapshot.programId || '', snapshot_id: decision.snapshotId, content_id: decision.contentId, action: decision.action, decision, created_at: input.snapshot.window.frozenAt });
    } catch {
      saved = null;
    }
    if (!saved) {
      const raced = (await readDecision()).items[0];
      if (!raced) throw Error('promotion_decision_write_unavailable');
      if (digest(raced.decision) !== digest(decision)) throw Error('promotion_decision_conflict');
    }
  }
  const quotaDigest = digest(input.quota);
  const readQuota = () => dataStore.list<any>(QUOTA_REFERENCES, { where: { tenant_id: input.tenantId, quota_id: input.quota.quotaId, version: input.quota.version }, perPage: 1 });
  const existing = (await readQuota()).items[0];
  if (existing) {
    if (existing.payload_digest !== quotaDigest) throw Error('promotion_quota_version_conflict');
    return { decisions: input.decisions, quota: input.quota, repeated: true };
  }
  let savedQuota = null;
  try {
    savedQuota = await dataStore.create(QUOTA_REFERENCES, { tenant_id: input.tenantId, quota_id: input.quota.quotaId, version: input.quota.version, program_id: input.snapshot.programId || '', snapshot_id: input.snapshot.snapshotId, payload_digest: quotaDigest, quota: input.quota, created_at: input.snapshot.window.frozenAt });
  } catch {
    savedQuota = null;
  }
  if (!savedQuota) {
    const raced = (await readQuota()).items[0];
    if (!raced) throw Error('promotion_quota_write_unavailable');
    if (raced.payload_digest !== quotaDigest) throw Error('promotion_quota_version_conflict');
    return { decisions: input.decisions, quota: input.quota, repeated: true };
  }
  return { decisions: input.decisions, quota: input.quota, repeated: false };
}

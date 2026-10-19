import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { collectionBusinessDate } from '../socialDiscovery/dailyCollectionQuota.js';
import type { WeeklyQualifiedSource } from './weeklyQualifiedCandidateContinuation.js';

/** Immutable proposed child identity. This is evidence, never a provider permit. */
export interface WeeklyQualityShortfallAttempt {
  schema: 'weekly-quality-shortfall-attempt.v1';
  attemptId: string;
  tenantId: string;
  programId: string;
  packageId: string;
  packageVersion: number;
  consumerTaskId: string;
  rootJobId: string;
  rootJobHash: string;
  parentRunId: string;
  parentRunHash: string;
  parentFinishedAt: string;
  scopeId: string;
  scopeVersion: number;
  scopeHash: string;
  businessDate: string;
  source: WeeklyQualifiedSource;
  priorAttemptIds: string[];
  notBefore: string;
  proposedAt: string;
  authorizesExecution: false;
  grantsAdditionalDailyQuota: false;
  recordHash: string;
}

/** A fail-closed proposal that cannot revive a terminal retry grant. The actual
 * package lease, persisted lineage, quota reservation and provider submission
 * must be verified by their owners before this can ever be wired to execution. */
export function proposeWeeklyQualityShortfallAttempt(input: {
  tenantId: string; programId: string; packageId: string; packageVersion: number;
  consumerTaskId: string; rootJobId: string; rootJobHash: string;
  parentRunId: string; parentRunHash: string; parentFinishedAt: string;
  scopeId: string; scopeVersion: number; scopeHash: string;
  currentWeekValid: boolean; currentScopeApproved: boolean;
  priorAttemptIds: string[];
  plan: { code: string; ready: boolean; source: WeeklyQualifiedSource | null; notBefore: string | null; authorizesExecution: false; grantsAdditionalDailyQuota: false };
  capacity: { businessDate: string; remainingCount: number; kind: 'normal_daily_window' | 'explicit_grant'; grantId: string | null };
  now: string;
}): WeeklyQualityShortfallAttempt {
  const now = new Date(input.now), finished = new Date(input.parentFinishedAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(finished.getTime()) || finished.getTime() > now.getTime()
    || !input.currentWeekValid || !input.currentScopeApproved
    || !input.tenantId || !input.programId || !input.packageId || !input.consumerTaskId
    || !input.rootJobId || !input.rootJobHash || !input.parentRunId || !input.parentRunHash
    || !input.scopeId || !input.scopeHash || !Number.isSafeInteger(input.packageVersion) || input.packageVersion < 1
    || !Number.isSafeInteger(input.scopeVersion) || input.scopeVersion < 1
    || new Set(input.priorAttemptIds).size !== input.priorAttemptIds.length || input.priorAttemptIds.some(id => !id))
    throw Error('weekly_quality_shortfall_scope_invalid');
  const businessDate = collectionBusinessDate(now);
  if (collectionBusinessDate(finished) !== businessDate || input.capacity.businessDate !== businessDate)
    throw Error('weekly_quality_shortfall_same_day_required');
  if (input.capacity.kind !== 'normal_daily_window' || input.capacity.grantId !== null
    || !Number.isSafeInteger(input.capacity.remainingCount) || input.capacity.remainingCount < 1)
    throw Error('weekly_quality_shortfall_normal_quota_required');
  const plan = input.plan;
  if (!plan.ready || plan.code !== 'weekly_qualified_continuation_ready' || !plan.source
    || plan.authorizesExecution !== false || plan.grantsAdditionalDailyQuota !== false
    || !plan.notBefore || !Number.isFinite(Date.parse(plan.notBefore)) || now.getTime() < Date.parse(plan.notBefore)
    || !Number.isSafeInteger(plan.source.limit) || plan.source.limit < 1 || plan.source.limit > input.capacity.remainingCount
    || !plan.source.mode || !plan.source.platform || !plan.source.queryRef)
    throw Error('weekly_quality_shortfall_plan_invalid');
  const body = {
    schema: 'weekly-quality-shortfall-attempt.v1' as const,
    tenantId: input.tenantId, programId: input.programId, packageId: input.packageId,
    packageVersion: input.packageVersion, consumerTaskId: input.consumerTaskId,
    rootJobId: input.rootJobId, rootJobHash: input.rootJobHash,
    parentRunId: input.parentRunId, parentRunHash: input.parentRunHash,
    parentFinishedAt: input.parentFinishedAt,
    scopeId: input.scopeId, scopeVersion: input.scopeVersion, scopeHash: input.scopeHash,
    businessDate, source: { ...plan.source }, priorAttemptIds: [...input.priorAttemptIds],
    notBefore: plan.notBefore, proposedAt: now.toISOString(),
    authorizesExecution: false as const, grantsAdditionalDailyQuota: false as const,
  };
  const attemptId = socialRequestHash(body).slice(0, 24);
  return { ...body, attemptId, recordHash: socialRequestHash({ ...body, attemptId }) };
}

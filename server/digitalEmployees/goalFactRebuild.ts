import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';

export type WeeklyGoalFactRebuildLink = {
  sourceGoalId: string;
  sourceGoalVersion: number;
  sourcePlanId: string;
  sourcePlanDigest: string;
  fromFactsVersion: string;
  toFactsVersion: string;
  configVersion: number;
  policyVersion: string;
  requestId: string;
  rebuiltBy: string;
  rebuiltAt: string;
};

export type WeeklyGoalFactRebuildReplacement = WeeklyGoalFactRebuildLink & {
  targetGoalId: string;
  targetPlanId: string;
};

type GoalRecord = Record_ & { tenant_id: string; status: string; version: number; scope: unknown };
type PlanRecord = Record_ & {
  tenant_id: string;
  goal_id: string;
  status: string;
  plan: unknown;
};

const FACT_REBUILD_SUPERSEDED_PLAN_STATUS = 'superseded';

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function weeklyGoalSourcePlanDigest(plan: Pick<PlanRecord, 'id' | 'tenant_id' | 'goal_id' | 'status' | 'plan'>): string {
  return createHash('sha256').update(stableStringify({
    id: plan.id,
    tenantId: plan.tenant_id,
    goalId: plan.goal_id,
    status: plan.status,
    plan: plan.plan,
  })).digest('hex');
}

export function weeklyGoalFactRebuildRecordId(kind: 'goal' | 'plan' | 'audit', tenantId: string, sourceGoalId: string, sourceGoalVersion: number, factsVersion: string, configVersion = 0, policyVersion = '', sourcePlanDigest = ''): string {
  return createHash('sha256')
    .update(JSON.stringify([kind, tenantId, sourceGoalId, sourceGoalVersion, factsVersion, configVersion, policyVersion, sourcePlanDigest]))
    .digest('hex')
    .slice(0, 15);
}

export function weeklyGoalFactRebuildLink(value: unknown): WeeklyGoalFactRebuildLink | null {
  const link = object(value).factRebuild as Partial<WeeklyGoalFactRebuildLink> | undefined;
  if (!link
    || typeof link.sourceGoalId !== 'string'
    || !Number.isSafeInteger(link.sourceGoalVersion)
    || typeof link.sourcePlanId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(link.sourcePlanDigest || ''))
    || typeof link.fromFactsVersion !== 'string'
    || typeof link.toFactsVersion !== 'string'
    || !Number.isSafeInteger(link.configVersion)
    || typeof link.policyVersion !== 'string'
    || typeof link.requestId !== 'string'
    || typeof link.rebuiltBy !== 'string'
    || typeof link.rebuiltAt !== 'string') return null;
  return link as WeeklyGoalFactRebuildLink;
}

/**
 * Presence is deliberately checked independently from payload validity. A
 * malformed or partially written rebuild marker must fail closed instead of
 * making its target look like an ordinary editable weekly goal.
 */
export function hasWeeklyGoalFactRebuildMarker(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(object(value), 'factRebuild');
}

export function sameWeeklyGoalFactRebuild(link: WeeklyGoalFactRebuildLink | null, expected: Pick<WeeklyGoalFactRebuildLink, 'sourceGoalId' | 'sourceGoalVersion' | 'sourcePlanId' | 'sourcePlanDigest' | 'fromFactsVersion' | 'toFactsVersion' | 'configVersion' | 'policyVersion'>): boolean {
  return Boolean(link
    && link.sourceGoalId === expected.sourceGoalId
    && link.sourceGoalVersion === expected.sourceGoalVersion
    && link.sourcePlanId === expected.sourcePlanId
    && link.sourcePlanDigest === expected.sourcePlanDigest
    && link.fromFactsVersion === expected.fromFactsVersion
    && link.toFactsVersion === expected.toFactsVersion
    && link.configVersion === expected.configVersion
    && link.policyVersion === expected.policyVersion);
}

export function sameCompletedWeeklyGoalFactRebuild(left: WeeklyGoalFactRebuildLink | null, right: WeeklyGoalFactRebuildLink): boolean {
  return sameWeeklyGoalFactRebuild(left, right)
    && left?.requestId === right.requestId
    && left.rebuiltBy === right.rebuiltBy
    && left.rebuiltAt === right.rebuiltAt;
}

export function weeklyGoalFactRebuildReplacement(value: unknown): WeeklyGoalFactRebuildReplacement | null {
  const replacement = object(value).factRebuildReplacement as Partial<WeeklyGoalFactRebuildReplacement> | undefined;
  const link = weeklyGoalFactRebuildLink({ factRebuild: replacement });
  if (!link
    || typeof replacement?.targetGoalId !== 'string'
    || typeof replacement.targetPlanId !== 'string') return null;
  return { ...link, targetGoalId: replacement.targetGoalId, targetPlanId: replacement.targetPlanId };
}

export function weeklyGoalFactRebuildPlanCommitMarker(value: unknown): WeeklyGoalFactRebuildReplacement | null {
  const marker = object(value).factRebuildFence as Partial<WeeklyGoalFactRebuildReplacement> | undefined;
  const link = weeklyGoalFactRebuildLink({ factRebuild: marker });
  if (!link
    || typeof marker?.targetGoalId !== 'string'
    || typeof marker.targetPlanId !== 'string') return null;
  return { ...link, targetGoalId: marker.targetGoalId, targetPlanId: marker.targetPlanId };
}

export function hasWeeklyGoalFactRebuildPlanFence(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(object(value), 'factRebuildFence');
}

/** The source token is issued before the server-owned commit fence exists.
 * Strip only that reserved field so an interrupted same-intent commit can be
 * retried without accepting any user-visible plan mutation. */
export function weeklyGoalFactRebuildSourcePlanDigest(plan: Pick<PlanRecord, 'id' | 'tenant_id' | 'goal_id' | 'status' | 'plan'>): string {
  const { factRebuildFence: _commitFence, ...planBody } = object(plan.plan);
  return weeklyGoalSourcePlanDigest({
    ...plan,
    status: plan.status === FACT_REBUILD_SUPERSEDED_PLAN_STATUS ? 'draft' : plan.status,
    plan: planBody,
  });
}

export function weeklyGoalFactRebuildSnapshotMatches(
  current: { factsVersion: string; configVersion: number; policyVersion: string },
  expected: Pick<WeeklyGoalFactRebuildLink, 'toFactsVersion' | 'configVersion' | 'policyVersion'>,
): boolean {
  return current.factsVersion === expected.toFactsVersion
    && current.configVersion === expected.configVersion
    && current.policyVersion === expected.policyVersion;
}

export class WeeklyGoalFactRebuildCommitError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'WeeklyGoalFactRebuildCommitError';
  }
}

function completedReplacementMatches(actual: WeeklyGoalFactRebuildReplacement | null, expected: WeeklyGoalFactRebuildReplacement): boolean {
  return Boolean(actual
    && actual.targetGoalId === expected.targetGoalId
    && actual.targetPlanId === expected.targetPlanId
    && sameCompletedWeeklyGoalFactRebuild(actual, expected));
}

/**
 * Finalizes a generated replacement without starting it. Both replacement
 * records and their fact lineage must already be durable before the source
 * draft can be atomically cancelled. Replays only validate the stored link.
 */
export async function commitWeeklyGoalFactRebuildReplacement(input: {
  dataStore: DataStore;
  tenantId: string;
  sourceGoalId: string;
  sourceGoalVersion: number;
  sourceDescription: string;
  replacement: WeeklyGoalFactRebuildReplacement;
  validateAfterSourcePlanFence?: () => Promise<void>;
}): Promise<'committed' | 'replayed'> {
  const { dataStore, tenantId, sourceGoalId, sourceGoalVersion, replacement } = input;
  if (!dataStore.compareAndSwap) throw new WeeklyGoalFactRebuildCommitError('goal_fact_rebuild_atomic_store_required', '当前存储不支持安全重建周目标。');
  const [source, sourcePlan, target, targetPlan, sourceRuns, targetRuns] = await Promise.all([
    dataStore.getById<GoalRecord>('weekly_goals', sourceGoalId),
    dataStore.getById<PlanRecord>('weekly_plans', replacement.sourcePlanId),
    dataStore.getById<GoalRecord>('weekly_goals', replacement.targetGoalId),
    dataStore.getById<PlanRecord>('weekly_plans', replacement.targetPlanId),
    dataStore.list<Record_>('workflow_runs', { where: { tenant_id: tenantId, goal_id: sourceGoalId }, page: 1, perPage: 1 }),
    dataStore.list<Record_>('workflow_runs', { where: { tenant_id: tenantId, goal_id: replacement.targetGoalId }, page: 1, perPage: 1 }),
  ]);
  if (!source || source.tenant_id !== tenantId || Number(source.version) !== sourceGoalVersion) {
    throw new WeeklyGoalFactRebuildCommitError('goal_changed', '周目标版本已变化，请刷新后重试。');
  }
  const sourcePlanCommit = weeklyGoalFactRebuildPlanCommitMarker(sourcePlan?.plan);
  if (!sourcePlan
    || sourcePlan.tenant_id !== tenantId
    || sourcePlan.goal_id !== source.id
    || !['draft', FACT_REBUILD_SUPERSEDED_PLAN_STATUS].includes(sourcePlan.status)
    || weeklyGoalFactRebuildSourcePlanDigest(sourcePlan) !== replacement.sourcePlanDigest
    || (hasWeeklyGoalFactRebuildPlanFence(sourcePlan.plan) && !completedReplacementMatches(sourcePlanCommit, replacement))
    || (sourcePlan.status === FACT_REBUILD_SUPERSEDED_PLAN_STATUS && !completedReplacementMatches(sourcePlanCommit, replacement))) {
    throw new WeeklyGoalFactRebuildCommitError('goal_source_plan_changed', '原周计划已变化，请刷新后重试。');
  }
  if (sourceRuns.items.length) {
    throw new WeeklyGoalFactRebuildCommitError('package_locked', '周目标已经产生运行记录，不能自动重建。');
  }
  const targetPlanBody = object(targetPlan?.plan);
  const targetFactsVersion = String(object(targetPlanBody.knowledgeBinding).factsVersion || '').trim();
  if (!target
    || target.tenant_id !== tenantId
    || !targetPlan
    || targetPlan.tenant_id !== tenantId
    || targetPlan.goal_id !== target.id
    || targetFactsVersion !== replacement.toFactsVersion
    || Number(targetPlanBody.configVersion) !== replacement.configVersion
    || String(targetPlanBody.policyVersion || '') !== replacement.policyVersion
    || !sameCompletedWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(target.scope), replacement)
    || !sameCompletedWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(targetPlanBody), replacement)) {
    throw new WeeklyGoalFactRebuildCommitError('goal_fact_rebuild_replacement_incomplete', '替代周目标或计划尚未完整保存。');
  }
  if (source.status === 'cancelled') {
    if (['draft', 'active', 'paused', 'completed', 'cancelled'].includes(target.status)
      && ['draft', 'approved'].includes(targetPlan.status)
      && completedReplacementMatches(weeklyGoalFactRebuildReplacement(source.scope), replacement)
      && completedReplacementMatches(sourcePlanCommit, replacement)) {
      if (sourcePlan.status === 'draft') await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
        tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: sourcePlan.plan,
      }, { status: FACT_REBUILD_SUPERSEDED_PLAN_STATUS });
      return 'replayed';
    }
    throw new WeeklyGoalFactRebuildCommitError('goal_changed', '原周目标已由其他操作变更。');
  }
  if (source.status !== 'draft') {
    throw new WeeklyGoalFactRebuildCommitError('draft_required', '只有尚未启动的过期周目标可以自动重建。');
  }
  if (target.status !== 'draft'
    || Number(target.version) !== 1
    || targetPlan.status !== 'draft'
    || targetRuns.items.length) {
    throw new WeeklyGoalFactRebuildCommitError('goal_fact_rebuild_target_not_pristine', '替代周目标已被修改或启动，不能替换原草稿。');
  }
  if (sourcePlan.status === FACT_REBUILD_SUPERSEDED_PLAN_STATUS) {
    throw new WeeklyGoalFactRebuildCommitError('goal_changed', '原周目标已由其他操作变更。');
  }
  const sourcePlanBody = object(sourcePlan.plan);
  const fencedSourcePlanBody = sourcePlanCommit
    ? sourcePlanBody
    : { ...sourcePlanBody, factRebuildFence: replacement };
  if (!sourcePlanCommit) {
    const sealed = await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
      tenant_id: tenantId,
      goal_id: source.id,
      status: 'draft',
      plan: sourcePlan.plan,
    }, { plan: fencedSourcePlanBody });
    if (!sealed) {
      throw new WeeklyGoalFactRebuildCommitError('goal_source_plan_changed', '原周计划已变化，请刷新后重试。');
    }
  }
  const runsAfterFence = await dataStore.list<Record_>('workflow_runs', {
    where: { tenant_id: tenantId, goal_id: sourceGoalId }, page: 1, perPage: 1,
  });
  if (runsAfterFence.items.length) {
    await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
      tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: fencedSourcePlanBody,
    }, { plan: sourcePlanBody });
    throw new WeeklyGoalFactRebuildCommitError('package_locked', '周目标已经产生运行记录，不能自动重建。');
  }
  try {
    await input.validateAfterSourcePlanFence?.();
  } catch (error) {
    await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
      tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: fencedSourcePlanBody,
    }, { plan: sourcePlanBody });
    throw error;
  }
  const sourceScope = object(source.scope);
  const committed = await dataStore.compareAndSwap('weekly_goals', source.id, {
    tenant_id: tenantId,
    status: 'draft',
    version: sourceGoalVersion,
  }, {
    status: 'cancelled',
    scope: {
      ...sourceScope,
      ...(!String(sourceScope.description || '').trim() ? { description: input.sourceDescription } : {}),
      factRebuildReplacement: replacement,
    },
    updated_at: replacement.rebuiltAt,
  });
  if (committed) {
    const superseded = await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
      tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: fencedSourcePlanBody,
    }, { status: FACT_REBUILD_SUPERSEDED_PLAN_STATUS });
    if (!superseded) {
      throw new WeeklyGoalFactRebuildCommitError('goal_fact_rebuild_source_plan_finalize_failed', '原周计划封存状态不完整，请重试恢复。');
    }
    return 'committed';
  }
  const current = await dataStore.getById<GoalRecord>('weekly_goals', source.id);
  if (current?.tenant_id === tenantId
    && current.status === 'cancelled'
    && completedReplacementMatches(weeklyGoalFactRebuildReplacement(current.scope), replacement)) {
    await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
      tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: fencedSourcePlanBody,
    }, { status: FACT_REBUILD_SUPERSEDED_PLAN_STATUS });
    return 'replayed';
  }
  await dataStore.compareAndSwap('weekly_plans', sourcePlan.id, {
    tenant_id: tenantId, goal_id: source.id, status: 'draft', plan: fencedSourcePlanBody,
  }, { plan: sourcePlanBody });
  throw new WeeklyGoalFactRebuildCommitError('goal_changed', '原周目标状态已变化，未自动覆盖。');
}

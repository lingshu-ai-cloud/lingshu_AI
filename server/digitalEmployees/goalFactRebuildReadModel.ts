import { commitWeeklyGoalFactRebuildReplacement, hasWeeklyGoalFactRebuildMarker, sameCompletedWeeklyGoalFactRebuild, weeklyGoalFactRebuildLink, weeklyGoalFactRebuildRecordId, weeklyGoalFactRebuildReplacement, weeklyGoalFactRebuildSourcePlanDigest } from './goalFactRebuild.js';
import { store } from '../storage/index.js';
import { digitalEmployeeOperatingGoals } from './overviewGoalScope.js';
import { goalInput } from './overviewProjection.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type GoalRecord, type PlanRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createGoalFactRebuildReadModel(deps: Pick<DigitalEmployeeApplicationPorts, 'tenantRecord'>) {
  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  async function ensureWeeklyGoalFactRebuildAudit(input: {
    tenantId: string;
    userId: string;
    sourceGoalId: string;
    sourceGoalVersion: number;
    sourcePlanId: string;
    sourcePlanDigest: string;
    targetGoalId: string;
    targetPlanId: string;
    fromFactsVersion: string;
    toFactsVersion: string;
    configVersion: number;
    policyVersion: string;
    requestId: string;
  }): Promise<void> {
    const id = weeklyGoalFactRebuildRecordId('audit', input.tenantId, input.sourceGoalId, input.sourceGoalVersion, input.toFactsVersion, input.configVersion, input.policyVersion, input.sourcePlanDigest);
    const metadata = {
      requestId: input.requestId,
      sourceGoalId: input.sourceGoalId,
      sourceGoalVersion: input.sourceGoalVersion,
      sourcePlanId: input.sourcePlanId,
      sourcePlanDigest: input.sourcePlanDigest,
      targetGoalId: input.targetGoalId,
      targetPlanId: input.targetPlanId,
      fromFactsVersion: input.fromFactsVersion,
      toFactsVersion: input.toFactsVersion,
      configVersion: input.configVersion,
      policyVersion: input.policyVersion,
      automatic: true,
      started: false,
    };
    const auditMatches = (record: StoredRecord | null) => {
      const saved = jsonObject<Record<string, unknown>>(record?.metadata, {});
      return Boolean(record
        && String(record.tenantId || '') === input.tenantId
        && String(record.action || '') === 'weekly_goal.rebuilt_from_latest_facts'
        && String(record.targetType || '') === 'weekly_goal'
        && String(record.targetId || '') === input.targetGoalId
        && String(saved.requestId || '') === input.requestId
        && String(saved.sourceGoalId || '') === input.sourceGoalId
        && Number(saved.sourceGoalVersion) === input.sourceGoalVersion
        && String(saved.sourcePlanId || '') === input.sourcePlanId
        && String(saved.sourcePlanDigest || '') === input.sourcePlanDigest
        && String(saved.targetGoalId || '') === input.targetGoalId
        && String(saved.targetPlanId || '') === input.targetPlanId
        && String(saved.fromFactsVersion || '') === input.fromFactsVersion
        && String(saved.toFactsVersion || '') === input.toFactsVersion
        && Number(saved.configVersion) === input.configVersion
        && String(saved.policyVersion || '') === input.policyVersion
        && saved.automatic === true
        && saved.started === false);
    };
    const existing = await store.getById<StoredRecord>('audit_logs', id);
    if (existing) {
      if (!auditMatches(existing)) {
        throw new Error('weekly_goal_fact_rebuild_audit_conflict');
      }
      return;
    }
    let created: StoredRecord | null = null;
    try {
      created = await store.create<StoredRecord>('audit_logs', {
        id,
        tenantId: input.tenantId,
        actorUserId: input.userId,
        actorEmail: '',
        action: 'weekly_goal.rebuilt_from_latest_facts',
        targetType: 'weekly_goal',
        targetId: input.targetGoalId,
        metadata,
        createdAt: new Date().toISOString(),
      });
    } catch { /* A deterministic-ID winner is recovered and validated below. */ }
    if (created) return;
    const recovered = await store.getById<StoredRecord>('audit_logs', id);
    if (!auditMatches(recovered)) {
      throw new Error('weekly_goal_fact_rebuild_audit_unavailable');
    }
  }

  function weeklyGoalFactRebuildRecovery(goal: GoalRecord, plan: PlanRecord, expectedFactsVersion: string, factVersion: string) {
    return {
      recoveryAction: 'rebuild_weekly_goal',
      sourceGoalId: goal.id,
      expectedGoalVersion: Number(goal.version || 1),
      sourcePlanId: plan.id,
      expectedFactsVersion,
      expectedSourcePlanDigest: weeklyGoalFactRebuildSourcePlanDigest(plan),
      factVersion,
    };
  }

  async function weeklyGoalFactRebuildTargetCommitted(tenantId: string, target: GoalRecord): Promise<boolean> {
    if (!hasWeeklyGoalFactRebuildMarker(target.scope)) return true;
    const targetLink = weeklyGoalFactRebuildLink(target.scope);
    if (!targetLink) return false;
    const source = await tenantRecord<GoalRecord>(COLLECTION.goals, targetLink.sourceGoalId, tenantId);
    const replacement = weeklyGoalFactRebuildReplacement(source?.scope);
    if (!source
      || source.status !== 'cancelled'
      || !replacement
      || replacement.targetGoalId !== target.id
      || !sameCompletedWeeklyGoalFactRebuild(targetLink, replacement)) return false;
    try {
      return await commitWeeklyGoalFactRebuildReplacement({
        dataStore: store,
        tenantId,
        sourceGoalId: source.id,
        sourceGoalVersion: targetLink.sourceGoalVersion,
        sourceDescription: goalInput(source).scope,
        replacement,
      }) === 'replayed';
    } catch {
      return false;
    }
  }

  async function committedDigitalEmployeeOperatingGoals(tenantId: string, goals: GoalRecord[]): Promise<GoalRecord[]> {
    const operatingGoals = digitalEmployeeOperatingGoals(goals);
    const commitStates = await Promise.all(operatingGoals.map(goal => weeklyGoalFactRebuildTargetCommitted(tenantId, goal)));
    return operatingGoals.filter((_goal, index) => commitStates[index]);
  }

  return { ensureWeeklyGoalFactRebuildAudit, weeklyGoalFactRebuildRecovery, weeklyGoalFactRebuildTargetCommitted, committedDigitalEmployeeOperatingGoals };
}

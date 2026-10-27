import { normalizeDigitalEmployeeConfig, type DigitalEmployeeConfig, type WeeklyGoalInput } from './domain.js';
import { VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES as VISIBLE_AGENT_ROLES, visibleDigitalEmployeeAgentRole as visibleAgentRole, type VisibleDigitalEmployeeAgentRole as VisibleAgentRole } from './agentRoles.js';
import type { ResolvedDigitalEmployeeConfiguration } from './configuration.js';
import { recommendPackage, repairCollapsedWeeklyVideoProduction } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { jsonObject, type ConfigRecord, type GoalRecord, type PlanRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';

/** Public shapes only. The caller owns tenant reads, authorization, and writes. */
export function publicConfig(record: ConfigRecord | null): DigitalEmployeeConfig | null {
  return record ? normalizeDigitalEmployeeConfig(jsonObject(record.config, {})) : null;
}

export function publicConfigurationMetadata(resolved: ResolvedDigitalEmployeeConfiguration | null) {
  if (!resolved) return null;
  return {
    configVersion: resolved.configVersion,
    policyVersion: resolved.policyVersion,
    knowledgeBinding: resolved.knowledgeBinding,
    runtimePolicy: resolved.runtimePolicy,
  };
}

export function publicGoal(record: GoalRecord): WeeklyGoalInput & { id: string; status: string; version: number; createdAt: string; updatedAt: string } {
  return {
    id: record.id,
    businessLine: ['content_growth', 'customer_conversion'].includes(String(record.business_line)) ? record.business_line as WeeklyGoalInput['businessLine'] : 'full_funnel',
    contentPlatforms: jsonObject<WeeklyGoalInput['contentPlatforms']>(record.content_platforms, ['facebook', 'instagram', 'tiktok', 'youtube']),
    title: String(record.title || ''),
    objective: String(record.objective || ''),
    metric: String(record.metric || ''),
    baseline: Number(record.baseline || 0),
    target: Number(record.target || 0),
    unit: String(record.unit || ''),
    startsAt: String(record.starts_at || ''),
    endsAt: String(record.ends_at || ''),
    scope: typeof jsonObject(record.scope, record.scope || '') === 'object' ? String(jsonObject<any>(record.scope, {}).description || '') : String(jsonObject(record.scope, record.scope || '')),
    videoPlans: jsonObject<any>(record.scope, {}).videoPlans,
    promotionPlans: jsonObject<any>(record.scope, {}).promotionPlans,
    constraints: jsonObject<string[]>(record.constraints, []),
    status: String(record.status || 'draft'),
    version: Number(record.version || 1),
    createdAt: String(record.created_at || ''),
    updatedAt: String(record.updated_at || ''),
  };
}

export function goalInput(record: GoalRecord): WeeklyGoalInput {
  const publicRecord = publicGoal(record);
  const { id: _id, status: _status, version: _version, createdAt: _created, updatedAt: _updated, ...goal } = publicRecord;
  return goal;
}

export function configSnapshotForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig {
  if (!plan) return fallback;
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  return body.configSnapshot ? normalizeDigitalEmployeeConfig(jsonObject(body.configSnapshot, fallback)) : fallback;
}

export function publicOverviewPlan(input: {
  plan: PlanRecord | null;
  body: Record<string, unknown>;
  goal: GoalRecord;
  resolvedConfiguration: ResolvedDigitalEmployeeConfiguration | null;
}) {
  const { plan, body, goal, resolvedConfiguration } = input;
  if (!plan) return null;
  const publicTasks = Array.isArray(body.tasks)
    ? body.tasks.map(item => {
      const task = jsonObject<Record<string, unknown>>(item, {});
      return { ...task, agentRole: visibleAgentRole(String(task.agentRole || ''), String(task.key || '')) };
    })
    : [];
  const configSnapshot = body.configSnapshot && typeof body.configSnapshot === 'object'
    ? { ...jsonObject<Record<string, unknown>>(body.configSnapshot, {}), team: [...VISIBLE_AGENT_ROLES] }
    : body.configSnapshot;
  return {
    id: plan.id,
    status: plan.status,
    ...body,
    tasks: publicTasks,
    ...(configSnapshot ? { configSnapshot } : {}),
    businessPackage: body.businessPackage
      ? repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage)
      : (resolvedConfiguration ? { ...recommendPackage(goalInput(goal), configSnapshotForPlan(plan, resolvedConfiguration.config), goal.owner_id), revision: 0 } : undefined),
  };
}

export function publicAgentStatuses(tasks: Array<TaskRecord & { agent_role: VisibleAgentRole }>) {
  return VISIBLE_AGENT_ROLES.map(role => {
    const agentTasks = tasks.filter(task => task.agent_role === role);
    const active = agentTasks.find(task => ['running', 'waiting_external', 'waiting_approval', 'waiting_human', 'handed_off'].includes(task.status));
    return {
      role,
      status: active?.status || (agentTasks.length > 0 && agentTasks.every(task => ['succeeded', 'skipped'].includes(task.status)) ? 'completed' : 'idle'),
      currentTask: active?.title || '',
      completed: agentTasks.filter(task => task.status === 'succeeded').length,
      total: agentTasks.length,
    };
  });
}

/** Prevent private reasoning fields from reaching persisted or streamed events. */
export function publicEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicEventPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => {
      const normalized = key.toLowerCase();
      return !['thought', 'thoughts', 'reasoning', 'chain_of_thought'].includes(normalized)
        && !/(thought|reasoning|chain.?of.?thought)/i.test(key);
    })
    .map(([key, item]) => [key, publicEventPayload(item)]));
}

import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import {
  type OwnedSocialAccount,
  type SocialPlatform,
  type SocialWeeklyContentPackage,
  type SocialWeeklyPublicationTask,
  type VersionedSocialRef,
  type WeeklyOperatingPackage,
  type WeeklyWorkflowEvent,
} from '../../shared/contracts/socialProgram.js';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import type { CapacityPlan } from '../socialOperating/capacityPlanner.js';
import type { AutomationPolicyResolution } from '../socialOperating/automationPolicyResolver.js';
import { SocialProgramError } from './service.js';
import { buildWeeklyWorkflow, type WeeklyAutomationPolicySnapshot, type WeeklyCapacitySnapshot } from './weeklyPlanner.js';
import { applyWorkflowEvent } from './workflowState.js';
import { listWeeklyExecutionTasks, projectWeeklyExecution, summarizeWeeklyExecutionTasks } from './executionTasks.js';

import { enqueueAgentNotificationDomainEvent } from '../notifications/agentNotificationOutbox.js';

export const PACKAGES = 'social_weekly_operating_packages';
export const PROGRAMS = 'social_programs';
const ACCOUNTS = 'social_owned_accounts';
export const WORKFLOW_EVENTS = 'social_weekly_workflow_events';
const workflowMutationTails = new Map<string, Promise<void>>();
export const PROMOTION_QUOTAS = 'social_weekly_quota_references';
export const WEEKLY_REVIEWS = 'social_weekly_review_snapshots';
const SUPPORTED_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube'] as const;
type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];

export type PackageRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  package_id: string;
  version: number;
  week_start: string;
  status: string;
  payload: WeeklyOperatingPackage;
  updated_at: string;
};
export type ProgramRow = { id: string; tenant_id: string; program_id: string; payload: Record<string, unknown> };
type AccountRow = { id: string; tenant_id: string; program_id: string; payload: OwnedSocialAccount };
export type WorkflowEventRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  package_id: string;
  package_version: number;
  event_id: string;
  state_version: number;
  event_digest: string;
  event: WeeklyWorkflowEvent;
};

export interface WeeklyPublishingAccountPlan {
  accountId: string;
  platform: SupportedPlatform;
  publicationCount: number;
  accountPositioning: string | null;
}

const DEFAULT_COUNTS: Record<SupportedPlatform, number[]> = {
  tiktok: [5, 5],
  facebook: [5, 5],
  instagram: [3],
  youtube: [3],
};

const text = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max);
const uniqueText = (value: unknown, max = 30) => Array.isArray(value)
  ? [...new Set(value.map(item => text(item, 240)).filter(Boolean))].slice(0, max)
  : [];
export const at = () => new Date().toISOString();
export const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value);
export const eventDigest = (event: WeeklyWorkflowEvent) => createHash('sha256').update(stable(event)).digest('hex');

export async function serializeWorkflowMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = workflowMutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.then(() => current);
  workflowMutationTails.set(key, tail);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (workflowMutationTails.get(key) === tail) workflowMutationTails.delete(key);
  }
}

function finiteBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new SocialProgramError('invalid_budget', 400, '预算必须是非负数。');
  }
  return Math.round(parsed * 100) / 100;
}

export function dateOnly(value: unknown, code: string): string {
  const result = text(value, 10);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new SocialProgramError(code, 400, '周起始日期必须使用 YYYY-MM-DD。');
  }
  return result;
}

function weekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function isSupportedPlatform(value: SocialPlatform): value is SupportedPlatform {
  return SUPPORTED_PLATFORMS.includes(value as SupportedPlatform);
}

export function versionedRef(value: unknown): VersionedSocialRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const type = text(row.type, 80);
  const id = text(row.id, 160);
  const version = Number(row.version);
  return type && id && Number.isSafeInteger(version) && version > 0 ? { type, id, version } : null;
}

export function businessGoal(value: unknown, programId: string): BusinessContentGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const goal = value as BusinessContentGoal;
  return goal.programId === programId && goal.goalId && Number.isSafeInteger(goal.version) && goal.version > 0
    && (goal.status === 'ready' || goal.status === 'blocked') && Array.isArray(goal.blockers)
    ? goal : null;
}

function capacitySnapshot(value: unknown): WeeklyCapacitySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as WeeklyCapacitySnapshot;
  return versionedRef(item.ref) && (item.status === 'ready' || item.status === 'blocked') && Array.isArray(item.accountPlans)
    ? item : null;
}

function policySnapshot(value: unknown): WeeklyAutomationPolicySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as WeeklyAutomationPolicySnapshot;
  return versionedRef(item.ref) && (item.status === 'ready' || item.status === 'blocked') ? item : null;
}

export function validCapacityPlan(value: unknown): value is CapacityPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as CapacityPlan;
  if (!['ready', 'degraded', 'blocked'].includes(plan.status) || !Array.isArray(plan.accountQuotas) || !Array.isArray(plan.limitingFactors)) return false;
  const integers = [plan.originalContentQuota, plan.adaptationQuota, plan.publicationQuota];
  if (integers.some(item => !Number.isSafeInteger(item) || item < 0)) return false;
  if (!Number.isFinite(plan.estimatedCostCny) || plan.estimatedCostCny < 0) return false;
  if (plan.originalContentQuota + plan.adaptationQuota !== plan.publicationQuota) return false;
  if (plan.accountQuotas.some(item => !text(item.accountId, 160) || !Number.isSafeInteger(item.publicationQuota) || item.publicationQuota < 0)) return false;
  return plan.accountQuotas.reduce((sum, item) => sum + item.publicationQuota, 0) === plan.publicationQuota;
}

export function validAutomationPolicy(value: unknown): value is AutomationPolicyResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as AutomationPolicyResolution;
  return ['allowed', 'approval_required', 'blocked'].includes(policy.status)
    && ['read', 'analyze', 'draft', 'change_scope', 'spend', 'publish', 'customer_send', 'commercial_commitment'].includes(policy.action)
    && typeof policy.automaticExecutionAllowed === 'boolean';
}

export async function programRow(dataStore: DataStore, tenantId: string, programId: string): Promise<ProgramRow> {
  const result = await dataStore.list<ProgramRow>(PROGRAMS, {
    where: { tenant_id: tenantId, program_id: programId }, page: 1, perPage: 1,
  });
  if (!result.items[0]) throw new SocialProgramError('program_not_found', 404, '社媒项目不存在。');
  return result.items[0];
}

export async function accountsForProgram(dataStore: DataStore, tenantId: string, programId: string): Promise<OwnedSocialAccount[]> {
  const result = await dataStore.list<AccountRow>(ACCOUNTS, {
    where: { tenant_id: tenantId, program_id: programId }, sort: 'created_at', page: 1, perPage: 100,
  });
  return result.items.map(row => row.payload).filter(account => account.status !== 'retired');
}

function defaultAccountPlans(accounts: OwnedSocialAccount[]): WeeklyPublishingAccountPlan[] {
  const plans: WeeklyPublishingAccountPlan[] = [];
  for (const platform of SUPPORTED_PLATFORMS) {
    const available = accounts.filter(account => account.platform === platform);
    const counts = DEFAULT_COUNTS[platform];
    if (available.length < counts.length) {
      throw new SocialProgramError(
        'default_account_matrix_incomplete',
        409,
        `默认周包需要 ${platform} ${counts.length} 个业务账号，当前仅 ${available.length} 个。`,
      );
    }
    counts.forEach((publicationCount, index) => plans.push({
      accountId: available[index]!.accountId,
      platform,
      publicationCount,
      accountPositioning: available[index]!.businessRole || null,
    }));
  }
  return plans;
}

function customAccountPlans(value: unknown, accounts: OwnedSocialAccount[]): WeeklyPublishingAccountPlan[] {
  if (!Array.isArray(value) || !value.length) {
    throw new SocialProgramError('account_plans_required', 400, '请提供至少一个账号发布配额。');
  }
  const accountById = new Map(accounts.map(account => [account.accountId, account]));
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SocialProgramError('account_plan_invalid', 400, '账号发布配额格式无效。');
    }
    const row = raw as Record<string, unknown>;
    const accountId = text(row.accountId, 160);
    const account = accountById.get(accountId);
    const publicationCount = Number(row.publicationCount);
    if (!account || !isSupportedPlatform(account.platform)) {
      throw new SocialProgramError('account_not_found', 400, '发布配额包含不属于当前项目的账号。');
    }
    if (seen.has(accountId)) throw new SocialProgramError('duplicate_account_plan', 400, '同一账号只能出现一次。');
    if (!Number.isSafeInteger(publicationCount) || publicationCount < 1 || publicationCount > 50) {
      throw new SocialProgramError('publication_count_invalid', 400, '单账号发布数必须是 1—50 的整数。');
    }
    seen.add(accountId);
    return {
      accountId,
      platform: account.platform,
      publicationCount,
      accountPositioning: text(row.accountPositioning, 300) || account.businessRole || null,
    };
  });
}

function publicationTasks(
  plans: WeeklyPublishingAccountPlan[],
  originalContentTarget: number,
  input: Record<string, unknown>,
): SocialWeeklyPublicationTask[] {
  const taskInputs = Array.isArray(input.publicationTasks) ? input.publicationTasks : [];
  const taskInputsByAccount = new Map<string, Record<string, unknown>[]>();
  for (const raw of taskInputs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const task = raw as Record<string, unknown>;
    const accountId = text(task.accountId, 160);
    if (!accountId) continue;
    taskInputsByAccount.set(accountId, [...(taskInputsByAccount.get(accountId) ?? []), task]);
  }
  const accountTaskIndexes = new Map<string, number>();
  const generated: SocialWeeklyPublicationTask[] = [];
  let index = 0;
  for (const plan of plans) {
    for (let accountIndex = 0; accountIndex < plan.publicationCount; accountIndex += 1) {
      const accountTaskIndex = accountTaskIndexes.get(plan.accountId) ?? 0;
      const matchingOverride = taskInputsByAccount.get(plan.accountId)?.[accountTaskIndex];
      const positionalOverride = taskInputs[index] && typeof taskInputs[index] === 'object' && !Array.isArray(taskInputs[index])
        ? taskInputs[index] as Record<string, unknown> : undefined;
      const override = matchingOverride ?? positionalOverride ?? {};
      const motherIndex = index % originalContentTarget;
      const firstTask = generated.find(item => item.motherContentId === `mother-${motherIndex + 1}`);
      generated.push({
        publicationTaskId: text(override.publicationTaskId, 160) || randomUUID(),
        motherContentId: text(override.motherContentId, 160) || `mother-${motherIndex + 1}`,
        adaptationOfPublicationTaskId: firstTask?.publicationTaskId ?? null,
        platform: plan.platform,
        accountId: plan.accountId,
        accountPositioning: text(override.accountPositioning, 300) || plan.accountPositioning,
        businessProposition: text(override.businessProposition, 500) || null,
        cta: text(override.cta, 500) || null,
        factRefs: Array.isArray(override.factRefs)
          ? override.factRefs.map(versionedRef).filter((ref): ref is VersionedSocialRef => Boolean(ref)).slice(0, 30)
          : [],
        metricTargets: uniqueText(override.metricTargets),
        publishWindow: text(override.publishWindow, 120) || null,
        status: 'planned',
      });
      accountTaskIndexes.set(plan.accountId, accountTaskIndex + 1);
      index += 1;
    }
  }
  return generated;
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new SocialProgramError('original_content_target_invalid', 400, `母内容数必须是 1—${maximum} 的整数。`);
  }
  return result;
}

export async function latestPackageRow(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
): Promise<PackageRow | null> {
  const result = await dataStore.list<PackageRow>(PACKAGES, {
    where: { tenant_id: tenantId, program_id: programId, package_id: packageId },
    sort: '-version', page: 1, perPage: 1,
  });
  return result.items[0] ?? null;
}

export async function workflowEventRows(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
  packageVersion: number,
): Promise<WorkflowEventRow[]> {
  const items: WorkflowEventRow[] = [];
  let page = 1;
  while (true) {
    const result = await dataStore.list<WorkflowEventRow>(WORKFLOW_EVENTS, {
      where: { tenant_id: tenantId, program_id: programId, package_id: packageId, package_version: packageVersion },
      sort: 'state_version', page, perPage: 200,
    });
    items.push(...result.items);
    if (page >= result.totalPages || !result.items.length) return items;
    page += 1;
  }
}

export async function projectWorkflowState(
  dataStore: DataStore,
  tenantId: string,
  row: PackageRow,
): Promise<WeeklyOperatingPackage> {
  let projected: WeeklyOperatingPackage = {
    ...row.payload,
    workflowStateVersion: row.payload.workflowStateVersion ?? row.payload.appliedWorkflowEvents.length,
  };
  let expectedStateVersion: number = row.payload.workflowStateVersion ?? row.payload.appliedWorkflowEvents.length;
  const persisted = await workflowEventRows(dataStore, tenantId, row.program_id, row.package_id, row.version);
  for (const stored of persisted) {
    const embedded = projected.appliedWorkflowEvents.find(item => item.eventId === stored.event_id);
    if (embedded) {
      if (eventDigest(embedded) !== stored.event_digest) {
        throw new SocialProgramError('workflow_event_conflict', 409, '已持久化工作流事件与包内历史冲突。');
      }
      expectedStateVersion = Math.max(expectedStateVersion, stored.state_version);
      continue;
    }
    if (stored.state_version !== expectedStateVersion + 1) {
      throw new SocialProgramError('workflow_event_stream_incomplete', 503, '工作流事件序列不连续，暂停推进。');
    }
    projected = applyWorkflowEvent(projected, stored.event, { authoritativeUnblockVerified: true });
    expectedStateVersion = stored.state_version;
    projected.workflowStateVersion = expectedStateVersion;
  }
  return projected;
}

export function requireExpectedVersion(actual: number, expected: unknown): void {
  const parsed = Number(expected);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SocialProgramError('expected_version_required', 400, '写入必须提供 expectedVersion。');
  }
  if (actual !== parsed) throw new SocialProgramError('version_conflict', 409, `数据已更新，当前版本为 ${actual}。`);
}

export function packageFromInput(args: {
  input: Record<string, unknown>;
  programId: string;
  userId: string;
  accounts: OwnedSocialAccount[];
  packageId: string;
  contentPackageId: string;
  version: number;
  previousVersion: number | null;
  program: Record<string, unknown>;
  previousPackage?: WeeklyOperatingPackage;
}): WeeklyOperatingPackage {
  const weekStart = dateOnly(args.input.weekStart, 'week_start_invalid');
  const capacity = capacitySnapshot(args.input.capacityPlan);
  const policy = policySnapshot(args.input.automationPolicy);
  const goal = businessGoal(args.input.businessContentGoal, args.programId);
  const capacityAccountPlans = capacity?.status === 'ready' ? capacity.accountPlans : undefined;
  const proposedAccountPlans = capacityAccountPlans ?? args.input.accountPlans;
  const plans = proposedAccountPlans === undefined
    ? defaultAccountPlans(args.accounts)
    : customAccountPlans(proposedAccountPlans, args.accounts);
  const publicationTaskTarget = plans.reduce((sum, plan) => sum + plan.publicationCount, 0);
  if (publicationTaskTarget > 100) throw new SocialProgramError('publication_target_too_large', 400, '单周发布任务不能超过 100 条。');
  const originalContentTarget = positiveInteger(capacity?.status === 'ready' ? capacity.originalContentTarget : args.input.originalContentTarget, Math.min(10, publicationTaskTarget), publicationTaskTarget);
  const tasks = publicationTasks(plans, originalContentTarget, args.input);
  const status = 'draft' as const;
  const timestamp = at();
  const contentPackage: SocialWeeklyContentPackage = {
    contentPackageId: args.contentPackageId,
    operatingPackageId: args.packageId,
    version: args.version,
    status,
    originalContentTarget,
    adaptationVersionTarget: publicationTaskTarget - originalContentTarget,
    publicationTaskTarget,
    publicationTasks: tasks,
    weeklyBudgetCny: finiteBudget(capacity?.status === 'ready' ? capacity.productionBudgetCny : args.input.weeklyBudgetCny),
    perItemBudgetCny: finiteBudget(args.input.perItemBudgetCny),
    capacityNotes: uniqueText(args.input.capacityNotes),
    authorization: {
      mode: args.input.authorizationMode === 'each' ? 'each' : 'bounded',
      accountIds: plans.map(plan => plan.accountId),
      maxPublishItems: args.input.authorizationMode === 'each' ? 0 : publicationTaskTarget,
      weekStart,
      weekEnd: weekEnd(weekStart),
      allowRealPublishing: false,
      authorizedBy: null,
      authorizedAt: null,
      revokedBy: null,
      revokedAt: null,
    },
  };
  const workflow = buildWeeklyWorkflow({
    packageId: args.packageId,
    version: args.version,
    businessGoal: goal,
    capacity,
    automationPolicy: policy,
    publicationTasks: tasks,
    discoveryBudgetCny: finiteBudget(args.input.discoveryBudgetCny),
    previousTasks: args.previousPackage?.workflowTasks,
  });
  return {
    packageId: args.packageId,
    programId: args.programId,
    version: args.version,
    status,
    weekStart,
    weekEnd: weekEnd(weekStart),
    objective: text(args.input.objective, 1_000) || goal?.objective || '',
    enterpriseProfileRef: versionedRef(args.input.enterpriseProfileRef ?? args.program.enterpriseProfileRef),
    businessContentGoalRef: goal ? { type: 'business_content_goal', id: goal.goalId, version: goal.version } : versionedRef(args.input.businessContentGoalRef),
    monthlyPlanRef: versionedRef(args.input.monthlyPlanRef ?? args.program.activeMonthlyPlanRef),
    workflows: workflow.workflows,
    workflowTasks: workflow.tasks,
    executionTaskRefs: [],
    executionSummary: summarizeWeeklyExecutionTasks([], timestamp),
    appliedWorkflowEvents: [],
    workflowStateVersion: 0,
    taskVersionMappings: workflow.mappings,
    planningBlockers: workflow.blockers,
    capacityPlanRef: capacity?.ref ?? null,
    automationPolicyRef: policy?.ref ?? null,
    operatingDecisionSnapshotRef: versionedRef(args.input.operatingDecisionSnapshotRef),
    referenceModeRef: versionedRef(args.input.referenceModeRef),
    promotionQuotaRef: versionedRef(args.input.promotionQuotaRef),
    discoveryBudgetCny: finiteBudget(args.input.discoveryBudgetCny),
    socialContentPackage: contentPackage,
    successCriteria: uniqueText(args.input.successCriteria),
    changeReason: text(args.input.changeReason, 500) || null,
    previousVersion: args.previousVersion,
    createdBy: args.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function savePackage(dataStore: DataStore, tenantId: string, item: WeeklyOperatingPackage): Promise<PackageRow> {
  const saved = await dataStore.create<PackageRow>(PACKAGES, {
    tenant_id: tenantId,
    program_id: item.programId,
    package_id: item.packageId,
    version: item.version,
    week_start: item.weekStart,
    status: item.status,
    payload: item,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });
  if (!saved) throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '周任务包暂时无法保存。');
  return saved;
}

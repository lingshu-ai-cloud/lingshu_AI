import { randomUUID } from 'node:crypto';
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
import { SocialProgramError } from './service.js';
import { buildWeeklyWorkflow, type WeeklyAutomationPolicySnapshot, type WeeklyCapacitySnapshot } from './weeklyPlanner.js';
import { applyWorkflowEvent } from './workflowState.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';

const PACKAGES = 'social_weekly_operating_packages';
const PROGRAMS = 'social_programs';
const ACCOUNTS = 'social_owned_accounts';
const SUPPORTED_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube'] as const;
type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];

type PackageRow = {
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
type ProgramRow = { id: string; tenant_id: string; program_id: string; payload: Record<string, unknown> };
type AccountRow = { id: string; tenant_id: string; program_id: string; payload: OwnedSocialAccount };

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
const at = () => new Date().toISOString();

function finiteBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new SocialProgramError('invalid_budget', 400, '预算必须是非负数。');
  }
  return Math.round(parsed * 100) / 100;
}

function dateOnly(value: unknown, code: string): string {
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

function versionedRef(value: unknown): VersionedSocialRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const type = text(row.type, 80);
  const id = text(row.id, 160);
  const version = Number(row.version);
  return type && id && Number.isSafeInteger(version) && version > 0 ? { type, id, version } : null;
}

function businessGoal(value: unknown, programId: string): BusinessContentGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const goal = value as BusinessContentGoal;
  return goal.programId === programId && goal.goalId && Number.isSafeInteger(goal.version) ? goal : null;
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

async function programRow(dataStore: DataStore, tenantId: string, programId: string): Promise<ProgramRow> {
  const result = await dataStore.list<ProgramRow>(PROGRAMS, {
    where: { tenant_id: tenantId, program_id: programId }, page: 1, perPage: 1,
  });
  if (!result.items[0]) throw new SocialProgramError('program_not_found', 404, '社媒项目不存在。');
  return result.items[0];
}

async function accountsForProgram(dataStore: DataStore, tenantId: string, programId: string): Promise<OwnedSocialAccount[]> {
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

async function latestPackageRow(
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

function requireExpectedVersion(actual: number, expected: unknown): void {
  const parsed = Number(expected);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SocialProgramError('expected_version_required', 400, '写入必须提供 expectedVersion。');
  }
  if (actual !== parsed) throw new SocialProgramError('version_conflict', 409, `数据已更新，当前版本为 ${actual}。`);
}

function packageFromInput(args: {
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
  const plans = (args.input.accountPlans ?? capacityAccountPlans) === undefined
    ? defaultAccountPlans(args.accounts)
    : customAccountPlans(args.input.accountPlans ?? capacityAccountPlans, args.accounts);
  const publicationTaskTarget = plans.reduce((sum, plan) => sum + plan.publicationCount, 0);
  if (publicationTaskTarget > 100) throw new SocialProgramError('publication_target_too_large', 400, '单周发布任务不能超过 100 条。');
  const originalContentTarget = positiveInteger(args.input.originalContentTarget ?? capacity?.originalContentTarget, Math.min(10, publicationTaskTarget), publicationTaskTarget);
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
    weeklyBudgetCny: finiteBudget(args.input.weeklyBudgetCny ?? capacity?.productionBudgetCny),
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
    appliedWorkflowEvents: [],
    taskVersionMappings: workflow.mappings,
    planningBlockers: workflow.blockers,
    capacityPlanRef: capacity?.ref ?? null,
    automationPolicyRef: policy?.ref ?? null,
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

async function savePackage(dataStore: DataStore, tenantId: string, item: WeeklyOperatingPackage): Promise<void> {
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
}

export function createWeeklyOperatingPackageService(dataStore: DataStore) {
  const operatingRepository = createSocialOperatingRepository(dataStore);

  async function withAuthoritativeGoal(
    tenantId: string,
    programId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ref = versionedRef(input.businessContentGoalRef);
    if (!ref) return input;
    if (ref.type !== 'business_content_goal') {
      throw new SocialProgramError('business_goal_ref_invalid', 400, '经营目标引用类型无效。');
    }
    const goal = await operatingRepository.getGoal(tenantId, programId, ref.id, ref.version);
    if (!goal) throw new SocialProgramError('business_goal_not_found', 404, '经营目标不存在。');
    return { ...input, businessContentGoal: goal };
  }

  return {
    async list(tenantId: string, programId: string, weekStart?: string): Promise<WeeklyOperatingPackage[]> {
      await programRow(dataStore, tenantId, programId);
      const where: Record<string, string> = { tenant_id: tenantId, program_id: programId };
      if (weekStart) where.week_start = dateOnly(weekStart, 'week_start_invalid');
      const result = await dataStore.list<PackageRow>(PACKAGES, { where, sort: '-version', page: 1, perPage: 300 });
      return result.items.map(row => row.payload);
    },

    async get(tenantId: string, programId: string, packageId: string): Promise<WeeklyOperatingPackage> {
      await programRow(dataStore, tenantId, programId);
      const row = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!row) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      return row.payload;
    },

    async create(tenantId: string, userId: string, programId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
      const program = await programRow(dataStore, tenantId, programId);
      const accounts = await accountsForProgram(dataStore, tenantId, programId);
      input = await withAuthoritativeGoal(tenantId, programId, input);
      const item = packageFromInput({
        input, programId, userId, accounts, program: program.payload,
        packageId: randomUUID(), contentPackageId: randomUUID(), version: 1, previousVersion: null,
      });
      if (!item.objective || !item.successCriteria.length) {
        throw new SocialProgramError('weekly_operating_package_incomplete', 400, '周任务包必须包含经营目标和成功标准。');
      }
      await savePackage(dataStore, tenantId, item);
      return item;
    },

    async revise(tenantId: string, userId: string, programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
      const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      requireExpectedVersion(current.payload.version, input.expectedVersion);
      const program = await programRow(dataStore, tenantId, programId);
      const accounts = await accountsForProgram(dataStore, tenantId, programId);
      const merged = {
        objective: current.payload.objective,
        weekStart: current.payload.weekStart,
        enterpriseProfileRef: current.payload.enterpriseProfileRef,
        monthlyPlanRef: current.payload.monthlyPlanRef,
        businessContentGoalRef: current.payload.businessContentGoalRef,
        originalContentTarget: current.payload.socialContentPackage.originalContentTarget,
        weeklyBudgetCny: current.payload.socialContentPackage.weeklyBudgetCny,
        perItemBudgetCny: current.payload.socialContentPackage.perItemBudgetCny,
        capacityNotes: current.payload.socialContentPackage.capacityNotes,
        publicationTasks: current.payload.socialContentPackage.publicationTasks,
        authorizationMode: current.payload.socialContentPackage.authorization.mode,
        successCriteria: current.payload.successCriteria,
        accountPlans: current.payload.socialContentPackage.publicationTasks.reduce<Array<Record<string, unknown>>>((plans, task) => {
          const existing = plans.find(plan => plan.accountId === task.accountId);
          if (existing) existing.publicationCount = Number(existing.publicationCount) + 1;
          else plans.push({ accountId: task.accountId, publicationCount: 1, accountPositioning: task.accountPositioning });
          return plans;
        }, []),
        ...input,
      };
      const resolved = await withAuthoritativeGoal(tenantId, programId, merged);
      const item = packageFromInput({
        input: resolved, programId, userId, accounts, program: program.payload,
        packageId, contentPackageId: current.payload.socialContentPackage.contentPackageId,
        version: current.payload.version + 1, previousVersion: current.payload.version,
        previousPackage: current.payload,
      });
      if (!item.objective || !item.successCriteria.length) {
        throw new SocialProgramError('weekly_operating_package_incomplete', 400, '周任务包必须包含经营目标和成功标准。');
      }
      await savePackage(dataStore, tenantId, item);
      if (current.payload.socialContentPackage.authorization.allowRealPublishing) {
        const timestamp = at();
        const invalidated: WeeklyOperatingPackage = {
          ...current.payload,
          socialContentPackage: {
            ...current.payload.socialContentPackage,
            authorization: {
              ...current.payload.socialContentPackage.authorization,
              allowRealPublishing: false,
              revokedBy: userId,
              revokedAt: timestamp,
            },
          },
          updatedAt: timestamp,
        };
        if (!await dataStore.update(PACKAGES, current.id, { payload: invalidated, updated_by: userId, updated_at: timestamp })) {
          throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '旧版本发布授权暂时无法失效。');
        }
      }
      return item;
    },

    async activate(
      tenantId: string,
      userId: string,
      programId: string,
      packageId: string,
      input: Record<string, unknown>,
    ): Promise<WeeklyOperatingPackage> {
      const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      requireExpectedVersion(current.payload.version, input.expectedVersion);
      if (current.payload.status !== 'draft') throw new SocialProgramError('weekly_operating_package_not_draft', 409, '只能激活草稿版本。');
      const program = await programRow(dataStore, tenantId, programId);
      const expectedProgramVersion = Number(input.expectedProgramVersion);
      const actualProgramVersion = Number(program.payload.version);
      if (!Number.isSafeInteger(expectedProgramVersion) || expectedProgramVersion !== actualProgramVersion) {
        throw new SocialProgramError('program_version_conflict', 409, `项目已更新，当前版本为 ${actualProgramVersion}。`);
      }
      const activeResult = await dataStore.list<PackageRow>(PACKAGES, {
        where: { tenant_id: tenantId, program_id: programId, week_start: current.payload.weekStart, status: 'active' },
        page: 1, perPage: 100,
      });
      const supersededRows: PackageRow[] = [];
      for (const active of activeResult.items) {
        const superseded = { ...active.payload, status: 'superseded' as const, socialContentPackage: { ...active.payload.socialContentPackage, status: 'superseded' as const } };
        if (!await dataStore.update(PACKAGES, active.id, { status: 'superseded', payload: superseded })) {
          for (const previous of supersededRows) {
            await dataStore.update(PACKAGES, previous.id, { status: previous.status, payload: previous.payload });
          }
          throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '旧活动周任务包暂时无法退役。');
        }
        supersededRows.push(active);
      }
      const activated: WeeklyOperatingPackage = {
        ...current.payload,
        status: 'active',
        socialContentPackage: {
          ...current.payload.socialContentPackage,
          status: 'active',
          authorization: input.authorizePublishing === true
            ? {
              ...current.payload.socialContentPackage.authorization,
              mode: 'bounded',
              maxPublishItems: current.payload.socialContentPackage.publicationTaskTarget,
              allowRealPublishing: true,
              authorizedBy: userId,
              authorizedAt: at(),
              revokedBy: null,
              revokedAt: null,
            }
            : current.payload.socialContentPackage.authorization,
        },
        updatedAt: at(),
      };
      if (!await dataStore.update(PACKAGES, current.id, {
        status: 'active', payload: activated, updated_by: userId, updated_at: activated.updatedAt,
      })) {
        for (const previous of supersededRows) {
          await dataStore.update(PACKAGES, previous.id, { status: previous.status, payload: previous.payload });
        }
        throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '周任务包暂时无法激活。');
      }
      const nextProgram = {
        ...program.payload,
        activeWeeklyOperatingPackageRef: { type: 'weekly_operating_package', id: packageId, version: activated.version },
        version: actualProgramVersion + 1,
        updatedAt: at(),
      };
      if (!await dataStore.update(PROGRAMS, program.id, {
        payload: nextProgram, version: nextProgram.version, updated_by: userId, updated_at: nextProgram.updatedAt,
      })) {
        await dataStore.update(PACKAGES, current.id, { status: 'draft', payload: current.payload });
        for (const previous of supersededRows) {
          await dataStore.update(PACKAGES, previous.id, { status: previous.status, payload: previous.payload });
        }
        throw new SocialProgramError('program_storage_unavailable', 503, '周任务包激活失败，已回滚当前版本。');
      }
      return activated;
    },

    async retire(
      tenantId: string,
      userId: string,
      programId: string,
      packageId: string,
      input: Record<string, unknown>,
    ): Promise<WeeklyOperatingPackage> {
      const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      requireExpectedVersion(current.payload.version, input.expectedVersion);
      if (current.payload.status === 'retired') {
        throw new SocialProgramError('weekly_operating_package_retired', 409, '该周任务包版本已撤回。');
      }
      const timestamp = at();
      let activeProgram: ProgramRow | null = null;
      let nextProgram: Record<string, unknown> | null = null;
      if (current.payload.status === 'active') {
        activeProgram = await programRow(dataStore, tenantId, programId);
        const expectedProgramVersion = Number(input.expectedProgramVersion);
        const actualProgramVersion = Number(activeProgram.payload.version);
        if (!Number.isSafeInteger(expectedProgramVersion) || expectedProgramVersion !== actualProgramVersion) {
          throw new SocialProgramError('program_version_conflict', 409, `项目已更新，当前版本为 ${actualProgramVersion}。`);
        }
        const activeRef = activeProgram.payload.activeWeeklyOperatingPackageRef as VersionedSocialRef | null | undefined;
        if (activeRef?.id !== packageId || activeRef.version !== current.payload.version) {
          throw new SocialProgramError('program_active_package_mismatch', 409, '项目当前活动周任务包引用与撤回版本不一致。');
        }
        nextProgram = {
          ...activeProgram.payload,
          activeWeeklyOperatingPackageRef: null,
          version: actualProgramVersion + 1,
          updatedAt: timestamp,
        };
      }
      const retired: WeeklyOperatingPackage = {
        ...current.payload,
        status: 'retired',
        socialContentPackage: {
          ...current.payload.socialContentPackage,
          status: 'retired',
          authorization: {
            ...current.payload.socialContentPackage.authorization,
            allowRealPublishing: false,
            revokedBy: userId,
            revokedAt: timestamp,
          },
        },
        updatedAt: timestamp,
      };
      if (!await dataStore.update(PACKAGES, current.id, {
        status: 'retired', payload: retired, updated_by: userId, updated_at: timestamp,
      })) {
        throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '周任务包暂时无法撤回。');
      }

      if (activeProgram && nextProgram) {
        if (!await dataStore.update(PROGRAMS, activeProgram.id, {
          payload: nextProgram, version: nextProgram.version, updated_by: userId, updated_at: timestamp,
        })) {
          await dataStore.update(PACKAGES, current.id, {
            status: current.status, payload: current.payload, updated_at: current.payload.updatedAt,
          });
          throw new SocialProgramError('program_storage_unavailable', 503, '周任务包撤回失败，已回滚当前版本。');
        }
      }
      return retired;
    },

    async applyWorkflowEvent(
      tenantId: string,
      userId: string,
      programId: string,
      packageId: string,
      input: Record<string, unknown>,
    ): Promise<WeeklyOperatingPackage> {
      const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      requireExpectedVersion(current.payload.version, input.expectedVersion);
      const event = input.event as WeeklyWorkflowEvent | undefined;
      if (!event?.eventId || !event.taskId || !event.type || !event.occurredAt) {
        throw new SocialProgramError('workflow_event_invalid', 400, '工作流事件字段不完整。');
      }
      const updated = applyWorkflowEvent(current.payload, event);
      if (updated === current.payload) return current.payload;
      if (!await dataStore.update(PACKAGES, current.id, { payload: updated, updated_by: userId, updated_at: updated.updatedAt })) {
        throw new SocialProgramError('weekly_operating_package_storage_unavailable', 503, '工作流状态暂时无法保存。');
      }
      return updated;
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import {
  type VersionedSocialRef,
  type WeeklyOperatingPackage,
  type WeeklyWorkflowEvent,
} from '../../shared/contracts/socialProgram.js';
import type { VersionedQuotaReference } from '../../shared/contracts/socialReview.js';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import { SocialProgramError } from './service.js';
import { buildWeeklyWorkflow, type WeeklyAutomationPolicySnapshot, type WeeklyCapacitySnapshot } from './weeklyPlanner.js';
import { applyWorkflowEvent } from './workflowState.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';
import type { CapacityPlan } from '../socialOperating/capacityPlanner.js';
import type { AutomationPolicyResolution } from '../socialOperating/automationPolicyResolver.js';
import {
  activateWeeklyExecutionTasks,
  cancelWeeklyExecutionTasks,
  listWeeklyExecutionTasks,
  materializeWeeklyExecutionTasks,
  projectWeeklyExecution,
  summarizeWeeklyExecutionTasks,
} from './executionTasks.js';
import { enqueueAgentNotificationDomainEvent } from '../notifications/agentNotificationOutbox.js';
import {
  PACKAGES, PROGRAMS, PROMOTION_QUOTAS, WEEKLY_REVIEWS, WORKFLOW_EVENTS,
  type PackageRow, type ProgramRow, type WorkflowEventRow,
  accountsForProgram, at, businessGoal, dateOnly, eventDigest,
  latestPackageRow, packageFromInput, programRow, projectWorkflowState,
  requireExpectedVersion, savePackage, serializeWorkflowMutation, stable,
  validAutomationPolicy, validCapacityPlan, versionedRef,
  workflowEventRows,
} from './weeklyOperatingPackageSupport.js';

export function createWeeklyOperatingPackageService(dataStore: DataStore) {
  const operatingRepository = createSocialOperatingRepository(dataStore);

  function rejectClientAuthorityObjects(input: Record<string, unknown>): void {
    for (const field of ['businessContentGoal', 'capacityPlan', 'automationPolicy']) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        throw new SocialProgramError('authoritative_object_injection_forbidden', 400, `不得直接提交权威对象 ${field}，请仅提交版本引用。`);
      }
    }
  }

  async function withAuthoritativePlanning(
    tenantId: string,
    programId: string,
    input: Record<string, unknown>,
  ): Promise<{
    input: Record<string, unknown>;
    goal: BusinessContentGoal | null;
    capacity: WeeklyCapacitySnapshot | null;
    policy: WeeklyAutomationPolicySnapshot | null;
  }> {
    const goalRef = versionedRef(input.businessContentGoalRef);
    if (input.businessContentGoalRef != null && !goalRef) {
      throw new SocialProgramError('business_goal_ref_invalid', 400, '经营目标引用无效。');
    }
    if (goalRef && goalRef.type !== 'business_content_goal') {
      throw new SocialProgramError('business_goal_ref_invalid', 400, '经营目标引用类型无效。');
    }
    const storedGoal = goalRef ? await operatingRepository.getGoal(tenantId, programId, goalRef.id, goalRef.version) : null;
    if (goalRef && !storedGoal) throw new SocialProgramError('business_goal_not_found', 404, '经营目标不存在。');
    const goal = businessGoal(storedGoal, programId);
    if (storedGoal && !goal) throw new SocialProgramError('business_goal_corrupt', 409, '权威经营目标数据不完整，已失败关闭。');

    const capacityRef = versionedRef(input.capacityPlanRef);
    if (input.capacityPlanRef != null && !capacityRef) {
      throw new SocialProgramError('capacity_plan_ref_invalid', 400, '容量决策引用无效。');
    }
    if (capacityRef && capacityRef.type !== 'capacity_plan') {
      throw new SocialProgramError('capacity_plan_ref_invalid', 400, '容量决策引用类型无效。');
    }
    const capacityDecision = capacityRef
      ? await operatingRepository.getOperatingDecision<CapacityPlan>(tenantId, programId, capacityRef.id)
      : null;
    if (capacityRef && (!capacityDecision || capacityDecision.decisionType !== 'capacity_plan' || capacityDecision.version !== capacityRef.version)) {
      throw new SocialProgramError('capacity_plan_not_found', 404, '权威容量决策不存在。');
    }
    if (capacityDecision && (!Array.isArray(capacityDecision.blockers) || !validCapacityPlan(capacityDecision.output))) {
      throw new SocialProgramError('capacity_plan_corrupt', 409, '权威容量决策数据不完整，已失败关闭。');
    }
    if (capacityDecision && (!goalRef || stable(capacityDecision.subjectRef) !== stable(goalRef))) {
      throw new SocialProgramError('capacity_plan_lineage_invalid', 409, '容量决策与当前经营目标版本不一致。');
    }
    const capacity: WeeklyCapacitySnapshot | null = capacityDecision && capacityRef ? {
      ref: capacityRef,
      status: capacityDecision.outcome === 'blocked' || capacityDecision.output.status === 'blocked' ? 'blocked' : 'ready',
      originalContentTarget: capacityDecision.output.originalContentQuota,
      accountPlans: capacityDecision.output.accountQuotas.filter(item => item.publicationQuota > 0).map(item => ({
        accountId: item.accountId, publicationCount: item.publicationQuota,
      })),
      productionBudgetCny: input.operatingDecisionSnapshotRef ? goal?.weeklyBudgetCny ?? capacityDecision.output.estimatedCostCny : capacityDecision.output.estimatedCostCny,
      blockers: capacityDecision.blockers.map(item => item.code),
    } : null;

    const policyRef = versionedRef(input.automationPolicyRef);
    if (input.automationPolicyRef != null && !policyRef) {
      throw new SocialProgramError('automation_policy_ref_invalid', 400, '自动化决策引用无效。');
    }
    if (policyRef && policyRef.type !== 'automation_policy') {
      throw new SocialProgramError('automation_policy_ref_invalid', 400, '自动化决策引用类型无效。');
    }
    const policyDecision = policyRef
      ? await operatingRepository.getOperatingDecision<AutomationPolicyResolution>(tenantId, programId, policyRef.id)
      : null;
    if (policyRef && (!policyDecision || policyDecision.decisionType !== 'automation_policy' || policyDecision.version !== policyRef.version)) {
      throw new SocialProgramError('automation_policy_not_found', 404, '权威自动化决策不存在。');
    }
    if (policyDecision && (!Array.isArray(policyDecision.blockers) || !validAutomationPolicy(policyDecision.output))) {
      throw new SocialProgramError('automation_policy_corrupt', 409, '权威自动化决策数据不完整，已失败关闭。');
    }
    if (policyDecision && (!goalRef || stable(policyDecision.subjectRef) !== stable(goalRef))) {
      throw new SocialProgramError('automation_policy_lineage_invalid', 409, '自动化决策与当前经营目标版本不一致。');
    }
    const policy: WeeklyAutomationPolicySnapshot | null = policyDecision && policyRef ? {
      ref: policyRef,
      status: policyDecision.outcome === 'blocked' || policyDecision.output.status === 'blocked' ? 'blocked' : 'ready',
      blockers: policyDecision.blockers.map(item => item.code),
    } : null;
    return { input: { ...input, businessContentGoal: goal, capacityPlan: capacity, automationPolicy: policy }, goal, capacity, policy };
  }

  async function withExecutionProjection(tenantId: string, item: WeeklyOperatingPackage): Promise<WeeklyOperatingPackage> {
    const tasks = await listWeeklyExecutionTasks(
      dataStore, tenantId, item.programId, item.packageId, item.version,
    );
    return projectWeeklyExecution(item, tasks);
  }

  async function withAuthoritativeDecisions(
    tenantId: string,
    programId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (input.businessContentGoal || input.capacityPlan || input.automationPolicy) {
      throw new SocialProgramError('client_authority_forbidden', 400, '周包不接受客户端提交的目标、容量或自动化结果。');
    }
    const snapshotRef = versionedRef(input.operatingDecisionSnapshotRef);
    if (!snapshotRef) return input;
    if (snapshotRef.type !== 'operating_authority_snapshot') throw new SocialProgramError('operating_snapshot_ref_invalid', 400, '经营编排快照引用类型无效。');
    const snapshot = await operatingRepository.getSnapshot(tenantId, programId, snapshotRef.id, snapshotRef.version);
    if (!snapshot) throw new SocialProgramError('operating_snapshot_not_found', 404, '经营编排快照不存在。');
    if (snapshot.status === 'blocked') throw new SocialProgramError('operating_snapshot_blocked', 409, '经营编排快照尚未就绪，不能生成权威周包。');
    const goalRef = snapshot.businessContentGoalRef;
    const goal = await operatingRepository.getGoal(tenantId, programId, goalRef.id, goalRef.version);
    if (!goal) throw new SocialProgramError('business_goal_not_found', 404, '经营目标不存在。');
    const [capacityDecision, policyDecision] = await Promise.all([
      operatingRepository.getOperatingDecision<CapacityPlan>(tenantId, programId, snapshot.capacityPlanRef.id),
      operatingRepository.getOperatingDecision<AutomationPolicyResolution>(tenantId, programId, snapshot.automationPolicyRef.id),
    ]);
    if (!capacityDecision || !policyDecision) throw new SocialProgramError('operating_decision_missing', 503, '经营编排快照缺少决策记录。');
    const capacity: WeeklyCapacitySnapshot = {
      ref: snapshot.capacityPlanRef,
      status: capacityDecision.output.status === 'blocked' ? 'blocked' : 'ready',
      originalContentTarget: capacityDecision.output.originalContentQuota,
      accountPlans: capacityDecision.output.accountQuotas.filter(item => item.publicationQuota > 0).map(item => ({ accountId: item.accountId, publicationCount: item.publicationQuota })),
      productionBudgetCny: goal.weeklyBudgetCny,
      blockers: capacityDecision.blockers.map(item => item.code),
    };
    const policy: WeeklyAutomationPolicySnapshot = {
      ref: snapshot.automationPolicyRef,
      status: policyDecision.output.status === 'blocked' ? 'blocked' : 'ready',
      blockers: policyDecision.blockers.map(item => item.code),
    };
    return {
      ...input,
      // These allocation fields are projections of the persisted resolver
      // output. Never let same-request values shadow the authority snapshot.
      accountPlans: undefined,
      originalContentTarget: undefined,
      weeklyBudgetCny: undefined,
      enterpriseProfileRef: snapshot.enterprise.ref,
      businessContentGoalRef: goalRef,
      capacityPlanRef: snapshot.capacityPlanRef,
      automationPolicyRef: snapshot.automationPolicyRef,
      businessContentGoal: goal,
      capacityPlan: capacity,
      automationPolicy: policy,
      referenceModeRef: snapshot.referenceModeRef,
    };
  }

  async function withPromotionQuota(
    tenantId: string,
    programId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ref = versionedRef(input.promotionQuotaRef);
    if (!ref) return input;
    if (ref.type !== 'weekly_promotion_quota') {
      throw new SocialProgramError('promotion_quota_ref_invalid', 400, '晋级配额引用类型无效。');
    }
    const found = await dataStore.list<{ id: string; program_id?: string; snapshot_id: string; quota: VersionedQuotaReference }>(PROMOTION_QUOTAS, {
      where: { tenant_id: tenantId, quota_id: ref.id, version: ref.version }, page: 1, perPage: 2,
    });
    if (found.items.length !== 1) throw new SocialProgramError('promotion_quota_not_found', 404, '晋级配额不存在或不唯一。');
    const row = found.items[0];
    const quota = row.quota;
    if (!quota || quota.quotaId !== ref.id || quota.version !== ref.version || (quota.programId && quota.programId !== programId)
      || (row.program_id && row.program_id !== programId)) {
      throw new SocialProgramError('promotion_quota_lineage_invalid', 409, '晋级配额与当前项目不匹配。');
    }
    if (!quota.allocations.length) {
      throw new SocialProgramError('promotion_quota_observe_only', 409, '样本仍在观察，不能进入下周配额。');
    }
    const snapshots = await dataStore.list<{ id: string; snapshot: { programId?: string; window?: { endsAt?: string } } }>(WEEKLY_REVIEWS, {
      where: { tenant_id: tenantId, snapshot_id: quota.sourceSnapshotId }, page: 1, perPage: 2,
    });
    const snapshot = snapshots.items[0]?.snapshot;
    const weekStart = dateOnly(input.weekStart, 'week_start_invalid');
    if (snapshots.items.length !== 1 || !snapshot || (snapshot.programId && snapshot.programId !== programId)
      || !snapshot.window?.endsAt || Date.parse(`${weekStart}T00:00:00.000Z`) < Date.parse(snapshot.window.endsAt)) {
      throw new SocialProgramError('promotion_quota_window_invalid', 409, '晋级配额只能输入复盘窗口之后的周计划。');
    }
    const byAccount = new Map<string, { accountId: string; publicationCount: number; accountPositioning: string }>();
    for (const allocation of quota.allocations) {
      const current = byAccount.get(allocation.accountId);
      if (current) current.publicationCount += allocation.contentCount;
      else byAccount.set(allocation.accountId, {
        accountId: allocation.accountId,
        publicationCount: allocation.contentCount,
        accountPositioning: allocation.businessDirection,
      });
    }
    const accountPlans = [...byAccount.values()];
    const allocatedCount = accountPlans.reduce((sum, item) => sum + item.publicationCount, 0);
    return {
      ...input,
      promotionQuotaRef: ref,
      accountPlans,
      originalContentTarget: Math.max(1, Math.min(allocatedCount, Number(input.originalContentTarget) || allocatedCount)),
    };
  }

  async function enqueuePackageChange(input: {
    tenantId: string;
    item: WeeklyOperatingPackage;
    operation: 'created' | 'revised' | 'activated' | 'retired';
    before?: WeeklyOperatingPackage;
    authorizationRequired?: boolean;
  }): Promise<void> {
    const kind = input.authorizationRequired ? 'authorization.required' as const : 'weekly_package.adjusted' as const;
    await enqueueAgentNotificationDomainEvent({
      eventId: `weekly-package:${input.item.packageId}:v${input.item.version}:${input.operation}`,
      kind,
      tenantId: input.tenantId,
      programId: input.item.programId,
      packageId: input.item.packageId,
      packageVersion: input.item.version,
      entityId: input.item.packageId,
      title: input.authorizationRequired ? '周任务包需要发布授权' : '周任务包已更新',
      summary: input.authorizationRequired
        ? '周任务包已激活，但真实发布仍保持关闭，需由有权限的人员确认。'
        : `周任务包已${input.operation === 'created' ? '创建' : input.operation === 'revised' ? '修订' : input.operation === 'activated' ? '激活' : '撤回'}。`,
      sourceAgent: 'business_agent',
      changes: [{
        field: input.authorizationRequired ? 'publishingAuthorization' : 'weeklyPackageVersion',
        label: input.authorizationRequired ? '发布授权' : '周任务包版本',
        before: input.authorizationRequired ? false : input.before?.version ?? null,
        after: input.authorizationRequired ? 'required' : input.item.version,
      }],
      occurredAt: input.item.updatedAt,
    }, dataStore);
  }

  return {
    async list(tenantId: string, programId: string, weekStart?: string): Promise<WeeklyOperatingPackage[]> {
      await programRow(dataStore, tenantId, programId);
      const where: Record<string, string> = { tenant_id: tenantId, program_id: programId };
      if (weekStart) where.week_start = dateOnly(weekStart, 'week_start_invalid');
      const result = await dataStore.list<PackageRow>(PACKAGES, { where, sort: '-version', page: 1, perPage: 300 });
      return Promise.all(result.items.map(async row => withExecutionProjection(tenantId, await projectWorkflowState(dataStore, tenantId, row))));
    },

    async get(tenantId: string, programId: string, packageId: string): Promise<WeeklyOperatingPackage> {
      await programRow(dataStore, tenantId, programId);
      const row = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!row) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      return withExecutionProjection(tenantId, await projectWorkflowState(dataStore, tenantId, row));
    },

    async create(tenantId: string, userId: string, programId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
      rejectClientAuthorityObjects(input);
      const program = await programRow(dataStore, tenantId, programId);
      const accounts = await accountsForProgram(dataStore, tenantId, programId);
      input = await withAuthoritativeDecisions(tenantId, programId, input);
      input = (await withAuthoritativePlanning(tenantId, programId, input)).input;
      input = await withPromotionQuota(tenantId, programId, input);
      const item = packageFromInput({
        input, programId, userId, accounts, program: program.payload,
        packageId: randomUUID(), contentPackageId: randomUUID(), version: 1, previousVersion: null,
      });
      if (!item.objective || !item.successCriteria.length) {
        throw new SocialProgramError('weekly_operating_package_incomplete', 400, '周任务包必须包含经营目标和成功标准。');
      }
      const saved = await savePackage(dataStore, tenantId, item);
      try {
        const tasks = await materializeWeeklyExecutionTasks(dataStore, tenantId, item);
        await enqueuePackageChange({ tenantId, item, operation: 'created' });
        return projectWeeklyExecution(item, tasks, item.updatedAt);
      } catch (error) {
        await dataStore.delete(PACKAGES, saved.id);
        throw error;
      }
    },

    async revise(tenantId: string, userId: string, programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
      rejectClientAuthorityObjects(input);
      const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
      if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
      requireExpectedVersion(current.payload.version, input.expectedVersion);
      const projectedCurrent = await projectWorkflowState(dataStore, tenantId, current);
      const program = await programRow(dataStore, tenantId, programId);
      const accounts = await accountsForProgram(dataStore, tenantId, programId);
      const merged = {
        objective: current.payload.objective,
        weekStart: current.payload.weekStart,
        enterpriseProfileRef: current.payload.enterpriseProfileRef,
        monthlyPlanRef: current.payload.monthlyPlanRef,
        businessContentGoalRef: current.payload.businessContentGoalRef,
        capacityPlanRef: current.payload.capacityPlanRef,
        automationPolicyRef: current.payload.automationPolicyRef,
        operatingDecisionSnapshotRef: current.payload.operatingDecisionSnapshotRef,
        referenceModeRef: current.payload.referenceModeRef,
        promotionQuotaRef: current.payload.promotionQuotaRef,
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
      const orchestrated = await withAuthoritativeDecisions(tenantId, programId, merged);
      const resolved = await withAuthoritativePlanning(tenantId, programId, orchestrated);
      const resolvedWithQuota = await withPromotionQuota(tenantId, programId, resolved.input);
      const item = packageFromInput({
        input: resolvedWithQuota, programId, userId, accounts, program: program.payload,
        packageId, contentPackageId: current.payload.socialContentPackage.contentPackageId,
        version: current.payload.version + 1, previousVersion: current.payload.version,
        previousPackage: projectedCurrent,
      });
      if (!item.objective || !item.successCriteria.length) {
        throw new SocialProgramError('weekly_operating_package_incomplete', 400, '周任务包必须包含经营目标和成功标准。');
      }
      const saved = await savePackage(dataStore, tenantId, item);
      let projected: WeeklyOperatingPackage;
      try {
        projected = projectWeeklyExecution(item, await materializeWeeklyExecutionTasks(dataStore, tenantId, item), item.updatedAt);
      } catch (error) {
        await dataStore.delete(PACKAGES, saved.id);
        throw error;
      }
      await enqueuePackageChange({ tenantId, item, operation: 'revised', before: current.payload });
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
      return projected;
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
      const projectedCurrent = await projectWorkflowState(dataStore, tenantId, current);
      const authority = await withAuthoritativePlanning(tenantId, programId, {
        businessContentGoalRef: current.payload.businessContentGoalRef,
        capacityPlanRef: current.payload.capacityPlanRef,
        automationPolicyRef: current.payload.automationPolicyRef,
      });
      const checked = buildWeeklyWorkflow({
        packageId: current.payload.packageId,
        version: current.payload.version,
        businessGoal: authority.goal,
        capacity: authority.capacity,
        automationPolicy: authority.policy,
        publicationTasks: current.payload.socialContentPackage.publicationTasks,
        discoveryBudgetCny: current.payload.discoveryBudgetCny,
      });
      const activationBlockers = [...new Set([
        ...current.payload.planningBlockers,
        ...checked.blockers,
        ...projectedCurrent.workflowTasks.flatMap(task => task.status === 'blocked'
          ? [...task.ownBlockingReasons, ...task.inheritedBlockingTaskIds.map(id => `upstream:${id}`)]
          : []),
      ])];
      if (activationBlockers.length) {
        throw new SocialProgramError(
          'weekly_operating_package_activation_blocked',
          409,
          `周任务包尚有未解决的规划/G2 缺项：${activationBlockers.join('、')}`,
        );
      }
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
        ...projectedCurrent,
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
      for (const previous of supersededRows) {
        await cancelWeeklyExecutionTasks(
          dataStore, tenantId, previous.payload.programId, previous.payload.packageId, previous.payload.version,
          `superseded_by:${activated.packageId}:${activated.version}`, activated.updatedAt,
        );
      }
      const tasks = await activateWeeklyExecutionTasks(dataStore, tenantId, activated, activated.updatedAt);
      await enqueuePackageChange({ tenantId, item: activated, operation: 'activated', before: current.payload, authorizationRequired: input.authorizePublishing !== true });
      return projectWeeklyExecution(activated, tasks, activated.updatedAt);
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
      const tasks = await cancelWeeklyExecutionTasks(
        dataStore, tenantId, programId, packageId, retired.version, `package_retired:${userId}`, timestamp,
      );
      await enqueuePackageChange({ tenantId, item: retired, operation: 'retired', before: current?.payload });
      return projectWeeklyExecution(retired, tasks, timestamp);
    },

    async applyWorkflowEvent(
      tenantId: string,
      userId: string,
      programId: string,
      packageId: string,
      input: Record<string, unknown>,
    ): Promise<WeeklyOperatingPackage> {
      const event = input.event as WeeklyWorkflowEvent | undefined;
      if (!event?.eventId || !event.taskId || !['start', 'complete', 'block', 'unblock', 'cancel'].includes(event.type) || !event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) {
        throw new SocialProgramError('workflow_event_invalid', 400, '工作流事件字段不完整。');
      }
      return serializeWorkflowMutation(`${tenantId}:${programId}:${packageId}`, async () => {
        const current = await latestPackageRow(dataStore, tenantId, programId, packageId);
        if (!current) throw new SocialProgramError('weekly_operating_package_not_found', 404, '周任务包不存在。');
        requireExpectedVersion(current.payload.version, input.expectedVersion);
        const projected = await projectWorkflowState(dataStore, tenantId, current);
        const prior = projected.appliedWorkflowEvents.find(item => item.eventId === event.eventId);
        if (prior) {
          if (eventDigest(prior) !== eventDigest(event)) {
            throw new SocialProgramError('workflow_event_conflict', 409, '同一事件 ID 不得承载不同内容。');
          }
          return withExecutionProjection(tenantId, projected);
        }
        const expectedStateVersion = Number(input.expectedStateVersion);
        if (!Number.isSafeInteger(expectedStateVersion) || expectedStateVersion < 0) {
          throw new SocialProgramError('expected_state_version_required', 400, '工作流写入必须提供 expectedStateVersion。');
        }
        if (expectedStateVersion !== projected.workflowStateVersion) {
          throw new SocialProgramError('workflow_state_version_conflict', 409, `工作流状态已更新，当前版本为 ${projected.workflowStateVersion}。`);
        }
        const lastEvent = projected.appliedWorkflowEvents.at(-1);
        if (lastEvent && Date.parse(event.occurredAt) < Date.parse(lastEvent.occurredAt)) {
          throw new SocialProgramError('workflow_event_time_conflict', 409, '工作流事件时间不得早于已提交的最新事件。');
        }
        if (event.type === 'unblock') {
          const target = projected.workflowTasks.find(task => task.taskId === event.taskId);
          if (!target) throw new SocialProgramError('workflow_task_not_found', 404, '周工作流任务不存在。');
          if (target.kind !== 'readiness' || target.ownBlockingReasons.some(reason => !current.payload.planningBlockers.includes(reason))) {
            throw new SocialProgramError('workflow_unblock_authority_required', 409, '缺少可由服务端复核的权威事实，不得仅凭客户端事件解除阻塞。');
          }
          const authority = await withAuthoritativePlanning(tenantId, programId, {
            businessContentGoalRef: current.payload.businessContentGoalRef,
            capacityPlanRef: current.payload.capacityPlanRef,
            automationPolicyRef: current.payload.automationPolicyRef,
          });
          const checked = buildWeeklyWorkflow({
            packageId: current.payload.packageId,
            version: current.payload.version,
            businessGoal: authority.goal,
            capacity: authority.capacity,
            automationPolicy: authority.policy,
            publicationTasks: current.payload.socialContentPackage.publicationTasks,
            discoveryBudgetCny: current.payload.discoveryBudgetCny,
          });
          if (checked.blockers.length) {
            throw new SocialProgramError('workflow_unblock_recheck_failed', 409, `权威事实复核未通过：${checked.blockers.join('、')}`);
          }
        }
        const updated = applyWorkflowEvent(projected, event, { authoritativeUnblockVerified: true });
        const nextStateVersion = projected.workflowStateVersion + 1;
        const digest = eventDigest(event);
        let saved = false;
        try {
          saved = Boolean(await dataStore.create<WorkflowEventRow>(WORKFLOW_EVENTS, {
            tenant_id: tenantId,
            program_id: programId,
            package_id: packageId,
            package_version: current.payload.version,
            event_id: event.eventId,
            state_version: nextStateVersion,
            event_digest: digest,
            event,
            created_by: userId,
            created_at: at(),
          }));
        } catch {
          saved = false;
        }
        if (!saved) {
          const rows = await workflowEventRows(dataStore, tenantId, programId, packageId, current.payload.version);
          const replay = rows.find(row => row.event_id === event.eventId);
          if (replay) {
            if (replay.event_digest !== digest) throw new SocialProgramError('workflow_event_conflict', 409, '同一事件 ID 不得承载不同内容。');
            return withExecutionProjection(tenantId, await projectWorkflowState(dataStore, tenantId, current));
          }
          const latest = await projectWorkflowState(dataStore, tenantId, current);
          if (latest.workflowStateVersion !== expectedStateVersion) {
            throw new SocialProgramError('workflow_state_version_conflict', 409, `工作流状态已更新，当前版本为 ${latest.workflowStateVersion}。`);
          }
          throw new SocialProgramError('workflow_event_storage_unavailable', 503, '工作流事件暂时无法保存。');
        }
        return withExecutionProjection(tenantId, { ...updated, workflowStateVersion: nextStateVersion });
      });
    },
  };
}

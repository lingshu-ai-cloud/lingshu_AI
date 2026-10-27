import { hasWeeklyGoalFactRebuildPlanFence } from './goalFactRebuild.js';
import { applyManagedPublishingGrant } from './managedPublishingGrant.js';
import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { findOperatingGoalConflict } from './operatingGoalConflicts.js';
import { repairCollapsedWeeklyVideoProduction, validatePackageForStart, compilePackage, packageTaskForKey } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { store } from '../storage/index.js';
import { newContentGenerationAuthorization, type ContentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { type EnterpriseProfile } from '../routes/enterprise.js';
import { readServerProductionOnboardingReadiness } from './productionOnboardingPreflight.js';
import { configurationSnapshot, enterpriseProfileFromKnowledgeBinding } from './configuration.js';
import { isDigitalEmployeeOperatingGoal } from './overviewGoalScope.js';
import { configSnapshotForPlan, goalInput, publicConfig } from './overviewProjection.js';
import { buildWeeklyPlan } from './domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createGoalActivationApplication(deps: Pick<DigitalEmployeeApplicationPorts, 'requiredCreate' | 'goalApprovalQueues' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'first' | 'advanceRun' | 'buildOverview' | 'configForTenant' | 'resolveCurrentConfiguration' | 'weeklyGoalFactRebuildRecovery' | 'frozenEnterpriseProfileForPlan' | 'executionConfigForPlan' | 'appendEvent' | 'appendAudit'>) {
  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const goalApprovalQueues = deps.goalApprovalQueues;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const advanceRun: DigitalEmployeeApplicationPorts['advanceRun'] = (...args) => deps.advanceRun(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  const weeklyGoalFactRebuildRecovery: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildRecovery'] = (...args) => deps.weeklyGoalFactRebuildRecovery(...args);

  const frozenEnterpriseProfileForPlan: DigitalEmployeeApplicationPorts['frozenEnterpriseProfileForPlan'] = (...args) => deps.frozenEnterpriseProfileForPlan(...args);

  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  async function ensureReviewRunTasks(tenantId: string, goal: GoalRecord, plan: PlanRecord, run: RunRecord, tasks: ReturnType<typeof buildWeeklyPlan>['tasks'], pack: WeeklyPackage | undefined) {
    const now = new Date().toISOString();
    const stored = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
    for (const task of tasks) {
      if (stored.items.some(t => t.task_key === task.key)) continue;
      await requiredCreate<TaskRecord>(COLLECTION.tasks, {
        tenant_id: tenantId,
        goal_id: goal.id,
        plan_id: plan.id,
        run_id: run.id,
        task_key: task.key,
        title: task.title,
        description: task.description,
        agent_role: task.agentRole,
        kind: task.kind,
        status: 'pending',
        sequence: task.sequence,
        priority: task.priority,
        requires_approval: task.requiresApproval,
        depends_on: task.dependsOn,
        output: {},
        blocked_reason: '',
        owner_id: packageTaskForKey(pack, task.key)?.ownerId || '',
        business_domain: task.businessDomain,
        capability_key: task.capabilityKey,
        destination: task.destination,
        destination_view: task.destinationView || '',
        status_source: task.statusSource,
        execution_mode: task.executionMode,
        external_effect: task.externalEffect,
        automatic_execution_allowed: task.automaticExecutionAllowed,
        policy_source: task.policySource,
        business_refs: (packageTaskForKey(pack, task.key)?.sourceProjectIds || []).map(id => ({ type: 'studio_project', id })),
        task_version: 1,
        correction_version: 0,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async function approveGoalForReview(tenantId: string, userId: string, goalId: string, packageRevision: number | undefined, members: Array<{id: string}>, authorization?: ContentGenerationAuthorization) {
    return withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
      if (!store.compareAndSwap) return { status: 503, body: { error: 'goal_atomic_store_required', message: '当前存储不支持安全启动周目标。' } };
      const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
      if (!goal) { return { status: 404, body: { error: 'goal_not_found' } }; }
      if (!isDigitalEmployeeOperatingGoal(goal)) {
        return { status: 409, body: { error: 'operating_goal_required', message: '该任务属于独立视频制作，请在对应内容任务中继续操作。' } };
      }
      if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
        return { status: 409, body: { error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能启动。' } };
      }
      const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
      if (existingRun) {
        if (existingRun.status === 'initializing') {
          const savedPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, existingRun.plan_id, tenantId);
          if (!savedPlan) throw Error('初始化计划不可用');
          const saved = jsonObject<ReturnType<typeof compilePackage>>(savedPlan.plan, {} as ReturnType<typeof compilePackage>);
          if (!saved.tasks?.length) throw Error('初始化任务清单不可用');
          await ensureReviewRunTasks(tenantId, goal, savedPlan, existingRun, saved.tasks, saved.businessPackage);
          if (!await store.update(COLLECTION.runs, existingRun.id, { status: 'planning' })) throw Error('任务初始化状态保存失败');
          await advanceRun(tenantId, existingRun.id);
        }
        return { status: 200, body: await buildOverview(tenantId, goal.id) };
      }
      // Conflict checks must see every tenant record, including old operating runs
      // pushed beyond the first page by independent social-content bridge records.
      async function conflictRecords<T extends { id: string; tenant_id: string }>(collection: string): Promise<T[]> {
        const records: T[] = [];
        const seen = new Set<string>();
        let totalItems: number | undefined;
        for (let page = 1; ; page++) {
          const batch = await store.list<T>(collection, { where: { tenant_id: tenantId }, sort: 'id', page, perPage: 500 });
          if (!Number.isSafeInteger(batch.totalPages) || batch.totalPages < 0
            || !Number.isSafeInteger(batch.totalItems) || batch.totalItems < 0
            || batch.page !== page || (totalItems !== undefined && totalItems !== batch.totalItems)) {
            throw Error('周目标互斥检查分页发生变化，请刷新后重试。');
          }
          totalItems = batch.totalItems;
          for (const record of batch.items) {
            if (record.tenant_id !== tenantId || seen.has(record.id)) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
            seen.add(record.id);
            records.push(record);
          }
          if (page >= batch.totalPages) {
            if (records.length !== totalItems) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
            return records;
          }
          if (!batch.items.length) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
        }
      }
      const [configRecord, tenantGoals, tenantRuns, existingPlan] = await Promise.all([
        configForTenant(tenantId),
        conflictRecords<GoalRecord>(COLLECTION.goals),
        conflictRecords<RunRecord>(COLLECTION.runs),
        first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
      ]);
      const allowDisjoint = normalizeContinuationPolicy(publicConfig(configRecord)?.continuationPolicy).overlappingCycles === 'allow_disjoint';
      const conflict = await findOperatingGoalConflict({
        goal, goals: tenantGoals, runs: tenantRuns, allowDisjoint,
        loadGoal: id => tenantRecord<GoalRecord>(COLLECTION.goals, id, tenantId),
      });
      if (conflict) {
        return { status: 409, body: {
            error: 'active_goal_exists',
            message: '当前租户已有活跃周目标，请先完成、暂停后取消，或明确结束现有运行。',
            activeGoalId: conflict.goal?.id || conflict.run?.goal_id || '',
            activeRunId: conflict.run?.id || '',
            activeGoalTitle: conflict.goal?.title || '',
            activeGoalStatus: conflict.goal?.status || '',
            activeRunStatus: conflict.run?.status || '',
            activeStartsAt: conflict.goal?.starts_at || '',
            activeEndsAt: conflict.goal?.ends_at || '',
          } };
      }
      const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
      const currentConfig = resolvedConfiguration?.config || null;
      if (!currentConfig || !resolvedConfiguration) { return { status: 409, body: { error: 'onboarding_required' } }; }
      const savedBody = existingPlan ? jsonObject<Record<string, unknown>>(existingPlan.plan, {}) : {};
      if (existingPlan && (existingPlan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(savedBody))) {
        return { status: 409, body: { error: 'package_locked', message: '计划已启动或正在重建，请刷新后重试。' } };
      }
      const savedFactsVersion = String(jsonObject<Record<string, unknown>>(savedBody.knowledgeBinding, {}).factsVersion || '').trim();
      const canonicalFactsVersion = resolvedConfiguration.knowledgeBinding.factsVersion;
      if (savedFactsVersion && savedFactsVersion !== canonicalFactsVersion) {
        return { status: 409, body: {
            error: 'enterprise_facts_changed',
            message: '企业事实已更新；当前草稿仍引用旧事实，请基于最新事实新建周目标后再启动。',
            ...weeklyGoalFactRebuildRecovery(goal, existingPlan!, savedFactsVersion, canonicalFactsVersion),
          } };
      }
      const needsFrozenFactSnapshot = !existingPlan || !frozenEnterpriseProfileForPlan(existingPlan, false);
      // A draft goal owns the configuration snapshot captured when it was created.
      // Later Agent-setting edits apply only to a newly created goal.
      const config = executionConfigForPlan(existingPlan, currentConfig);
      // Account and delivery readiness are checked by the affected task at runtime.
      // Do not clear the content production platforms when no publishing account exists.
      let pack = savedBody.businessPackage ? repairCollapsedWeeklyVideoProduction(savedBody.businessPackage as WeeklyPackage) : undefined;
      let managedPublishingGrantId = String(savedBody.managedPublishingGrantId || '');
      if (pack && !managedPublishingGrantId) {
        const authorized = applyManagedPublishingGrant(pack, currentConfig, goal.ends_at);
        if (authorized.grantId) { pack = authorized.pack; managedPublishingGrantId = authorized.grantId; }
      }
      if (pack) {
        if (packageRevision !== pack.revision) { return { status: 409, body: { error: 'package_changed', message: '请查看并确认最新版本的经营包。' } }; }
        if (pack.tasks.some(t => t.ownerId && !members.some(m => m.id === t.ownerId))) { return { status: 409, body: { error: 'owner_unavailable', message: '计划中的负责人已不可用，请重新分配任务。' } }; }
        const masterPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(item => item.productionRole !== 'platform_adaptation') || [];
        if (masterPlans.length && (pack.detailGeneration?.status !== 'ready'
          || masterPlans.some(item => !item.preproduction?.readiness.canStart))) {
          const blockers = [...new Set([
            ...(pack.detailGeneration?.blockers || []),
            ...masterPlans.flatMap(item => item.preproduction?.readiness.blockers || ['制作详情尚未生成']),
          ].filter(Boolean))];
          return { status: 409, body: {
              error: 'package_details_blocked',
              message: `制作条件尚未全部满足：${blockers.join('；') || '请先生成并确认每条内容的制作详情'}`,
              blockers,
            } };
        }
        if (masterPlans.length) {
          const productionProfile = frozenEnterpriseProfileForPlan(existingPlan, false)
            || enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null;
          if (!productionProfile) {
            return { status: 409, body: { error: 'enterprise_fact_snapshot_missing', message: '企业事实快照缺失，请重新确认企业与产品资料后再开工。' } };
          }
          try {
            const readiness = await readServerProductionOnboardingReadiness({
              store,
              tenantId,
              profile: productionProfile,
              preferences: config.productionOnboarding,
              plans: masterPlans,
              budgetConfirmed: true,
            });
            if (!readiness.ready) return { status: 409, body: {
                error: 'production_onboarding_preflight_blocked',
                message: `周任务未启动：${readiness.blockers.map(item => item.message).join('；')}`,
                blockers: readiness.blockers,
                requiredArchetypes: readiness.requiredArchetypes,
              } };
          } catch (error) {
            return { status: 503, body: {
                error: 'production_onboarding_preflight_unavailable',
                message: `${error instanceof Error ? error.message : '生产资料预检暂时不可用'}；本次未创建运行，请稍后重试。`,
              } };
          }
        }
        const issues = validatePackageForStart(pack, goalInput(goal), configSnapshotForPlan(existingPlan, currentConfig));
        if (issues.length) { return { status: 400, body: { error: 'package_invalid', message: issues.join('；') } }; }
      }
      const planDraft = pack ? compilePackage(pack, goalInput(goal), config) : buildWeeklyPlan(goalInput(goal), config);
      const now = new Date().toISOString();
      const productionTask = pack?.tasks.find(t => t.templateId === 'production');
      if (productionTask?.videoPlans) goal.scope = { ...jsonObject<Record<string, unknown>>(goal.scope, {}), description: goalInput(goal).scope, videoPlans: productionTask.videoPlans };
      const frozenPlanMetadata = existingPlan
        ? { ...savedBody, ...(needsFrozenFactSnapshot ? { knowledgeBinding: resolvedConfiguration.knowledgeBinding } : {}) }
        : configurationSnapshot(resolvedConfiguration);
      const approvedPlanBody = {
        ...frozenPlanMetadata,
        ...planDraft,
        contentGenerationAuthorization: { ...(authorization || newContentGenerationAuthorization()), authorizedBy: userId, authorizedAt: now },
        ...(managedPublishingGrantId ? { managedPublishingGrantId } : {}),
        ...(pack ? { packageApprovedBy: userId, packageApprovedAt: now } : {}),
      };
      let plan: PlanRecord;
      if (existingPlan) {
        const updated = await store.compareAndSwap?.(COLLECTION.plans, existingPlan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: existingPlan.plan,
        }, { status: 'approved', plan: approvedPlanBody });
        if (!updated) { return { status: 409, body: { error: 'package_changed', message: '计划已更新或正在重建，请刷新后重试。' } }; }
        plan = { ...existingPlan, status: 'approved', plan: approvedPlanBody };
      } else {
        plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
          tenant_id: tenantId, goal_id: goal.id, status: 'approved', plan: approvedPlanBody, created_at: now,
        });
      }
      const activated = await store.compareAndSwap?.(COLLECTION.goals, goal.id, {
        tenant_id: tenantId, status: 'draft', version: Number(goal.version || 1),
      }, { status: 'active', updated_at: now, ...(pack ? { scope: goal.scope, content_platforms: goal.content_platforms } : {}) });
      if (!activated) {
        if (existingPlan) await store.compareAndSwap?.(COLLECTION.plans, existingPlan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'approved', plan: approvedPlanBody,
        }, { status: 'draft', plan: existingPlan.plan });
        return { status: 409, body: { error: 'goal_changed', message: '周目标状态已变化，未启动新运行。' } };
      }
      const run = await requiredCreate<RunRecord>(COLLECTION.runs, {
        tenant_id: tenantId,
        goal_id: goal.id,
        plan_id: plan.id,
        status: 'initializing',
        current_controller: 'business',
        pause_reason: '',
        started_at: now,
        completed_at: '',
      });
      await ensureReviewRunTasks(tenantId, goal, plan, run, planDraft.tasks, pack);
      if (!await store.update(COLLECTION.runs, run.id, { status: 'planning' })) throw Error('任务初始化状态保存失败');
      await appendEvent({ tenantId, runId: run.id, type: 'plan.generated', level: 'success', summary: `计划 Agent 已生成 ${planDraft.tasks.length} 个任务`, payload: { strategy: planDraft.strategy } });
      const contentCount = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans?.length || 0;
      await appendEvent({
        tenantId,
        runId: run.id,
        type: 'business.orchestration.started',
        level: 'success',
        summary: `经营 Agent 已接管本周执行，并向编导、内容与客服 Agent 下发任务${contentCount ? `；内容队列共 ${contentCount} 条` : ''}`,
        payload: { controller: 'business', delegatedRoles: ['director', 'content', 'customer'], contentCount, packageRevision: pack?.revision || 0 },
      });
      await appendEvent({ tenantId, runId: run.id, type: 'workflow.started', summary: '数字员工已开始执行本周计划' });
      await appendAudit({ tenantId, userId, action: 'weekly_goal.approved', targetType: 'weekly_goal', targetId: goal.id, metadata: { planId: plan.id, runId: run.id } });
      await advanceRun(tenantId, run.id);
      return { status: 200, body: await buildOverview(tenantId, goal.id) };
    });
  }

  return { approveGoalForReview };
}

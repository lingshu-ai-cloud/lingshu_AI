import type { DataStore } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type ApprovalRecord, type ConfigRecord, type ContentBatchPlanRecord, type EventRecord, type GoalRecord, type HandoffRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import type { buildBusinessSnapshot } from './businessSnapshot.js';
import { buildWeeklyReview, type DigitalEmployeeConfig } from './domain.js';
import { goalInput, configSnapshotForPlan } from './overviewProjection.js';
import { configurationSnapshot, type ResolvedDigitalEmployeeConfiguration } from './configuration.js';
import { compilePackage, recommendPackage, validatePackage } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { ReviewTodoBoard } from '../../src/lib/reviewTodos.js';
import { summarizeContentFeedback } from './contentReview.js';
import { summarizeWeeklyMatrix } from './weeklyMatrixReview.js';
import { recordBelongsToTask } from './taskEvidenceProjection.js';
import { runReviewSummary } from './weeklyReviewProjection.js';
import { applyReviewTodoPlan, sameTodoRequirements } from './reviewTodoPlan.js';
import { nextManagedCycleWindow, prepareManagedCyclePackage } from './managedOperatingCycle.js';
import { applyManagedPublishingGrant, managedPublishingGrantCovers } from './managedPublishingGrant.js';
import { hasWeeklyGoalFactRebuildPlanFence } from './goalFactRebuild.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';

export interface WeeklyReviewDependencies {
  store: DataStore;
  activationQueues: Map<string, Promise<void>>;
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T | null>;
  requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T>;
  configForTenant(tenantId: string): Promise<ConfigRecord | null>;
  resolveCurrentConfiguration(tenantId: string, record?: ConfigRecord | null): Promise<ResolvedDigitalEmployeeConfiguration | null>;
  executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig;
  weeklyGoalFactRebuildTargetCommitted(tenantId: string, target: GoalRecord): Promise<boolean>;
  approveGoalForReview(tenantId: string, userId: string, goalId: string, packageRevision: number | undefined, members: Array<{ id: string }>): Promise<{ status: number; body: unknown }>;
  buildBusinessSnapshot: typeof buildBusinessSnapshot;
  appendEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    type: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<EventRecord>;
  appendAudit(input: {
    tenantId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/** One review lifecycle shared by completion, HTTP refresh and the background worker. */
export function createWeeklyReviewApplication(deps: WeeklyReviewDependencies) {
  const { store, tenantRecord, first, requiredCreate, buildBusinessSnapshot, appendEvent, appendAudit,
    configForTenant, resolveCurrentConfiguration, executionConfigForPlan,
    weeklyGoalFactRebuildTargetCommitted, approveGoalForReview, activationQueues: goalApprovalQueues } = deps;
  const scheduledReviewQueues = new Map<string, Promise<void>>();
  async function completeReview(tenantId: string, goal: GoalRecord, run: RunRecord, tasks: TaskRecord[]): Promise<void> {
    const weeklyPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
    const reviewPackage = jsonObject<{ businessPackage?: WeeklyPackage }>(weeklyPlan?.plan, {}).businessPackage;
    const matrixPlan = reviewPackage?.matrixPlan;
    const existing = await first<StoredRecord & { tenant_id: string; run_id: string; summary: unknown }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: run.id });
    const [approvals, handoffs, businessSnapshot, batchPlans, projects, posts, trendVideos, reviewHistory] = await Promise.all([
      store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
      store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
      buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at }),
      store.list<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 20 }),
      store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
      store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 }),
      store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 100 }).catch(() => ({ items: [] })),
      store.list<StoredRecord & { run_id?: string; summary?: unknown }>(COLLECTION.reviews, { where: { tenant_id: tenantId }, sort: '-created_at', perPage: 20 }),
    ]);
    const taskReview = buildWeeklyReview({
      goal: goalInput(goal),
      totalTasks: tasks.length,
      completedTasks: tasks.filter(task => task.status === 'succeeded').length,
      approvalCount: approvals.items.filter(item => item.status === 'approved').length,
      handoffCount: handoffs.items.length,
      failedTasks: tasks.filter(task => task.status === 'failed').length,
    });
    const reviewRun = tasks.every(task => ['succeeded', 'skipped'].includes(task.status)) ? { ...run, status: 'succeeded' } : run;
    const reviewScope = {
      taskIds: new Set(tasks.map(task => task.id)),
      refIds: new Set(tasks.flatMap(task => jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])
        .flatMap(ref => [ref.id, ref.recordId, ref.entityId, ref.taskId])
        .map(value => String(value || '').trim())
        .filter(Boolean))),
    };
    const contentApprovalTaskIds = new Set(tasks.filter(task => task.task_key === 'content_release_approval').map(task => task.id));
    const previousReview = reviewHistory.items.find(item => String(item.run_id || '') !== run.id);
    const previousRound = jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(previousReview?.summary, {}).nextRoundRecommendations, {});
    const previousTagAdaptation = jsonObject<Record<string, unknown>>(previousRound.tagAdaptation, {});
    const contentFeedback = summarizeContentFeedback({
      orders: batchPlans.items.flatMap(item => jsonObject(item.orders, [])),
      projects: projects.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
      approvals: approvals.items.filter(approval => contentApprovalTaskIds.has(String(approval.task_id || ''))),
      posts: posts.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
      trendVideos: trendVideos.items,
      previousHotTags: jsonObject<string[]>(previousTagAdaptation.hotTags, []),
    });
    const matrixPerformance = matrixPlan ? summarizeWeeklyMatrix(matrixPlan, projects.items.filter(item => recordBelongsToTask(item, run, reviewScope)), posts.items.filter(item => recordBelongsToTask(item, run, reviewScope)), reviewPackage?.tasks.some(task => task.templateId === 'publishing')) : undefined;
    const summary = {
      ...taskReview,
      ...(matrixPerformance ? { matrixPerformance } : {}),
      ...runReviewSummary(reviewRun, tasks, businessSnapshot),
      contentPerformance: contentFeedback.items,
      approvalFeedback: contentFeedback.approvalFeedback,
      nextPlanRecommendations: [...contentFeedback.nextPlanRecommendations, ...(matrixPerformance || []).map(row => `${row.platform} · ${row.accountId}：${row.recommendation}`)],
      nextRoundRecommendations: contentFeedback.nextRoundRecommendations,
      routingEvidence: {
        priorRouteDistribution: contentFeedback.routeCounts,
        approvalFeedback: contentFeedback.approvalFeedback,
        contentInheritance: contentFeedback.nextRoundRecommendations.contentInheritance,
        tagAdaptation: contentFeedback.nextRoundRecommendations.tagAdaptation,
        industryTrends: contentFeedback.nextRoundRecommendations.industryTrends,
      },
    };
    const payload = { status: 'generated', summary };
    if (existing) {
      const updated = await store.update(COLLECTION.reviews, existing.id, payload);
      if (!updated) throw new Error('weekly_reviews_storage_unavailable');
    } else {
      await requiredCreate(COLLECTION.reviews, {
        tenant_id: tenantId, goal_id: goal.id, run_id: run.id, ...payload, created_at: new Date().toISOString(),
      });
    }
  }
  async function generateRunReview(tenantId: string, userId: string, runId: string): Promise<{ run: RunRecord; goal: GoalRecord }> {
    const run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId);
    if (!run) throw new Error('run_not_found');
    const [goal, tasks] = await Promise.all([
      tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
    ]);
    if (!goal) throw new Error('run_context_missing');
    await completeReview(tenantId, goal, run, tasks.items);
    await appendEvent({ tenantId, runId: run.id, type: 'review.generated', level: 'success', summary: '本周复盘已按真实业务数据刷新', payload: { completedTasks: tasks.items.filter(task => task.status === 'succeeded').length, totalTasks: tasks.items.length } });
    await appendAudit({ tenantId, userId, action: 'weekly_review.generated', targetType: 'workflow_run', targetId: run.id, metadata: { goalId: goal.id } });
    return { run, goal };
  }
  /** Idempotent scheduled review entry point used by the background orchestrator. */
  async function generateScheduledRunReview(input: {
    tenantId: string;
    runId: string;
    scheduleSlot: string;
  }): Promise<boolean> {
    return withLocalQueue(scheduledReviewQueues, `${input.tenantId}:${input.runId}`, async () => {
      const existingMarker = await store.list<EventRecord>(COLLECTION.events, {
        where: { tenant_id: input.tenantId, run_id: input.runId, type: 'review.scheduled' }, sort: '-sequence', page: 1, perPage: 100,
      });
      const alreadyGenerated = existingMarker.items.some(event => {
        if (event.type !== 'review.scheduled') return false;
        return String(jsonObject<Record<string, unknown>>(event.payload, {}).scheduleSlot || '') === input.scheduleSlot;
      });
      if (alreadyGenerated) return false;
      const { goal } = await generateRunReview(input.tenantId, 'digital_employee_runtime', input.runId);
      await appendEvent({
        tenantId: input.tenantId,
        runId: input.runId,
        type: 'review.scheduled',
        level: 'success',
        summary: '已按经营配置自动生成阶段复盘',
        payload: { scheduleSlot: input.scheduleSlot },
      });
      await appendAudit({
        tenantId: input.tenantId,
        userId: 'digital_employee_runtime',
        action: 'weekly_review.scheduled',
        targetType: 'workflow_run',
        targetId: input.runId,
        metadata: { goalId: goal.id, scheduleSlot: input.scheduleSlot },
      });
      return true;
    });
  }
  async function continueManagedOperatingCycle(tenantId: string, sourceRunId: string, now = new Date()): Promise<string | null> {
    const elapsedStart = Date.now();
    const leaseNow = () => new Date(now.getTime() + Date.now() - elapsedStart);
    const lease = await acquireDurableOperationLease({ dataStore: store, tenantId, scope: 'managed-operating-cycle', subjectId: 'next-cycle', ownerId: `runtime-${process.pid}`, now, leaseDurationMs: 30 * 60_000 });
    if (!lease) return null;
    try {
      const sourceRun = await tenantRecord<RunRecord>(COLLECTION.runs, sourceRunId, tenantId);
      if (!sourceRun || sourceRun.status !== 'succeeded' || ['starter_198', 'starter_social_content'].includes(String(sourceRun.product_profile || ''))) return null;
      const source = await tenantRecord<GoalRecord>(COLLECTION.goals, sourceRun.goal_id, tenantId);
      const sourcePlan = await tenantRecord<PlanRecord>(COLLECTION.plans, sourceRun.plan_id, tenantId);
      const review = await first<StoredRecord>(COLLECTION.reviews, { tenant_id: tenantId, run_id: sourceRunId });
      if (!source || source.status !== 'completed' || !sourcePlan || sourcePlan.status !== 'approved' || !review || review.status !== 'generated') return null;
      const body = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
      const sourcePack = body.businessPackage as WeeklyPackage | undefined;
      const resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
      const window = nextManagedCycleWindow(source, now);
      if (!sourcePack || !resolved || !window) return null;
      const summary = jsonObject<Record<string, unknown>>(review.summary, {});
      const recommendations = Array.isArray(summary.nextPlanRecommendations) ? summary.nextPlanRecommendations.filter((value): value is string => typeof value === 'string') : [];
      const prepared = prepareManagedCyclePackage(sourcePack, resolved.config, window.endsAt, recommendations, now);
      if (!prepared) return null;
      let target: GoalRecord | null = null;
      // Recover a goal saved before the source checkpoint, including after restart.
      for (let page = 1; ; page++) {
        const goals = await store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, page, perPage: 100, sort: '-created_at' });
        for (const candidate of goals.items) {
          const context = jsonObject<{ managedContinuation?: { sourceRunId?: string } }>(candidate.scope, {});
          if (context.managedContinuation?.sourceRunId === sourceRunId) { target = candidate; break; }
        }
        if (target || page >= goals.totalPages || !goals.items.length) break;
      }
      if (target && (target.starts_at !== window.startsAt || target.ends_at !== window.endsAt)) return target.id;
      if (target) {
        const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: target.id });
        if (existingRun && existingRun.status !== 'initializing') return target.id;
      }
      const input = { ...goalInput(source), title: '社媒托管经营周期', startsAt: window.startsAt, endsAt: window.endsAt, businessLine: 'content_growth' as const };
      const issues = validatePackage(prepared.pack, input, resolved.config);
      if (issues.length) throw Error(issues.join('；'));
      await assertDurableOperationLease({ dataStore: store, lease, now: leaseNow() });
      if (!target) {
        const busy = await store.list<RunRecord>(COLLECTION.runs, { where: { tenant_id: tenantId }, perPage: 500 });
        if (busy.items.some(run => !['succeeded', 'failed', 'cancelled'].includes(run.status))) return null;
        target = await requiredCreate<GoalRecord>(COLLECTION.goals, { tenant_id: tenantId, business_line: 'content_growth', content_platforms: source.content_platforms, objective: source.objective, metric: source.metric, baseline: source.baseline, target: source.target, unit: source.unit, constraints: source.constraints, scope: { description: input.scope, videoPlans: prepared.pack.tasks.find(task => task.templateId === 'production')?.videoPlans, managedContinuation: { sourceRunId, sourceGoalId: source.id, reviewId: review.id, grantId: prepared.grantId, cycleKey: `${sourceRunId}:${window.startsAt}` } }, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, owner_id: resolved.config.managedPublishingGrant!.authorizedBy, status: 'draft', version: 1, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      let targetPlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id });
      if (!targetPlan) targetPlan = await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(prepared.pack, input, resolved.config), managedPublishingGrantId: prepared.grantId, managedSourceRunId: sourceRunId }, created_at: now.toISOString() });
      await assertDurableOperationLease({ dataStore: store, lease, now: leaseNow() });
      if (String(jsonObject<Record<string, unknown>>(targetPlan.plan, {}).managedPublishingGrantId || '') !== prepared.grantId) return null;
      // Re-check revocation after writes and before activating paid work.
      const latest = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
      if (!latest || !managedPublishingGrantCovers(prepared.pack, latest.config, prepared.grantId, target.ends_at, now.toISOString())) return null;
      const result = await approveGoalForReview(tenantId, latest.config.managedPublishingGrant!.authorizedBy!, target.id, prepared.pack.revision, []);
      if (result.status !== 200) { const error = result.body as { message?: string; error?: string }; throw Error(error.message || error.error || 'managed_cycle_activation_failed'); }
      return target.id;
    } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
  }
  /** Persist assignments before starting. Replays use source IDs stored in the plan. */
  async function allocateReviewTodos(tenantId: string, userId: string, board: ReviewTodoBoard): Promise<string> {
    const targetId = await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
      const source = await tenantRecord<GoalRecord>(COLLECTION.goals, board.sourceGoalId, tenantId);
      if (!source) throw Error('复盘目标已不可用');
      const goals = await store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId, starts_at: board.week }, perPage: 100 });
      if (!board.targetGoalId && goals.items.filter(g => g.status === 'draft').length > 1) throw Error('有多个下周目标，请先明确选择');
      let target = board.targetGoalId ? await tenantRecord<GoalRecord>(COLLECTION.goals, board.targetGoalId, tenantId) : goals.items.find(g => g.status === 'draft');
      // Recover after a successful start followed by a failed board-state write.
      for (const candidate of goals.items) {
        if (board.targetGoalId && candidate.id !== board.targetGoalId) continue;
        const saved = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: candidate.id });
        const pack = saved ? jsonObject<{businessPackage?: WeeklyPackage}>(saved.plan, {}).businessPackage : undefined;
        if (pack && board.items.every(i => pack.reviewTodos?.some(p => sameTodoRequirements(p, i)))) { target = candidate; break; }
      }
      if (board.targetGoalId && !target) throw Error('下周目标不存在或不可访问');
      if (!target && goals.items.filter(g => g.status === 'draft').length > 1) throw Error('有多个下周目标，请先明确选择');
      if (target && target.starts_at !== board.week) throw Error('目标周期与待办周期不一致');
      if (target && !await weeklyGoalFactRebuildTargetCommitted(tenantId, target)) throw Error('最新事实周目标尚未完成安全替换');
      const configRecord = await configForTenant(tenantId);
      const resolved = await resolveCurrentConfiguration(tenantId, configRecord);
      if (!resolved) throw Error('请先完成 Agent 设置');
      const sourcePlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id });
      const sourcePack = sourcePlan ? jsonObject<{businessPackage?: WeeklyPackage}>(sourcePlan.plan, {}).businessPackage : undefined;
      if (!target) {
        const end = new Date(`${board.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
        const input = { ...goalInput(source), title: '下周经营目标', startsAt: board.week, endsAt: end.toISOString().slice(0, 10) };
        const seed = sourcePack ? structuredClone(sourcePack) : recommendPackage(input, resolved.config);
        delete seed.reviewTodos;
        seed.tasks.forEach(t => { t.dueAt = input.endsAt; t.ownerId = ''; t.ownerName = ''; t.videoPlans?.forEach(v => { delete v.reviewRequirements; }); });
        seed.authorization.mode = 'each'; seed.revision = 1;
        // Validate capacity before creating any records.
        applyReviewTodoPlan(seed, board.items);
        target = await requiredCreate<GoalRecord>(COLLECTION.goals, { tenant_id: tenantId, business_line: source.business_line, content_platforms: source.content_platforms, objective: source.objective, metric: source.metric, baseline: source.baseline, target: source.target, unit: source.unit, constraints: source.constraints, scope: { description: input.scope, videoPlans: seed.tasks.find(t => t.templateId === 'production')?.videoPlans, reviewTodoBoardId: board.id }, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, owner_id: userId || source.owner_id, status: 'draft', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(seed, input, resolved.config) }, created_at: new Date().toISOString() });
      }
      // Preserve the draft link even if activation subsequently needs user input.
      board.targetGoalId = target.id;
      let plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id });
      if (!plan && jsonObject<Record<string, unknown>>(target.scope, {}).reviewTodoBoardId === board.id) {
        const input = goalInput(target);
        const seed = sourcePack ? structuredClone(sourcePack) : recommendPackage(input, resolved.config);
        delete seed.reviewTodos;
        seed.tasks.forEach(t => { t.dueAt = input.endsAt; t.ownerId = ''; t.ownerName = ''; t.videoPlans?.forEach(v => { delete v.reviewRequirements; }); });
        seed.authorization.mode = 'each'; seed.revision = 1;
        plan = await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(seed, input, resolved.config) }, created_at: new Date().toISOString() });
      }
      if (!plan) throw Error('下周目标缺少计划，请在目标页补充');
      const body = jsonObject<Record<string, unknown>>(plan.plan, {});
      if (hasWeeklyGoalFactRebuildPlanFence(body)) throw Error('下周计划正在发生状态变更');
      const pack = body.businessPackage as WeeklyPackage | undefined;
      if (!pack) throw Error('请先完善下周目标的具体任务安排');
      const alreadyApplied = board.items.every(i => pack.reviewTodos?.some(p => sameTodoRequirements(p, i)));
      if (target.status !== 'draft') { if (alreadyApplied) return target.id; throw Error('下周目标已启动，请在任务执行页调整，不能自动追加'); }
      if (plan.status !== 'draft') throw Error('下周计划正在发生状态变更');
      const updated = applyReviewTodoPlan(pack, board.items);
      // Never inherit last cycle's grant. Resolve explicit, current expiring consent.
      const recurring = applyManagedPublishingGrant(updated, resolved.config, target.ends_at);
      updated.authorization = recurring.pack.authorization;
      if (updated.tasks.some(t => t.ownerId)) throw Error('下周目标包含团队分工，请在目标页核对负责人后启动');
      const config = executionConfigForPlan(plan, resolved.config);
      const issues = validatePackage(updated, goalInput(target), configSnapshotForPlan(plan, resolved.config));
      if (issues.length) throw Error(issues.join('；'));
      if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
        tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: plan.plan,
      }, { plan: { ...body, ...compilePackage(updated, goalInput(target), config), managedPublishingGrantId: recurring.grantId || '' } })) throw Error('下周计划已更新或正在重建，请刷新后重试');
      return target.id;
    });
    const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: targetId });
    const pack = plan ? jsonObject<{businessPackage?: WeeklyPackage}>(plan.plan, {}).businessPackage : undefined;
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, targetId, tenantId);
    const result = await approveGoalForReview(tenantId, userId || goal?.owner_id || '', targetId, pack?.revision, []);
    if (result.status !== 200) { const error = result.body as {message?: string;error?: string}; throw Error(error.message || error.error || '目标启动失败'); }
    return targetId;
  }
  return { completeReview, generateRunReview, generateScheduledRunReview, continueManagedOperatingCycle, allocateReviewTodos };
}
export type WeeklyReviewApplication = ReturnType<typeof createWeeklyReviewApplication>;

import { buildDailyTotals, SOCIAL_METRIC_KEYS, type MetricSnapshot, type SocialMetricKey } from '../socialMetrics/aggregation.js';
import { listSocialMetricSnapshots } from '../socialMetrics/store.js';
import { store } from '../storage/index.js';
import type { WeeklyGoalInput } from './domain.js';
import { listAllRecords } from '../storage/pagination.js';

type StoredRecord = { id: string; [key: string]: unknown };

export type BusinessOutcomeStatus =
  | 'achieved'
  | 'not_achieved'
  | 'in_progress'
  | 'awaiting_measurement'
  | 'unsupported_metric';

export interface BusinessOutcome {
  status: BusinessOutcomeStatus;
  metric: string;
  baseline: number;
  target: number;
  observedValue: number | null;
  measuredIncrement: number | null;
  progressPercent: number | null;
  source: string;
  dataQuality: 'verified' | 'partial' | 'unavailable';
  window: { startsAt: string; endsAt: string; evaluatedAt: string };
  evidence: Record<string, unknown>;
  explanation: string;
}

export interface EvidenceBackedReview {
  schemaVersion: 2;
  workflow: {
    status: 'completed' | 'completed_with_failures' | 'completed_with_skips';
    completionRate: number;
    completedTasks: number;
    totalTasks: number;
    failedTasks: number;
    skippedTasks: number;
    approvalCount: number;
    handoffCount: number;
    actualCost: number;
  };
  businessOutcome: BusinessOutcome;
  publishing: {
    scheduled: number;
    published: number;
    dryRuns: number;
    failed: number;
    postIds: string[];
  };
  automationRate: number;
  approvalRate: number;
  handoffRate: number;
  highlights: string[];
  insights: string[];
  issueHotspots: string[];
  operatingResults: Array<{ label: string; value?: number | string; unit?: string; source: string; missing?: boolean }>;
  costs: { actual: number; budget: number; currency: string; source: string; missing: false };
  nextWeekRecommendations: string[];
  trend: Array<{ week: string; workflowCompletionRate?: number; businessProgressRate?: number; actualCost?: number }>;
  planComparison: Array<{ version: number; label?: string; adopted?: boolean; result?: string }>;
  nextGoalSuggestion: string;
  generatedAt: string;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeMetric(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

const SOCIAL_ALIASES: Record<string, SocialMetricKey> = {
  view: 'views', views: 'views', 播放: 'views', 播放量: 'views',
  reach: 'reach', 覆盖: 'reach', 触达: 'reach',
  like: 'likes', likes: 'likes', 点赞: 'likes',
  comment: 'comments', comments: 'comments', 评论: 'comments',
  share: 'shares', shares: 'shares', 分享: 'shares', 转发: 'shares',
  save: 'saves', saves: 'saves', 收藏: 'saves',
  follower: 'followers', followers: 'followers', 粉丝: 'followers',
  subscriber: 'subscribers', subscribers: 'subscribers', 订阅: 'subscribers',
  profileview: 'profileViews', profileviews: 'profileViews', 主页访问: 'profileViews',
  postspublished: 'postsPublished', 发布数: 'postsPublished',
};

function dateBoundary(value: string, end: boolean): number {
  const raw = value.trim();
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${end ? '23:59:59.999' : '00:00:00.000'}Z`
    : raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function resultFor(input: {
  goal: WeeklyGoalInput;
  now: Date;
  increment: number | null;
  source: string;
  dataQuality: BusinessOutcome['dataQuality'];
  evidence: Record<string, unknown>;
  unsupported?: boolean;
}): BusinessOutcome {
  const startsAt = dateBoundary(input.goal.startsAt, false);
  const endsAt = dateBoundary(input.goal.endsAt, true);
  const observedValue = input.increment === null ? null : input.goal.baseline + input.increment;
  const requiredIncrement = Math.max(0, input.goal.target - input.goal.baseline);
  const progressPercent = observedValue === null
    ? null
    : requiredIncrement === 0
      ? 100
      : Math.max(0, Math.round((input.increment! / requiredIncrement) * 10_000) / 100);
  let status: BusinessOutcomeStatus;
  if (input.unsupported) status = 'unsupported_metric';
  else if (input.increment === null) status = 'awaiting_measurement';
  else if (input.goal.baseline + input.increment >= input.goal.target) status = 'achieved';
  else if (Number.isFinite(endsAt) && input.now.getTime() <= endsAt) status = 'in_progress';
  else status = 'not_achieved';
  const explanation = status === 'achieved'
    ? '正式数据源已证明目标达成。'
    : status === 'in_progress'
      ? '执行流程已结束，但业务观测窗口仍在进行，不宣告目标达成。'
      : status === 'not_achieved'
        ? '正式数据已到达观测窗口末尾，当前未达目标。'
        : status === 'unsupported_metric'
          ? '目标指标尚未映射到可审计的正式数据源，不生成推测结论。'
          : '尚无足够的正式数据证明目标达成。';
  return {
    status,
    metric: input.goal.metric,
    baseline: input.goal.baseline,
    target: input.goal.target,
    observedValue,
    measuredIncrement: input.increment,
    progressPercent,
    source: input.source,
    dataQuality: input.dataQuality,
    window: { startsAt: input.goal.startsAt, endsAt: input.goal.endsAt, evaluatedAt: input.now.toISOString() },
    evidence: input.evidence,
    explanation,
  };
}

export function measureBusinessOutcome(input: {
  goal: WeeklyGoalInput;
  snapshots: MetricSnapshot[];
  approvals: StoredRecord[];
  posts: StoredRecord[];
  now?: Date;
}): BusinessOutcome {
  const now = input.now || new Date();
  const metric = normalizeMetric(input.goal.metric);
  const socialMetric = SOCIAL_ALIASES[metric]
    || SOCIAL_METRIC_KEYS.find(key => normalizeMetric(key) === metric);
  const startsAt = dateBoundary(input.goal.startsAt, false);
  const endsAt = dateBoundary(input.goal.endsAt, true);
  const cutoff = Math.min(now.getTime(), Number.isFinite(endsAt) ? endsAt : now.getTime());
  if (socialMetric) {
    const points = buildDailyTotals(input.snapshots, socialMetric).filter(point => {
      const timestamp = Date.parse(`${point.date}T23:59:59.999Z`);
      return (!Number.isFinite(startsAt) || timestamp >= startsAt) && timestamp <= cutoff;
    });
    const relevantSnapshots = input.snapshots.filter(snapshot => {
      const timestamp = Date.parse(snapshot.capturedAt);
      return typeof snapshot.metrics[socialMetric] === 'number'
        && (!Number.isFinite(startsAt) || timestamp >= startsAt - 86_400_000)
        && timestamp <= cutoff;
    });
    return resultFor({
      goal: input.goal,
      now,
      increment: points.length ? points.reduce((sum, point) => sum + point.value, 0) : null,
      source: 'social_metric_snapshots',
      dataQuality: points.length ? 'verified' : relevantSnapshots.length ? 'partial' : 'unavailable',
      evidence: {
        metricKey: socialMetric,
        snapshotIds: relevantSnapshots.map(snapshot => snapshot.id).filter(Boolean),
        dailyPoints: points,
        semantics: 'period_increment_from_daily_or_differenced_cumulative_snapshots',
      },
    });
  }
  if (['approvedcontentpackages', 'approvedpackages', '审批通过内容包'].includes(metric)) {
    const records = input.approvals.filter(item => ['approved', 'approved_with_changes'].includes(String(item.status)));
    return resultFor({ goal: input.goal, now, increment: records.length, source: 'approval_requests', dataQuality: 'verified', evidence: { approvalIds: records.map(item => item.id) } });
  }
  const published = input.posts.filter(item => {
    const stats = jsonObject(item.stats);
    const publishedAt = Date.parse(String(item.published_at || item.created || ''));
    return String(stats.status) === 'published' && Boolean(String(item.platform_post_id || ''))
      && (!Number.isFinite(startsAt) || publishedAt >= startsAt) && publishedAt <= cutoff;
  });
  if (['publishedposts', 'posts', 'contentpublished', '发布数', '内容发布数'].includes(metric)) {
    return resultFor({ goal: input.goal, now, increment: published.length, source: 'posts', dataQuality: 'verified', evidence: { postIds: published.map(item => item.id), rule: 'platform_post_id_and_published_worker_receipt_required' } });
  }
  if (['lead', 'leads', 'inquiry', 'inquiries', '询盘', '线索'].includes(metric)) {
    const increment = published.reduce((sum, post) => sum + Math.max(0, Number(post.inquiries || 0)), 0);
    return resultFor({ goal: input.goal, now, increment, source: 'posts.inquiries', dataQuality: published.length ? 'verified' : 'unavailable', evidence: { postIds: published.map(item => item.id), attribution: 'tracked_posts_in_goal_window' } });
  }
  if (['deal', 'deals', '成交', '订单'].includes(metric)) {
    const increment = published.reduce((sum, post) => sum + Math.max(0, Number(post.deals || 0)), 0);
    return resultFor({ goal: input.goal, now, increment, source: 'posts.deals', dataQuality: published.length ? 'verified' : 'unavailable', evidence: { postIds: published.map(item => item.id), attribution: 'tracked_posts_in_goal_window' } });
  }
  return resultFor({ goal: input.goal, now, increment: null, source: 'unmapped', dataQuality: 'unavailable', evidence: { supportedMetricKeys: [...SOCIAL_METRIC_KEYS, 'approved_content_packages', 'published_posts', 'inquiries', 'deals'] }, unsupported: true });
}

export async function buildEvidenceBackedReview(input: {
  tenantId: string;
  runId: string;
  goal: WeeklyGoalInput;
  now?: Date;
}): Promise<EvidenceBackedReview> {
  const [tasks, approvals, handoffs, actions, snapshots, currentRun, priorReviews] = await Promise.all([
    listAllRecords<StoredRecord>({ store, collection: 'workflow_tasks', query: { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: 'sequence' } }),
    listAllRecords<StoredRecord>({ store, collection: 'approval_requests', query: { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: 'id' } }),
    listAllRecords<StoredRecord>({ store, collection: 'handoff_sessions', query: { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: 'id' } }),
    listAllRecords<StoredRecord>({ store, collection: 'outbound_action_ledger', query: { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: 'id' } }),
    listSocialMetricSnapshots(input.tenantId),
    store.getById<StoredRecord>('workflow_runs', input.runId),
    store.list<StoredRecord>('weekly_reviews', { where: { tenant_id: input.tenantId }, sort: '-created_at', perPage: 24 }),
  ]);
  const postIds = new Set(actions.map(item => String(item.external_record_id || '')).filter(Boolean));
  const attributablePosts = (await Promise.all([...postIds].map(id => store.getById<StoredRecord>('posts', id))))
    .filter((item): item is StoredRecord => Boolean(item && item.tenant_id === input.tenantId));
  const published = attributablePosts.filter(item => String(jsonObject(item.stats).status) === 'published' && Boolean(String(item.platform_post_id || '')));
  const businessOutcome = measureBusinessOutcome({ goal: input.goal, snapshots, approvals, posts: attributablePosts, now: input.now });
  const completedTasks = tasks.filter(task => task.status === 'succeeded').length;
  const failedTasks = tasks.filter(task => task.status === 'failed').length;
  const skippedTasks = tasks.filter(task => task.status === 'skipped').length;
  const actualCost = Math.round(tasks.reduce((sum, task) => sum + Math.max(0, Number(task.actual_cost || 0)), 0) * 100) / 100;
  const totalTasks = tasks.length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const approvedCount = approvals.filter(item => ['approved', 'approved_with_changes'].includes(String(item.status))).length;
  const automationRate = totalTasks ? Math.max(0, Math.round(((completedTasks - approvedCount) / totalTasks) * 100)) : 0;
  const approvalRate = totalTasks ? Math.round((approvedCount / totalTasks) * 100) : 0;
  const handoffRate = totalTasks ? Math.round((handoffs.length / totalTasks) * 100) : 0;
  const dryRuns = actions.filter(item => item.status === 'dry_run').length;
  const failedActions = actions.filter(item => item.status === 'failed').length;
  const issueHotspots = [...new Set([
    ...tasks.filter(task => task.status === 'failed').map(task => String(task.error_detail || task.error_code || task.blocked_reason || '任务失败')).filter(Boolean),
    ...tasks.filter(task => task.status === 'skipped').map(task => `人工跳过：${String(task.blocked_reason || task.title || task.task_key || '未注明原因')}`),
    ...actions.filter(item => ['failed', 'dry_run'].includes(String(item.status))).map(item => String(item.reason || (item.status === 'dry_run' ? '外部动作仅完成 dry-run' : '外部动作失败'))).filter(Boolean),
  ])].slice(0, 10).map(item => item.slice(0, 240));
  const highlights = [
    completedTasks ? `${completedTasks}/${totalTasks} 项任务有持久化完成证据` : '',
    published.length ? `${published.length} 条内容取得平台发布回执` : '',
    businessOutcome.status === 'achieved' ? `${input.goal.metric} 已由 ${businessOutcome.source} 验证达标` : '',
  ].filter(Boolean);
  const insights = [
    businessOutcome.explanation,
    dryRuns ? `${dryRuns} 个动作停留在 dry-run，未计入真实发布成果。` : '',
    handoffs.length ? `${handoffs.length} 次人工接管已计入自动化率口径。` : '',
  ].filter(Boolean);
  const nextWeekRecommendations = businessOutcome.status === 'achieved'
    ? [`保留当前审批与事实门禁，将 ${input.goal.metric} 目标在当前值基础上小幅提高。`]
    : businessOutcome.status === 'unsupported_metric'
      ? [`先把 ${input.goal.metric} 映射到正式数据源，再创建下一周目标。`]
      : businessOutcome.dataQuality === 'unavailable'
        ? [`先补齐 ${input.goal.metric} 的平台指标或业务回写，避免用流程完成度替代经营结果。`]
        : [`复用已验证产出，针对未达差额调整渠道、素材或观察窗口后再运行。`];

  const priorByRun = new Map<string, StoredRecord>();
  for (const item of priorReviews.items) {
    const runId = String(item.run_id || item.id);
    if (runId !== input.runId && !priorByRun.has(runId)) priorByRun.set(runId, item);
  }
  const priorTrend = [...priorByRun.values()]
    .map(item => jsonObject(item.summary))
    .map(summary => {
      const workflow = jsonObject(summary.workflow);
      const outcome = jsonObject(summary.businessOutcome);
      const costs = jsonObject(summary.costs);
      const window = jsonObject(outcome.window);
      return {
        week: String(window.startsAt || itemDate(summary.generatedAt) || '历史周期'),
        workflowCompletionRate: finiteOptional(workflow.completionRate),
        businessProgressRate: finiteOptional(outcome.progressPercent),
        actualCost: finiteOptional(costs.actual ?? workflow.actualCost),
      };
    })
    .reverse()
    .slice(-7);
  const currentTrend = {
    week: input.goal.startsAt || (input.now || new Date()).toISOString().slice(0, 10),
    workflowCompletionRate: completionRate,
    businessProgressRate: businessOutcome.progressPercent ?? undefined,
    actualCost,
  };

  let planComparison: EvidenceBackedReview['planComparison'] = [];
  if (currentRun && currentRun.tenant_id === input.tenantId && currentRun.goal_id) {
    const [plans, goalRuns] = await Promise.all([
      store.list<StoredRecord>('weekly_plans', { where: { tenant_id: input.tenantId, goal_id: String(currentRun.goal_id) }, sort: 'version', perPage: 100 }),
      store.list<StoredRecord>('workflow_runs', { where: { tenant_id: input.tenantId, goal_id: String(currentRun.goal_id) }, sort: 'started_at', perPage: 100 }),
    ]);
    planComparison = plans.items.map((plan, index) => {
      const runForPlan = goalRuns.items.find(run => String(run.plan_id || '') === plan.id);
      return {
        version: Math.max(1, Number(plan.version || index + 1)),
        label: String(plan.reason || (index === 0 ? '初始计划' : '重规划')).slice(0, 120),
        adopted: plan.id === currentRun.plan_id,
        result: runForPlan ? `运行状态：${String(runForPlan.status || 'unknown')}` : '尚未运行',
      };
    });
  }
  const nextGoalSuggestion = businessOutcome.status === 'achieved'
    ? `已用正式数据验证“${input.goal.objective}”，下周可在保留审批边界的前提下小幅提高 ${input.goal.metric} 目标。`
    : `暂不宣告“${input.goal.objective}”达成；先补齐 ${input.goal.metric} 的正式观测数据，再决定是延长窗口还是调整策略。`;
  return {
    schemaVersion: 2,
    workflow: {
      status: failedTasks ? 'completed_with_failures' : skippedTasks ? 'completed_with_skips' : 'completed',
      completionRate,
      completedTasks,
      totalTasks,
      failedTasks,
      skippedTasks,
      approvalCount: approvedCount,
      handoffCount: handoffs.length,
      actualCost,
    },
    businessOutcome,
    publishing: {
      scheduled: actions.filter(item => item.status === 'scheduled').length,
      published: published.length,
      dryRuns,
      failed: failedActions,
      postIds: attributablePosts.map(item => item.id),
    },
    automationRate,
    approvalRate,
    handoffRate,
    highlights,
    insights,
    issueHotspots,
    operatingResults: [
      { label: input.goal.metric, ...(businessOutcome.observedValue === null ? { missing: true } : { value: businessOutcome.observedValue }), unit: input.goal.unit, source: businessOutcome.source },
      { label: '真实发布', value: published.length, unit: '条', source: 'platform_worker_receipts' },
      { label: '审批通过', value: approvedCount, unit: '项', source: 'approval_requests' },
      { label: '人工接管', value: handoffs.length, unit: '次', source: 'handoff_sessions' },
    ],
    costs: { actual: actualCost, budget: input.goal.budgetLimit, currency: '¥', source: 'workflow_tasks.actual_cost', missing: false },
    nextWeekRecommendations,
    trend: [...priorTrend, currentTrend],
    planComparison,
    nextGoalSuggestion,
    generatedAt: (input.now || new Date()).toISOString(),
  };
}

function finiteOptional(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function itemDate(value: unknown): string {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

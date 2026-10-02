import { contentAccepted } from './contentAcceptance.js';
import type { ContentOrder } from './contentBatchPlan.js';
import { store } from '../storage/index.js';
import type { ExecutionStoreRecord } from '../routes/productionContracts.js';
import type { ContentQueueItem, ContentQueueProjection, PublishingPlatform, WorkflowTask } from '../../src/lib/digitalEmployees.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';

type Stored = { id: string; [key: string]: unknown };
const object = <T extends Record<string, any> = Record<string, any>>(value: unknown): T => {
  if (typeof value === 'string') {
    try { return object<T>(JSON.parse(value)); } catch { return {} as T; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as T : {} as T;
};
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : typeof value === 'string' ? (() => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; } })() : [];
const text = (value: unknown) => String(value ?? '').trim();
const money = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10_000) / 10_000 : null;
};

const stageOrder = ['script', 'material_match', 'voice_subtitles', 'heygen', 'render', 'quality', 'completed'] as const;
const stageLabels: Record<string, string> = {
  script: '脚本生成', material_match: '素材匹配', voice_subtitles: '配音与字幕', heygen: '数字人口播', render: '成片渲染', quality: '质量检查', completed: '成片完成', blocked: '制作受阻',
};

function planOrder(plan: VideoCreationPlan, index: number): ContentOrder {
  return {
    id: `planned:${plan.contentId || index + 1}`,
    goalId: '',
    productId: '',
    productName: plan.productName,
    theme: { key: 'planned', label: plan.theme },
    platform: plan.platform,
    accountId: plan.matrix?.accountId || '',
    accountLabel: '',
    route: plan.route,
    videoPlan: plan,
    languages: [plan.language],
    configurationSnapshot: { configVersion: 0, policyVersion: '', factsVersion: '' },
    cta: plan.matrix?.cta || '',
    constraints: [],
    evidenceRefs: [],
    status: 'planned',
  };
}

function sourceOrderId(project: Stored): string {
  const spec = object(project.spec);
  const order = object(spec.contentOrder);
  return text(order.sourceContentOrderId || spec.contentOrderId).split('::')[0] || '';
}

function projectStage(project: Stored): string {
  return text(object(object(project.spec).automation).stage) || 'script';
}

function projectBlocked(project: Stored): boolean {
  const automation = object(object(project.spec).automation);
  return ['blocked', 'failed'].includes(text(automation.stage)) || ['blocked', 'failed'].includes(text(automation.status)) || Boolean(text(automation.blocker));
}

function queueState(projects: Stored[], task?: WorkflowTask): Pick<ContentQueueItem, 'status' | 'stage' | 'progress' | 'reason' | 'steps' | 'updatedAt'> {
  if (!projects.length) {
    const blocked = task && ['failed', 'waiting_external', 'waiting_human'].includes(task.status);
    return {
      status: blocked ? 'blocked' : task ? 'queued' : 'planned',
      stage: blocked ? '等待补齐制作条件' : task ? '等待创建制作项目' : '等待周计划确认',
      progress: 0,
      reason: blocked ? task.blocked_reason : '',
      updatedAt: task?.updated_at || '',
      steps: stageOrder.slice(0, -1).map((stage, index) => ({ label: stageLabels[stage], state: index === 0 && task ? 'active' as const : 'pending' as const })),
    };
  }
  const blockedProject = projects.find(projectBlocked);
  const complete = projects.every(project => projectStage(project) === 'completed' && object(object(object(project.spec).automation).quality).passed === true);
  const approved = complete && projects.every(project => contentAccepted(object(project.spec)));
  const indexes = projects.map(project => Math.max(0, stageOrder.indexOf(projectStage(project) as typeof stageOrder[number])));
  const currentIndex = Math.min(...indexes);
  const progress = complete ? 100 : Math.round(Math.max(0, currentIndex) / (stageOrder.length - 1) * 100);
  const currentStage = complete ? 'completed' : stageOrder[currentIndex] || 'script';
  return {
    status: blockedProject ? 'blocked' : approved ? 'completed' : complete ? 'waiting_review' : 'producing',
    stage: blockedProject ? '制作受阻' : approved ? '已验收完成' : complete ? '成片待验收' : `${stageLabels[currentStage]}${projects.length > 1 ? ` · ${projects.length} 个语言版本` : ''}`,
    progress,
    reason: blockedProject ? text(object(object(blockedProject.spec).automation).blocker) : '',
    updatedAt: projects.map(project => text(project.updated_at || project.updated)).filter(Boolean).sort().at(-1) || task?.updated_at || '',
    steps: stageOrder.slice(0, -1).map((stage, index) => ({
      label: stageLabels[stage],
      state: complete || projects.every(project => stageOrder.indexOf(projectStage(project) as typeof stageOrder[number]) > index)
        ? 'done' as const
        : index === currentIndex ? 'active' as const : 'pending' as const,
    })),
  };
}

function costState(projects: Stored[], executions: ExecutionStoreRecord[], estimated: number | null): Pick<ContentQueueItem, 'estimatedCostCny' | 'settledCostCny' | 'costStatus'> {
  const ids = new Set(projects.map(project => project.id));
  const related = executions.filter(execution => ids.has(execution.project_id));
  const settled = related.map(execution => execution.payload).filter(payload => payload.costStatus === 'reconciled' && money(payload.actualCostCny) !== null);
  if (settled.length) return {
    estimatedCostCny: estimated,
    settledCostCny: Math.round(settled.reduce((sum, payload) => sum + Number(payload.actualCostCny || 0), 0) * 10_000) / 10_000,
    costStatus: 'settled',
  };
  if (related.length) return { estimatedCostCny: estimated, settledCostCny: null, costStatus: 'awaiting_settlement' };
  return { estimatedCostCny: estimated, settledCostCny: null, costStatus: estimated !== null ? 'estimated' : 'unavailable' };
}

const manualStageOrder = ['brief', 'plan', 'production', 'review', 'delivery'] as const;
const manualStageLabels: Record<typeof manualStageOrder[number], string> = {
  brief: '需求确认', plan: '方案确认', production: '内容制作', review: '内容验收', delivery: '交付发布',
};

function manualPlatform(values: unknown[]): PublishingPlatform {
  const joined = values.map(value => text(value).toLowerCase()).join(' ');
  if (/instagram|ins\b/.test(joined)) return 'instagram';
  if (/facebook|脸书/.test(joined)) return 'facebook';
  if (/youtube|油管/.test(joined)) return 'youtube';
  return 'tiktok';
}

function manualState(record: Stored): Pick<ContentQueueItem, 'status' | 'stage' | 'progress' | 'reason' | 'steps' | 'updatedAt'> {
  const status = text(record.status);
  const stageIndex = status === 'draft' || status === 'needs_input' ? 0
    : status === 'plan_review' ? 1
      : status === 'producing' ? 2
        : status === 'asset_review' ? 3
          : ['packaging', 'delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(status) ? 4 : 0;
  const blocked = ['paused', 'attention', 'needs_input'].includes(status);
  const completed = ['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(status);
  return {
    status: blocked ? 'blocked' : completed ? 'completed' : status === 'asset_review' ? 'waiting_review' : status === 'producing' || status === 'packaging' ? 'producing' : 'planned',
    stage: blocked ? status === 'needs_input' ? '等待补齐任务输入' : status === 'paused' ? '任务已暂停' : '任务需要处理'
      : completed ? '内容已交付' : manualStageLabels[manualStageOrder[stageIndex]],
    progress: completed ? 100 : Math.round(stageIndex / (manualStageOrder.length - 1) * 100),
    reason: blocked ? text(object(record.brief).specialRequirements) || (status === 'needs_input' ? '请补齐任务输入后继续' : '请进入内容创作查看处理要求') : '',
    updatedAt: text(record.updated_at || record.updated || record.created_at),
    steps: manualStageOrder.map((stage, index) => ({
      label: manualStageLabels[stage],
      state: completed || index < stageIndex ? 'done' as const : index === stageIndex ? 'active' as const : 'pending' as const,
    })),
  };
}

function manualTaskItem(input: {
  record: Stored;
  projects: Stored[];
  executions: ExecutionStoreRecord[];
  accountLabels: Map<string, string>;
}): ContentQueueItem | null {
  const brief = object(input.record.brief);
  const taskId = text(input.record.task_id);
  const title = text(brief.title);
  if (!taskId || !title) return null;
  const targetAccount = object(brief.targetAccountRef);
  const accountId = text(targetAccount.id);
  const count = Math.max(1, Math.floor(Number(brief.requestedOutputCount) || 1));
  const weeklyBudget = money(brief.weeklyBudgetCny);
  const perItemBudget = money(brief.perItemBudgetCny);
  const estimated = perItemBudget ?? (weeklyBudget === null ? null : Math.round((weeklyBudget / count) * 100) / 100);
  const mode = text(input.record.task_mode);
  const weeklyPlanId = text(input.record.weekly_plan_id);
  const creationMode = text(brief.creationMode || input.record.legacy_creation_route);
  const relatedProjects = input.projects.filter(project => text(object(project.spec).socialContentTaskId) === taskId);
  const platforms = array<unknown>(brief.platforms);
  const formats = array<unknown>(brief.formats).map(text).filter(Boolean);
  const languages = array<unknown>(brief.languages).map(text).filter(Boolean);
  return {
    id: `social:${taskId}`,
    contentId: taskId,
    orderId: taskId,
    batchPlanId: weeklyPlanId,
    projectIds: relatedProjects.map(project => project.id),
    taskId: '',
    socialContentTaskId: taskId,
    origin: mode === 'instant' || !weeklyPlanId ? 'manual' : 'weekly_plan',
    title,
    productName: text(brief.productRef),
    platform: manualPlatform(platforms),
    accountId,
    accountLabel: input.accountLabels.get(accountId) || accountId,
    route: creationMode === 'viral_replication' || creationMode === 'clone' ? 'clone' : creationMode === 'material_processing' ? 'material' : 'product',
    languages,
    plannedPublishDate: text(brief.dueAt),
    referenceId: '',
    referenceTitle: '',
    benchmarkAccount: '',
    matchScore: null,
    planningFactors: [
      mode === 'instant' ? '用户在内容创作中创建的单项任务' : weeklyPlanId ? '来自内容周计划' : '用户手动创建的内容任务',
      text(brief.objective) ? `目标：${text(brief.objective)}` : '',
      accountId ? `账号：${input.accountLabels.get(accountId) || accountId}` : '尚未指定发布账号',
    ].filter(Boolean),
    lineage: {
      goalId: text(object(brief.programRef).id),
      objective: text(brief.objective),
      accountId,
      accountLabel: input.accountLabels.get(accountId) || accountId,
      budgetCny: estimated,
      planId: weeklyPlanId,
      planVersion: weeklyPlanId ? text(input.record.version) : '',
      factsVersion: '',
      cycleStart: text(input.record.created_at).slice(0, 10),
      cycleEnd: text(brief.dueAt),
      authorizationMode: 'manual',
    },
    outputSummary: {
      count,
      durationSeconds: null,
      formats: formats.length ? formats : ['短视频'],
    },
    ...manualState(input.record),
    ...costState(relatedProjects, input.executions, estimated),
  };
}

export async function buildContentQueueProjection(input: {
  tenantId: string;
  runId: string;
  planBody: Record<string, unknown>;
  tasks: WorkflowTask[];
  planId?: string;
  goal?: { id: string; objective: string; startsAt: string; endsAt: string; version: number } | null;
  publishingTargets?: Array<{ accountId: string; accountLabel: string }>;
}): Promise<ContentQueueProjection> {
  const pack = input.planBody.businessPackage as WeeklyPackage | undefined;
  const productionPlans = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const productionTask = input.tasks.find(task => task.task_key === 'content_production');
  const [batchResult, projectResult, executionResult, manualTaskResult] = await Promise.all([
    input.runId ? store.list<Stored>('content_batch_plans', { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-created_at', perPage: 100 }) : Promise.resolve({ items: [] as Stored[] }),
    store.list<Stored>('studio_projects', { where: { tenant_id: input.tenantId }, sort: '-updated_at', perPage: 500 }).catch(() => ({ items: [] as Stored[] })),
    store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: input.tenantId }, perPage: 500 }).catch(() => ({ items: [] as ExecutionStoreRecord[] })),
    store.list<Stored>('starter_social_content_tasks', { where: { tenant_id: input.tenantId }, sort: '-updated_at', perPage: 500 }).catch(() => ({ items: [] as Stored[] })),
  ]);
  const batch = batchResult.items.find(item => text(item.status) === 'planned');
  const orders = batch ? array<ContentOrder>(batch.orders) : productionPlans.map(planOrder);
  const projects = projectResult.items.filter(project => {
    const spec = object(project.spec);
    const automation = object(spec.automation);
    return spec.workflowRunId === input.runId && automation.managedBy === 'digital_employee' && automation.stage !== 'superseded';
  });
  const accountLabels = new Map((input.publishingTargets || []).map(item => [item.accountId, item.accountLabel]));
  const weeklyItems = orders.map((order, index): ContentQueueItem => {
    const relatedProjects = projects.filter(project => sourceOrderId(project) === order.id);
    const plan = order.videoPlan;
    const evidence = plan?.planningEvidence;
    const state = queueState(relatedProjects, productionTask);
    const estimated = money(plan?.estimatedCost);
    return {
      id: order.id,
      contentId: plan?.contentId || order.id,
      orderId: order.id,
      batchPlanId: batch?.id || '',
      projectIds: relatedProjects.map(project => project.id),
      taskId: productionTask?.id || '',
      socialContentTaskId: '',
      origin: 'weekly_plan',
      title: plan?.buyerProblem || order.theme?.label || plan?.theme || `内容 ${index + 1}`,
      productName: order.productName || plan?.productName || '',
      platform: order.platform,
      accountId: order.accountId || plan?.matrix?.accountId || '',
      accountLabel: order.accountLabel || '',
      route: order.route,
      languages: [...new Set(relatedProjects.map(project => text(object(project.spec).lang)).filter(Boolean).concat(order.languages || plan?.language || []))],
      plannedPublishDate: plan?.plannedPublishDate || '',
      referenceId: plan?.referenceId || '',
      referenceTitle: evidence?.referenceTitle || '',
      benchmarkAccount: evidence?.benchmarkAccount || '',
      matchScore: evidence ? evidence.matchScore : null,
      planningFactors: evidence?.factors || [],
      lineage: {
        goalId: order.goalId || input.goal?.id || '',
        objective: input.goal?.objective || '',
        accountId: order.accountId || plan?.matrix?.accountId || '',
        accountLabel: order.accountLabel || accountLabels.get(order.accountId || plan?.matrix?.accountId || '') || '',
        budgetCny: estimated && estimated > 0 ? estimated : null,
        planId: input.planId || '',
        planVersion: String(pack?.revision || input.goal?.version || ''),
        factsVersion: text(order.configurationSnapshot?.factsVersion),
        cycleStart: input.goal?.startsAt || '',
        cycleEnd: input.goal?.endsAt || '',
        authorizationMode: pack?.authorization.mode || 'each',
      },
      outputSummary: {
        count: 1,
        durationSeconds: Number.isFinite(Number(plan?.duration)) && Number(plan?.duration) > 0 ? Number(plan?.duration) : null,
        formats: ['短视频'],
      },
      ...state,
      ...costState(relatedProjects, executionResult.items, estimated && estimated > 0 ? estimated : null),
    };
  });
  const manualItems = manualTaskResult.items
    .map(record => manualTaskItem({ record, projects: projectResult.items, executions: executionResult.items, accountLabels }))
    .filter((item): item is ContentQueueItem => Boolean(item));
  const items = [...manualItems, ...weeklyItems]
    .sort((left, right) => Date.parse(right.updatedAt || '1970-01-01') - Date.parse(left.updatedAt || '1970-01-01'));
  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: items.length ? 'available' : input.runId ? 'pending' : 'unavailable',
    sourceNote: batch
      ? '已合并手动内容任务、冻结周计划订单、制作项目状态与供应商结算回执'
      : productionPlans.length ? '已合并手动内容任务与待确认周计划；确认后将冻结订单并创建制作项目' : manualItems.length ? '当前展示内容创作中的手动任务；周计划确认后会并入同一队列' : '当前还没有内容任务',
    items,
  };
}

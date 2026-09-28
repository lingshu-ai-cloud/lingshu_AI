import { contentAccepted } from './contentAcceptance.js';
import type { ContentOrder } from './contentBatchPlan.js';
import { store } from '../storage/index.js';
import type { ExecutionStoreRecord } from '../routes/productionContracts.js';
import type { ContentQueueItem, ContentQueueProjection, WorkflowTask } from '../../src/lib/digitalEmployees.js';
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

export async function buildContentQueueProjection(input: {
  tenantId: string;
  runId: string;
  planBody: Record<string, unknown>;
  tasks: WorkflowTask[];
}): Promise<ContentQueueProjection> {
  const pack = input.planBody.businessPackage as WeeklyPackage | undefined;
  const productionPlans = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const productionTask = input.tasks.find(task => task.task_key === 'content_production');
  const [batchResult, projectResult, executionResult] = await Promise.all([
    input.runId ? store.list<Stored>('content_batch_plans', { where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-created_at', perPage: 100 }) : Promise.resolve({ items: [] as Stored[] }),
    input.runId ? store.list<Stored>('studio_projects', { where: { tenant_id: input.tenantId }, sort: '-updated_at', perPage: 500 }) : Promise.resolve({ items: [] as Stored[] }),
    input.runId ? store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: input.tenantId }, perPage: 500 }).catch(() => ({ items: [] as ExecutionStoreRecord[] })) : Promise.resolve({ items: [] as ExecutionStoreRecord[] }),
  ]);
  const batch = batchResult.items.find(item => text(item.status) === 'planned');
  const orders = batch ? array<ContentOrder>(batch.orders) : productionPlans.map(planOrder);
  const projects = projectResult.items.filter(project => {
    const spec = object(project.spec);
    const automation = object(spec.automation);
    return spec.workflowRunId === input.runId && automation.managedBy === 'digital_employee' && automation.stage !== 'superseded';
  });
  const items = orders.map((order, index): ContentQueueItem => {
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
      ...state,
      ...costState(relatedProjects, executionResult.items, estimated && estimated > 0 ? estimated : null),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: items.length ? 'available' : input.runId ? 'pending' : 'unavailable',
    sourceNote: batch
      ? '来自已冻结内容批次、制作项目状态与供应商结算回执'
      : productionPlans.length ? '来自待确认周计划；确认后将冻结订单并创建制作项目' : '当前周计划尚未生成内容订单',
    items,
  };
}

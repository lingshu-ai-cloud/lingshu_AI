import { contentAccepted } from './contentAcceptance.js';
import type { ContentOrder } from './contentBatchPlan.js';
import { store } from '../storage/index.js';
import type { ExecutionStoreRecord } from '../routes/productionContracts.js';
import type { ContentQueueItem, ContentQueueProjection, ContentQueueStep, PublishingPlatform, WorkflowTask } from '../../src/lib/digitalEmployees.js';
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
type ProductionStepTemplate = Pick<ContentQueueStep, 'key' | 'label' | 'responsibleAgent' | 'estimatedMinutes'> & { stageIndex: number; approval?: boolean };
const productionStepTemplates: ProductionStepTemplate[] = [
  { key: 'material_readiness', label: '核对素材与授权', responsibleAgent: '内容 Agent', estimatedMinutes: 20, stageIndex: -1 },
  { key: 'script', label: '拆解爆款原脚本并生成企业适配脚本', responsibleAgent: '编导 Agent', estimatedMinutes: 30, stageIndex: 0 },
  { key: 'storyboard', label: '生成企业适配逐镜分镜', responsibleAgent: '编导 Agent', estimatedMinutes: 35, stageIndex: 0 },
  { key: 'asset_generation', label: '匹配或生成逐镜素材', responsibleAgent: '内容 Agent', estimatedMinutes: 45, stageIndex: 1 },
  { key: 'voice_subtitles', label: '生成配音与字幕', responsibleAgent: '内容 Agent', estimatedMinutes: 30, stageIndex: 2 },
  { key: 'presenter', label: '生成数字人口播或人物镜头', responsibleAgent: '内容 Agent', estimatedMinutes: 60, stageIndex: 3 },
  { key: 'video_generation', label: '剪辑、合成与成片渲染', responsibleAgent: '内容 Agent', estimatedMinutes: 90, stageIndex: 4 },
  { key: 'quality_check', label: '事实、画面、音频与版权质检', responsibleAgent: '内容 Agent · 质检能力', estimatedMinutes: 25, stageIndex: 5 },
  { key: 'rework', label: '按质检结果局部返工', responsibleAgent: '内容 Agent', estimatedMinutes: 30, stageIndex: 5 },
  { key: 'user_approval', label: '用户确认成片', responsibleAgent: '用户', estimatedMinutes: 10, stageIndex: 6, approval: true },
];

function productionSteps(input: {
  hasProjects: boolean;
  taskPresent: boolean;
  currentIndex: number;
  complete: boolean;
  approved: boolean;
}): ContentQueueStep[] {
  return productionStepTemplates.map(template => {
    let state: ContentQueueStep['state'] = 'pending';
    if (template.approval) state = input.approved ? 'done' : input.complete ? 'active' : 'pending';
    else if (input.complete || input.hasProjects && template.stageIndex < input.currentIndex || input.hasProjects && template.stageIndex < 0) state = 'done';
    else if (input.hasProjects && template.stageIndex === input.currentIndex) state = 'active';
    else if (!input.hasProjects && input.taskPresent && template.stageIndex < 0) state = 'active';
    return { ...template, state };
  });
}

function confidenceDimension(input: {
  evidence: string[];
  gaps: string[];
  blocked?: boolean;
  maximum?: 'high' | 'medium';
}): NonNullable<ContentQueueItem['confidence']>['production'] {
  const evidence = input.evidence.filter(Boolean);
  const gaps = input.gaps.filter(Boolean);
  const level = input.blocked ? 'low'
    : evidence.length === 0 ? 'insufficient'
      : gaps.length === 0 && input.maximum !== 'medium' ? 'high'
        : evidence.length >= 2 ? 'medium' : 'low';
  return {
    level,
    label: level === 'high' ? '高' : level === 'medium' ? '中' : level === 'low' ? '低' : '数据不足',
    evidence,
    gaps,
  };
}

function taskConfidence(input: {
  status: ContentQueueItem['status'];
  productName: string;
  languages: string[];
  formats: string[];
  projectCount: number;
  accountId: string;
  accountConnected: boolean;
  publishDate: string;
  authorizationMode: ContentQueueItem['lineage']['authorizationMode'];
  objective: string;
  referenceTitle: string;
  referenceViews: string;
  benchmarkAccount: string;
  matchScore: number | null;
}): NonNullable<ContentQueueItem['confidence']> {
  const production = confidenceDimension({
    blocked: input.status === 'blocked',
    evidence: [
      input.productName ? '已绑定产品或制作主题' : '',
      input.languages.length ? `已确认语言：${input.languages.join(' / ')}` : '',
      input.formats.length ? `已确认形式：${input.formats.join(' / ')}` : '',
      input.projectCount ? `已有 ${input.projectCount} 个正式制作项目` : '',
      ['waiting_review', 'completed'].includes(input.status) ? '已经产出可验收结果' : '',
    ],
    gaps: [
      !input.productName ? '缺产品或制作主题' : '',
      !input.languages.length ? '缺语言要求' : '',
      input.status === 'blocked' ? '当前存在制作卡点' : '',
    ],
  });
  const publishing = confidenceDimension({
    evidence: [
      input.accountConnected ? '目标账号已连接' : input.accountId ? '已指定目标账号' : '',
      input.publishDate ? `已安排日期：${input.publishDate}` : '',
      input.authorizationMode === 'bounded' ? '已获得范围授权' : input.authorizationMode === 'each' ? '采用逐次确认' : '',
    ],
    gaps: [
      !input.accountId ? '缺发布账号' : '',
      !input.accountConnected && input.accountId ? '账号连接状态待确认' : '',
      !input.publishDate ? '缺发布时间' : '',
      input.authorizationMode !== 'bounded' ? '发布前仍需确认' : '',
    ],
  });
  const businessEvidenceReady = Boolean(input.objective && (input.referenceTitle || input.benchmarkAccount));
  const businessBase = confidenceDimension({
    maximum: 'medium',
    evidence: [
      input.objective ? `已绑定经营目标：${input.objective}` : '',
      input.benchmarkAccount ? `已绑定对标账号：${input.benchmarkAccount}` : '',
      input.referenceTitle ? `已有可核对参考：${input.referenceTitle}` : '',
      input.referenceViews ? `已有参考播放证据：${input.referenceViews}` : '',
      input.matchScore !== null ? `内容匹配度：${input.matchScore}` : '',
    ],
    gaps: [
      !input.objective ? '缺经营目标' : '',
      !input.referenceTitle && !input.benchmarkAccount ? '缺可核对的参考内容' : '',
      '发布后的真实播放、互动、询盘或成交数据尚未回传',
    ],
  });
  const business = businessEvidenceReady ? businessBase : {
    ...businessBase,
    level: 'insufficient' as const,
    label: '数据不足',
  };
  const dimensions = [production, publishing, business];
  const dataSufficiency = dimensions.some(item => item.level === 'insufficient') ? 'insufficient'
    : dimensions.some(item => item.gaps.length > 0) ? 'partial' : 'complete';
  return {
    production,
    publishing,
    business,
    dataSufficiency,
    note: '这是基于现有证据的数据充分度与执行把握，不是承诺播放、询盘或成交的成功概率。',
  };
}

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
  const automation = object(object(project.spec).automation);
  const stage = text(automation.stage) || 'script';
  return ['blocked', 'failed'].includes(stage) ? text(automation.resumeStage) || 'script' : stage;
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
      steps: productionSteps({ hasProjects: false, taskPresent: Boolean(task), currentIndex: 0, complete: false, approved: false }),
    };
  }
  const blockedProject = projects.find(projectBlocked);
  const complete = projects.every(project => projectStage(project) === 'completed' && object(object(object(project.spec).automation).quality).passed === true);
  const approved = complete && projects.every(project => contentAccepted(object(project.spec)));
  const indexes = projects.map(project => Math.max(0, stageOrder.indexOf(projectStage(project) as typeof stageOrder[number])));
  const currentIndex = Math.min(...indexes);
  // A rendered/quality-passed file still needs the explicit user acceptance
  // step. Reserve 100% for an accepted deliverable so a blocked or
  // waiting-review item can never display a contradictory full completion.
  const stageProgress = Math.round(Math.max(0, currentIndex) / (stageOrder.length - 1) * 100);
  const progress = approved ? 100 : complete ? 90 : Math.min(90, stageProgress);
  const currentStage = complete ? 'completed' : stageOrder[currentIndex] || 'script';
  return {
    status: blockedProject ? 'blocked' : approved ? 'completed' : complete ? 'waiting_review' : 'producing',
    stage: blockedProject ? '制作受阻' : approved ? '已验收完成' : complete ? '成片待验收' : `${stageLabels[currentStage]}${projects.length > 1 ? ` · ${projects.length} 个语言版本` : ''}`,
    progress,
    reason: blockedProject ? text(object(object(blockedProject.spec).automation).blocker) : '',
    updatedAt: projects.map(project => text(project.updated_at || project.updated)).filter(Boolean).sort().at(-1) || task?.updated_at || '',
    steps: productionSteps({ hasProjects: true, taskPresent: Boolean(task), currentIndex, complete, approved }),
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
const manualStepTemplates: Array<Pick<ContentQueueStep, 'key' | 'label' | 'responsibleAgent' | 'estimatedMinutes'> & { stageIndex: number }> = [
  { key: 'brief', label: '确认需求、账号和预算', responsibleAgent: '用户', estimatedMinutes: 10, stageIndex: 0 },
  { key: 'plan', label: '确认内容方案与交付时间', responsibleAgent: '经营 Agent', estimatedMinutes: 15, stageIndex: 1 },
  { key: 'script', label: '拆解参考脚本并生成企业适配脚本', responsibleAgent: '编导 Agent', estimatedMinutes: 30, stageIndex: 2 },
  { key: 'storyboard', label: '生成企业适配逐镜分镜', responsibleAgent: '编导 Agent', estimatedMinutes: 35, stageIndex: 2 },
  { key: 'assets', label: '匹配或生成逐镜素材', responsibleAgent: '内容 Agent', estimatedMinutes: 45, stageIndex: 2 },
  { key: 'video', label: '配音、剪辑与成片渲染', responsibleAgent: '内容 Agent', estimatedMinutes: 120, stageIndex: 2 },
  { key: 'quality', label: '成片质检与局部返工', responsibleAgent: '内容 Agent · 质检能力', estimatedMinutes: 25, stageIndex: 3 },
  { key: 'approval', label: '用户确认成片', responsibleAgent: '用户', estimatedMinutes: 10, stageIndex: 3 },
  { key: 'delivery', label: '交付或发布', responsibleAgent: '发布 Agent', estimatedMinutes: 10, stageIndex: 4 },
];

function manualPlatform(values: unknown[]): PublishingPlatform {
  const joined = values.map(value => text(value).toLowerCase()).join(' ');
  if (/instagram|ins\b/.test(joined)) return 'instagram';
  if (/facebook|脸书/.test(joined)) return 'facebook';
  if (/youtube|油管/.test(joined)) return 'youtube';
  return 'tiktok';
}

function manualState(record: Stored, missingInputs: string[]): Pick<ContentQueueItem, 'status' | 'stage' | 'progress' | 'reason' | 'steps' | 'updatedAt'> {
  const status = text(record.status);
  const stageIndex = status === 'draft' || status === 'needs_input' ? 0
    : status === 'plan_review' ? 1
      : status === 'producing' ? 2
        : status === 'asset_review' ? 3
          : ['packaging', 'delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(status) ? 4 : 0;
  const blocked = ['paused', 'attention', 'needs_input'].includes(status);
  const completed = ['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(status);
  const brief = object(record.brief);
  const managedStartReason = text(
    object(brief._managedStart).reason || object(record._managedStart).reason,
  );
  const reason = !blocked ? ''
    : text(brief.specialRequirements)
      || (missingInputs.length ? `仍缺：${missingInputs.join('、')}。请进入制作台补齐后继续。` : '')
      || (managedStartReason === 'reference_analysis_pending' ? '参考视频逐镜分析仍在进行；分析完成后会自动进入内容方案确认。' : '')
      || (status === 'paused' ? '任务已暂停，可从当前节点继续。' : '当前任务需要人工确认后继续。');
  return {
    status: blocked ? 'blocked' : completed ? 'completed' : status === 'asset_review' ? 'waiting_review' : status === 'producing' || status === 'packaging' ? 'producing' : 'planned',
    stage: blocked ? status === 'needs_input' ? '等待补齐任务输入' : status === 'paused' ? '任务已暂停' : '任务需要处理'
      : completed ? '内容已交付' : manualStageLabels[manualStageOrder[stageIndex]],
    progress: completed ? 100 : Math.round(stageIndex / (manualStageOrder.length - 1) * 100),
    reason,
    updatedAt: text(record.updated_at || record.updated || record.created_at),
    steps: manualStepTemplates.map(step => ({
      key: step.key,
      label: step.label,
      responsibleAgent: step.responsibleAgent,
      estimatedMinutes: step.estimatedMinutes,
      state: completed || step.stageIndex < stageIndex ? 'done' as const : step.stageIndex === stageIndex ? 'active' as const : 'pending' as const,
    })),
  };
}

function manualTaskItem(input: {
  record: Stored;
  projects: Stored[];
  executions: ExecutionStoreRecord[];
  accountLabels: Map<string, string>;
  publishingTargets: Array<{ platform?: PublishingPlatform; accountId: string; accountLabel: string }>;
  defaultProductName: string;
  defaultPublishDate: string;
  defaultLanguages: string[];
}): ContentQueueItem | null {
  const brief = object(input.record.brief);
  const taskId = text(input.record.task_id);
  const title = text(brief.title);
  if (!taskId || !title) return null;
  const targetAccount = object(brief.targetAccountRef);
  const count = Math.max(1, Math.floor(Number(brief.requestedOutputCount) || 1));
  const weeklyBudget = money(brief.weeklyBudgetCny);
  const perItemBudget = money(brief.perItemBudgetCny);
  const estimated = perItemBudget !== null && perItemBudget > 0
    ? perItemBudget
    : weeklyBudget !== null && weeklyBudget > 0
      ? Math.round((weeklyBudget / count) * 100) / 100
      : 12.5;
  const mode = text(input.record.task_mode);
  const weeklyPlanId = text(input.record.weekly_plan_id);
  const creationMode = text(brief.creationMode || input.record.legacy_creation_route);
  const relatedProjects = input.projects.filter(project => text(object(project.spec).socialContentTaskId) === taskId);
  const platforms = array<unknown>(brief.platforms);
  const platform = manualPlatform(platforms);
  const fallbackAccount = input.publishingTargets.find(target => target.platform === platform) || input.publishingTargets[0];
  const accountId = text(targetAccount.id) || fallbackAccount?.accountId || '';
  const productName = text(brief.productRef) || input.defaultProductName;
  const formats = array<unknown>(brief.formats).map(text).filter(Boolean);
  const languages = array<unknown>(brief.languages).map(text).filter(Boolean);
  const resolvedLanguages = languages.length ? languages : input.defaultLanguages.length ? input.defaultLanguages : ['en'];
  const plannedPublishDate = text(brief.dueAt) || input.defaultPublishDate;
  const missingInputs = [
    !productName ? '产品' : '',
    !accountId ? '发布账号' : '',
    !resolvedLanguages.length ? '输出语言' : '',
    !plannedPublishDate ? '交付时间' : '',
  ].filter(Boolean);
  const state = manualState(input.record, missingInputs);
  const planSource = text(brief.productRef) && text(targetAccount.id) && languages.length && text(brief.dueAt) ? 'confirmed' as const : 'system_default' as const;
  const estimatedMinutes = manualStepTemplates.reduce((sum, step) => sum + step.estimatedMinutes, 0);
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
    productName,
    platform,
    accountId,
    accountLabel: input.accountLabels.get(accountId) || fallbackAccount?.accountLabel || accountId,
    route: creationMode === 'viral_replication' || creationMode === 'clone' ? 'clone' : creationMode === 'material_processing' ? 'material' : 'product',
    languages: resolvedLanguages,
    plannedPublishDate,
    referenceId: '',
    referenceTitle: '',
    referenceViews: '',
    benchmarkAccount: '',
    matchScore: null,
    planningFactors: [
      mode === 'instant' ? '用户在内容创作中创建的单项任务' : weeklyPlanId ? '来自内容周计划' : '用户手动创建的内容任务',
      text(brief.objective) ? `目标：${text(brief.objective)}` : '',
      accountId ? `账号：${input.accountLabels.get(accountId) || fallbackAccount?.accountLabel || accountId}` : '尚未指定发布账号',
      planSource === 'system_default' ? '缺省字段已按企业重点产品、同平台账号和本周截止时间自动补齐，仍可在制作台调整' : '内容方案与交付时间已由用户确认',
    ].filter(Boolean),
    lineage: {
      goalId: text(object(brief.programRef).id),
      objective: text(brief.objective),
      accountId,
      accountLabel: input.accountLabels.get(accountId) || fallbackAccount?.accountLabel || accountId,
      budgetCny: estimated,
      planId: weeklyPlanId,
      planVersion: weeklyPlanId ? text(input.record.version) : '',
      factsVersion: '',
      cycleStart: text(input.record.created_at).slice(0, 10),
      cycleEnd: plannedPublishDate,
      authorizationMode: 'manual',
    },
    outputSummary: {
      count,
      durationSeconds: null,
      formats: formats.length ? formats : ['短视频'],
    },
    confidence: taskConfidence({
      status: state.status,
      productName,
      languages: resolvedLanguages,
      formats: formats.length ? formats : ['短视频'],
      projectCount: relatedProjects.length,
      accountId,
      accountConnected: input.accountLabels.has(accountId),
      publishDate: plannedPublishDate,
      authorizationMode: 'manual',
      objective: text(brief.objective),
      referenceTitle: '',
      referenceViews: '',
      benchmarkAccount: '',
      matchScore: null,
    }),
    contentPlan: {
      summary: creationMode === 'viral_replication' || creationMode === 'clone'
        ? `爆款结构复刻 · ${resolvedLanguages.join(' / ').toUpperCase()} · ${formats[0] || '短视频'}`
        : `产品内容制作 · ${resolvedLanguages.join(' / ').toUpperCase()} · ${formats[0] || '短视频'}`,
      source: planSource,
      deliverBy: plannedPublishDate,
      publishAt: plannedPublishDate,
      estimatedMinutes,
    },
    ...state,
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
  publishingTargets?: Array<{ platform?: PublishingPlatform; accountId: string; accountLabel: string }>;
  defaultProductName?: string;
  defaultLanguages?: string[];
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
  const orders = batch
    ? array<ContentOrder>(batch.orders)
    : productionPlans.filter(plan => plan.productionRole !== 'platform_adaptation').map(planOrder);
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
    const accountId = order.accountId || plan?.matrix?.accountId || '';
    const languages = [...new Set(relatedProjects.map(project => text(object(project.spec).lang)).filter(Boolean).concat(order.languages || plan?.language || []))];
    const authorizationMode = pack?.authorization.mode || 'each';
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
      accountId,
      accountLabel: order.accountLabel || '',
      route: order.route,
      languages,
      plannedPublishDate: plan?.plannedPublishDate || '',
      referenceId: plan?.referenceId || '',
      referenceTitle: evidence?.referenceTitle || '',
      referenceViews: evidence?.referenceViews || '',
      benchmarkAccount: evidence?.benchmarkAccount || '',
      matchScore: evidence ? evidence.matchScore : null,
      planningFactors: evidence?.factors || [],
      lineage: {
        goalId: order.goalId || input.goal?.id || '',
        objective: input.goal?.objective || '',
        accountId,
        accountLabel: order.accountLabel || accountLabels.get(accountId) || '',
        budgetCny: estimated && estimated > 0 ? estimated : null,
        planId: input.planId || '',
        planVersion: String(pack?.revision || input.goal?.version || ''),
        factsVersion: text(order.configurationSnapshot?.factsVersion),
        cycleStart: input.goal?.startsAt || '',
        cycleEnd: input.goal?.endsAt || '',
        authorizationMode,
      },
      outputSummary: {
        count: 1,
        durationSeconds: Number.isFinite(Number(plan?.duration)) && Number(plan?.duration) > 0 ? Number(plan?.duration) : null,
        formats: ['短视频'],
      },
      confidence: taskConfidence({
        status: state.status,
        productName: order.productName || plan?.productName || '',
        languages,
        formats: ['短视频'],
        projectCount: relatedProjects.length,
        accountId,
        accountConnected: accountLabels.has(accountId),
        publishDate: plan?.plannedPublishDate || '',
        authorizationMode,
        objective: input.goal?.objective || '',
        referenceTitle: evidence?.referenceTitle || '',
        referenceViews: evidence?.referenceViews || '',
        benchmarkAccount: evidence?.benchmarkAccount || '',
        matchScore: evidence ? evidence.matchScore : null,
      }),
      ...(plan?.preproduction ? { preproduction: plan.preproduction } : {}),
      ...state,
      ...costState(relatedProjects, executionResult.items, estimated && estimated > 0 ? estimated : null),
    };
  });
  const manualItems = manualTaskResult.items
    .map(record => manualTaskItem({
      record,
      projects: projectResult.items,
      executions: executionResult.items,
      accountLabels,
      publishingTargets: input.publishingTargets || [],
      defaultProductName: input.defaultProductName || productionPlans.find(plan => plan.productionRole !== 'platform_adaptation')?.productName || '',
      defaultPublishDate: input.goal?.endsAt || '',
      defaultLanguages: input.defaultLanguages || [],
    }))
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

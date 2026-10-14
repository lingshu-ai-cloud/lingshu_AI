import type {
  AssistantDecisionAction,
  AssistantDecisionActionId,
  AssistantDecisionCard,
  AssistantDecisionFeed,
  AssistantDecisionKind,
  AssistantDecisionPage,
} from '../../shared/contracts/assistantDecisionCenter.js';
import {
  buildTaskDeepLink,
  type DigitalEmployeeDeepLink,
  type WorkflowTask,
} from '../../src/lib/digitalEmployees.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { repairCollapsedWeeklyVideoProduction } from './weeklyPackage.js';
import type {
  ApprovalRecord,
  GoalRecord,
  PlanRecord,
  RunRecord,
  TaskRecord,
} from '../routes/digitalEmployeeRecords.js';
import { customerApprovalRequestHash } from './customerTaskApprovalNavigation.js';
import type { ManagedReplicationPresenterReadiness } from './replicationContentProduction.js';
import { taskNeedsAttention } from '../../src/lib/taskExecutionState.js';

type DecisionCenterSource = {
  page: AssistantDecisionPage;
  goal: GoalRecord | null;
  plan: PlanRecord | null;
  run: RunRecord | null;
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  now?: Date;
  limit?: number;
};

export type StarterDecisionSource = {
  id: string;
  type: string;
  title: string;
  summary: string;
  riskLevel: string;
  effect?: string | null;
  subjectVersion: string | null;
  dueAt?: string | null;
  actions: Array<{ command: string | null; disabledReason?: string | null }>;
};

const PRIMARY: AssistantDecisionAction['emphasis'] = 'primary';
const DEFAULT: AssistantDecisionAction['emphasis'] = 'default';

export class AssistantDecisionValidationError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AssistantDecisionValidationError';
  }
}

export function validateAssistantDecisionCommand(
  card: AssistantDecisionCard,
  actionId: AssistantDecisionActionId,
  expectedVersion: string,
  note = '',
): AssistantDecisionAction {
  if (card.subject.version !== expectedVersion) {
    throw new AssistantDecisionValidationError('assistant_decision_changed', 409, {
      currentVersion: card.subject.version,
    });
  }
  const action = card.actions.find(item => item.id === actionId);
  if (!action) throw new AssistantDecisionValidationError('assistant_decision_action_not_allowed', 400);
  if (action.requiresNote && !note.trim()) {
    throw new AssistantDecisionValidationError('assistant_decision_note_required', 400);
  }
  return action;
}

export type AssistantDecisionCommandHandlers = {
  approveAndStart(card: AssistantDecisionCard): Promise<void>;
  decideApproval(card: AssistantDecisionCard, decision: 'approved' | 'rejected', note: string): Promise<void>;
  retryTask(card: AssistantDecisionCard): Promise<void>;
  replanTask(card: AssistantDecisionCard): Promise<void>;
  takeOver(card: AssistantDecisionCard): Promise<void>;
  decideStarter(card: AssistantDecisionCard, decision: 'approved' | 'rejected', note: string): Promise<void>;
};

export async function executeAssistantDecisionCommand(input: {
  card: AssistantDecisionCard;
  actionId: AssistantDecisionActionId;
  expectedVersion: string;
  note?: string;
  handlers: AssistantDecisionCommandHandlers;
}): Promise<'completed' | 'navigation_required'> {
  const note = input.note?.trim() || '';
  const action = validateAssistantDecisionCommand(input.card, input.actionId, input.expectedVersion, note);
  if (action.mode === 'navigate') return 'navigation_required';
  if (input.card.id.startsWith('starter:') && ['approve', 'reject'].includes(input.actionId)) {
    await input.handlers.decideStarter(input.card, input.actionId === 'approve' ? 'approved' : 'rejected', note);
    return 'completed';
  }
  if (input.card.subject.type === 'weekly_plan' && input.actionId === 'approve_and_start') {
    await input.handlers.approveAndStart(input.card);
    return 'completed';
  }
  if (input.card.subject.type === 'approval_request' && ['approve', 'reject'].includes(input.actionId)) {
    await input.handlers.decideApproval(input.card, input.actionId === 'approve' ? 'approved' : 'rejected', note);
    return 'completed';
  }
  if (input.card.subject.type === 'workflow_task' && input.actionId === 'retry_task') {
    await input.handlers.retryTask(input.card);
    return 'completed';
  }
  if (input.card.subject.type === 'workflow_task' && input.actionId === 'replan_task') {
    await input.handlers.replanTask(input.card);
    return 'completed';
  }
  if ((input.card.subject.type === 'workflow_task' || input.card.subject.type === 'approval_request')
    && input.actionId === 'take_over') {
    await input.handlers.takeOver(input.card);
    return 'completed';
  }
  throw new AssistantDecisionValidationError('assistant_decision_action_not_allowed', 400);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function text(value: unknown, max = 300): string {
  return String(value ?? '').trim().slice(0, max);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function planBody(plan: PlanRecord | null): Record<string, unknown> {
  return plan ? parseJson<Record<string, unknown>>(plan.plan, {}) : {};
}

function packageForPlan(plan: PlanRecord | null): WeeklyPackage | null {
  const pack = planBody(plan).businessPackage;
  return pack && typeof pack === 'object' ? repairCollapsedWeeklyVideoProduction(pack as WeeklyPackage) : null;
}

export function weeklyPlanDecisionVersion(goal: GoalRecord, plan: PlanRecord): string {
  const pack = packageForPlan(plan);
  return `goal:${Number(goal.version || 1)}|plan:${text(plan.status)}|package:${Number(pack?.revision || 0)}`;
}

export function approvalDecisionVersion(approval: ApprovalRecord): string {
  return `subject:${text(approval.subject_version || 0)}|content:${text(approval.content_hash) || '-'}|request:${customerApprovalRequestHash({ ...approval })}`;
}

export function workflowTaskDecisionVersion(task: TaskRecord): string {
  return `task:${Number(task.task_version || 1)}|status:${text(task.status)}|updated:${text(task.updated_at) || '-'}`;
}

export function workflowTaskNeedsEnterprisePresenter(task: TaskRecord): boolean {
  const output = parseJson<Record<string, unknown>>(task.output, {});
  const assistantInput = parseJson<Record<string, unknown>>(output.assistantInput, {});
  const assistantCode = text(assistantInput.code, 100);
  if (assistantCode === 'presenter_ready') return false;
  if (['presenter_authorization_required', 'presenter_setup_required'].includes(assistantCode)) return true;
  const evidence = `${text(task.blocked_reason, 2_000)} ${JSON.stringify(output).slice(0, 12_000)}`;
  return /avatar_required|presenter_authorization_required|尚未录入可用企业数字人|请先添加(?:并授权)?企业数字人|缺少(?:已授权)?企业数字人/i.test(evidence);
}

type AssistantPresenterInputCode = 'avatar_required' | 'presenter_authorization_required'
  | 'presenter_setup_required' | 'presenter_ready';

function workflowTaskPresenterInput(task: TaskRecord): {
  code: AssistantPresenterInputCode | '';
  message: string;
  presenterId: string;
  presenterName: string;
} {
  const output = parseJson<Record<string, unknown>>(task.output, {});
  const assistantInput = parseJson<Record<string, unknown>>(output.assistantInput, {});
  const code = text(assistantInput.code, 100);
  return {
    code: ['avatar_required', 'presenter_authorization_required', 'presenter_setup_required', 'presenter_ready'].includes(code)
      ? code as AssistantPresenterInputCode
      : '',
    message: text(assistantInput.message, 500),
    presenterId: text(assistantInput.presenterId, 200),
    presenterName: text(assistantInput.presenterName, 100),
  };
}

type AssistantStudioProject = { id: string; spec?: unknown; status?: unknown };

function productionProjectIds(task: TaskRecord): Set<string> {
  const output = parseJson<Record<string, unknown>>(task.output, {});
  const refs = [
    ...parseJson<Array<Record<string, unknown>>>(task.business_refs, []),
    ...(Array.isArray(output.businessRefs) ? output.businessRefs as Array<Record<string, unknown>> : []),
  ];
  return new Set(refs
    .filter(ref => ref?.type === 'studio_project')
    .map(ref => text(ref.id || ref.entityId, 200))
    .filter(Boolean));
}

function projectNeedsEnterprisePresenter(project: AssistantStudioProject): boolean {
  const spec = parseJson<Record<string, unknown>>(project.spec, {});
  const automation = parseJson<Record<string, unknown>>(spec.automation, {});
  if (['completed', 'superseded', 'cancelled'].includes(text(automation.stage || automation.status).toLowerCase())) return false;
  const shots = Array.isArray(spec.automatedReplicationShots)
    ? spec.automatedReplicationShots as Array<Record<string, unknown>>
    : [];
  return shots.some(shot => {
    const evidence = `${text(shot.blockerCode, 200)} ${text(shot.blocker, 1_000)}`;
    return /avatar_required|presenter_authorization_required|企业数字人/i.test(evidence)
      || (text(shot.kind) === 'blocked' && text(shot.intendedKind) === 'person');
  });
}

/**
 * Adds a compact, safe assistant input marker from the current task's linked
 * production projects. The full project spec and provider telemetry never
 * enter the assistant feed, and the persisted workflow task is not mutated.
 */
export function taskWithAssistantProductionInput(
  task: TaskRecord,
  projects: AssistantStudioProject[],
  presenterReadiness: ManagedReplicationPresenterReadiness = {
    state: 'missing', presenterCount: 0, presenterId: '', presenterName: '',
  },
): TaskRecord {
  if (task.task_key !== 'content_production') return task;
  const referencedIds = productionProjectIds(task);
  const blockedProjectIds = projects
    .filter(project => referencedIds.has(project.id) && projectNeedsEnterprisePresenter(project))
    .map(project => project.id);
  if (!blockedProjectIds.length) return task;
  const output = parseJson<Record<string, unknown>>(task.output, {});
  const input = presenterReadiness.state === 'ready'
    ? { code: 'presenter_ready', message: '已检测到可用于当前逐镜制作的企业数字人', presenterId: presenterReadiness.presenterId, presenterName: presenterReadiness.presenterName }
    : presenterReadiness.state === 'production_setup_required'
      ? { code: 'presenter_setup_required', message: `${presenterReadiness.presenterName ? `${presenterReadiness.presenterName} 已添加，但` : '企业数字人已添加，但'}当前逐镜复刻还需要绑定人物参考图、人物替换授权和 Active 方舟图片资产`, presenterId: presenterReadiness.presenterId, presenterName: presenterReadiness.presenterName }
      : presenterReadiness.state === 'authorization_required'
        ? { code: 'presenter_authorization_required', message: '企业数字人已添加，但本人授权或企业使用授权尚未完成', presenterId: presenterReadiness.presenterId, presenterName: presenterReadiness.presenterName }
        : { code: 'avatar_required', message: '人物镜头缺少可用且已授权的企业数字人形象', presenterId: '', presenterName: '' };
  return {
    ...task,
    output: {
      ...output,
      assistantInput: {
        ...input,
        presenterCount: presenterReadiness.presenterCount,
        projectCount: blockedProjectIds.length,
      },
    },
  };
}

function presenterOnboardingDeepLink(task: TaskRecord, runId: string, presenterId = ''): DigitalEmployeeDeepLink {
  const existing = workflowDeepLink(task, runId);
  const { view: _view, studioPanel: _studioPanel, ...base } = existing;
  return {
    ...base,
    page: 'digitalEmployees',
    businessRef: { ...existing.businessRef, taskKey: 'presenter_setup_required', ...(presenterId ? { entityId: presenterId } : {}) },
  };
}

function workflowDeepLink(task: TaskRecord, runId: string) {
  return buildTaskDeepLink({
    ...task,
    depends_on: parseJson(task.depends_on, []),
    output: parseJson(task.output, {}),
    business_refs: parseJson(task.business_refs, []),
  } as WorkflowTask, undefined, runId);
}

function planFacts(goal: GoalRecord, plan: PlanRecord): AssistantDecisionCard['facts'] {
  const pack = packageForPlan(plan);
  const context = pack?.operatingContext;
  const facts: AssistantDecisionCard['facts'] = [
    { label: '计划周期', value: `${text(goal.starts_at)} 至 ${text(goal.ends_at)}` },
    { label: '本周目标', value: text(goal.objective || goal.title) || '待确认' },
  ];
  if (context?.outputs?.count) facts.push({ label: '预计产出', value: `${context.outputs.count} 条内容`, tone: 'info' });
  if (context?.accounts?.length) facts.push({ label: '运营账号', value: `${context.accounts.length} 个账号` });
  if (Number.isFinite(context?.budget?.totalCny)) facts.push({ label: '预计成本', value: `¥${Number(context?.budget?.totalCny || 0).toFixed(2)}` });
  if (context?.authorization) {
    facts.push({
      label: '对外授权',
      value: context.authorization.mode === 'bounded' ? '按本周授权边界执行' : '每次对外动作需审批',
      tone: 'warning',
    });
  }
  return facts.slice(0, 6);
}

function planCard(goal: GoalRecord, plan: PlanRecord, now: string): AssistantDecisionCard | null {
  if (goal.status !== 'draft' || !['draft', 'pending_approval'].includes(String(plan.status))) return null;
  const pack = packageForPlan(plan);
  const adjusted = String(plan.status) === 'pending_approval' || Number(pack?.revision || 0) > 0;
  return {
    id: `plan:${goal.id}`,
    kind: adjusted ? 'plan_adjustment' : 'plan_start',
    priority: adjusted ? 1100 : 1000,
    status: 'pending',
    title: adjusted ? '确认调整后的本周计划' : '确认本周计划并开始工作',
    summary: adjusted
      ? '计划内容已经调整；确认后数字员工将按当前版本开始工作。'
      : '确认目标、产出与授权边界后即可开始本周工作。',
    facts: planFacts(goal, plan),
    subject: { type: 'weekly_plan', id: goal.id, version: weeklyPlanDecisionVersion(goal, plan) },
    actions: [
      { id: 'approve_and_start', label: '批准并开始', mode: 'command', emphasis: PRIMARY },
      { id: 'adjust_plan', label: '调整计划', mode: 'navigate', emphasis: DEFAULT },
      { id: 'open_workspace', label: '查看完整计划', mode: 'navigate', emphasis: DEFAULT },
    ],
    deepLink: { page: 'digitalEmployees', businessRef: { goalId: goal.id, planId: plan.id } },
    createdAt: text(goal.updated_at || goal.created_at) || now,
  };
}

function approvalSummaryFacts(approval: ApprovalRecord, task: TaskRecord): AssistantDecisionCard['facts'] {
  const evidence = parseJson<unknown>(approval.evidence, []);
  const records = Array.isArray(evidence) ? evidence : evidence && typeof evidence === 'object' ? [evidence] : [];
  const packageEvidence = records.find(item => item && typeof item === 'object'
    && ['publishing_approval_package', 'followup_batch'].includes(text((item as Record<string, unknown>).type))) as Record<string, unknown> | undefined;
  const items = Array.isArray(packageEvidence?.items) ? packageEvidence.items as Array<Record<string, unknown>> : [];
  const platforms = unique(items.map(item => text(item.platform)));
  const accountIds = unique(items.flatMap(item => Array.isArray(item.accountIds) ? item.accountIds.map(value => text(value)) : []));
  const facts: AssistantDecisionCard['facts'] = [
    { label: '操作', value: text(approval.action_summary || task.title) || '待审批操作' },
    { label: '风险级别', value: text(approval.risk_level) || '需人工确认', tone: 'warning' },
  ];
  if (items.length) facts.push({ label: '影响对象', value: `${items.length} 项` });
  if (platforms.length) facts.push({ label: '平台', value: platforms.join('、') });
  if (accountIds.length) facts.push({ label: '账号', value: `${accountIds.length} 个账号` });
  if (task.external_effect && task.external_effect !== 'none') {
    const labels: Record<string, string> = { draft: '生成草稿', schedule: '写入排期', publish: '真实发布', send: '真实发送' };
    facts.push({ label: '外部影响', value: labels[task.external_effect] || task.external_effect, tone: 'warning' });
  }
  return facts.slice(0, 6);
}

function approvalKind(approval: ApprovalRecord, task: TaskRecord): AssistantDecisionKind {
  const combined = `${task.task_key} ${task.external_effect || ''} ${approval.action_summary || ''}`.toLowerCase();
  return /(publish|send|followup|commercial|报价|承诺|发布|发送)/.test(combined)
    ? 'external_approval'
    : 'content_approval';
}

function approvalCard(approval: ApprovalRecord, task: TaskRecord, run: RunRecord, now: string): AssistantDecisionCard {
  const kind = approvalKind(approval, task);
  return {
    id: `approval:${approval.id}`,
    kind,
    priority: kind === 'external_approval' ? 900 : 800,
    status: 'pending',
    title: text(approval.action_summary || task.title) || '需要你审批',
    summary: kind === 'external_approval'
      ? '该操作会产生真实对外影响，请确认后继续。'
      : '内容已准备好，请确认是否继续。',
    facts: approvalSummaryFacts(approval, task),
    subject: { type: 'approval_request', id: approval.id, version: approvalDecisionVersion(approval) },
    actions: [
      { id: 'approve', label: '批准并继续', mode: 'command', emphasis: PRIMARY },
      { id: 'reject', label: '退回修改', mode: 'command', emphasis: DEFAULT, requiresNote: true },
      { id: 'open_workspace', label: '查看详情', mode: 'navigate', emphasis: DEFAULT },
    ],
    deepLink: workflowDeepLink(task, run.id),
    createdAt: text(approval.created_at) || now,
  };
}

function attentionCard(task: TaskRecord, run: RunRecord, now: string): AssistantDecisionCard {
  const failed = task.status === 'failed';
  const output = parseJson<Record<string, unknown>>(task.output, {});
  const inventory = parseJson<Record<string, unknown>>(output.inventoryPreflight, {});
  const sourceCollection = task.task_key === 'scheduled_source_collection';
  const viralAnalysis = task.task_key === 'viral_analysis';
  const proof = parseJson<Record<string, unknown>>(output.proof, {});
  const completedAnalyses = Math.max(0, Number(proof.value || 0));
  const requiredAnalyses = Math.max(0, Number(proof.requiredValue || 0));
  const inventorySummary = text(output.inventorySummary, 500);
  const sourceCollectionSummary = sourceCollection
    ? `${inventorySummary || '系统已先检查现有爆款库。'}${failed ? ` 本次缺口采集没有完成：${text(task.blocked_reason) || '采集步骤执行失败'}。` : ''} 你可以从当前节点重试，或重新规划本周任务；已经完成的结果会保留。`
    : '';
  const presenterInput = workflowTaskPresenterInput(task);
  const presenterRequired = workflowTaskNeedsEnterprisePresenter(task);
  const presenterReady = presenterInput.code === 'presenter_ready';
  const presenterSetupRequired = presenterInput.code === 'presenter_setup_required';
  const presenterAuthorizationRequired = presenterInput.code === 'presenter_authorization_required';
  const presenterTitle = presenterReady
    ? '数字人已就绪，请继续生产'
    : presenterSetupRequired
      ? '请补齐数字人的制作条件'
      : presenterAuthorizationRequired
        ? '请完成数字人授权'
        : '请添加企业数字人形象';
  const presenterSummary = presenterReady
    ? `${presenterInput.presenterName ? `${presenterInput.presenterName} 已就绪。` : '企业数字人已就绪。'}旧任务仍停在数字人节点；继续生产后会复用已完成镜头和回执。`
    : presenterInput.message || '人物镜头已停在数字人生成前；其他已完成镜头和生产回执会保留。补齐后可从当前节点继续。';
  const viralAnalysisSummary = `${text(task.blocked_reason) || `视频分析尚未完成：当前 ${completedAnalyses}/${requiredAnalyses || '—'} 条已通过。`} 系统只会在真实视频级分析通过后进入内容生产，不会把“已排队”当作“已完成”。`;
  const retryableBlockedTask = failed || ['blocked', 'waiting_external'].includes(task.status);
  return {
    id: `task:${task.id}`,
    kind: presenterReady ? 'next_step' : 'input_required',
    priority: presenterReady ? 550 : failed ? 650 : 600,
    status: 'pending',
    title: presenterRequired || presenterReady ? presenterTitle : text(task.title) || '需要你处理',
    summary: presenterRequired || presenterReady
      ? presenterSummary
      : viralAnalysis ? viralAnalysisSummary
        : sourceCollectionSummary || text(task.blocked_reason) || (failed ? '任务失败，需要你选择处理方式。' : '任务正在等待必要资料或人工决定。'),
    facts: [
      { label: '当前状态', value: presenterReady ? '数字人已就绪' : presenterSetupRequired ? '待补制作条件' : presenterAuthorizationRequired ? '待完成授权' : presenterRequired ? '待补充数字人' : viralAnalysis ? failed ? '分析失败' : '分析未完成' : failed ? '失败' : '等待用户', tone: presenterReady ? 'info' : presenterRequired || viralAnalysis && !failed ? 'warning' : failed ? 'danger' : 'warning' },
      ...(viralAnalysis && requiredAnalyses > 0 ? [{ label: '分析进度', value: `${completedAnalyses}/${requiredAnalyses} 条通过`, tone: completedAnalyses >= requiredAnalyses ? 'info' as const : 'warning' as const }] : []),
      ...(sourceCollection && Number(inventory.requiredCount || 0) > 0 ? [{ label: '爆款库存', value: `可用 ${Number(inventory.reusableCount || 0)}/${Number(inventory.requiredCount || 0)} 条${Number(inventory.missingCount || 0) ? `，缺 ${Number(inventory.missingCount)} 条` : ''}`, tone: Number(inventory.missingCount || 0) ? 'warning' as const : 'info' as const }] : []),
      ...(task.destination ? [{ label: '处理位置', value: text(task.destination) }] : []),
    ],
    subject: { type: 'workflow_task', id: task.id, version: presenterInput.code
      ? `${workflowTaskDecisionVersion(task)}|presenter:${presenterInput.code}`
      : workflowTaskDecisionVersion(task) },
    actions: presenterReady ? [
      { id: 'open_workspace', label: '查看并继续生产', mode: 'navigate', emphasis: PRIMARY },
    ] : presenterRequired ? [
      { id: 'open_workspace', label: presenterSetupRequired ? '补齐制作条件' : presenterAuthorizationRequired ? '完成数字人授权' : '添加数字人形象', mode: 'navigate', emphasis: PRIMARY },
    ] : viralAnalysis ? [
      ...(failed ? [{ id: 'retry_task', label: '重试失败分析', mode: 'command', emphasis: PRIMARY } as const] : []),
      { id: 'open_workspace', label: '查看分析进度', mode: 'navigate', emphasis: failed ? DEFAULT : PRIMARY } as const,
    ] : [
      ...(!['handed_off', 'cancelled', 'succeeded', 'skipped'].includes(task.status) && sourceCollection
        ? [
          { id: 'retry_task', label: '从当前节点重试', mode: 'command', emphasis: PRIMARY } as const,
          { id: 'replan_task', label: '重新规划本周任务', mode: 'command', emphasis: DEFAULT } as const,
        ]
        : retryableBlockedTask
          ? [{ id: 'retry_task', label: '重试当前节点', mode: 'command', emphasis: PRIMARY } as const]
          : []),
      { id: 'open_workspace', label: '前往处理', mode: 'navigate', emphasis: sourceCollection || retryableBlockedTask ? DEFAULT : PRIMARY },
    ],
    deepLink: presenterRequired ? presenterOnboardingDeepLink(task, run.id, presenterInput.presenterId) : workflowDeepLink(task, run.id),
    createdAt: text(task.updated_at || task.created_at) || now,
  };
}

function nextStepCard(task: TaskRecord, run: RunRecord, now: string): AssistantDecisionCard {
  const deepLink = workflowDeepLink(task, run.id);
  const running = task.status === 'running';
  return {
    id: `next:${task.id}`,
    kind: 'next_step',
    priority: 500,
    status: 'pending',
    title: text(task.title) || '继续当前工作',
    summary: running
      ? '任务正在执行；完成真实结果核验前不会进入下一生产节点。'
      : '任务已排队，系统正在核验上游数据；完成真实结果核验前不会进入下一生产节点。',
    facts: [{ label: '状态', value: running ? '正在进行' : '已排队', tone: 'info' }],
    subject: { type: 'workflow_task', id: task.id, version: workflowTaskDecisionVersion(task) },
    actions: [{ id: 'open_workspace', label: '查看真实进度', mode: 'navigate', emphasis: PRIMARY }],
    deepLink,
    createdAt: text(task.updated_at || task.created_at) || now,
  };
}

function pageMatches(deepLink: DigitalEmployeeDeepLink | undefined, page: AssistantDecisionPage): boolean {
  if (page === 'home' || page === 'digitalEmployees') return true;
  if (page === 'publishing') return deepLink?.view === 'publish';
  return deepLink?.page === page;
}

/**
 * Builds the assistant's deliberately small decision queue. It consumes
 * persisted domain state only and never accepts run events, logs or browser
 * traces, making accidental execution-history leakage structurally impossible.
 */
export function buildAssistantDecisionFeed(source: DecisionCenterSource): AssistantDecisionFeed {
  const now = (source.now || new Date()).toISOString();
  const cards: AssistantDecisionCard[] = [];
  if (source.goal && source.plan) {
    const card = planCard(source.goal, source.plan, now);
    if (card) cards.push(card);
  }

  const taskById = new Map(source.tasks.map(task => [task.id, task]));
  if (source.run) {
    source.approvals
      .filter(approval => approval.status === 'pending')
      .forEach(approval => {
        const task = taskById.get(approval.task_id);
        if (task) cards.push(approvalCard(approval, task, source.run!, now));
      });

    const pendingApprovalTaskIds = new Set(source.approvals.filter(item => item.status === 'pending').map(item => item.task_id));
    source.tasks
      .filter(task => ['waiting_external', 'waiting_human', 'failed'].includes(task.status)
        && !pendingApprovalTaskIds.has(task.id)
        && taskNeedsAttention({
          status: task.status,
          blocked_reason: task.blocked_reason,
          output: parseJson<Record<string, unknown>>(task.output, {}),
        }))
      .forEach(task => cards.push(attentionCard(task, source.run!, now)));

    if (!cards.some(card => card.priority >= 600)) {
      const completedTaskKeys = new Set(source.tasks
        .filter(task => ['succeeded', 'skipped'].includes(task.status))
        .map(task => task.task_key));
      const next = source.tasks.find(task => (task.status === 'running'
        || task.status === 'pending' && parseJson<string[]>(task.depends_on, []).every(key => completedTaskKeys.has(key)))
        && pageMatches(workflowDeepLink(task, source.run!.id), source.page));
      if (next) cards.push(nextStepCard(next, source.run, now));
    }
  }

  const sorted = cards
    .sort((left, right) => right.priority - left.priority || right.createdAt.localeCompare(left.createdAt));
  const total = sorted.length;
  return {
    items: sorted.slice(0, Math.max(1, Math.min(100, source.limit || 3))),
    total,
    generatedAt: now,
    page: source.page,
  };
}

export function starterDecisionCards(
  decisions: StarterDecisionSource[],
  now = new Date().toISOString(),
): AssistantDecisionCard[] {
  return decisions
    .filter(decision => Boolean(decision.subjectVersion)
      && decision.actions.some(action => action.command === 'resolve_decision' && !action.disabledReason))
    .map(decision => {
      const quotation = decision.type === 'quotation' || decision.id.startsWith('quote:');
      return {
        id: `starter:${decision.id}`,
        kind: quotation ? 'external_approval' : 'content_approval',
        priority: quotation ? 900 : 800,
        status: 'pending',
        title: text(decision.title) || '需要你审批',
        summary: text(decision.summary) || '请确认后继续。',
        facts: [
          { label: '风险级别', value: text(decision.riskLevel) || '需人工确认', tone: 'warning' },
          ...(decision.effect ? [{ label: '操作影响', value: text(decision.effect), tone: 'warning' as const }] : []),
        ],
        subject: { type: 'approval_request', id: decision.id, version: String(decision.subjectVersion) },
        actions: [
          { id: 'approve', label: '批准并继续', mode: 'command', emphasis: PRIMARY },
          { id: 'reject', label: '退回修改', mode: 'command', emphasis: DEFAULT, requiresNote: true },
          { id: 'open_workspace', label: '查看详情', mode: 'navigate', emphasis: DEFAULT },
        ],
        deepLink: { page: quotation ? 'conversion' : 'smartAssets', ...(quotation ? {} : { view: 'publish' as const }) },
        createdAt: text(decision.dueAt) || now,
      } satisfies AssistantDecisionCard;
    });
}

export function mergeAssistantDecisionFeeds(
  base: AssistantDecisionFeed,
  extraCards: AssistantDecisionCard[],
  limit = 3,
): AssistantDecisionFeed {
  const cards = [...base.items, ...extraCards]
    .sort((left, right) => right.priority - left.priority || right.createdAt.localeCompare(left.createdAt));
  return { ...base, items: cards.slice(0, Math.max(1, Math.min(100, limit))), total: base.total + extraCards.length };
}

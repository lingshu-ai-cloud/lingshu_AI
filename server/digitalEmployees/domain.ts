export type AutonomyMode = 'suggest' | 'collaborate' | 'managed' | 'automatic';
export type WeeklyGoalStatus = 'draft' | 'pending_approval' | 'active' | 'paused' | 'completed' | 'cancelled';
export type WorkflowTaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'handed_off'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'cancelled';
export type ApprovalDecision = 'approved' | 'approved_with_changes' | 'rejected' | 'handoff';
export type DigitalEmployeeAction = 'configure' | 'approve_goal' | 'control_run' | 'decide_approval' | 'handoff' | 'return_handoff';

export const GOAL_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['pending_approval', 'active', 'cancelled'], pending_approval: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'], paused: ['active', 'completed', 'cancelled'], completed: [], cancelled: [],
};
export const RUN_TRANSITIONS: Record<string, readonly string[]> = {
  queued: ['planning', 'running', 'paused', 'cancelled'], planning: ['running', 'paused', 'failed', 'cancelled'],
  running: ['waiting_approval', 'waiting_human', 'paused', 'succeeded', 'failed', 'cancelled'],
  waiting_approval: ['running', 'waiting_human', 'paused', 'failed', 'cancelled'],
  waiting_human: ['running', 'waiting_approval', 'paused', 'failed', 'cancelled'],
  paused: ['running', 'waiting_approval', 'waiting_human', 'cancelled'], succeeded: [], failed: ['running', 'cancelled'], cancelled: [],
};
export const TASK_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['running', 'waiting_approval', 'handed_off', 'failed', 'cancelled'],
  running: ['pending', 'waiting_approval', 'handed_off', 'succeeded', 'failed', 'cancelled'],
  waiting_approval: ['pending', 'handed_off', 'succeeded', 'failed', 'cancelled'],
  handed_off: ['pending', 'waiting_approval', 'succeeded', 'failed', 'cancelled'],
  succeeded: [], skipped: [], failed: ['pending', 'skipped', 'cancelled'], cancelled: [],
};

export function canTransition(map: Record<string, readonly string[]>, from: string, to: string): boolean {
  return from === to || Boolean(map[from]?.includes(to));
}

export function parseApprovalDecision(value: unknown): ApprovalDecision | null {
  return typeof value === 'string' && ['approved', 'approved_with_changes', 'rejected', 'handoff'].includes(value)
    ? value as ApprovalDecision : null;
}

export function canPerformDigitalEmployeeAction(input: {
  action: DigitalEmployeeAction; userId: string; ownerId?: string; supportAccess?: boolean;
}): boolean {
  if (input.supportAccess) return false;
  if (['decide_approval', 'return_handoff'].includes(input.action)) return Boolean(input.ownerId && input.ownerId === input.userId);
  return Boolean(input.userId);
}

export interface DigitalEmployeeConfig {
  companyName: string;
  industry: string;
  primaryBusiness: string;
  targetMarkets: string;
  customerProfile: string;
  autonomyMode: AutonomyMode;
  weeklyBudget: number;
  approvalOwner: string;
  constraints: string[];
  team: string[];
}

export interface WeeklyGoalInput {
  title: string;
  objective: string;
  metric: string;
  baseline: number;
  target: number;
  unit: string;
  startsAt: string;
  endsAt: string;
  scope: string;
  budgetLimit: number;
  constraints: string[];
}

export interface PlannedTask {
  key: string;
  title: string;
  description: string;
  agentRole: 'knowledge' | 'planner' | 'content' | 'risk' | 'channel' | 'review';
  kind: 'analysis' | 'planning' | 'production' | 'approval' | 'activation' | 'review';
  sequence: number;
  priority: 'high' | 'medium';
  requiresApproval: boolean;
  dependsOn: string[];
  expectedMinutes: number;
}

export interface WeeklyPlanDraft {
  strategy: string;
  successCriteria: string[];
  estimatedCost: number;
  estimatedMinutes: number;
  qualityGates: string[];
  riskSummary: string;
  tasks: PlannedTask[];
}

const text = (value: unknown, max = 500): string => String(value ?? '').trim().slice(0, max);
const number = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function normalizeDigitalEmployeeConfig(input: Partial<DigitalEmployeeConfig>): DigitalEmployeeConfig {
  const autonomyMode: AutonomyMode = ['suggest', 'collaborate', 'managed', 'automatic'].includes(String(input.autonomyMode))
    ? input.autonomyMode as AutonomyMode
    : 'managed';
  const team = Array.isArray(input.team) ? input.team.map(item => text(item, 80)).filter(Boolean) : [];
  const constraints = Array.isArray(input.constraints)
    ? input.constraints.map(item => text(item, 240)).filter(Boolean).slice(0, 20)
    : [];
  return {
    companyName: text(input.companyName, 120),
    industry: text(input.industry, 120),
    primaryBusiness: text(input.primaryBusiness, 500),
    targetMarkets: text(input.targetMarkets, 300),
    customerProfile: text(input.customerProfile, 500),
    autonomyMode,
    weeklyBudget: Math.max(0, number(input.weeklyBudget)),
    approvalOwner: text(input.approvalOwner, 120),
    constraints,
    team: team.length ? team : ['planner', 'knowledge', 'content', 'risk', 'review'],
  };
}

export function validateDigitalEmployeeConfig(config: DigitalEmployeeConfig): string[] {
  const missing: string[] = [];
  if (!config.companyName) missing.push('企业名称');
  if (!config.industry) missing.push('行业');
  if (!config.primaryBusiness) missing.push('主要业务');
  if (!config.targetMarkets) missing.push('目标市场');
  if (!config.customerProfile) missing.push('核心客户');
  if (!config.approvalOwner) missing.push('审批负责人');
  return missing;
}

export function normalizeWeeklyGoal(input: Partial<WeeklyGoalInput>, config: DigitalEmployeeConfig): WeeklyGoalInput {
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const baseline = Math.max(0, number(input.baseline));
  const target = Math.max(baseline + 1, number(input.target, baseline + 5));
  return {
    title: text(input.title, 160) || `${config.companyName} 本周增长目标`,
    objective: text(input.objective, 1000),
    metric: text(input.metric, 120) || 'approved_content_packages',
    baseline,
    target,
    unit: text(input.unit, 40) || '项',
    startsAt: text(input.startsAt, 40) || now.toISOString().slice(0, 10),
    endsAt: text(input.endsAt, 40) || weekEnd.toISOString().slice(0, 10),
    scope: text(input.scope, 600) || config.targetMarkets,
    budgetLimit: Math.max(0, number(input.budgetLimit, config.weeklyBudget)),
    constraints: Array.isArray(input.constraints)
      ? input.constraints.map(item => text(item, 240)).filter(Boolean).slice(0, 20)
      : [...config.constraints],
  };
}

export function validateWeeklyGoal(goal: WeeklyGoalInput): string[] {
  const missing: string[] = [];
  if (!goal.title) missing.push('目标名称');
  if (!goal.objective) missing.push('目标说明');
  if (!goal.metric) missing.push('指标');
  if (!goal.scope) missing.push('业务范围');
  if (!goal.startsAt || !goal.endsAt) missing.push('目标周期');
  if (goal.target <= goal.baseline) missing.push('目标值必须高于基线');
  return missing;
}

export function buildWeeklyPlan(goal: WeeklyGoalInput, config: DigitalEmployeeConfig, contract?: {
  intent?: { focusProducts?: string[]; audience?: string; market?: string };
  qualityGates?: string[]; completionCriteria?: string[]; assumptions?: string[];
}): WeeklyPlanDraft {
  const focus = contract?.intent?.focusProducts?.join('、') || config.primaryBusiness;
  const audience = contract?.intent?.audience || config.customerProfile;
  const market = contract?.intent?.market || goal.scope;
  const tasks: PlannedTask[] = [
    {
      key: 'context_readiness',
      title: '核对企业事实与行动边界',
      description: `知识 Agent 读取 ${config.companyName} 的企业配置、目标市场和本周限制，形成可引用的执行上下文。`,
      agentRole: 'knowledge', kind: 'analysis', sequence: 1, priority: 'high', requiresApproval: false, dependsOn: [], expectedMinutes: 3,
    },
    {
      key: 'goal_decomposition',
      title: '拆解本周目标与成功标准',
      description: `计划 Agent 将“${goal.objective}”拆为可执行任务，并绑定指标 ${goal.metric}。`,
      agentRole: 'planner', kind: 'planning', sequence: 2, priority: 'high', requiresApproval: false, dependsOn: ['context_readiness'], expectedMinutes: 4,
    },
    {
      key: 'content_execution_pack',
      title: '生成首轮内容执行包',
      description: `内容 Agent 围绕 ${focus}，面向 ${market} 的 ${audience} 生成主题、证据要求、渠道建议和本周执行清单。`,
      agentRole: 'content', kind: 'production', sequence: 3, priority: 'high', requiresApproval: false, dependsOn: ['goal_decomposition'], expectedMinutes: 6,
    },
    {
      key: 'brand_risk_approval',
      title: '品牌与对外动作审批',
      description: '风险 Agent 汇总事实依据、承诺边界和对外发布风险，等待负责人批准、修改或接管。',
      agentRole: 'risk', kind: 'approval', sequence: 4, priority: 'high', requiresApproval: true, dependsOn: ['content_execution_pack'], expectedMinutes: 5,
    },
    {
      key: 'schedule_activation',
      title: '激活已批准的执行清单',
      description: '渠道 Agent 仅把已批准内容登记到执行清单；未连接真实渠道时不会模拟发布成功。',
      agentRole: 'channel', kind: 'activation', sequence: 5, priority: 'medium', requiresApproval: false, dependsOn: ['brand_risk_approval'], expectedMinutes: 2,
    },
    {
      key: 'weekly_review',
      title: '生成周复盘与下周建议',
      description: '复盘 Agent 汇总完成度、自动化率、审批与接管情况，并生成下一周目标建议。',
      agentRole: 'review', kind: 'review', sequence: 6, priority: 'medium', requiresApproval: false, dependsOn: ['schedule_activation'], expectedMinutes: 3,
    },
  ];
  const estimatedMinutes = tasks.reduce((sum, task) => sum + task.expectedMinutes, 0);
  return {
    strategy: `围绕“${goal.objective}”，先校验企业事实，再形成可审批的首轮执行包；所有对外动作受 ${config.autonomyMode} 自主模式约束。`,
    successCriteria: contract?.completionCriteria?.length ? contract.completionCriteria : [
      `${goal.metric} 从 ${goal.baseline} 提升到 ${goal.target} ${goal.unit}`,
      '每项执行建议都能追溯到目标、企业事实或明确约束',
      '对外发布、商业承诺和预算扩容均经过人工审批',
    ],
    estimatedCost: Math.min(goal.budgetLimit, Math.max(0, Math.round(estimatedMinutes * 0.6 * 100) / 100)),
    estimatedMinutes,
    qualityGates: contract?.qualityGates?.length ? contract.qualityGates : ['企业事实完整性', '目标与任务一致性', '品牌与风险审批', '执行结果可追溯'],
    riskSummary: goal.budgetLimit > config.weeklyBudget
      ? '本周目标预算高于首次配置预算，执行前必须重新确认。'
      : '执行包生成属于低风险内部动作；任何对外发布仍需负责人批准。',
    tasks,
  };
}

export function buildTaskOutput(
  taskKey: string,
  goal: WeeklyGoalInput,
  config: DigitalEmployeeConfig,
): Record<string, unknown> {
  if (taskKey === 'context_readiness') {
    return {
      company: config.companyName,
      industry: config.industry,
      business: config.primaryBusiness,
      targetMarkets: config.targetMarkets,
      customerProfile: config.customerProfile,
      constraints: config.constraints,
      evidenceStatus: 'confirmed_configuration',
    };
  }
  if (taskKey === 'goal_decomposition') {
    return {
      objective: goal.objective,
      successMetric: goal.metric,
      baseline: goal.baseline,
      target: goal.target,
      unit: goal.unit,
      scope: goal.scope,
      checkpoints: ['完成企业事实校验', '形成执行包', '完成品牌审批', '登记执行结果'],
    };
  }
  if (taskKey === 'content_execution_pack') {
    const market = goal.scope || config.targetMarkets;
    return {
      packageType: 'content_growth_v1',
      audience: config.customerProfile,
      market,
      themes: [
        { title: '问题—方案', purpose: '用客户问题引出核心价值', evidence: '仅引用已确认的产品与企业事实' },
        { title: '能力—证明', purpose: '展示交付能力与可信证据', evidence: '资质、案例或可验证过程' },
        { title: '场景—行动', purpose: '把目标市场场景连接到下一步行动', evidence: '禁止未确认价格、交期和效果承诺' },
      ],
      channels: ['LinkedIn', 'Instagram', 'TikTok'],
      approvalRequired: true,
    };
  }
  if (taskKey === 'schedule_activation') {
    return {
      activation: 'approved_execution_list',
      externalPublishPerformed: false,
      reason: 'MVP 只登记已批准执行清单；真实渠道发布必须由已连接的业务 Worker 完成并回写结果。',
    };
  }
  return { status: 'completed', summary: '任务已完成并写入真实运行记录。' };
}

export interface ReviewInput {
  goal: WeeklyGoalInput;
  totalTasks: number;
  completedTasks: number;
  approvalCount: number;
  handoffCount: number;
  failedTasks: number;
}

export function buildWeeklyReview(input: ReviewInput): Record<string, unknown> {
  const completionRate = input.totalTasks ? Math.round((input.completedTasks / input.totalTasks) * 100) : 0;
  const automaticTasks = Math.max(0, input.completedTasks - input.approvalCount);
  const automationRate = input.completedTasks ? Math.round((automaticTasks / input.completedTasks) * 100) : 0;
  return {
    completionRate,
    automationRate,
    approvalRate: input.totalTasks ? Math.round((input.approvalCount / input.totalTasks) * 100) : 0,
    handoffRate: input.totalTasks ? Math.round((input.handoffCount / input.totalTasks) * 100) : 0,
    completedTasks: input.completedTasks,
    totalTasks: input.totalTasks,
    failedTasks: input.failedTasks,
    highlights: input.failedTasks
      ? ['已形成完整运行证据链', '存在失败节点，需要在下周计划中优先修复']
      : ['周目标已形成可追溯任务链', '审批边界得到执行', '生产现场事件完整记录'],
    nextGoalSuggestion: `延续“${input.goal.objective}”，基于本周已批准执行包接入真实渠道结果，并用 ${input.goal.metric} 校准下一周目标。`,
    knowledgeCandidates: ['本周有效的内容主题', '审批人修改意见', '应继续保留的风险边界'],
  };
}

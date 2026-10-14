import type { AgentCalendarTask } from './AgentWeeklyCalendar';

export type AgentCalendarSummaryGroup =
  | 'foundation'
  | 'directing'
  | 'production'
  | 'quality'
  | 'publishing'
  | 'inquiries'
  | 'review';

export type AgentCalendarSummary = {
  key: `${string}:${AgentCalendarSummaryGroup}`;
  group: AgentCalendarSummaryGroup;
  date: string;
  title: string;
  progress: string;
  startTime: string;
  durationMinutes: number;
  children: AgentCalendarTask[];
};

const GROUP_META: Record<AgentCalendarSummaryGroup, { title: string; cadence: 'monday' | 'daily' | 'sunday'; startTime: string; durationMinutes: number }> = {
  foundation: { title: '经营目标与执行准备', cadence: 'monday', startTime: '08:00', durationMinutes: 30 },
  directing: { title: '每日增量采集与编导', cadence: 'daily', startTime: '08:30', durationMinutes: 75 },
  production: { title: '影片生产', cadence: 'daily', startTime: '10:15', durationMinutes: 45 },
  quality: { title: '成片质检与验收', cadence: 'daily', startTime: '11:15', durationMinutes: 30 },
  publishing: { title: '发布与平台分发', cadence: 'daily', startTime: '17:30', durationMinutes: 30 },
  inquiries: { title: '询盘反馈与数据回收', cadence: 'daily', startTime: '18:15', durationMinutes: 45 },
  review: { title: '数据追踪与周复盘', cadence: 'sunday', startTime: '16:00', durationMinutes: 60 },
};

const STEP_GROUP: Record<string, AgentCalendarSummaryGroup> = {
  business_outline: 'foundation',
  benchmark_collection: 'directing', benchmark_scoring: 'directing', director_analysis: 'directing', business_schedule: 'directing',
  material_preparation: 'production', material_readiness: 'production', script: 'production', storyboard: 'production',
  asset_generation: 'production', video_generation: 'production', rework: 'production',
  quality_check: 'quality', user_approval: 'quality',
  publishing: 'publishing',
  customer_channel_readiness: 'inquiries', customer_inquiry_handoff: 'inquiries',
  performance_monitoring: 'review', weekly_review: 'review', template_extraction: 'review', template_performance_validation: 'review',
};

const SUMMARY_ID_GROUP: Record<string, AgentCalendarSummaryGroup> = {
  goal: 'foundation', configuration: 'foundation', accounts: 'foundation', knowledge: 'foundation',
  director: 'directing', production: 'production', publishing: 'publishing', review: 'review',
};

function summaryId(task: AgentCalendarTask): string {
  return task.id.match(/goal-[^-]+-(goal|configuration|accounts|knowledge|director|production|publishing|review)$/)?.[1] || '';
}

export function agentCalendarTaskGroup(task: AgentCalendarTask): AgentCalendarSummaryGroup {
  if (task.summaryGroup) return task.summaryGroup;
  if (task.executionStep && STEP_GROUP[task.executionStep]) return STEP_GROUP[task.executionStep];
  const legacy = SUMMARY_ID_GROUP[summaryId(task)];
  if (legacy) return legacy;
  if (task.reviewTarget) return 'review';
  if (task.customerExecutionTarget || task.salesTarget || task.agent === 'customer') return 'inquiries';
  if (task.publicationExecutionTarget || task.platform) return 'publishing';
  if (task.agent === 'content') return 'production';
  if (task.agent === 'director') return 'directing';
  return 'foundation';
}

export function taskHasDeliverableOrWorkspace(task: AgentCalendarTask): boolean {
  const hasWorkspace = Boolean(
    task.productionTaskId || task.productionExecutionTaskId || task.planningTarget || task.reviewTarget || task.templateTarget
    || task.customerExecutionTarget || task.publicationExecutionTarget || task.inventoryTarget || task.accountBindingTarget
    || task.enterpriseFactExceptionId || task.supplementTarget || task.salesTarget || task.materialRequestId
    || task.customerRunId || task.sendRecoveryTarget || task.nativeRecoveryTarget || task.publicationRecoveryTarget
    || task.crossWeekMaterialTarget || task.customerExceptionTarget,
  );
  const explicitDeliverable = Boolean(task.output.trim()) && !/^待交付[：:]?$/.test(task.output.trim());
  return !task.calendarSummaryOnly && (hasWorkspace || explicitDeliverable);
}

export function agentCalendarTaskType(task: AgentCalendarTask): string {
  if (task.agent === 'human') return '人工处理';
  const group = agentCalendarTaskGroup(task);
  if (group === 'directing') return '编导任务';
  if (group === 'production') return '制片任务';
  if (group === 'quality') return '验收任务';
  if (group === 'publishing') return '发布任务';
  return '经营任务';
}

/** User-facing owner identity used as the first line of every calendar card. */
export function agentCalendarIdentityLabel(agent: AgentCalendarTask['agent']): string {
  if (agent === 'human') return '人工处理';
  if (agent === 'business') return '经营智能体';
  if (agent === 'director') return '编导智能体';
  if (agent === 'content') return '内容智能体';
  return '客服智能体';
}

/**
 * Resolve the owner from the persisted workflow contract. Some older weekly
 * packages stored `business_agent` as a generic scheduler owner even when the
 * concrete step belongs to directing, production or customer service. The
 * step is the stronger responsibility signal; human actions stay human.
 */
export function agentCalendarResponsibleAgent(
  step: string | null | undefined,
  fallback: AgentCalendarTask['agent'],
): AgentCalendarTask['agent'] {
  if (fallback === 'human' || step === 'user_approval') return 'human';
  if (['benchmark_collection', 'benchmark_scoring', 'director_analysis', 'script', 'storyboard', 'template_extraction'].includes(step || '')) return 'director';
  if (['material_preparation', 'material_readiness', 'asset_generation', 'video_generation', 'quality_check', 'rework', 'publishing', 'platform_publish'].includes(step || '')) return 'content';
  if (['customer_channel_readiness', 'customer_inquiry_handoff'].includes(step || '')) return 'customer';
  if (['business_outline', 'business_schedule', 'performance_monitoring', 'weekly_review', 'template_performance_validation'].includes(step || '')) return 'business';
  return fallback;
}

function progress(children: AgentCalendarTask[]): string {
  if (!children.length) return '等待真实任务';
  const completed = children.filter(task => task.status === 'completed').length;
  const attention = children.filter(task => ['blocked', 'failed'].includes(task.status)).length;
  return `${completed}/${children.length} 已完成${attention ? ` · ${attention} 项需处理` : ''}`;
}

function summaryTitle(metaTitle: string, children: AgentCalendarTask[]): string {
  if (!children.length) return metaTitle;
  if (children.length === 1) return children[0]!.title;
  return `${children[0]!.title} 等 ${children.length} 项`;
}

export function buildAgentCalendarSummaries(tasks: AgentCalendarTask[], dates: string[]): AgentCalendarSummary[] {
  if (dates.length !== 7) return [];
  const weekday = (date:string) => new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = dates.find(date=>weekday(date)===1) ?? dates[0]!;
  const sunday = dates.find(date=>weekday(date)===0) ?? dates[6]!;
  const children = tasks.filter(taskHasDeliverableOrWorkspace);
  const summaries: AgentCalendarSummary[] = [];
  for (const group of Object.keys(GROUP_META) as AgentCalendarSummaryGroup[]) {
    const meta = GROUP_META[group];
    const groupTasks = children.filter(task => agentCalendarTaskGroup(task) === group);
    const targetDates = meta.cadence === 'monday' ? [monday] : meta.cadence === 'sunday' ? [sunday] : dates;
    for (const date of targetDates) {
      const scoped = meta.cadence === 'daily' ? groupTasks.filter(task => task.date === date) : groupTasks;
      summaries.push({ key: `${date}:${group}`, group, date, title: summaryTitle(meta.title, scoped), progress: progress(scoped), startTime: meta.startTime, durationMinutes: meta.durationMinutes, children: scoped });
    }
  }
  return summaries;
}

/**
 * Calendar summaries describe the operating cadence; they are not extra work.
 * The visual calendar therefore keeps real children as the source of truth and
 * shows at most one lightweight empty slot per group when the whole week has no
 * real task for that group.
 */
export function calendarDisplayPlaceholders(
  summaries: AgentCalendarSummary[],
  preferredDate?: string,
): AgentCalendarSummary[] {
  const groups = new Map<AgentCalendarSummaryGroup, AgentCalendarSummary[]>();
  for (const summary of summaries) groups.set(summary.group, [...(groups.get(summary.group) || []), summary]);
  return [...groups.values()].flatMap(groupSummaries => {
    if (groupSummaries.some(summary => summary.children.length > 0)) return [];
    const sorted = [...groupSummaries].sort((left, right) => left.date.localeCompare(right.date));
    const preferred = preferredDate
      ? sorted.find(summary => summary.date >= preferredDate) || sorted.at(-1)
      : sorted[0];
    return preferred ? [preferred] : [];
  });
}

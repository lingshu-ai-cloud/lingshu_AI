import type { AgentCalendarTask } from './AgentWeeklyCalendar';

export type AgentCalendarSummaryGroup =
  | 'foundation'
  | 'directing'
  | 'production'
  | 'publishing'
  | 'inquiries'
  | 'review';

export type AgentCalendarSummary = {
  key: `${string}:${AgentCalendarSummaryGroup}`;
  group: AgentCalendarSummaryGroup;
  date: string;
  title: string;
  progress: string;
  children: AgentCalendarTask[];
};

const GROUP_META: Record<AgentCalendarSummaryGroup, { title: string; cadence: 'monday' | 'operating' | 'sunday' }> = {
  foundation: { title: '经营目标与执行准备', cadence: 'monday' },
  directing: { title: '对标采集与编导方案', cadence: 'monday' },
  production: { title: '成片生产', cadence: 'operating' },
  publishing: { title: '发布与平台分发', cadence: 'operating' },
  inquiries: { title: '询盘承接与跟进', cadence: 'operating' },
  review: { title: '数据追踪与周复盘', cadence: 'sunday' },
};

const STEP_GROUP: Record<string, AgentCalendarSummaryGroup> = {
  business_outline: 'foundation',
  benchmark_collection: 'directing', benchmark_scoring: 'directing', director_analysis: 'directing', business_schedule: 'directing',
  material_preparation: 'production', material_readiness: 'production', script: 'production', storyboard: 'production',
  asset_generation: 'production', video_generation: 'production', quality_check: 'production', rework: 'production', user_approval: 'production',
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
  if (group === 'publishing') return '发布任务';
  return '经营任务';
}

function progress(children: AgentCalendarTask[]): string {
  if (!children.length) return '尚未生成独立任务';
  const completed = children.filter(task => task.status === 'completed').length;
  const attention = children.filter(task => ['blocked', 'failed'].includes(task.status)).length;
  return `${completed}/${children.length} 已完成${attention ? ` · ${attention} 项需处理` : ''}`;
}

export function buildAgentCalendarSummaries(tasks: AgentCalendarTask[], dates: string[]): AgentCalendarSummary[] {
  if (dates.length !== 7) return [];
  const monday = dates[0]!;
  const sunday = dates[6]!;
  const children = tasks.filter(taskHasDeliverableOrWorkspace);
  const summaries: AgentCalendarSummary[] = [];
  for (const group of Object.keys(GROUP_META) as AgentCalendarSummaryGroup[]) {
    const meta = GROUP_META[group];
    const groupTasks = children.filter(task => agentCalendarTaskGroup(task) === group);
    const targetDates = meta.cadence === 'monday' ? [monday] : meta.cadence === 'sunday' ? [sunday] : dates.slice(0, 6);
    for (const date of targetDates) {
      const scoped = meta.cadence === 'operating' ? groupTasks.filter(task => task.date === date) : groupTasks;
      summaries.push({ key: `${date}:${group}`, group, date, title: meta.title, progress: progress(scoped), children: scoped });
    }
  }
  return summaries;
}

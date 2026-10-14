import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { scheduleWeeklyVideos, weeklyPipelineCards } from '../../lib/weeklyGoalSchedule';
import {agentCalendarResponsibleAgent} from './agentCalendarGroups';

/** Draft preparation is a planned dependency chain, never a fabricated execution receipt. */
export function projectWeeklyGoalCalendar(data: DigitalEmployeeOverview): AgentCalendarTask[] {
  if (!data.goal) return [];
  const goal = data.goal;
  const start = new Date(`${goal.startsAt.slice(0, 10)}T12:00:00Z`);
  const monday = Number.isFinite(start.getTime())
    ? new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
    : goal.startsAt;
  const plans = data.plan?.businessPackage?.tasks.find(task => task.templateId === 'production')?.videoPlans || goal.videoPlans || [];
  const prefix = `goal-${goal.id}-`;
  const workflowKeys: Record<string, string[]> = {
    goal: ['goal_decomposition'],
    configuration: ['context_readiness'],
    accounts: ['content_release_approval', 'publishing_calendar'],
    knowledge: ['context_readiness'],
    director: ['scheduled_source_collection', 'viral_analysis', 'content_mode_routing'],
    production: ['content_production', 'content_quality_gate'],
    publishing: ['publishing_calendar', 'platform_publish'],
    review: ['customer_attribution', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review'],
  };
  const pipeline = weeklyPipelineCards(goal.startsAt, goal.endsAt, plans.length).map((card, index) => {
    const keys = workflowKeys[card.id] || [];
    const planned = (data.plan?.tasks || []).filter(task => keys.includes(task.key));
    const tasks = data.tasks.filter(task => keys.includes(task.task_key));
    const failed = tasks.find(task => task.status === 'failed');
    const blocked = tasks.find(task => task.blocked_reason || ['waiting_approval', 'waiting_external'].includes(task.status));
    const status: AgentCalendarTask['status'] = failed ? 'failed' : blocked ? 'blocked' : tasks.some(task => task.status === 'running') ? 'active' : tasks.length && tasks.every(task => task.status === 'succeeded') ? 'completed' : 'planned';
    const isWeeklyFoundation = ['goal', 'configuration', 'accounts', 'knowledge'].includes(card.id);
    const cardDate = isWeeklyFoundation ? monday : card.date;
    const internalNodes: AgentCalendarTask[] = planned.map(task => {
      const execution = tasks.find(item => item.task_key === task.key);
      const nodeBlocked = Boolean(execution?.blocked_reason || execution && ['waiting_approval', 'waiting_external'].includes(execution.status));
      const nodeStatus: AgentCalendarTask['status'] = execution?.status === 'failed' ? 'failed' : nodeBlocked ? 'blocked' : execution?.status === 'running' ? 'active' : execution?.status === 'succeeded' ? 'completed' : 'planned';
      return {
        id: `${prefix}${task.key}`,
        date: cardDate,
        time: `${String(9 + index).padStart(2, '0')}:00`,
        agent: agentCalendarResponsibleAgent(task.key, task.agentRole === 'orchestrator' ? 'business' : task.agentRole),
        executionStep: task.key,
        title: task.title,
        output: task.description,
        context: `${task.capabilityKey || 'workflow'} · 状态来源：${task.statusSource || '计划任务'}`,
        minutes: task.expectedMinutes,
        status: nodeStatus,
        ...(nodeBlocked || execution?.status === 'failed' ? { reason: execution?.blocked_reason || '执行失败，请查看任务记录后重试' } : {}),
        dependsOn: task.dependsOn.map(key => `${prefix}${key}`),
      };
    });
    return { id: prefix + card.id, date: cardDate, time: '00:00', agent: card.agent, title: card.title, calendarSummaryOnly: true,
      output: card.output, context: `${goal.title} · ${goal.startsAt} 至 ${goal.endsAt} · 计划阶段，实际执行以任务回执为准`, minutes: null,
      status, ...(failed || blocked ? { reason: failed?.blocked_reason || blocked?.blocked_reason || (failed ? '执行失败，请查看任务记录后重试' : '等待前置处理或人工确认') } : {}), dependsOn: card.dependsOn.map(id => prefix + id), assignee: card.owner,
      ...(internalNodes.length ? { internalNodes } : {}),
    };
  });
  const publications: AgentCalendarTask[] = scheduleWeeklyVideos(plans, goal.startsAt, goal.endsAt).map((plan, index) => ({
    id: `${prefix}publish-${plan.contentId || index}`, date: plan.plannedPublishDate!, time: '18:00', agent: 'content', executionStep: 'publishing',
    platform: plan.platform, title: `${plan.platform} · 发布第 ${index + 1} 条`, output: plan.theme || '按已确认目标产出平台视频',
    context: `${plan.matrix?.accountId || '待接入账号'} · 计划发布日，需先通过制作验收与账号授权`, minutes: null,
    status: 'planned', dependsOn: [prefix + 'production', prefix + 'accounts'],
  }));
  return [...pipeline, ...publications];
}

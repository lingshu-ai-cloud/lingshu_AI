import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { scheduleWeeklyVideos, weeklyPipelineCards } from '../../lib/weeklyGoalSchedule';

/** Draft preparation is a planned dependency chain, never a fabricated execution receipt. */
export function projectWeeklyGoalCalendar(data: DigitalEmployeeOverview): AgentCalendarTask[] {
  if (!data.goal) return [];
  const goal = data.goal;
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
    const blocked = tasks.find(task => task.blocked_reason || ['failed', 'waiting_approval', 'waiting_external'].includes(task.status));
    const status: AgentCalendarTask['status'] = blocked ? 'blocked' : tasks.some(task => task.status === 'running') ? 'active' : tasks.length && tasks.every(task => task.status === 'succeeded') ? 'completed' : 'planned';
    const internalNodes: AgentCalendarTask[] = planned.map(task => {
      const execution = tasks.find(item => item.task_key === task.key);
      const nodeBlocked = Boolean(execution?.blocked_reason || execution && ['failed', 'waiting_approval', 'waiting_external'].includes(execution.status));
      const nodeStatus: AgentCalendarTask['status'] = nodeBlocked ? 'blocked' : execution?.status === 'running' ? 'active' : execution?.status === 'succeeded' ? 'completed' : 'planned';
      return {
        id: `${prefix}${task.key}`,
        date: card.date,
        time: `${String(9 + index).padStart(2, '0')}:00`,
        agent: task.agentRole === 'orchestrator' ? 'business' : task.agentRole,
        title: task.title,
        output: task.description,
        context: `${task.capabilityKey || 'workflow'} · 状态来源：${task.statusSource || '计划任务'}`,
        minutes: task.expectedMinutes,
        status: nodeStatus,
        ...(nodeBlocked ? { reason: execution?.blocked_reason || '等待前置处理或人工确认' } : {}),
        dependsOn: task.dependsOn.map(key => `${prefix}${key}`),
      };
    });
    return { id: prefix + card.id, date: card.date, time: `${String(9 + index).padStart(2, '0')}:00`, agent: card.agent, title: card.title,
      output: card.output, context: `${goal.title} · ${goal.startsAt} 至 ${goal.endsAt} · 计划阶段，实际执行以任务回执为准`, minutes: null,
      status, ...(blocked ? { reason: blocked.blocked_reason || '等待前置处理或人工确认' } : {}), dependsOn: card.dependsOn.map(id => prefix + id), assignee: card.owner,
      ...(internalNodes.length ? { internalNodes } : {}),
    };
  });
  const publications: AgentCalendarTask[] = scheduleWeeklyVideos(plans, goal.startsAt, goal.endsAt).map((plan, index) => ({
    id: `${prefix}publish-${plan.contentId || index}`, date: plan.plannedPublishDate!, time: '18:00', agent: 'business',
    title: `${plan.platform} · 发布第 ${index + 1} 条`, output: plan.theme || '按已确认目标产出平台视频',
    context: `${plan.matrix?.accountId || '待接入账号'} · 计划发布日，需先通过制作验收与账号授权`, minutes: null,
    status: 'planned', dependsOn: [prefix + 'production', prefix + 'accounts'],
  }));
  return [...pipeline, ...publications];
}

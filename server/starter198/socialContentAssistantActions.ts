import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow.js';
import { projectContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard.js';

/** Actions are bound to one selected, tenant-owned record, never a guessed latest task. */
export function socialContentAssistantAction(task: SocialContentTaskSummary, orchestratorAvailable: boolean) {
  const startable = ['draft', 'needs_input', 'plan_review', 'paused', 'attention'].includes(task.status);
  const canStart = startable && !task.runId && task.readiness.complete && orchestratorAvailable;
  return {
    id: `content:${task.taskId}:${canStart ? 'start' : 'open'}`,
    label: canStart ? `${task.status === 'paused' ? '继续' : '启动'}「${task.brief.title}」` : `查看「${task.brief.title}」`,
    taskId: task.taskId, expectedVersion: task.version, status: task.status,
    operation: canStart ? 'start' as const : 'open' as const,
    href: `/?page=smartAssets&view=create&socialContentTaskId=${encodeURIComponent(task.taskId)}`,
    ...(startable && !task.readiness.complete ? { disabledReason: '请先在生产页面补齐任务输入。' }
      : startable && !orchestratorAvailable ? { disabledReason: '生产执行器尚未配置。' } : {}),
  };
}

export function socialContentAssistantReceipt(task: SocialContentTaskSummary, blockedReason?: string, packageBound = false) {
  return {
    taskId: task.taskId, runId: task.runId, status: task.status,
    card: projectContentProductionTaskCard(task),
    href: `/?page=smartAssets&view=create&socialContentTaskId=${encodeURIComponent(task.taskId)}`,
    ...(!packageBound ? {weeklyTaskId: `social-content:${task.taskId}`} : {}),
    calendarTarget: {productionTaskId: task.taskId},
    started: Boolean(task.runId) && task.status === 'producing' && !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

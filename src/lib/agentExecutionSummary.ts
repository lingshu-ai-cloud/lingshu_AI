import type { DigitalEmployeeOverview } from './digitalEmployees';
import { taskNeedsAttention, taskWaitLabels, type TaskWaitState } from './taskExecutionState';

export function agentExecutionSummary(data: Pick<DigitalEmployeeOverview, 'run' | 'tasks' | 'approvals'>) {
  const tasks = data.tasks.filter(task => task.run_id === data.run?.id);
  const completed = tasks.filter(task => task.status === 'succeeded').length;
  const base = { completed, total: tasks.length, taskId: undefined as string | undefined, running: false };
  const status = data.run?.status;
  if (!data.run) return { ...base, label: '任务包待执行', detail: '确认任务包后，点击执行任务。' };
  const terminal: Record<string, string> = { succeeded: '本轮任务已完成', failed: '本轮执行失败', cancelled: '本轮任务已取消', paused: '智能体任务已暂停' };
  if (terminal[status!]) return { ...base, label: terminal[status!], detail: status === 'paused' ? '恢复执行后继续推进任务。' : '查看本轮执行记录与交付结果。' };
  const active = tasks.find(task => task.status === 'running' && !taskNeedsAttention(task));
  const processing = tasks.find(task => task.status === 'waiting_external' && (task.output?.waitState as TaskWaitState | undefined)?.kind === 'processing');
  const current = active || processing;
  const attention = tasks.find(task => taskNeedsAttention(task));
  const approval = tasks.find(task => task.status === 'waiting_approval' || data.approvals.some(item => item.task_id === task.id && item.status === 'pending'));
  if (current) return { ...base, running: true, taskId: current.id, label: '智能体任务执行中', detail: `正在执行：${current.title}${attention || approval ? ' · 另有任务待你处理' : ''}` };
  const waiting = attention || approval || tasks.find(task => task.status === 'waiting_external');
  if (waiting) {
    const wait = waiting.output?.waitState as TaskWaitState | undefined;
    return { ...base, taskId: waiting.id, label: approval === waiting ? '智能体等待审批' : attention === waiting ? '智能体需要你处理' : '智能体等待执行条件', detail: `${waiting.title} · ${wait?.message || waiting.blocked_reason || (wait ? taskWaitLabels[wait.kind] : '等待任务继续执行')}` };
  }
  return { ...base, label: '智能体任务已排队', detail: '任务包已启动，等待下一项任务开始。' };
}

import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution';

/** Only use a persisted planner estimate; never invent a duration from a spinner. */
export function imageProductionEstimate(task: SocialImageCreationTask | undefined, execution: SocialImageExecutionReceipt | null, now: number): string {
  if (execution?.status !== 'running') return '';
  const plan = (task?.productionRuntime?.nodeOutputs || [])
    .filter(item => item.nodeId === 'execution_plan' && item.status === 'completed')
    .sort((a, b) => b.version - a.version)[0];
  const value = plan?.value && typeof plan.value === 'object' ? plan.value as Record<string, unknown> : null;
  const seconds = value?.estimatedDurationSeconds;
  const start = plan ? Date.parse(plan.createdAt) : NaN;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(start) || start > now) {
    const events = task?.productionRuntime?.events || [];
    const running = [...events].reverse().find(event => event.status === 'running' && event.nodeId === task?.productionRuntime?.currentNode);
    const started = running ? Date.parse(running.occurredAt) : NaN;
    if (Number.isFinite(started) && started <= now) {
      const elapsed = Math.floor((now - started) / 60_000);
      return `${elapsed < 1 ? '本步骤已进行不到 1 分钟' : `本步骤已进行约 ${elapsed} 分钟`} · 预计剩余时间暂不可估算`;
    }
    return '预计剩余时间暂不可估算';
  }
  const remaining = seconds - (now - start) / 1000;
  if (remaining <= 0) return '已超过预计时间，仍在处理';
  return `预计还需约 ${Math.max(1, Math.ceil(remaining / 60))} 分钟`;
}

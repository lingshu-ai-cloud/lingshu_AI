import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution';

/** Use completed same-stage history or a persisted planner estimate; never invent a countdown from a spinner. */
export function imageProductionEstimate(task: SocialImageCreationTask | undefined, execution: SocialImageExecutionReceipt | null, now: number, historySeconds: number[] = []): string {
  if (execution?.status !== 'running') return '';
  const currentNode = task?.productionRuntime?.currentNode;
  const events = task?.productionRuntime?.events || [];
  const current = [...events].reverse().find(event => event.nodeId === currentNode);
  const started = current ? Date.parse(current.occurredAt) : NaN;
  const elapsedSeconds = Number.isFinite(started) && started <= now ? (now - started) / 1000 : 0;
  const history = historySeconds.filter(value => Number.isFinite(value) && value >= 1 && value <= 3600).sort((a, b) => a - b);
  if (history.length >= 2) {
    const lower = Math.max(1, Math.floor((Math.max(0, history[0]! - elapsedSeconds) * 0.8) / 60));
    const upper = Math.max(lower + 1, Math.ceil((Math.max(0, history[history.length - 1]! - elapsedSeconds) * 1.5) / 60));
    if (elapsedSeconds > history[history.length - 1]! * 1.5) return `已超过近期 ${history.length} 次同环节的参考时长，仍在处理`;
    return `参考近期 ${history.length} 次同环节记录，预计还需约 ${lower}–${upper} 分钟（仅供参考）`;
  }
  const plan = (task?.productionRuntime?.nodeOutputs || [])
    .filter(item => item.nodeId === 'execution_plan' && item.status === 'completed')
    .sort((a, b) => b.version - a.version)[0];
  const value = plan?.value && typeof plan.value === 'object' ? plan.value as Record<string, unknown> : null;
  const seconds = value?.estimatedDurationSeconds;
  const start = plan ? Date.parse(plan.createdAt) : NaN;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(start) || start > now) {
    if (Number.isFinite(started) && started <= now) {
      const elapsed = Math.floor((now - started) / 60_000);
      return `${elapsed < 1 ? '本步骤已进行不到 1 分钟' : `本步骤已进行约 ${elapsed} 分钟`} · 同环节历史样本不足，暂无法可靠估时`;
    }
    return '同环节历史样本不足，暂无法可靠估时';
  }
  const remaining = seconds - (now - start) / 1000;
  if (remaining <= 0) return '已超过预计时间，仍在处理';
  return `预计还需约 ${Math.max(1, Math.ceil(remaining / 60))} 分钟`;
}

import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { projectContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard';

export function isAssistantReplicationTask(task: SocialContentTaskDetail): boolean {
  try { return ['assistant_replication_confirmation', 'assistant_scene_confirmation'].includes(JSON.parse(task.brief.specialRequirements || '{}').source); }
  catch { return false; }
}

export function assistantReplicationQueueState(task: SocialContentTaskDetail) {
  if (task.status === 'cancelled' || task.status === 'cancelling') return { label: '已取消', blockers: [], running: false };
  // Draft planning projections are not execution evidence. Never display their estimates or blockers as a running job.
  if (!task.runId) return { label: '待调度', blockers: [], running: false };
  const card = projectContentProductionTaskCard(task);
  const blocked = card.blockingItems.length > 0 || ['failed', 'paused', 'needs_input', 'needs_approval'].includes(card.overallState);
  return { label: blocked ? '待介入' : card.overallState === 'completed' ? '已完成' : '执行中',
    blockers: card.blockingItems, running: true };
}

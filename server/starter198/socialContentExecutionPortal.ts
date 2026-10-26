import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import { projectContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard.js';
import { socialJson, socialObject, socialText } from './socialContentValidation.js';

/** Only an actual enqueue reply written by the start command can create a portal. */
export function socialContentExecutionAccepted(record: Record<string, unknown>): boolean {
  const receipt = socialObject(socialObject(socialJson(record.brief))?._executionQueueReceipt);
  return Boolean(receipt && ['queued', 'attached_to_run'].includes(String(receipt.disposition)) && socialText(receipt.queueItemId)
    && receipt.queueItemId === record.orchestrator_item_id
    && (!socialText(receipt.runId) || receipt.runId === record.run_id));
}

export function socialContentExecutionPortal(record: Record<string, unknown>, task: SocialContentTaskDetail) {
  if (!socialContentExecutionAccepted(record)) return null;
  return { taskId: task.taskId, runId: task.runId, title: task.brief.title,
    card: projectContentProductionTaskCard(task),
    href: `/?page=socialInspiration&view=tasks&socialContentTaskId=${encodeURIComponent(task.taskId)}` };
}

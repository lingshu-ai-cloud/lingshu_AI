import type { Message } from '../appSession';
import type { SocialAssistantReceipt } from './socialContentApi';

/** An enqueue receipt creates one persistent pointer, not a second task. */
export function appendProductionReceipt(messages: Message[], content: string, result: SocialAssistantReceipt): Message[] {
  if (!result.receipt.queued) return [...messages, { role: 'assistant', content }];
  const taskPortal = { kind: 'content_task' as const, taskId: result.receipt.taskId,
    title: result.task.brief.title.slice(0, 180), action: 'view_production' as const, phase: 'ready' as const };
  const index = messages.findIndex(message => message.taskPortal?.action === 'view_production'
    && message.taskPortal.taskId === taskPortal.taskId);
  return index < 0 ? [...messages, { role: 'assistant', content, taskPortal }]
    : messages.map((message, position) => position === index ? { ...message, content, taskPortal } : message);
}

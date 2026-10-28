import type { Message } from '../../appSession';

const WEEKLY_PLAN_REPLIES = [
  '已找到并绑定可用的爆款视频与图文参考。',
  '已在当前窗口打开本周计划。',
];

/** Keep the plan card beside the reply that introduced it, not at the live end of the thread. */
export function weeklyPlanConversationAnchor(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && WEEKLY_PLAN_REPLIES.some(reply => message.content.startsWith(reply))) return index;
  }
  return -1;
}

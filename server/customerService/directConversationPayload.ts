import { splitMobileChatMessages } from '../agents/mobileChatStyle.js';
import { directConversationCustomerServiceDecision } from './decision.js';

export function directConversationPayload(pair: { draft: string; draftZh: string }, category: string) {
  const messages = splitMobileChatMessages(pair.draft);
  const translatedMessages = splitMobileChatMessages(pair.draftZh);
  return {
    draft: messages.join('\n\n'),
    messages,
    translatedDraft: translatedMessages.join('\n\n'),
    translatedMessages,
    handoffRequired: false,
    knowledgeMiss: false,
    category,
    verification: { status: 'verified', issues: [] },
    decision: directConversationCustomerServiceDecision(category),
  };
}

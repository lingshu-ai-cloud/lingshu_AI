import type { AssistantJournalScope } from './assistantThreadJournal';

const key = (scope: AssistantJournalScope) => `lingshu:assistant-active:${encodeURIComponent(scope.tenantId)}:${encodeURIComponent(scope.userId)}`;
export function readAssistantConversationKey(scope: AssistantJournalScope): string {
  try {
    const value = localStorage.getItem(key(scope)) || '';
    return /^(?:business|conversation:[a-zA-Z0-9-]+)$/.test(value) ? value : 'business';
  } catch { return 'business'; }
}
export function writeAssistantConversationKey(scope: AssistantJournalScope, value: string): void {
  localStorage.setItem(key(scope), value);
}

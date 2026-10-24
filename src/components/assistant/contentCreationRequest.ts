import { creationReplySchema, CREATION_QUESTIONS, type CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
import { authHeader } from '../../lib/auth';
import { useAssistantStore } from '../../stores/assistantStore';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';

/** Shares the assistant request fence, abort handle, transcript and save queue. */
export async function requestCreationReply(input: {
  turn: CreationTurn;
  isCurrent: () => boolean;
  controller: AbortController;
  persist: () => void;
  replaceCurrent?: boolean;
}) {
  const response = await fetch('/api/overseas/strategy/creation-dialogue', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input.turn), signal: AbortSignal.any([input.controller.signal, AbortSignal.timeout(45000)]),
  });
  const body = await response.json();
  if (!input.isCurrent()) return false;
  if (!response.ok) throw new Error(body.message || '创作推荐暂不可用，请重试。');
  const reply = creationReplySchema.parse(body);
  const store = useAssistantStore.getState();
  const thread = store.threads[PRIMARY_ASSISTANT_THREAD];
  store.hydrateThread(PRIMARY_ASSISTANT_THREAD, { creationDraft: reply.selection });
  // Preserve every visible question/answer while retaining only the current choice snapshot.
  const transcript = thread.messages.map(({ creation: _previousChoices, ...message }) => message);
  if (input.replaceCurrent && transcript.at(-1)?.role === 'assistant') transcript.pop();
  store.setMessages(PRIMARY_ASSISTANT_THREAD, [...transcript, { role: 'assistant', content: CREATION_QUESTIONS[reply.stage], creation: reply }]);
  input.persist();
  return true;
}

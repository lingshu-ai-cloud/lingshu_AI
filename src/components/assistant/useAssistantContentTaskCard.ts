import { useEffect } from 'react';
import { projectContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import { contentTaskCardToAssistantCard } from '../../lib/assistantContentTaskProjection';
import { socialContentApi } from '../../lib/socialContentApi';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../../lib/socialContentTaskRefresh';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';

type StoreActions = ReturnType<typeof useAssistantStore.getState>;

/** Keeps one in-conversation ContentTask card aligned with the server snapshot. */
export function useAssistantContentTaskCard(input: {
  active: boolean;
  focusedTaskId: string | null;
  agentId: OrbitAgentId;
  scopeKey: string;
  upsertTaskCard: StoreActions['upsertTaskCard'];
  persistThread: (agentId: OrbitAgentId) => void;
}) {
  useEffect(() => {
    const contentTaskId = input.focusedTaskId?.startsWith('social-content:')
      ? input.focusedTaskId.slice('social-content:'.length)
      : '';
    if (!input.active || !contentTaskId) return;
    let active = true;
    let inFlight = false;
    let lastCursor = useAssistantStore.getState().threads[input.agentId]
      .taskCards[input.focusedTaskId!]?.contentTask?.recoveryCursor.value ?? '';
    const refresh = async (event?: Event) => {
      const requested = (event as CustomEvent<{ taskId?: string }> | undefined)?.detail?.taskId;
      if ((requested && requested !== contentTaskId) || inFlight) return;
      inFlight = true;
      try {
        const task = await socialContentApi.getTask(contentTaskId);
        if (!active) return;
        const card = projectContentProductionTaskCard(task);
        if (card.recoveryCursor.value === lastCursor) return;
        lastCursor = card.recoveryCursor.value;
        input.upsertTaskCard(input.agentId, contentTaskCardToAssistantCard(card));
        input.persistThread(input.agentId);
      } catch {
        // Preserve the last confirmed projection. A read failure is unknown,
        // never evidence that the task failed or disappeared.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, refresh);
    };
  }, [input.active, input.agentId, input.focusedTaskId, input.persistThread, input.scopeKey, input.upsertTaskCard]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../../App';
import { authHeader } from '../../lib/auth';
import { readAssistantThreadJournal, type AssistantJournalScope } from '../../lib/assistantThreadJournal';
import { useAssistantStore, type AgentThreadState, type AssistantTaskCardInput, type OrbitAgentId } from '../../stores/assistantStore';
import type { AssistantActionRequest, AssistantActionResponse } from '../../../shared/contracts/assistantActions';
import { actionCardToTaskCard } from './assistantActionProjection';
import {
  CURRENT_STATUS_TASK_ID,
  PRIMARY_ASSISTANT_THREAD,
  emptyAssistantThread,
  mergeAssistantThread,
  persistedAssistantThread,
  withoutPersistedConversation,
} from './globalAssistantRuntime';

/** Recovers presentation state, then re-signs any focused action from the authoritative workspace. */
export function useAssistantThreadHydration(input: {
  page: Page;
  stablePersistenceScope: AssistantJournalScope;
  persistThread: (agentId: OrbitAgentId, reason: 'retry') => void;
  hydrateThread: (agentId: OrbitAgentId, patch: Partial<AgentThreadState>) => void;
  executeAssistantAction: (agentId: OrbitAgentId, request: AssistantActionRequest) => Promise<AssistantActionResponse | null>;
  upsertTaskCard: (agentId: OrbitAgentId, card: AssistantTaskCardInput) => void;
  focusTaskCard: (agentId: OrbitAgentId, taskId: string | null) => void;
  requestId: () => string;
}) {
  const { page, stablePersistenceScope, persistThread, hydrateThread,
    executeAssistantAction, upsertTaskCard, focusTaskCard, requestId } = input;
  const [assistantThreadHydrated, setAssistantThreadHydrated] = useState(false);
  const assistantThreadHydrationStartedRef = useRef(false);
  const initialAssistantPageRef = useRef(page);
  const persistRecoveredThread = useCallback(() => {
    persistThread(PRIMARY_ASSISTANT_THREAD, 'retry');
  }, [persistThread]);

  useEffect(() => {
    if (assistantThreadHydrationStartedRef.current) return undefined;
    assistantThreadHydrationStartedRef.current = true;
    let cancelled = false;
    const journal = readAssistantThreadJournal(
      window.localStorage,
      stablePersistenceScope,
      PRIMARY_ASSISTANT_THREAD,
    );
    // A keyed component instance starts from an empty scoped thread, then
    // recovers only the matching tenant + user + agent journal. This prevents
    // Zustand state from a prior login/support scope flashing into this one.
    hydrateThread(
      PRIMARY_ASSISTANT_THREAD,
      journal ? withoutPersistedConversation(journal) : emptyAssistantThread(),
    );
    const threadBeforeRequest = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
    fetch('/api/overseas/assistant-threads', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(async data => {
        if (cancelled) return;
        const localChangedWhileLoading = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD] !== threadBeforeRequest;
        const latestLocal = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        if (!Array.isArray(data?.items)) {
          if (journal) persistRecoveredThread();
          setAssistantThreadHydrated(true);
          return;
        }
        const item = data.items.find((candidate: { agentId?: unknown } | null) => candidate?.agentId === PRIMARY_ASSISTANT_THREAD);
        const persistedRemote = item ? persistedAssistantThread({
          version: Number.isSafeInteger(Number(item.version)) ? Number(item.version) : 0,
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
          messages: Array.isArray(item.messages) ? item.messages : [],
          creationDraft: item.creationDraft ?? null,
          draftInput: typeof item.draftInput === 'string' ? item.draftInput : '',
          scrollPosition: Number(item.scrollPosition ?? 0),
          unreadCount: Number(item.unreadCount ?? 0),
          isFollowingLatest: typeof item.isFollowingLatest === 'boolean' ? item.isFollowingLatest : true,
          paused: typeof item.paused === 'boolean' ? item.paused : false,
          taskCards: item.taskCards && typeof item.taskCards === 'object' ? item.taskCards : {},
          focusedTaskId: typeof item.focusedTaskId === 'string' ? item.focusedTaskId : null,
        }, emptyAssistantThread()) : null;
        const remote = persistedRemote ? withoutPersistedConversation(persistedRemote) : null;
        const merged = remote
          ? (journal || localChangedWhileLoading ? mergeAssistantThread(remote, latestLocal) : remote)
          : latestLocal;
        hydrateThread(PRIMARY_ASSISTANT_THREAD, merged);
        const hydratedThread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        const persistedFocusedTaskId = hydratedThread.focusedTaskId;
        setAssistantThreadHydrated(true);

        if (journal) persistRecoveredThread();

        // Thread storage intentionally keeps presentation state only. Re-read
        // the authoritative workspace after hydration and place its freshly
        // signed actions on a dedicated current-status card. Never bind an
        // arbitrary current decision to the ID of a possibly stale old card.
        if (!persistedFocusedTaskId) return;
        const request: AssistantActionRequest = {
          source: 'button',
          requestId: requestId(),
          actionId: 'view_status',
          page: initialAssistantPageRef.current,
        };
        const response = await executeAssistantAction(PRIMARY_ASSISTANT_THREAD, request);
        if (
          cancelled
          || useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD] !== hydratedThread
          || !response
          || response.status === 'not_handled'
          || response.status === 'delegated'
          || response.status === 'failed'
          || response.status === 'stale_action'
        ) return;
        upsertTaskCard(
          PRIMARY_ASSISTANT_THREAD,
          actionCardToTaskCard(response.card, response, CURRENT_STATUS_TASK_ID),
        );
        focusTaskCard(PRIMARY_ASSISTANT_THREAD, CURRENT_STATUS_TASK_ID);
      })
      .catch(() => {
        if (!cancelled) {
          if (journal) persistRecoveredThread();
          setAssistantThreadHydrated(true);
        }
      });
    return () => { cancelled = true; };
  }, [executeAssistantAction, focusTaskCard, hydrateThread, persistRecoveredThread, stablePersistenceScope, upsertTaskCard, requestId]);

  return assistantThreadHydrated;
}

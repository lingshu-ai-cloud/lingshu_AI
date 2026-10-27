import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../../App';
import { authHeader } from '../../lib/auth';
import { readAssistantConversationKey, writeAssistantConversationKey } from '../../lib/assistantConversationIdentity';
import { clearAssistantThreadJournal, readAssistantThreadJournal, type AssistantJournalScope } from '../../lib/assistantThreadJournal';
import { useAssistantStore, type AgentThreadState, type AssistantTaskCardInput, type OrbitAgentId } from '../../stores/assistantStore';
import type { AssistantActionRequest, AssistantActionResponse } from '../../../shared/contracts/assistantActions';
import { actionCardToTaskCard } from './assistantActionProjection';
import {
  CURRENT_STATUS_TASK_ID,
  PRIMARY_ASSISTANT_THREAD,
  emptyAssistantThread,
  mergeAssistantThread,
  persistedAssistantThread,
} from './globalAssistantRuntime';

export function hydratedFocusNeedsWorkspaceStatus(focusedTaskId: string | null): boolean {
  return Boolean(focusedTaskId && !focusedTaskId.startsWith('social-content:'));
}

type HydrationCandidate = Record<string, unknown> & {
  agentId?: unknown;
  deletedAt?: unknown;
  id?: unknown;
};

const validConversationKey = (value: unknown): value is string => (
  typeof value === 'string' && /^(?:business|conversation:[a-zA-Z0-9-]+)$/.test(value)
);

/**
 * A browser can lose its active-conversation pointer while the durable rows
 * remain intact. Never strand the home composer on a tombstone: prefer the
 * newest active row returned by the server, and only allocate a new identity
 * when the selected row is confirmed deleted and no active row remains.
 */
export function resolveAssistantConversationSelection(
  requestedKey: string,
  selected: HydrationCandidate | null,
  activeItems: HydrationCandidate[],
  freshKey: string,
): { key: string; item: HydrationCandidate | null; changed: boolean } {
  const selectedDeleted = Boolean(selected?.deletedAt);
  const missingDefault = requestedKey === PRIMARY_ASSISTANT_THREAD && !selected?.id;
  if (!selectedDeleted && !missingDefault) return { key: requestedKey, item: selected, changed: false };
  const fallback = activeItems.find(item => validConversationKey(item.agentId) && !item.deletedAt) ?? null;
  if (fallback && validConversationKey(fallback.agentId)) {
    return { key: fallback.agentId, item: fallback, changed: fallback.agentId !== requestedKey };
  }
  if (!selectedDeleted) return { key: requestedKey, item: selected, changed: false };
  return { key: freshKey, item: null, changed: freshKey !== requestedKey };
}

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
  const initialAssistantPageRef = useRef(page);
  const persistRecoveredThread = useCallback(() => {
    persistThread(PRIMARY_ASSISTANT_THREAD, 'retry');
  }, [persistThread]);

  useEffect(() => {
    let cancelled = false;
    const conversationKey = readAssistantConversationKey(stablePersistenceScope);
    const storedJournal = readAssistantThreadJournal(
      window.localStorage,
      stablePersistenceScope,
      PRIMARY_ASSISTANT_THREAD,
    );
    const journal = storedJournal
      && !storedJournal.deletedAt
      && (storedJournal.conversationKey || 'business') === conversationKey
      ? storedJournal
      : null;
    // A keyed component instance starts from an empty scoped thread, then
    // recovers only the matching tenant + user + agent journal. This prevents
    // Zustand state from a prior login/support scope flashing into this one.
    hydrateThread(
      PRIMARY_ASSISTANT_THREAD,
      journal ? { ...journal, conversationKey } : { ...emptyAssistantThread(), conversationKey },
    );
    const threadBeforeRequest = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
    const headers = authHeader();
    fetch(`/api/overseas/assistant-threads/${encodeURIComponent(conversationKey)}`, { headers })
      .then(resp => resp.ok ? resp.json() : null)
      .then(async (selected: HydrationCandidate | null) => {
        const needsFallback = Boolean(selected?.deletedAt)
          || (conversationKey === PRIMARY_ASSISTANT_THREAD && !selected?.id);
        let activeItems: HydrationCandidate[] = [];
        if (needsFallback) {
          try {
            const response = await fetch('/api/overseas/assistant-threads?page=1', { headers });
            const payload = response.ok ? await response.json() as { items?: unknown } : null;
            activeItems = Array.isArray(payload?.items) ? payload.items as HydrationCandidate[] : [];
          } catch {
            // A confirmed tombstone still receives a fresh local identity even
            // when history listing is temporarily unavailable.
          }
        }
        return resolveAssistantConversationSelection(
          conversationKey,
          selected,
          activeItems,
          `conversation:${crypto.randomUUID()}`,
        );
      })
      .then(async selection => {
        if (cancelled) return;
        if (selection.changed) {
          clearAssistantThreadJournal(window.localStorage, stablePersistenceScope, PRIMARY_ASSISTANT_THREAD);
          writeAssistantConversationKey(stablePersistenceScope, selection.key);
        }
        const localChangedWhileLoading = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD] !== threadBeforeRequest;
        const latestLocal = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        const item = selection.item;
        const persistedRemote = item ? persistedAssistantThread({
          conversationKey: selection.key,
          conversationResetVersion: item.conversationResetVersion,
          deletedAt: item.deletedAt,
          title: item.title,
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
          pendingContentTaskBinding: item.pendingContentTaskBinding && typeof item.pendingContentTaskBinding === 'object'
            ? item.pendingContentTaskBinding
            : null,
        }, emptyAssistantThread()) : null;
        const remote = persistedRemote;
        const merged = selection.changed
          ? {
            ...(remote ?? { ...emptyAssistantThread(), conversationKey: selection.key }),
            ...(localChangedWhileLoading ? { draftInput: latestLocal.draftInput } : {}),
          }
          : remote
            ? (journal || localChangedWhileLoading ? mergeAssistantThread(remote, latestLocal) : remote)
            : latestLocal;
        hydrateThread(PRIMARY_ASSISTANT_THREAD, merged);
        const hydratedThread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        const persistedFocusedTaskId = hydratedThread.focusedTaskId;
        setAssistantThreadHydrated(true);

        if (journal && !selection.changed) persistRecoveredThread();

        // Thread storage intentionally keeps presentation state only. Re-read
        // the authoritative workspace after hydration and place its freshly
        // signed actions on a dedicated current-status card. Never bind an
        // arbitrary current decision to the ID of a possibly stale old card.
        if (!hydratedFocusNeedsWorkspaceStatus(persistedFocusedTaskId)) return;
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

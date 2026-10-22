import { useCallback } from 'react';
import { authHeader } from '../../lib/auth';
import {
  clearAssistantThreadJournal,
  sameAssistantThreadJournalContent,
  writeAssistantThreadJournal,
  type AssistantJournalScope,
} from '../../lib/assistantThreadJournal';
import { useAssistantStore, type AgentThreadState, type OrbitAgentId } from '../../stores/assistantStore';
import {
  ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES,
  assistantPersistenceCanRun,
  assistantPersistenceRetryDelay,
  cloneAssistantThread,
  mergeAssistantThread,
  persistedAssistantThread,
  type AssistantPersistenceReason,
  type AssistantThreadSaveQueue,
} from './globalAssistantRuntime';

type ScopeFence = { scopeKey: string; active: boolean };

/** Serial CAS save queue; the caller owns scope-fence and lifecycle timing. */
export function useAssistantThreadSaveQueue({
  stablePersistenceScope,
  persistenceFenceRef,
  assistantThreadSaveQueuesRef,
  hydrateThread,
  setPersistenceMetadata,
}: {
  stablePersistenceScope: AssistantJournalScope;
  persistenceFenceRef: { current: ScopeFence };
  assistantThreadSaveQueuesRef: { current: Map<OrbitAgentId, AssistantThreadSaveQueue> };
  hydrateThread: (agentId: OrbitAgentId, patch: Partial<AgentThreadState>) => void;
  setPersistenceMetadata: (agentId: OrbitAgentId, version: number, updatedAt: string) => void;
}) {
  const persistThread = useCallback((
    agentId: OrbitAgentId,
    reason: AssistantPersistenceReason = 'change',
  ) => {
    const fence = persistenceFenceRef.current;
    const fenceIsCurrent = () => fence.active && persistenceFenceRef.current === fence;
    if (!fenceIsCurrent()) return;
    // Capture the authenticated scope once. A request from an old component
    // instance must never pick up a newly logged-in user's credentials.
    const scopedAuthHeaders = authHeader();
    const queues = assistantThreadSaveQueuesRef.current;
    const queue = queues.get(agentId) ?? {
      pending: null,
      running: false,
      retryAttempt: 0,
      retryTimer: null,
      abortController: null,
    };
    queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
    // The synchronous journal survives a pagehide that outlives keepalive.
    // It is bounded and credential-scrubbed and never contains auth tokens or
    // pending attachment bytes.
    writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, queue.pending);
    queues.set(agentId, queue);
    if (queue.running) return;
    if (reason === 'change' && queue.retryTimer !== null) return;
    if (reason !== 'change' && queue.retryTimer !== null) {
      window.clearTimeout(queue.retryTimer);
      queue.retryTimer = null;
    }
    if (reason !== 'lifecycle' && !assistantPersistenceCanRun()) return;
    queue.running = true;
    void (async () => {
      let conflicts = 0;
      let retryRequired = false;
      try {
        while (queue.pending && fenceIsCurrent()) {
          const snapshot = queue.pending;
          queue.pending = null;
          const expectedVersion = useAssistantStore.getState().threads[agentId].version;
          const requestBody = JSON.stringify({ ...snapshot, expectedVersion });
          const controller = new AbortController();
          queue.abortController = controller;
          const response = await fetch(`/api/overseas/assistant-threads/${agentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...scopedAuthHeaders },
            body: requestBody,
            signal: controller.signal,
            // A pagehide can race an already-running save. Keep every request
            // below the browser limit alive, not just the lifecycle-triggered
            // retry, so the in-flight winner is not cancelled on navigation.
            keepalive: new TextEncoder().encode(requestBody).byteLength <= ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES,
          });
          const payload = await response.json().catch(() => null) as ({
            version?: unknown;
            updatedAt?: unknown;
            current?: unknown;
          } & Record<string, unknown>) | null;
          if (queue.abortController === controller) queue.abortController = null;
          if (!fenceIsCurrent()) return;
          if (response.status === 409) {
            const latestLocal = useAssistantStore.getState().threads[agentId];
            const remote = persistedAssistantThread(payload?.current, latestLocal);
            if (!remote || conflicts >= 4) {
              queue.pending = cloneAssistantThread(latestLocal);
              retryRequired = true;
              break;
            }
            const merged = mergeAssistantThread(remote, latestLocal);
            hydrateThread(agentId, merged);
            queue.pending = cloneAssistantThread(merged);
            writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, merged);
            conflicts += 1;
            continue;
          }
          if (!response.ok) {
            queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
            retryRequired = true;
            break;
          }
          const savedVersion = Number(payload?.version);
          if (!Number.isSafeInteger(savedVersion) || savedVersion <= expectedVersion) {
            queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
            retryRequired = true;
            break;
          }
          setPersistenceMetadata(
            agentId,
            savedVersion,
            typeof payload?.updatedAt === 'string' ? payload.updatedAt : '',
          );
          const latestAfterSave = useAssistantStore.getState().threads[agentId];
          if (!queue.pending && sameAssistantThreadJournalContent(snapshot, latestAfterSave)) {
            clearAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId);
          } else {
            queue.pending = cloneAssistantThread(latestAfterSave);
            writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, latestAfterSave);
          }
          conflicts = 0;
          queue.retryAttempt = 0;
        }
      } catch {
        if (!fenceIsCurrent()) return;
        queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
        writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, queue.pending);
        retryRequired = true;
      } finally {
        queue.abortController = null;
        queue.running = false;
        if (fenceIsCurrent() && queue.pending && retryRequired && queue.retryTimer === null && assistantPersistenceCanRun()) {
          const delay = assistantPersistenceRetryDelay(queue.retryAttempt);
          queue.retryAttempt = Math.min(queue.retryAttempt + 1, 4);
          queue.retryTimer = window.setTimeout(() => {
            queue.retryTimer = null;
            if (fenceIsCurrent()) persistThread(agentId, 'retry');
          }, delay);
        }
      }
    })();
  }, [assistantThreadSaveQueuesRef, hydrateThread, persistenceFenceRef, setPersistenceMetadata, stablePersistenceScope]);
  return persistThread;
}

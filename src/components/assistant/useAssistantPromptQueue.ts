import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrbitAgentId } from '../../stores/assistantStore';
import type { useAssistantSend } from './useAssistantSend';

type Entry = { id: string; text: string };
type Input = { scope: string; busy: boolean; blocked: boolean; agent: OrbitAgentId; send: ReturnType<typeof useAssistantSend>['send'] };
export const shouldQueuePrompt = (busy: boolean, dispatching: boolean, count: number) => busy || dispatching || count > 0;
export function clearQueuePauseWhenEmpty(paused: Set<string>, scope: string, count: number) {
  if (count === 0) paused.delete(scope);
}
const storageKey = (scope: string) => `lingshu:assistant:prompt-queue:${encodeURIComponent(scope)}`;

/** Session storage is optional; storage failures leave the current in-memory queue intact. */
export function readPromptQueue(scope: string): Entry[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(scope)) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is Entry => Boolean(entry && typeof entry.id === 'string' && typeof entry.text === 'string' && entry.text.trim()));
  } catch { return []; }
}
export function writePromptQueue(scope: string, entries: Entry[]) {
  try {
    if (entries.length) sessionStorage.setItem(storageKey(scope), JSON.stringify(entries));
    else sessionStorage.removeItem(storageKey(scope));
    return true;
  } catch { return false; }
}

/** Persist waiting items before dispatch; never automatically retry a dispatched request. */
export function useAssistantPromptQueue({ scope, busy, blocked, agent, send }: Input) {
  const queues = useRef<Record<string, Entry[]>>({});
  const initialized = useRef(new Set<string>());
  const storedScopes = useRef(new Set<string>());
  const pausedScopes = useRef(new Set<string>());
  const lastScope = useRef(scope);
  const dispatching = useRef(false);
  const [revision, setRevision] = useState(0);
  if (!initialized.current.has(scope)) {
    const restored = readPromptQueue(scope);
    queues.current[scope] = restored;
    if (restored.length) { pausedScopes.current.add(scope); storedScopes.current.add(scope); }
    initialized.current.add(scope);
  }
  if (lastScope.current !== scope) {
    if (queues.current[lastScope.current]?.length) pausedScopes.current.add(lastScope.current);
    lastScope.current = scope;
  }
  const update = useCallback((key: string, entries: Entry[]) => {
    const saved = writePromptQueue(key, entries);
    if (!saved && storedScopes.current.has(key)) {
      pausedScopes.current.add(key);
      setRevision(value => value + 1);
      return false;
    }
    queues.current[key] = entries;
    clearQueuePauseWhenEmpty(pausedScopes.current, key, entries.length);
    if (saved) { if (entries.length) storedScopes.current.add(key); else storedScopes.current.delete(key); }
    setRevision(value => value + 1);
    return true;
  }, []);
  const enqueue = useCallback((text: string) => {
    const value = text.trim();
    return value ? update(scope, [...(queues.current[scope] || []), { id: crypto.randomUUID(), text: value }]) : false;
  }, [scope, update]);
  const remove = useCallback((id: string) => update(scope, (queues.current[scope] || []).filter(entry => entry.id !== id)), [scope, update]);
  const resume = useCallback(() => { pausedScopes.current.delete(scope); setRevision(value => value + 1); }, [scope]);
  useEffect(() => {
    if (busy || blocked || dispatching.current || pausedScopes.current.has(scope)) return;
    const [first, ...rest] = queues.current[scope] || [];
    if (!first) return;
    // Do not send if an older stored copy could reappear after a refresh.
    const saved = writePromptQueue(scope, rest);
    if (!saved && storedScopes.current.has(scope)) {
      pausedScopes.current.add(scope);
      setRevision(value => value + 1);
      return;
    }
    if (saved) { if (rest.length) storedScopes.current.add(scope); else storedScopes.current.delete(scope); }
    dispatching.current = true;
    queues.current[scope] = rest;
    setRevision(value => value + 1);
    void send(first.text, agent, undefined, [], undefined, { preserveDraft: true }).catch(() => {
      pausedScopes.current.add(scope);
    }).finally(() => {
      dispatching.current = false;
      setRevision(value => value + 1);
    });
  }, [scope, busy, blocked, agent, send, update, revision]);
  return { entries: queues.current[scope] || [], enqueue, remove, paused: pausedScopes.current.has(scope), resume,
    shouldQueue: (generationBusy: boolean) => shouldQueuePrompt(generationBusy, dispatching.current, (queues.current[scope] || []).length) };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore.js';
import { emptyAssistantThread, type AssistantThreadSaveQueue } from './globalAssistantRuntime.js';
import { useAssistantThreadSaveQueue } from './useAssistantThreadSaveQueue.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('assistant save queue serializes updates and carries the latest CAS version', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const storage = new MemoryStorage();
  Object.assign(globalThis, {
    localStorage: storage,
    window: { localStorage: storage, location: { search: '' }, history: { state: null }, setTimeout, clearTimeout },
    document: { visibilityState: 'visible' },
  });
  const requests: Array<{ body: { expectedVersion: number; messages: Array<{ content: string }> }; respond: (response: Response) => void }> = [];
  globalThis.fetch = async (_url, init) => new Promise<Response>(resolve => {
    requests.push({ body: JSON.parse(String(init?.body)), respond: resolve });
  });
  try {
    useAssistantStore.getState().hydrateThread('business', emptyAssistantThread());
    const scope = { tenantId: 'tenant-a', userId: 'user-a' };
    const fenceRef = { current: { scopeKey: 'tenant-a\u0000user-a', active: true } };
    const pauseRef = { current: false };
    const queuesRef = { current: new Map<OrbitAgentId, AssistantThreadSaveQueue>() };
    let saveQueue: ReturnType<typeof useAssistantThreadSaveQueue> | undefined;
    renderToStaticMarkup(createElement(() => {
      saveQueue = useAssistantThreadSaveQueue({
        stablePersistenceScope: scope,
        persistenceFenceRef: fenceRef,
        assistantThreadSaveQueuesRef: queuesRef,
        persistencePauseRef: pauseRef,
        hydrateThread: useAssistantStore.getState().hydrateThread,
        setPersistenceMetadata: useAssistantStore.getState().setPersistenceMetadata,
      });
      return null;
    }));
    assert.ok(saveQueue);
    const { persistThread, waitForInFlightThreadSave } = saveQueue;
    useAssistantStore.getState().setMessages('business', [{ role: 'user', content: 'first' }]);
    pauseRef.current = true;
    persistThread('business');
    assert.equal(requests.length, 0, 'an atomic business mutation must exclude background thread saves');
    pauseRef.current = false;
    persistThread('business');
    pauseRef.current = true;
    let drained = false;
    const drain = waitForInFlightThreadSave('business').then(() => { drained = true; });
    await nextTick();
    assert.equal(drained, false, 'atomic mutation must wait while an earlier PUT still owns the CAS');
    requests[0]!.respond(new Response(JSON.stringify({ version: 1, updatedAt: 'now' }), { status: 200 }));
    await drain;
    assert.equal(useAssistantStore.getState().threads.business.version, 1);
    pauseRef.current = false;
    useAssistantStore.getState().setMessages('business', [{ role: 'user', content: 'latest' }]);
    persistThread('business');
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.body.expectedVersion, 1);
    assert.equal(requests[1]?.body.messages.at(-1)?.content, 'latest');
    requests[1]!.respond(new Response(JSON.stringify({ version: 2, updatedAt: 'later' }), { status: 200 }));
    await nextTick();
    assert.equal(useAssistantStore.getState().threads.business.version, 2);
    assert.equal(queuesRef.current.get('business')?.pending, null);
    useAssistantStore.getState().setMessages('business', [{ role: 'user', content: 'local-new' }]);
    persistThread('business');
    assert.equal(requests[2]?.body.expectedVersion, 2);
    requests[2]!.respond(new Response(JSON.stringify({ current: {
      ...emptyAssistantThread(), version: 3, updatedAt: 'remote',
      messages: [{ role: 'assistant', content: 'remote-old' }],
    } }), { status: 409 }));
    await nextTick();
    assert.equal(requests[3]?.body.expectedVersion, 3);
    assert.deepEqual(requests[3]?.body.messages.map(message => message.content), ['local-new']);
    requests[3]!.respond(new Response(JSON.stringify({ version: 4, updatedAt: 'merged' }), { status: 200 }));
    await nextTick();
    assert.equal(useAssistantStore.getState().threads.business.version, 4);
    useAssistantStore.getState().setMessages('business', [{ role: 'assistant', content: 'late streamed answer' }]);
    persistThread('business');
    requests[4]!.respond(new Response(JSON.stringify({ current: {
      ...emptyAssistantThread(), version: 5, conversationResetVersion: 5,
    } }), { status: 409 }));
    await nextTick();
    assert.deepEqual(useAssistantStore.getState().threads.business.messages, []);
    assert.equal(requests.length, 5, 'a clear conflict must not retry old messages');
    assert.equal(queuesRef.current.get('business')?.pending, null);
    useAssistantStore.getState().setMessages('business', [{ role: 'user', content: 'new after clear' }]);
    persistThread('business');
    requests[5]!.respond(new Response(JSON.stringify({ current: {
      ...emptyAssistantThread(), version: 6, conversationResetVersion: 6, deletedAt: 'now',
    } }), { status: 410 }));
    await nextTick();
    persistThread('business');
    assert.equal(requests.length, 6, 'deleted conversations never silently recreate');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow, localStorage: originalStorage, document: originalDocument });
  }
});

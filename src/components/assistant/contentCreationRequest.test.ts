import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestCreationReply } from './contentCreationRequest';
import { useAssistantStore } from '../../stores/assistantStore';
import { emptyAssistantThread, withoutPersistedConversation } from './globalAssistantRuntime';
import { writeAssistantThreadJournal, readAssistantThreadJournal } from '../../lib/assistantThreadJournal';
import type { CreationReply, CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
const selection = { referenceId: 'video-a', productIds: [], shotIds: [] };
const turn: CreationTurn = { action: 'start', selection, instruction: '请创作产品视频' };
const reply: CreationReply = { stage: 'products', selection: { ...selection, evidenceVersion: 'a'.repeat(64) }, referenceTitle: '参考 A', products: [{ id: 'p', name: '产品 A' }], shots: [], narrations: [], gaps: [], presenterIds: [] };

test('creation response uses one existing thread and journal; stale responses never overwrite it', async () => {
  const originalFetch = globalThis.fetch; const originalLocalStorage = globalThis.localStorage;
  const store = useAssistantStore.getState();
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.assign(globalThis, { localStorage: storage });
  let sent: unknown; let saved = 0;
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); return Response.json(reply); };
  store.hydrateThread('business', { ...emptyAssistantThread(), draftInput: '原派活草稿', creationDraft: selection });
  try {
    const input = { turn, isCurrent: () => true, controller: new AbortController(), persist: () => { saved++; } };
    assert.equal(await requestCreationReply(input), true);
    assert.deepEqual(sent, turn); assert.equal(saved, 1); assert.equal(store.threads.business?.creationDraft, null, 'store snapshots do not mutate in place');
    const thread = useAssistantStore.getState().threads.business;
    assert.equal(thread.messages.at(-1)?.creation?.referenceTitle, '参考 A');
    writeAssistantThreadJournal(storage, { tenantId: 'a', userId: 'user' }, 'business', thread);
    const restored = readAssistantThreadJournal(storage, { tenantId: 'a', userId: 'user' }, 'business');
    assert.ok(restored); assert.deepEqual(withoutPersistedConversation(restored).creationDraft, reply.selection);
    assert.equal(withoutPersistedConversation(restored).messages.at(-1)?.creation?.stage, 'products');
    assert.equal(readAssistantThreadJournal(storage, { tenantId: 'b', userId: 'user' }, 'business'), null);
    assert.equal(await requestCreationReply({ ...input, isCurrent: () => false }), false);
    assert.equal(saved, 1); assert.equal(useAssistantStore.getState().threads.business, thread);
    store.hydrateThread('business', emptyAssistantThread()); assert.equal(useAssistantStore.getState().threads.business.creationDraft, null);
  } finally { globalThis.fetch = originalFetch; Object.assign(globalThis, { localStorage: originalLocalStorage }); }
});

test('failed evidence reads preserve selections and draft for retry', async () => {
  const originalFetch = globalThis.fetch; const originalLocalStorage = globalThis.localStorage;
  Object.assign(globalThis, { localStorage: { getItem: () => null } });
  globalThis.fetch = async () => Response.json({ message: '素材库存暂不可用' }, { status: 503 });
  const store = useAssistantStore.getState(); store.hydrateThread('business', { ...emptyAssistantThread(), draftInput: '保留派活', creationDraft: selection });
  try {
    await assert.rejects(requestCreationReply({ turn, isCurrent: () => true, controller: new AbortController(), persist: () => assert.fail('failed reply cannot persist success') }), /库存暂不可用/);
    assert.equal(useAssistantStore.getState().threads.business.draftInput, '保留派活'); assert.deepEqual(useAssistantStore.getState().threads.business.creationDraft, selection);
  } finally { globalThis.fetch = originalFetch; Object.assign(globalThis, { localStorage: originalLocalStorage }); }
});

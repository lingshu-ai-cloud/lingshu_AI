import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useAssistantStore } from '../../stores/assistantStore';
import {
  emptyAssistantThread,
  mergeAssistantThread,
  persistedAssistantThread,
  withoutPersistedConversation,
} from './globalAssistantRuntime';

test('starting a new conversation clears the previous tombstone and reset metadata', () => {
  const store = useAssistantStore.getState();
  store.hydrateThread('business', { ...emptyAssistantThread(), conversationKey: 'conversation:old', deletedAt: 'deleted', conversationResetVersion: 9, title: '旧会话' });
  store.hydrateThread('business', { ...emptyAssistantThread(), conversationKey: 'conversation:new' });
  assert.equal(useAssistantStore.getState().threads.business.deletedAt, '');
  assert.equal(useAssistantStore.getState().threads.business.conversationResetVersion, 0);
  assert.equal(useAssistantStore.getState().threads.business.title, '');
});

test('a cleared or deleted remote conversation never merges stale local messages or references', () => {
  const stale = { ...emptyAssistantThread(), version: 5, messages: [{ role: 'user' as const, content: 'old private context' }], draftInput: 'stale input' };
  const cleared = { ...emptyAssistantThread(), version: 6, conversationResetVersion: 6, conversationKey: 'business' };
  assert.deepEqual(mergeAssistantThread(cleared, stale), cleared);
  assert.deepEqual(mergeAssistantThread({ ...cleared, deletedAt: '2026-10-27T00:00:00Z' }, stale).messages, []);
  const restored = persistedAssistantThread({ ...cleared, agentId: 'conversation:next', title: '下一次会话' }, stale)!;
  assert.equal(restored.conversationKey, 'conversation:next');
  assert.equal(restored.conversationResetVersion, 6);
});

test('restored thread keeps server CAS metadata but does not reopen old conversation text', () => {
  const remote = persistedAssistantThread({
    ...emptyAssistantThread(), version: 7, updatedAt: 'server-version-7',
    messages: [{ role: 'user', content: 'old conversation' }], draftInput: 'old draft',
  }, emptyAssistantThread());
  assert.ok(remote);
  const fresh = withoutPersistedConversation(remote);
  assert.equal(fresh.version, 7);
  assert.equal(fresh.updatedAt, 'server-version-7');
  assert.deepEqual(fresh.messages, []);
  assert.equal(fresh.draftInput, '');
});

test('local input made during hydration survives a later remote snapshot', () => {
  const remote = { ...emptyAssistantThread(), version: 8, updatedAt: 'server-version-8',
    messages: [{ role: 'assistant' as const, content: 'old answer' }] };
  const local = { ...emptyAssistantThread(), messages: [{ role: 'user' as const, content: 'new question' }],
    draftInput: 'new draft' };
  const merged = mergeAssistantThread(remote, local);
  assert.equal(merged.version, 8);
  assert.equal(merged.updatedAt, 'server-version-8');
  assert.deepEqual(merged.messages, local.messages);
  assert.equal(merged.draftInput, 'new draft');
});

test('a company report artifact retains its scoped dialogue on refresh while ordinary conversations remain transient', () => {
  const thread = emptyAssistantThread();
  thread.messages = [{ role: 'assistant', content: '研究草稿', companyReport: { id: 'cr_test' } as NonNullable<import('../../appSession').Message['companyReport']> }];
  assert.deepEqual(withoutPersistedConversation(thread).messages, thread.messages);
});

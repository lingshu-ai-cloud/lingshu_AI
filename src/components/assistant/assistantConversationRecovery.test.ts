import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyAssistantThread } from './globalAssistantRuntime';
import { resolveAssistantConversationSelection } from './useAssistantThreadHydration';
import { assistantConversationCanDelete } from './useAssistantConversationManagement';

test('a deleted active pointer resumes the newest available conversation instead of showing a tombstone', () => {
  const selected = {
    id: 'deleted-row', agentId: 'business', deletedAt: '2026-10-27T15:02:37.636Z', version: 2030,
  };
  const current = {
    id: 'active-row', agentId: 'conversation:e59984f4-1910-477f-b4fe-92b473b4aed1', deletedAt: '', version: 184,
  };
  const resolved = resolveAssistantConversationSelection('business', selected, [current], 'conversation:fresh');
  assert.equal(resolved.key, current.agentId);
  assert.equal(resolved.item, current);
  assert.equal(resolved.changed, true);
});

test('a confirmed tombstone without another active row starts a distinct unsaved conversation', () => {
  const resolved = resolveAssistantConversationSelection(
    'conversation:deleted',
    { id: 'deleted-row', agentId: 'conversation:deleted', deletedAt: 'now' },
    [],
    'conversation:fresh',
  );
  assert.deepEqual(resolved, { key: 'conversation:fresh', item: null, changed: true });
});

test('a lost default pointer reuses an existing active conversation', () => {
  const current = { id: 'active-row', agentId: 'conversation:active', deletedAt: '' };
  const resolved = resolveAssistantConversationSelection(
    'business',
    { id: '', agentId: 'business', deletedAt: '' },
    [current],
    'conversation:fresh',
  );
  assert.equal(resolved.key, 'conversation:active');
  assert.equal(resolved.item, current);
});

test('a visible unsent draft can be deleted even before its first server save', () => {
  const thread = { ...emptyAssistantThread(), conversationKey: 'conversation:new', draftInput: '创建周计划' };
  assert.equal(assistantConversationCanDelete(thread), true);
  assert.equal(assistantConversationCanDelete({ ...emptyAssistantThread(), conversationKey: 'conversation:new' }), false);
});

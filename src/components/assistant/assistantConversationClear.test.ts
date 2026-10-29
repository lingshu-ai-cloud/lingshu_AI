import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantConversationCanClear } from './useAssistantConversationManagement';
import { emptyAssistantThread } from './globalAssistantRuntime';

test('a reference card remains clearable after the transcript is already empty', () => {
  const thread = emptyAssistantThread();
  assert.equal(assistantConversationCanClear(thread), false);
  assert.equal(assistantConversationCanClear(thread, true), true);
  assert.equal(assistantConversationCanClear({ ...thread, draftInput: 'draft' }), true);
  assert.equal(assistantConversationCanClear({ ...thread, messages: [{ role: 'assistant', content: 'reply' }] }), true);
});

test('conversation reset removes weekly cards and fences delayed preparation without changing persisted business records', () => {
  const hook = readFileSync(new URL('./useAssistantWeeklyPlanExperience.ts', import.meta.url), 'utf8');
  const reset = hook.slice(hook.indexOf('const resetConversation ='), hook.indexOf('const refresh ='));
  for (const expected of ['conversationEpoch.current += 1', 'setProposal(null)', 'setDraft(null)', 'setGuidance(null)', 'setReferenceGap(null)', "setReferenceMessage('')", 'setFactsRecovery(null)', 'setModalOpen(false)']) assert.ok(reset.includes(expected), expected);
  assert.doesNotMatch(reset, /digitalEmployeeApi|socialDiscoveryApi|setOverview/);
  const prepare = hook.slice(hook.indexOf('const prepare ='), hook.indexOf('const saveDraft ='));
  assert.match(prepare, /await digitalEmployeeApi\.weeklyReferenceReadiness\(goalId\);\s*if \(epoch !== conversationEpoch.current\) return ''/);
  const parent = readFileSync(new URL('../GlobalAssistant.tsx', import.meta.url), 'utf8');
  const clearing = parent.slice(parent.indexOf('const resetTransientConversation ='), parent.indexOf('const openAgent ='));
  assert.match(clearing, /weeklyPlanExperience\.resetConversation\(\)/);
  assert.match(parent, /hasTransientContent: weeklyPlanExperience\.hasConversationContent/);
});

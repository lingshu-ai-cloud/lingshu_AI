import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLegacyUnboundOperationNotice, isUnboundOperationError } from './assistantOperationNotice';
import type { AssistantTaskCard } from '../stores/assistantStore';

test('legacy unbound notice is hidden after hydration, real work is preserved', () => {
  const notice = { title: '这次操作尚未执行', conclusion: '这条指令无法安全绑定到唯一的任务和版本，因此没有执行。', secondaryActions: [] } as unknown as AssistantTaskCard;
  assert.equal(isLegacyUnboundOperationNotice(notice), true);
  assert.equal(isLegacyUnboundOperationNotice({ ...notice, workspace: { label: '任务', href: '/task/1' } }), false);
  assert.equal(isLegacyUnboundOperationNotice({ ...notice, title: '口播待确认' }), false);
  assert.equal(isLegacyUnboundOperationNotice(null), false);
});
test('only unbound operation guards become inline notices', () => {
  assert.equal(isUnboundOperationError('assistant_mutation_requires_signed_action'), true);
  assert.equal(isUnboundOperationError('assistant_mutation_not_supported'), true);
  assert.equal(isUnboundOperationError('assistant_action_result_unknown'), false);
  assert.equal(isUnboundOperationError(undefined), false);
});

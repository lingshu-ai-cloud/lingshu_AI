import { withoutPersistedConversation } from '../components/assistant/globalAssistantRuntime';
import assert from 'node:assert/strict';
import test from 'node:test';
import { appendProductionReceipt } from './assistantProductionPortal.js';
import type { SocialAssistantReceipt } from './socialContentApi.js';
import { parseMessages } from '../../server/routes/assistantThreadMessageInput.js';
import { sanitizeAssistantThreadForJournal } from './assistantThreadJournal.js';
import { emptyAssistantThread } from '../components/assistant/globalAssistantRuntime.js';
import { productionPortalNavigation } from '../components/assistant/AssistantProductionPortal.js';

test('the portal is persisted only after acceptance and a retry updates the original pointer', () => {
  const response = { task: { brief: { title: '产品视频' } }, receipt: { taskId: 'content', queued: false } } as SocialAssistantReceipt;
  assert.equal(appendProductionReceipt([], '仅保存任务', response)[0]!.taskPortal, undefined);
  response.receipt.queued = true;
  const first = appendProductionReceipt([], '已入队', response);
  const again = appendProductionReceipt(first, '读取原运行', response);
  assert.equal(again.length, 1);
  assert.equal(again[0]!.taskPortal?.taskId, 'content');
  assert.equal(again[0]!.taskPortal?.action, 'view_production');
  assert.deepEqual(parseMessages(again), again);
  assert.equal(sanitizeAssistantThreadForJournal({ ...emptyAssistantThread(), messages: again }).messages[0]?.taskPortal?.taskId, 'content');
  const navigation = productionPortalNavigation('content');
  assert.equal(navigation.socialContentTaskId, 'content');
  assert.equal(navigation.page, 'socialInspiration');
  assert.equal(navigation.view, 'tasks');
  assert.equal(navigation.directStudio, false, 'open the original task detail, not the generic editor');
});

assert.equal(withoutPersistedConversation({ ...emptyAssistantThread(), messages: [{ role: "assistant", content: "", taskPortal: { kind: "content_task", taskId: "task", action: "view_production", phase: "ready", title: "制作" } }] }).messages.length, 1);

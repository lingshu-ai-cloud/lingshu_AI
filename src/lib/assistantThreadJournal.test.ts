import assert from 'node:assert/strict';
import type { AgentThreadState } from '../stores/assistantStore.js';
import {
  assistantThreadJournalKey,
  clearAssistantThreadJournal,
  readAssistantThreadJournal,
  sanitizeAssistantThreadForJournal,
  sameAssistantThreadJournalContent,
  writeAssistantThreadJournal,
} from './assistantThreadJournal.js';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const scope = { tenantId: 'tenant-a', userId: 'user-a' };
const thread: AgentThreadState = {
  version: 7,
  updatedAt: '2026-10-10T00:00:00.000Z',
  messages: [{
    role: 'user',
    content: '离线草稿前一条消息 https://files.example.test/message.mp4?X-Amz-Signature=message-signature&safe=ok /api/media/private.mp4?assetToken=relative-asset-secret&safe=ok https://embedded-user:embedded-password@files.example.test/private.mp4',
    sources: [{
      title: '预签名来源',
      uri: 'https://files.example.test/source.mp4?X-Amz-Signature=source-signature&X-Amz-Credential=source-credential&safe=ok',
    }],
  }],
  draftInput: '重载后仍需恢复的草稿 https://files.example.test/draft.mp4?X-Goog-Signature=draft-signature&safe=ok',
  scrollPosition: 483,
  unreadCount: 2,
  isFollowingLatest: false,
  paused: false,
  taskCards: {
    plan: {
      taskId: 'plan',
      title: '确认本周计划',
      conclusion: '等待确认',
      details: ['5 条母版 https://files.example.test/detail.mp4?sig=detail-signature&safe=ok'],
      items: [{
        id: 'preview-1',
        title: '素材预览',
        thumbnailUrl: 'https://files.example.test/thumb.jpg?sig=thumbnail-signature&safe=ok',
      }],
      status: 'approval',
      notificationReason: 'approval_required',
      primaryAction: {
        id: 'confirm',
        label: '确认',
        actionId: 'confirm_choice',
        href: '/?page=digitalEmployees&accessToken=url-access-secret&apiKey=url-api-secret&X-Goog-Signature=url-goog-signature&safe=ok',
        parameters: {
          option: 'confirm',
          access_token: 'must-not-persist',
          accessToken: 'camel-access-secret',
          refreshToken: 'camel-refresh-secret',
          apiKey: 'camel-api-secret',
          clientSecret: 'camel-client-secret',
          nested: { sessionToken: 'nested-session-secret', safe: 'kept' },
          callbackUrl: 'https://example.test/callback?accessToken=text-url-secret&safe=ok',
        },
      },
      secondaryActions: [],
      updatedAt: 9,
    },
  },
  focusedTaskId: 'plan',
};

const storage = new MemoryStorage();
assert.equal(writeAssistantThreadJournal(storage, scope, 'business', thread), true);
const key = assistantThreadJournalKey(scope, 'business');
assert.ok(storage.getItem(key), 'pagehide must leave a synchronous local journal before the request can be lost');
const serialized = storage.getItem(key) || '';
assert.doesNotMatch(
  serialized,
  /must-not-persist|camel-access-secret|camel-refresh-secret|camel-api-secret|camel-client-secret|nested-session-secret|url-access-secret|url-api-secret|text-url-secret|source-signature|source-credential|thumbnail-signature|url-goog-signature|message-signature|draft-signature|detail-signature|relative-asset-secret|embedded-user|embedded-password|access_token|accessToken|refreshToken|apiKey|clientSecret|sessionToken|X-Amz-Signature|X-Amz-Credential|X-Goog-Signature/,
  'snake_case and camelCase credentials must never enter the local journal',
);
assert.match(serialized, /safe=ok|safe%3Dok/, 'non-secret URL state is preserved');

// Simulate a full reload: no in-memory queue survives, only localStorage does.
const reloaded = readAssistantThreadJournal(storage, scope, 'business');
assert.ok(reloaded);
assert.equal(reloaded.draftInput, sanitizeAssistantThreadForJournal(thread).draftInput);
assert.equal(reloaded.scrollPosition, thread.scrollPosition);
assert.equal(reloaded.focusedTaskId, 'plan');
assert.equal(reloaded.taskCards.plan.title, '确认本周计划');
assert.equal(sameAssistantThreadJournalContent(reloaded, thread), true, 'journal equality compares the same safe representation');

assert.equal(readAssistantThreadJournal(storage, { tenantId: 'tenant-b', userId: 'user-a' }, 'business'), null);
assert.equal(readAssistantThreadJournal(storage, { tenantId: 'tenant-a', userId: 'user-b' }, 'business'), null);
assert.equal(readAssistantThreadJournal(storage, scope, 'director'), null, 'agent journals are isolated too');

clearAssistantThreadJournal(storage, scope, 'business');
assert.equal(readAssistantThreadJournal(storage, scope, 'business'), null, 'server success clears the recovered journal');

console.log('assistant thread reload journal tests passed');

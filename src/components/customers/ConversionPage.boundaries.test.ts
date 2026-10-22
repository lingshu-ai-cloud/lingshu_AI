import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CustomerProfile } from '../../types/customer';
import { createMessageEvent, sendCustomerOutbox } from './customerConversationDelivery.js';
import { customerServicePresentation } from './customerServicePresentation.js';
import { isSuggestionDismissed, suggestionDismissKey } from './customerSuggestionDismissal.js';

test('客户发送适配器保留模拟隔离和真实渠道请求形态', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ status: 'sent', outboxId: 'outbox-1' });
  };
  try {
    const mock = { id: 'mock-1', isMock: true, source: 'messenger' } as CustomerProfile;
    assert.equal((await sendCustomerOutbox(mock, 'request-mock', 'hello', false)).status, 'delivered');
    assert.equal(calls.length, 0, '模拟客户不得发送 HTTP 请求');
    const real = { id: 'real-1', source: 'instagram', instagramUserId: 'instagram-1' } as CustomerProfile;
    assert.equal((await sendCustomerOutbox(real, 'request-1', 'hello', false)).status, 'sent');
    assert.deepEqual(calls, [{ url: '/api/overseas/customers/real-1/outbox', body: {
      requestId: 'request-1', body: 'hello', mode: 'free_text', outsideWindow: false, to: 'instagram-1',
    } }]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});

test('页面继续接入客户定位、草稿、发送和真人接管边界', () => {
  const page = readFileSync(new URL('../ConversionPage.tsx', import.meta.url), 'utf8');
  const session = readFileSync(new URL('./useConversionSessionEffects.ts', import.meta.url), 'utf8');
  const drafts = readFileSync(new URL('./useConversionDraftEffects.ts', import.meta.url), 'utf8');
  assert.match(page, /useConversionSessionEffects\(/);
  assert.match(page, /useConversionDraftEffects\(/);
  assert.match(page, /sendCustomerOutbox\(/);
  assert.match(page, /customerManualTakeoverApi\.hold\(/);
  assert.match(session, /readCustomerItemNavigation\(/);
  assert.match(session, /getCustomerServiceStatus\(/);
  assert.match(drafts, /requestDraft\(selected\)/);
  assert.match(drafts, /agent: 'conversion',[\s\S]{0,80}sourcePage: 'conversion'/);
});

test('客服状态展示保留读取失败和部分直回的可辨识文案', () => {
  assert.deepEqual(customerServicePresentation(null, true, false), {
    label: '读取失败', summary: '暂时没读到客服状态，点一下开关可重新尝试。',
  });
  const status = { enabled: true, observationDay: 2, partialAutoReplyEnabled: true, eligibleForPartialAutoReply: true } as Parameters<typeof customerServicePresentation>[0];
  assert.equal(customerServicePresentation(status, false, true).label, '部分直回');
  assert.match(customerServicePresentation(status, false, false).summary, /已开放权限/);
  assert.equal(createMessageEvent('c-1', 'hello', 'buyer').title, '客户消息');
});

test('客户建议的暂不处理状态由会话与侧栏共享同一键', () => {
  const originalStorage = globalThis.localStorage;
  const key = suggestionDismissKey('c-1', 'followup');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (name: string) => name === key ? String(Date.now() + 60_000) : null } });
  try {
    assert.equal(isSuggestionDismissed('c-1', 'followup'), true);
    assert.equal(isSuggestionDismissed('c-2', 'followup'), false);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});

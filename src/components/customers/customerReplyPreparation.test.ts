import assert from 'node:assert/strict';
import test from 'node:test';
import type {CustomerProfile} from '../../types/customer';
import {isWaitingForHumanQuote, replyLanguage, requestDraft} from './customerReplyPreparation';

const customer = {
  id: 'customer-1',
  name: 'Buyer',
  language: '英语',
  product: 'Widget',
  outboundProduct: 'Widget',
  stage: 'lead',
  handlingReason: '',
  timeline: [{id: 'buyer-1', type: 'messenger', actor: 'buyer', body: 'What is the unit price?', timestamp: Date.now()}],
} as unknown as CustomerProfile;

test('reply preparation keeps quote questions in the human lane', () => {
  assert.equal(replyLanguage(customer), 'English');
  assert.equal(isWaitingForHumanQuote(customer), true);
  assert.equal(isWaitingForHumanQuote({...customer, timeline: [{...customer.timeline[0], body: 'Hello'}]}), false);
});

test('explicit manual draft preserves its request marker and editable Chinese draft', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let requestBody: Record<string, unknown> | undefined;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {getItem: () => null},
  });
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({draft: 'Please share the quantity.', translatedDraft: '请提供数量。'}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  };
  try {
    const result = await requestDraft(customer, '请生成草稿', undefined, 'reply', true);
    assert.equal(requestBody?.manualRequest, true);
    assert.equal(requestBody?.customerId, customer.id);
    assert.equal(result.draft, '请提供数量。');
    assert.equal(result.originalDraft, 'Please share the quantity.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as {localStorage?: Storage}).localStorage;
  }
});

import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptRecoveryForm, verifyPublishingReceipt, type ReceiptAttempts } from './PublishingReceiptRecovery';
const data: ReceiptAttempts = { platform: 'youtube', querySupported: true, attempts: { account: { status: 'unknown', attemptId: 'attempt' }, done: { status: 'published' } } };
const markup = renderToStaticMarkup(<ReceiptRecoveryForm data={data} busy={false} error="" values={{}} onChange={() => {}} onVerify={() => {}} />);
assert.match(markup, /已停止自动重发/); assert.match(markup, /YouTube 平台视频 ID/); assert.match(markup, /disabled/); assert.doesNotMatch(markup, /发布账号：done/);
const unsupported = renderToStaticMarkup(<ReceiptRecoveryForm data={{ ...data, querySupported: false, platform: 'facebook' }} busy={false} error="" values={{}} onChange={() => {}} onVerify={() => {}} />);
assert.match(unsupported, /暂不支持可信回执查询/); assert.doesNotMatch(unsupported, /<input/);
let calls = 0;
await assert.rejects(() => verifyPublishingReceipt('post', 'account', 'attempt', '', async () => { calls++; throw Error('must not query'); }), /填写/);
assert.equal(calls, 0);
// Auth helper requires the browser's storage; the injected fetch still prevents
// every real network operation in this fixture.
(globalThis as any).localStorage = { getItem: () => null };
await assert.rejects(() => verifyPublishingReceipt('post', 'account', 'attempt', 'platform-id', (async (_url: string, init: RequestInit) => {
  calls++; assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { accountId: 'account', attemptId: 'attempt', platformPostId: 'platform-id' });
  return { ok: false, json: async () => ({ error: '证据不匹配' }) };
}) as typeof fetch), /证据不匹配/);
assert.equal(calls, 1);
console.log('publishing receipt recovery UI passed');

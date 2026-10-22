import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { BatchFollowupTruthPanel } from './BatchFollowupTruthPanel';

function overview(authorized: boolean, messagesSent?: number): DigitalEmployeeOverview {
  return { tasks: [
    { task_key: 'followup_batch_draft', status: 'succeeded', business_refs: [{ type: 'followup_batch', id: 'batch-1' }] },
    { task_key: 'followup_batch_approval', status: 'succeeded' },
    { task_key: 'followup_dispatch', status: messagesSent ? 'succeeded' : 'waiting_external',
      blocked_reason: authorized ? '' : '渠道尚未授权',
      output: { bulkWorkerStatus: 'manual_or_scheduled', messagingAuthorization: { manualFollowupSendAllowed: authorized }, messagesSent } },
  ] } as unknown as DigitalEmployeeOverview;
}

test('manual follow-up stays disabled without tenant and provider authorization', () => {
  const html = renderToStaticMarkup(createElement(BatchFollowupTruthPanel, {
    data: overview(false), onOpen: () => undefined, onDispatch: () => undefined, statusLabel: {},
  }));
  assert.match(html, /真实发送未就绪/);
  assert.match(html, /disabled=""/);
  assert.match(html, /渠道尚未授权/);
  assert.match(html, /批准的是逐客草稿批次，不等于消息已经发出/);
});

test('authorized due-item action and persisted send receipts remain distinct', () => {
  const ready = renderToStaticMarkup(createElement(BatchFollowupTruthPanel, {
    data: overview(true), onOpen: () => undefined, onDispatch: () => undefined, statusLabel: {},
  }));
  assert.match(ready, /发送已到期客户/);
  assert.doesNotMatch(ready, /disabled=""/);
  const sent = renderToStaticMarkup(createElement(BatchFollowupTruthPanel, {
    data: overview(true, 2), onOpen: () => undefined, onDispatch: () => undefined, statusLabel: {},
  }));
  assert.match(sent, /真实发送回执/);
  assert.match(sent, /已有 2 位客户取得真实发送回执/);
  assert.doesNotMatch(sent, /发送已到期客户/);
});

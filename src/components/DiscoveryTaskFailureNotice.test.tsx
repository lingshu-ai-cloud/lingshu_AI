import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import type { WorkflowTask } from '../lib/digitalEmployees';
import DiscoveryTaskFailureNotice from './DiscoveryTaskFailureNotice';

function render(task_key: string, status: string, blocked_reason: string) {
  const task = { task_key, status, blocked_reason } as WorkflowTask;
  return renderToStaticMarkup(createElement(DiscoveryTaskFailureNotice, { task }));
}

test('failed collection shows diagnosis, next step, and unmodified provider reason', () => {
  const html = render('scheduled_source_collection', 'failed', 'TikTok: HTTP 401 invalid api key');
  assert.match(html, /平台鉴权失败/);
  assert.match(html, /检查对应平台的 API Key/);
  assert.match(html, /原始原因：TikTok: HTTP 401 invalid api key/);
});

test('unclassified collection blocker still preserves original reason', () => {
  const html = render('scheduled_source_collection', 'waiting_human', '需要人工核对范围');
  assert.match(html, /素材采集需要处理/);
  assert.match(html, /原始原因：需要人工核对范围/);
});

test('unrelated or unblocked work does not show a collection alert', () => {
  assert.equal(render('viral_analysis', 'failed', 'HTTP 401'), '');
  assert.equal(render('scheduled_source_collection', 'succeeded', '旧错误'), '');
  assert.equal(render('scheduled_source_collection', 'failed', ''), '');
});

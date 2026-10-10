import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskMonitorView } from './taskMonitorView';

test('shared content project tasks use distinct monitoring surfaces', () => {
  const views = [
    taskMonitorView('content_mode_routing', 'succeeded'),
    taskMonitorView('content_production', 'waiting_external'),
    taskMonitorView('content_quality_gate', 'pending'),
  ];
  assert.equal(new Set(views).size, 3);
  assert.equal(views[1], 'browser');
});
test('ended tasks never reconnect to the evolving project browser', () => {
  for (const status of ['succeeded', 'completed', 'cancelled', 'failed']) {
    for (const key of ['content_production', 'followup_dispatch', undefined]) {
      assert.notEqual(taskMonitorView(key, status), 'browser');
    }
  }
});
test('active production and customer tasks keep real browser monitoring', () => {
  for (const key of ['content_production', 'followup_dispatch']) {
    for (const status of ['running', 'waiting_external', 'waiting_human']) {
      assert.equal(taskMonitorView(key, status), 'browser');
    }
  }
});

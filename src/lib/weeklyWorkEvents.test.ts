import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyWeeklyWorkUpdated, WEEKLY_WORK_UPDATED_EVENT } from './weeklyWorkEvents';

test('weekly-work notifications carry only validated receipts for the same goal', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  const received: unknown[] = [];
  target.addEventListener(WEEKLY_WORK_UPDATED_EVENT, event => received.push((event as CustomEvent).detail));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try {
    const execution = { goalId: 'goal', runId: 'run', status: 'planning', taskCount: 4, startedAt: '2026-10-11T00:00:00Z' };
    notifyWeeklyWorkUpdated({ source: 'page', goalId: 'goal', execution });
    notifyWeeklyWorkUpdated({ source: 'assistant', goalId: 'other', execution });
    notifyWeeklyWorkUpdated({ source: 'page', goalId: 'goal', execution: { ...execution, taskCount: 0 } });
    notifyWeeklyWorkUpdated({ source: 'page', goalId: ' ' });
    assert.deepEqual(received, [
      { source: 'page', goalId: 'goal', execution },
      { source: 'assistant', goalId: 'other' },
      { source: 'page', goalId: 'goal' },
    ]);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('confirmed fact synchronization appends a durable assistant status without reporting production started', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget(), replies: Array<{ assistantText: string }> = [];
  target.addEventListener('lingshu-assistant-open', event => replies.push((event as CustomEvent).detail));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try {
    notifyWeeklyWorkUpdated({ source: 'assistant', goalId: 'goal' });
    assert.equal(replies.length, 0);
    notifyWeeklyWorkUpdated({ source: 'assistant', goalId: 'new-draft', factsSynchronized: true });
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.assistantText, /已按最新企业资料同步/);
    assert.match(replies[0]!.assistantText, /生产尚未开始/);
    assert.doesNotMatch(replies[0]!.assistantText, /制作资料已齐|已经开始生产/);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingWeekWindow, splitTextList, taskReportActions } from './schedulerTaskReport.js';

test('weekly report window starts on Monday in Beijing time', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z');
  const window = beijingWeekWindow(now);
  assert.equal(new Date(window.startMs).toISOString(), '2026-10-18T16:00:00.000Z');
  assert.equal(window.endMs, now);
});

test('report action and platform parsing stay available after extraction', () => {
  assert.deepEqual(splitTextList('youtube, TikTok；Instagram'), ['youtube', 'TikTok', 'Instagram']);
  assert.equal(taskReportActions('exchange_rate')[0]?.agentLabel, '我的客户');
});

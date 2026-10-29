import assert from 'node:assert/strict';
import test from 'node:test';
import { readWeeklyQueueOverview } from './weeklyQueueOverviewRead';

test('hung overview stops loading, aborts its read and never auto-retries', async () => {
  let calls = 0;
  let readSignal: AbortSignal | undefined;
  await assert.rejects(readWeeklyQueueOverview(signal => {
    calls++;
    readSignal = signal;
    return new Promise(() => {});
  }, new AbortController().signal, 5), /周任务读取超时/);
  assert.equal(readSignal?.aborted, true);
  assert.equal(calls, 1);
});

test('closing the view cancels its pending read', async () => {
  const controller = new AbortController();
  const result = readWeeklyQueueOverview(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('success and server failure settle immediately without waiting for timeout', async () => {
  assert.deepEqual(await readWeeklyQueueOverview(async () => ({ plan: 'original' }), new AbortController().signal), { plan: 'original' });
  await assert.rejects(readWeeklyQueueOverview(async () => { throw new Error('503'); }, new AbortController().signal), /503/);
});

test('already closed view starts no request', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(readWeeklyQueueOverview(async () => { called = true; }, controller.signal), { name: 'AbortError' });
  assert.equal(called, false);
});

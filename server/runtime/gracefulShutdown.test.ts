import assert from 'node:assert/strict';
import test from 'node:test';
import { createGracefulShutdown } from './gracefulShutdown.js';

test('successful drain exits even when background handles would keep the event loop alive', () => {
  const events: string[] = [];
  let closeCallback: ((error?: Error) => void) | undefined;
  let deadlineCallback: (() => void) | undefined;
  const timer = { unref: () => events.push('deadline-unref') } as unknown as ReturnType<typeof setTimeout>;
  const shutdown = createGracefulShutdown({
    server: {
      close(callback) { events.push('server-close'); closeCallback = callback as (error?: Error) => void; return this as never; },
      closeIdleConnections() { events.push('close-idle'); },
      closeAllConnections() { events.push('close-all'); },
    },
    stop: [() => events.push('stop-jobs'), () => events.push('stop-messenger')],
    scheduleDeadline(callback) { deadlineCallback = callback; events.push('deadline-scheduled'); return timer; },
    clearDeadline(actual) { assert.equal(actual, timer); events.push('deadline-cleared'); },
    exit(code) { events.push(`exit-${code}`); },
    log: { log: message => events.push(String(message)), error: message => events.push(String(message)) },
  });

  shutdown('SIGTERM');
  shutdown('SIGINT');
  assert.deepEqual(events.slice(0, 7), [
    'stop-jobs',
    'stop-messenger',
    '[runtime] SIGTERM received; draining HTTP connections',
    'deadline-scheduled',
    'deadline-unref',
    'server-close',
    'close-idle',
  ]);

  closeCallback?.();
  assert.deepEqual(events.slice(-2), ['deadline-cleared', 'exit-0']);
  assert.ok(deadlineCallback, 'deadline remains available until HTTP drain completes');
});

test('cleanup failure cannot strand the process and exits nonzero after HTTP drain', () => {
  const events: string[] = [];
  const timer = { unref() {} } as unknown as ReturnType<typeof setTimeout>;
  const shutdown = createGracefulShutdown({
    server: {
      close(callback) { events.push('server-close'); callback?.(); return this as never; },
      closeIdleConnections() { events.push('close-idle'); },
    },
    stop: [() => { throw new Error('worker stop failed'); }, () => events.push('second-cleanup-ran')],
    scheduleDeadline() { return timer; },
    clearDeadline() { events.push('deadline-cleared'); },
    exit(code) { events.push(`exit-${code}`); },
    log: { log() {}, error: () => events.push('logged-error') },
  });

  shutdown('SIGINT');
  assert.deepEqual(events, [
    'logged-error',
    'second-cleanup-ran',
    'server-close',
    'deadline-cleared',
    'exit-1',
    'close-idle',
  ]);
});

test('deadline destroys remaining connections and exits when HTTP never drains', () => {
  const events: string[] = [];
  let deadlineCallback!: () => void;
  const timer = { unref() {} } as unknown as ReturnType<typeof setTimeout>;
  const shutdown = createGracefulShutdown({
    server: {
      close() { events.push('server-close'); return this as never; },
      closeAllConnections() { events.push('close-all'); },
    },
    stop: [],
    deadlineMs: 25,
    scheduleDeadline(callback, delayMs) { deadlineCallback = callback; events.push(`deadline-${delayMs}`); return timer; },
    exit(code) { events.push(`exit-${code}`); },
    log: { log() {}, error: () => events.push('deadline-error') },
  });

  shutdown('SIGTERM');
  deadlineCallback();
  assert.deepEqual(events, ['deadline-25', 'server-close', 'deadline-error', 'close-all', 'exit-1']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readHomeFirstRun, resetHomeFirstRun, writeHomeFirstRun } from './homeFirstRun';

test('first-run progress is scoped to one signed-in user and keeps independent card completion', () => {
  const values = new Map<string, string>();
  const previousWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  } });
  try {
    assert.deepEqual(readHomeFirstRun('tenant-a:user-a'), { entered: false, growthCompleted: false });
    writeHomeFirstRun('tenant-a:user-a', { entered: true });
    writeHomeFirstRun('tenant-a:user-a', { growthCompleted: true });
    assert.deepEqual(readHomeFirstRun('tenant-a:user-a'), { entered: true, growthCompleted: true });
    assert.deepEqual(readHomeFirstRun('tenant-a:user-b'), { entered: false, growthCompleted: false });
    assert.deepEqual(resetHomeFirstRun('tenant-a:user-a'), { entered: true, growthCompleted: false });
    assert.deepEqual(readHomeFirstRun('tenant-a:user-a'), { entered: true, growthCompleted: false });
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

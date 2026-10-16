import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_STATE_INVALIDATED_EVENT,
  notifyAssistantStateInvalidated,
  subscribeAssistantStateInvalidations,
} from './assistantStateInvalidation';

test('business mutations invalidate decision surfaces without copying business payloads', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget() as EventTarget & { localStorage: { setItem: (key: string, value: string) => void } };
  const stored: Array<[string, string]> = [];
  target.localStorage = { setItem: (key, value) => stored.push([key, value]) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  let subscriptions = 0;
  let detail: unknown;
  target.addEventListener(ASSISTANT_STATE_INVALIDATED_EVENT, event => { detail = (event as CustomEvent).detail; });
  const unsubscribe = subscribeAssistantStateInvalidations(() => { subscriptions += 1; });
  try {
    notifyAssistantStateInvalidated({ domain: 'presenter-assets', source: '/presenters/refresh', entityId: 'person-1' });
    assert.equal(subscriptions, 1);
    assert.deepEqual(detail && typeof detail === 'object' ? Object.keys(detail as object).sort() : [],
      ['changedAt', 'domain', 'entityId', 'source']);
    assert.equal(stored.length, 1, 'cross-tab invalidation stores only the compact revision envelope');
    assert.doesNotMatch(stored[0]![1], /avatar|rightsEvidence|assetUri/);
  } finally {
    unsubscribe();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

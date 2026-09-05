import assert from 'node:assert/strict';
import { consumeDigitalEmployeeReturnContext, dispatchDigitalEmployeeDeepLink, type DigitalEmployeeDeepLink } from './digitalEmployees';
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
const values = new Map<string, string>();
let navigation: DigitalEmployeeDeepLink | undefined;
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  sessionStorage: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null, removeItem: (key: string) => values.delete(key) },
  dispatchEvent: (event: CustomEvent) => { navigation = event.detail; },
} });
try {
  for (const id of ['project-a', 'project-b']) {
    dispatchDigitalEmployeeDeepLink({ page: 'smartAssets', view: 'create', runId: 'same-run', taskId: 'same-task', businessRef: { taskKey: 'content_production', entityId: id, deliveryId: `studio_project:${id}` } });
    assert.equal(navigation?.businessRef.entityId, id);
    assert.equal(consumeDigitalEmployeeReturnContext()?.deliveryId, `studio_project:${id}`, 'return must restore the precise card, not a sibling sharing the workflow task');
    assert.equal(consumeDigitalEmployeeReturnContext(), null, 'return context is consumed once');
  }
} finally {
  if (previous) Object.defineProperty(globalThis, 'window', previous);
  else Reflect.deleteProperty(globalThis, 'window');
}
console.log('Delivery navigation round-trip tests passed');

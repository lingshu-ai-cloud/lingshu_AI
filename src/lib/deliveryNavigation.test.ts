import assert from 'node:assert/strict';
import { consumeDigitalEmployeeReturnContext, dispatchDigitalEmployeeDeepLink, type DigitalEmployeeDeepLink } from './digitalEmployees';
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
const values = new Map<string, string>();
let navigation: DigitalEmployeeDeepLink | undefined;
const events: Array<{ type: string; detail: unknown }> = [];
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  sessionStorage: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null, removeItem: (key: string) => values.delete(key) },
  localStorage: { setItem: (key: string, value: string) => values.set(`local:${key}`, value) },
  dispatchEvent: (event: CustomEvent) => { events.push({ type: event.type, detail: event.detail }); if (event.type === 'lingshu:navigate') navigation = event.detail; },
} });
try {
  for (const id of ['project-a', 'project-b']) {
    dispatchDigitalEmployeeDeepLink({ page: 'smartAssets', view: 'create', runId: 'same-run', taskId: 'same-task', businessRef: { taskKey: 'content_production', entityId: id, deliveryId: `studio_project:${id}` } });
    assert.equal(navigation?.businessRef.entityId, id);
    assert.equal(consumeDigitalEmployeeReturnContext()?.deliveryId, `studio_project:${id}`, 'return must restore the precise card, not a sibling sharing the workflow task');
    assert.equal(consumeDigitalEmployeeReturnContext(), null, 'return context is consumed once');
  }
  dispatchDigitalEmployeeDeepLink({ page: 'enterprise', runId: 'run-avatar', taskId: 'task-avatar', businessRef: { taskKey: 'content_production', enterpriseView: 'presenters' } });
  assert.equal(values.get('local:lingshu:enterprise:initial-view'), 'presenters', 'assistant presenter recovery must open the enterprise presenter tab');
  assert.deepEqual(events.find(event => event.type === 'lingshu:enterprise-view')?.detail, { view: 'presenters' }, 'already-mounted enterprise pages must switch to the presenter view');
} finally {
  if (previous) Object.defineProperty(globalThis, 'window', previous);
  else Reflect.deleteProperty(globalThis, 'window');
}
console.log('Delivery navigation round-trip tests passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import {customerItemProductionLink, readCustomerItemNavigation} from './weeklyCustomerProductionLink';
import {dispatchDigitalEmployeeDeepLink, consumeDigitalEmployeeReturnContext} from './digitalEmployees';

const expected = {
  tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 2,
  channel: 'instagram' as const, accountId: 'account', nativeAccountId: 'native-account',
  customerId: 'customer', conversationId: 'instagram:native-account:recipient',
  runId: 'run', taskId: 'task', itemId: 'item', batchId: 'batch',
};
function restoreGlobal(name: 'window' | 'localStorage', previous: PropertyDescriptor | undefined) {
  if (previous) Object.defineProperty(globalThis, name, previous);
  else Reflect.deleteProperty(globalThis, name);
}

test('weekly customer deep link verifies every frozen identity field before selecting a conversation', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => 'token'}});
  t.after(() => {restoreGlobal('localStorage', previous); globalThis.fetch = previousFetch;});
  const link = customerItemProductionLink({runId: expected.runId, taskId: expected.taskId, itemId: expected.itemId, expected});
  assert.deepEqual(link.businessRef.customerNavigation, expected);
  let returned = {...expected};
  globalThis.fetch = async () => new Response(JSON.stringify({item: returned}));
  assert.deepEqual(await readCustomerItemNavigation(link), expected);
  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    returned = {...expected, [field]: field === 'packageVersion' ? 3 : `foreign-${field}`};
    await assert.rejects(readCustomerItemNavigation(link), /不一致/, `${field} drift must reject the link`);
    returned = {...expected, [field]: null};
    await assert.rejects(readCustomerItemNavigation(link), /不一致/, `${field} omission must reject the link`);
  }
});

test('conversation round trip preserves exact weekly identity and consumes the original return context once', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  const events: CustomEvent[] = [];
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {
    sessionStorage: {setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key)},
    dispatchEvent: (event: CustomEvent) => {events.push(event);},
  }});
  t.after(() => restoreGlobal('window', previous));
  const link = customerItemProductionLink({runId: expected.runId, taskId: expected.taskId, itemId: expected.itemId, expected});
  dispatchDigitalEmployeeDeepLink(link);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.page, 'conversion');
  assert.deepEqual(events[0].detail.businessRef.customerNavigation, expected);
  const back = consumeDigitalEmployeeReturnContext();
  assert.equal(back?.runId, expected.runId);
  assert.equal(back?.taskId, expected.taskId);
  assert.deepEqual(back?.customerNavigation, expected);
  assert.equal(consumeDigitalEmployeeReturnContext(), null);
});

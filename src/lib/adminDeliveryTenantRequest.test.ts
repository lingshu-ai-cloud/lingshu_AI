import assert from 'node:assert/strict';
import {
  clearDeliveryTenantRequestId,
  deliveryTenantFormFingerprint,
  deliveryTenantRequestId,
  type DeliveryTenantRequestStorage,
} from './adminDeliveryTenantRequest.js';

const values = new Map<string, string>();
const storage: DeliveryTenantRequestStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: key => { values.delete(key); },
};
const draft = {
  companyName: '  Example Company  ',
  contactName: ' Owner ',
  industry: ' Export ',
  notes: ' Delivery notes ',
};
const normalizedDraft = {
  companyName: 'Example Company',
  contactName: 'Owner',
  industry: 'Export',
  notes: 'Delivery notes',
};

assert.equal(
  await deliveryTenantFormFingerprint(draft),
  await deliveryTenantFormFingerprint(normalizedDraft),
  'irrelevant surrounding whitespace must not rotate an in-flight request id',
);
const first = await deliveryTenantRequestId(draft, storage);
const responseLostRetry = await deliveryTenantRequestId(normalizedDraft, storage);
assert.equal(responseLostRetry, first, 'a response-loss retry for the same form must reuse its persisted UUID');
assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const changed = await deliveryTenantRequestId({ ...normalizedDraft, notes: 'Changed delivery notes' }, storage);
assert.notEqual(changed, first, 'a material form change must start a new idempotent request');
clearDeliveryTenantRequestId(first, storage);
assert.equal(await deliveryTenantRequestId({ ...normalizedDraft, notes: 'Changed delivery notes' }, storage), changed,
  'clearing a stale request id must not remove the newer form request');
clearDeliveryTenantRequestId(changed, storage);
const afterSuccess = await deliveryTenantRequestId({ ...normalizedDraft, notes: 'Changed delivery notes' }, storage);
assert.notEqual(afterSuccess, changed, 'a confirmed success must clear the request id for the next creation');

console.log('admin delivery tenant request id persistence tests passed');

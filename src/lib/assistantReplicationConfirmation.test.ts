import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantCreationPortal } from '../components/assistant/assistantProductionIntake';
import { replicationConfirmationInput, replicationConfirmationKey } from './assistantReplicationConfirmation';

test('confirmation preserves all products and Beijing publication time without inventing a primary product or schedule', async () => {
  const portal = { ...assistantCreationPortal('创建一条新内容')!, selectedReferenceId: 'crawl-reference', selectedProducts: [{ id: 'a', name: '产品甲' }, { id: 'b', name: '产品乙' }], plannedPublishAt: '2099-01-02T12:30' };
  const input = replicationConfirmationInput(portal);
  assert.equal(input.productId, undefined);
  const saved = JSON.parse(input.specialRequirements!);
  assert.deepEqual(saved.products, portal.selectedProducts);
  assert.equal(saved.plannedPublishAt, '2099-01-02T04:30:00.000Z');
  assert.equal(saved.referenceId, 'crawl-reference');
  assert.equal(await replicationConfirmationKey(portal.id, input), await replicationConfirmationKey(portal.id, replicationConfirmationInput(portal)));
  assert.throws(() => replicationConfirmationInput({ ...portal, selectedReferenceId: undefined }));
  assert.throws(() => replicationConfirmationInput({ ...portal, plannedPublishAt: '2000-01-01T00:00' }));
  assert.equal(replicationConfirmationInput({ ...portal, selectedProducts: [portal.selectedProducts[0]] }).productId, 'a');
});

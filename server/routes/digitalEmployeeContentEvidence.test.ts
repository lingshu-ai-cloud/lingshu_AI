import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import type { EnterpriseProfile } from './enterprise.js';
import { projectContentRoutingEvidence } from './digitalEmployeeContentEvidence.js';

test('focused products keep all confirmed products and material ownership boundaries', () => {
  const profile = {
    products: { items: [
      { id: 'product-alpha', name: 'Alpha', sku: 'SKU-A' },
      { id: 'product-beta', name: 'Beta', sku: 'SKU-B' },
    ] },
  } as EnterpriseProfile;
  const config = { focusProducts: 'Beta' } as DigitalEmployeeConfig;
  const evidence = projectContentRoutingEvidence('tenant-one', config, profile, [], {
    status: 'ready', sources: [], items: [
      { id: 'owned-beta', url: 'https://example.com/beta.png', productName: 'Beta', scope: 'tenant' },
      { id: 'shared-beta', url: 'https://example.com/shared.png', productName: 'Beta', scope: 'shared' },
      { id: 'synthetic-beta', url: 'https://example.com/mock.png', productName: 'Beta', synthetic: true },
      { id: 'unbound', url: 'https://example.com/general.png', scope: 'tenant' },
    ],
  });
  assert.deepEqual(evidence.products.map(product => product.name), ['Beta', 'Alpha']);
  assert.deepEqual(evidence.products[0]?.materialIds, ['owned-beta']);
  assert.deepEqual(evidence.products[1]?.materialIds, []);
  assert.deepEqual(evidence.materialIds, ['owned-beta']);
  assert.deepEqual(evidence.exactAnalysisIds, []);
});

test('unavailable material inventory cannot be projected as an empty verified library', () => {
  const profile = { products: { items: [] } } as unknown as EnterpriseProfile;
  const config = { focusProducts: '' } as DigitalEmployeeConfig;
  assert.throws(
    () => projectContentRoutingEvidence('tenant-one', config, profile, [], { status: 'unavailable', sources: [], items: [] }),
    /素材库暂时不可用/,
  );
});

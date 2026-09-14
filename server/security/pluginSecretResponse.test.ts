import assert from 'node:assert/strict';
import { pluginToPublic, type Plugin } from '../routes/plugins.js';

const secret = 'must-never-reach-an-api-response';
const plugin = {
  id: 'shopify',
  pluginKey: 'shopify',
  name: 'Shopify',
  nameZh: 'Shopify',
  category: 'ecommerce',
  description: 'test',
  icon: 'test',
  status: 'installed',
  config: { apiKey: secret, shopDomain: 'tenant-shop.example' },
  installedAt: '2026-09-12T00:00:00.000Z',
  accidentalTopLevelSecret: secret,
} as Plugin & { accidentalTopLevelSecret: string };
const response = pluginToPublic(plugin, true, { managementAllowed: true });

assert.equal('config' in response, false, 'plugin API projection must omit the raw config object');
assert.equal('accidentalTopLevelSecret' in response, false, 'plugin API projection must allowlist fields instead of spreading stored records');
assert.deepEqual(response.configuredFields.sort(), ['apiKey', 'shopDomain']);
assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));

const tenantResponse = pluginToPublic(plugin, true, { tenantUsable: false });
assert.equal(tenantResponse.managementAllowed, false);
assert.deepEqual(tenantResponse.configuredFields, [], 'tenant catalog must not expose platform configuration metadata');
assert.equal('installedAt' in tenantResponse, false, 'tenant catalog must not expose platform installation metadata');
assert.doesNotMatch(JSON.stringify(tenantResponse), new RegExp(secret));

console.log('plugin secret response tests passed');

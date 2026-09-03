import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pluginPublicView, pluginTenantConfigFile, type Plugin } from '../routes/plugins.js';

const privatePlugin: Plugin = {
  id: 'shopify', pluginKey: 'shopify', name: 'Shopify', nameZh: 'Shopify', category: 'ecommerce',
  description: '', icon: '', status: 'installed', config: { apiKey: 'customer-secret', shopDomain: 'tenant.example' },
};
const publicView = pluginPublicView(privatePlugin);
assert.equal(publicView.config.apiKey, '');
assert.equal(publicView.config.shopDomain, '');
assert.deepEqual(publicView.configuredFields, ['apiKey', 'shopDomain']);
assert.equal(JSON.stringify(publicView).includes('customer-secret'), false, 'plugin responses must never expose decrypted secrets');
assert.notEqual(pluginTenantConfigFile('tenant-a'), pluginTenantConfigFile('tenant-b'));
assert.throws(() => pluginTenantConfigFile('../escape'), /invalid_tenant_id/);

const channelsSource = fs.readFileSync(fileURLToPath(new URL('../routes/channels.ts', import.meta.url)), 'utf8');
assert.match(channelsSource, /NODE_ENV === 'production'[\s\S]*legacy_channel_api_disabled/, 'global JSON channel connectors must be disabled in production');
assert.match(channelsSource, /Object\.keys\(channel\.config[\s\S]*\[key, ''\]/, 'even local legacy reads must redact config values');
console.log('legacy integration tenant isolation and secret redaction tests passed');

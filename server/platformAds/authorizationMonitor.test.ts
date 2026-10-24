import assert from 'node:assert/strict';
import { scanAdAuthorizations, startAdAuthorizationMonitor } from './authorizationMonitor.js';
import type { AdConnection } from './connections.js';
const now = Date.parse('2026-10-24T00:00:00Z');
const row = (id: string, patch: Partial<AdConnection> = {}) => ({ id, tenant_id: 'tenant-'+id, provider: 'meta', tokenCipher: 'encrypted', ...patch } as AdConnection);
const calls: string[] = [];
const result = await scanAdAuthorizations({
  now: () => now,
  list: async page => ({ totalPages: 2, items: page === 1 ? [row('old'), row('recent', { authorization: { status: 'healthy', reasonCode: 'AUTH_VALID', checkedAt: new Date(now - 1000).toISOString() } }), row('revoked', { authorization: { status: 'revoked', reasonCode: 'USER_REVOKED' } })] : [row('network'), row('after-error'), row('empty', { tokenCipher: '' })] }),
  check: async (tenant, id) => { assert.equal(tenant, 'tenant-'+id); calls.push(id); if (id === 'network') throw new Error('private provider payload'); },
});
assert.deepEqual(result, { checked: 2, skipped: 3, failed: 1 });
assert.deepEqual(calls, ['old', 'network', 'after-error']);
let scans = 0;
startAdAuthorizationMonitor({ enabled: false, scan: async () => { scans++; } })();
assert.equal(scans, 0, 'disabled monitor must not inspect real providers');
console.log('Authorization monitor handles pagination, tenant identity, throttling and partial failures; disabled mode has no provider effects');

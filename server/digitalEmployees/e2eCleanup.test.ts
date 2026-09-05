import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupLocalE2ETenant } from './e2eCleanup.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-e2e-cleanup-'));
const tenantId = 'local_tenant_customer_0123456789abcdef0123456789abcdef';
const otherTenant = 'local_tenant_customer_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const write = (relative: string, value: unknown) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

write('data/local-store/workflow_runs.json', [
  { id: 'owned', tenant_id: tenantId },
  { id: 'other', tenant_id: otherTenant },
]);
write('data/tasks.json', [
  { id: 'nested-owned', config: { tenantId } },
  { id: 'nested-other', config: { tenantId: otherTenant } },
]);
write('data/local-auth-accounts.json', [{ userId: 'u1', tenantId }, { userId: 'u2', tenantId: otherTenant }]);
write('data/local-auth-tenants.json', [{ id: tenantId }, { id: otherTenant }]);
write('data/apify-video-usage.json', { tenants: { [tenantId]: 3, [otherTenant]: 7 } });
write('data/whatsapp-import-status.json', { tenantId, status: 'done', total: 1 });
const mediaDirectory = path.join(root, 'data/media/tenants', tenantId);
const enterpriseDirectory = path.join(root, 'data/enterprise-assets', enterpriseAssetTenantKey(tenantId));
fs.mkdirSync(mediaDirectory, { recursive: true });
fs.mkdirSync(enterpriseDirectory, { recursive: true });
fs.writeFileSync(path.join(mediaDirectory, 'clip.mp4'), 'owned');
fs.writeFileSync(path.join(enterpriseDirectory, 'product.png'), 'owned');

const preview = cleanupLocalE2ETenant({ root, tenantId, apply: false, now: new Date('2026-09-04T00:00:00Z') });
assert.equal(preview.removedRecords, 6);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/local-store/workflow_runs.json'), 'utf8')).length, 2, 'preview must not mutate');
assert.equal(fs.existsSync(mediaDirectory), true);

const applied = cleanupLocalE2ETenant({ root, tenantId, apply: true, now: new Date('2026-09-04T00:00:00Z') });
assert.equal(applied.verifiedClean, true);
assert.equal(applied.remainingReferences.length, 0);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/local-store/workflow_runs.json'), 'utf8')).map((item: { id: string }) => item.id), ['other']);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/tasks.json'), 'utf8')).map((item: { id: string }) => item.id), ['nested-other']);
assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'data/apify-video-usage.json'), 'utf8')).tenants), [otherTenant]);
assert.equal(fs.existsSync(mediaDirectory), false);
assert.equal(fs.existsSync(enterpriseDirectory), false);
assert.equal(fs.existsSync(path.join(root, 'data/whatsapp-import-status.json')), false, 'tenant-owned singleton status must be removed');
assert.ok(applied.backupDir && fs.existsSync(applied.backupDir), 'destructive cleanup must retain a recoverable backup');

assert.throws(() => cleanupLocalE2ETenant({ root, tenantId: 'local_tenant_admin_real', apply: true }), /isolated_local_customer_tenant_required/);

console.log('digital employee e2e cleanup tests passed');

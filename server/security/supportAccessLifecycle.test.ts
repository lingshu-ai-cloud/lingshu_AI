import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-support-access-'));
process.env.SUPPORT_ACCESS_DATA_DIR = temporaryDir;
process.env.SUPPORT_ACCESS_SECRET = 'support-access-test-secret-abcdefghijklmnopqrstuvwxyz';
process.env.SUPPORT_ACCESS_SESSION_TTL_MS = String(5 * 60_000);

const support = await import('../lib/supportAccess.js');
const tenantId = 'tenant-support-lifecycle';

assert.equal(support.supportAccessDefaultAuthorized(tenantId), false, 'missing tenant consent must fail closed');
const denied = support.createSupportAccessRequest({
  tenantId,
  tenantName: 'Lifecycle tenant',
  requestedByUserId: 'platform-admin',
  requestedByEmail: 'support@lingshu.test',
});
assert.equal(denied.status, 'denied');
assert.equal(support.issueSupportAccessToken(denied.id, 'platform-admin'), null);

support.setSupportAccessDefaultAuthorized(tenantId, 'tenant-owner', true);
const approved = support.createSupportAccessRequest({
  tenantId,
  tenantName: 'Lifecycle tenant',
  requestedByUserId: 'platform-admin',
  requestedByEmail: 'support@lingshu.test',
});
assert.equal(approved.status, 'approved');
const session = support.issueSupportAccessToken(approved.id, 'platform-admin');
assert.ok(session);
assert.ok(Date.parse(session.expiresAt) > Date.now());
assert.equal(support.verifySupportAccessToken(`Bearer ${session.token}`)?.tenantId, tenantId);

const prefix = 'support-v1.';
const [body] = session.token.slice(prefix.length).split('.');
const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
delete payload.expiresAt;
const legacyBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const legacySignature = createHmac('sha256', process.env.SUPPORT_ACCESS_SECRET).update(legacyBody).digest('base64url');
assert.equal(
  support.verifySupportAccessToken(`Bearer ${prefix}${legacyBody}.${legacySignature}`),
  null,
  'legacy non-expiring support tokens must be rejected',
);

const originalNow = Date.now;
try {
  Date.now = () => Date.parse(session.expiresAt) + 1;
  assert.equal(support.verifySupportAccessToken(`Bearer ${session.token}`), null, 'expired sessions must be rejected');
} finally {
  Date.now = originalNow;
}

support.setSupportAccessDefaultAuthorized(tenantId, 'tenant-owner', false);
assert.equal(support.verifySupportAccessToken(`Bearer ${session.token}`), null, 'revocation must invalidate live sessions');

fs.rmSync(temporaryDir, { recursive: true, force: true });
console.log('support access explicit consent, expiry, legacy rejection, and revocation tests passed');

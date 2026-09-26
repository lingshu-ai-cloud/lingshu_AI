import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rekeyScript = fileURLToPath(new URL('./rekey-tenant-transfer.mjs', import.meta.url));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-transfer-rekey-'));
const recordsFile = path.join(temporary, 'records.json');
const manifestFile = path.join(temporary, 'SHA256SUMS.json');
const sourceSecret = 'source-master-key';
const targetSecret = 'target-master-key';

function key(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function encrypt(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`;
}

function decrypt(value, secret) {
  const [, ivRaw, tagRaw, dataRaw] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(secret), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

const payload = {
  schemaVersion: 1,
  records: {
    tenant_platform_apps: [{ id: 'app', app_secret: encrypt('app-secret', sourceSecret), access_token: 'legacy-plain-token' }],
    platform_ad_connections: [{ id: 'ad', tokenCipher: encrypt('ad-token', sourceSecret) }],
    platform_ad_oauth_states: [{ id: 'state', tokenCipher: '' }],
    social_accounts: [{ id: 'social', accessToken: 'plain-provider-token' }],
  },
};
fs.writeFileSync(recordsFile, JSON.stringify(payload));
fs.writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, files: {
  'records.json': crypto.createHash('sha256').update(fs.readFileSync(recordsFile)).digest('hex'),
} }));

const result = spawnSync(process.execPath, [rekeyScript, temporary], {
  input: `${sourceSecret}\n${targetSecret}\n`, encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /REKEY_COMPLETE/);
const updated = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
assert.equal(decrypt(updated.records.tenant_platform_apps[0].app_secret, targetSecret), 'app-secret');
assert.equal(decrypt(updated.records.tenant_platform_apps[0].access_token, targetSecret), 'legacy-plain-token');
assert.equal(decrypt(updated.records.platform_ad_connections[0].tokenCipher, targetSecret), 'ad-token');
assert.equal(updated.records.social_accounts[0].accessToken, 'plain-provider-token');
assert.throws(() => decrypt(updated.records.tenant_platform_apps[0].app_secret, sourceSecret));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
assert.equal(manifest.files['records.json'], crypto.createHash('sha256').update(fs.readFileSync(recordsFile)).digest('hex'));

const badPackage = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-transfer-rekey-bad-'));
fs.writeFileSync(path.join(badPackage, 'records.json'), JSON.stringify(payload));
fs.writeFileSync(path.join(badPackage, 'SHA256SUMS.json'), JSON.stringify({ schemaVersion: 1, files: { 'records.json': 'bad' } }));
const bad = spawnSync(process.execPath, [rekeyScript, badPackage], {
  input: `${sourceSecret}\n${targetSecret}\n`, encoding: 'utf8',
});
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /checksum failed/);

console.log('tenant transfer credential rekey contract passed');

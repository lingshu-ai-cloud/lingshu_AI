#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENCRYPTED_FIELDS = new Map([
  ['tenant_platform_apps', ['app_secret', 'access_token']],
  ['platform_ad_connections', ['tokenCipher']],
  ['platform_ad_oauth_states', ['tokenCipher']],
]);

function fail(message) {
  throw new Error(message);
}

function keyFrom(value, label) {
  const raw = String(value || '').trim();
  if (!raw) fail(`${label} is empty`);
  return crypto.createHash('sha256').update(raw).digest();
}

function decryptSecret(value, sourceKey) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('v1:')) return raw;
  const parts = raw.split(':');
  if (parts.length !== 4) fail('invalid encrypted credential envelope');
  const [, ivRaw, tagRaw, dataRaw] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sourceKey, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    fail('a tenant credential could not be decrypted with the source key');
  }
}

function encryptSecret(value, targetKey) {
  const plain = String(value || '').trim();
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', targetKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesBelow(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(root, absolute));
    else if (entry.isFile() && absolute !== path.join(root, 'SHA256SUMS.json')) files.push(absolute);
  }
  return files;
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function verifyPackage(packageRoot) {
  const manifestFile = path.join(packageRoot, 'SHA256SUMS.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const [relative, expected] of Object.entries(manifest.files || {})) {
    const absolute = path.resolve(packageRoot, relative);
    if (!absolute.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(absolute) || sha256(absolute) !== expected) {
      fail(`package checksum failed: ${relative}`);
    }
  }
}

function readKeysFromStdin() {
  const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  return { source: lines[0] || '', target: lines[1] || '' };
}

function main() {
  const packageArgument = process.argv[2];
  if (!packageArgument || process.argv.length !== 3) {
    fail('usage: rekey-tenant-transfer.mjs <package-directory> (source key and target key on stdin)');
  }
  const packageRoot = path.resolve(packageArgument);
  const recordsFile = path.join(packageRoot, 'records.json');
  verifyPackage(packageRoot);
  const keys = readKeysFromStdin();
  const sourceKey = keyFrom(keys.source, 'source tenant platform key');
  const targetKey = keyFrom(keys.target, 'target tenant platform key');
  const payload = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
  if (payload.schemaVersion !== 1 || !payload.records || typeof payload.records !== 'object') {
    fail('unsupported tenant transfer package');
  }

  const counts = {};
  for (const [table, fields] of ENCRYPTED_FIELDS) {
    let changed = 0;
    for (const row of payload.records[table] || []) {
      for (const field of fields) {
        if (typeof row[field] !== 'string' || !row[field].trim()) continue;
        const plain = decryptSecret(row[field], sourceKey);
        row[field] = encryptSecret(plain, targetKey);
        changed += 1;
      }
    }
    if (changed) counts[table] = changed;
  }

  payload.credentialRekey = {
    algorithm: 'aes-256-gcm',
    completedAt: new Date().toISOString(),
    fields: counts,
  };
  atomicJson(recordsFile, payload);
  const manifest = {
    schemaVersion: 1,
    files: Object.fromEntries(filesBelow(packageRoot).sort().map(file => [
      path.relative(packageRoot, file).split(path.sep).join('/'),
      sha256(file),
    ])),
  };
  atomicJson(path.join(packageRoot, 'SHA256SUMS.json'), manifest);
  process.stdout.write(`${JSON.stringify({ rekeyedCredentialFields: counts })}\nREKEY_COMPLETE\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

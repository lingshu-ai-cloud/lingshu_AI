import '../server/loadEnvironment.js';

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { localAccountRecordsFile, readLocalAccountRecords, writeLocalAccountRecords } from '../server/lib/localAccountStore.js';
import { createLocalDataTenant, getLocalTenant, updateLocalDataTenant } from '../server/lib/localTenants.js';

const TENANT_ID = 'local_tenant_customer_aurelia_beauty';
const EMAIL = 'beauty-showcase@local.test';
const ROOT = process.cwd();
const FIXTURE_ROOT = path.resolve(ROOT, 'fixtures', 'beauty-showcase');
const BUNDLE_FILE = path.join(FIXTURE_ROOT, 'account-data.json');
const MANIFEST_FILE = path.join(FIXTURE_ROOT, 'manifest.json');
const SOURCE_MEDIA_ROOT = path.resolve(ROOT, 'data', 'media', 'tenants', TENANT_ID);
const FIXTURE_MEDIA_ROOT = path.join(FIXTURE_ROOT, 'media', 'tenants', TENANT_ID);
const collections = [
  'competitor_accounts', 'crawl_jobs', 'digital_employee_config_versions', 'digital_employee_configs',
  'social_discovery_scopes', 'starter_social_content_files', 'starter_social_content_operations',
  'starter_social_content_tasks', 'tenant_profiles', 'trend_videos',
] as const;

type JsonRecord = Record<string, unknown>;
type FixtureBundle = {
  schemaVersion: 1;
  tenant: JsonRecord;
  account: { userId: string; tenantId: string; email: string; name: string; accountType: 'customer'; role: string; createdAt: string };
  collections: Record<string, JsonRecord[]>;
  materials: JsonRecord[];
};

function readArray(file: string): JsonRecord[] {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error(`expected JSON array: ${file}`);
  return value as JsonRecord[];
}

function writeJson(file: string, value: unknown, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporary, file);
}

function belongsToFixture(record: JsonRecord): boolean {
  return String(record.tenantId || record.tenant_id || '') === TENANT_ID;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const blocked = new Set(['password', 'passwordhash', 'salt', 'token', 'accesstoken', 'refreshtoken', 'secret', 'apikey', 'cookie']);
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .filter(([key]) => !blocked.has(key.toLowerCase()))
    .map(([key, item]) => [key, scrub(item)]));
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name));
}

function validateBundle(bundle: FixtureBundle): void {
  if (bundle.tenant.id !== TENANT_ID || bundle.account.tenantId !== TENANT_ID || bundle.account.email !== EMAIL) throw new Error('fixture account identity mismatch');
  if (Object.keys(bundle.account).some(key => ['password', 'passwordHash', 'salt', 'token', 'secret'].includes(key))) throw new Error('fixture contains authentication material');
  if (bundle.collections.trend_videos?.length !== 30) throw new Error('fixture must contain exactly 30 trend videos');
  if (bundle.collections.competitor_accounts?.length !== 27) throw new Error('fixture must contain exactly 27 competitor accounts');
  if (bundle.materials.length !== 30) throw new Error('fixture must contain exactly 30 materials');
}

function exportFixture(): void {
  const account = readLocalAccountRecords(localAccountRecordsFile()).find(item => item.email.toLowerCase() === EMAIL);
  const tenant = getLocalTenant(TENANT_ID);
  if (!account || !tenant) throw new Error('beauty showcase local account is missing');
  const collectionData = Object.fromEntries(collections.map(collection => [collection,
    readArray(path.resolve(ROOT, 'data', 'local-store', `${collection}.json`)).filter(belongsToFixture).map(item => scrub(item) as JsonRecord),
  ]));
  const bundle: FixtureBundle = {
    schemaVersion: 1,
    tenant: scrub(tenant) as JsonRecord,
    account: { userId: account.userId, tenantId: account.tenantId, email: account.email, name: account.name,
      accountType: 'customer', role: account.role || 'admin', createdAt: account.createdAt },
    collections: collectionData,
    materials: readArray(path.resolve(ROOT, 'data', 'materials.json')).filter(belongsToFixture).map(item => scrub(item) as JsonRecord),
  };
  validateBundle(bundle);

  fs.mkdirSync(FIXTURE_MEDIA_ROOT, { recursive: true });
  for (const source of filesBelow(SOURCE_MEDIA_ROOT)) {
    const relative = path.relative(SOURCE_MEDIA_ROOT, source);
    if (relative.split(path.sep).includes('b2b-sources')) continue;
    const target = path.join(FIXTURE_MEDIA_ROOT, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  writeJson(BUNDLE_FILE, bundle);
  const files = filesBelow(FIXTURE_ROOT).filter(file => file !== MANIFEST_FILE).sort().map(file => ({
    path: path.relative(FIXTURE_ROOT, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, sha256: sha256(file),
  }));
  if (files.some(item => item.bytes >= 100 * 1024 * 1024)) throw new Error('fixture contains a file at or above GitHub\'s 100 MiB limit');
  writeJson(MANIFEST_FILE, { schemaVersion: 1, tenantId: TENANT_ID, exportedAt: new Date().toISOString(),
    counts: { trendVideos: 30, competitorAccounts: 27, materials: 30, mediaFiles: files.filter(item => item.path.startsWith('media/')).length }, files });
  console.log(JSON.stringify({ ok: true, mode: 'export', files: files.length, mediaFiles: files.filter(item => item.path.startsWith('media/')).length }, null, 2));
}

function verifyFixture(): FixtureBundle {
  const bundle = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8')) as FixtureBundle;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) as { files: Array<{ path: string; bytes: number; sha256: string }> };
  validateBundle(bundle);
  for (const expected of manifest.files) {
    const file = path.resolve(FIXTURE_ROOT, expected.path);
    if (!file.startsWith(`${FIXTURE_ROOT}${path.sep}`) || !fs.existsSync(file)) throw new Error(`fixture file is missing: ${expected.path}`);
    if (fs.statSync(file).size !== expected.bytes || sha256(file) !== expected.sha256) throw new Error(`fixture checksum mismatch: ${expected.path}`);
  }
  console.log(JSON.stringify({ ok: true, mode: 'verify', files: manifest.files.length }, null, 2));
  return bundle;
}

function mergeTenantRecords(file: string, records: JsonRecord[]): void {
  const current = fs.existsSync(file) ? readArray(file) : [];
  writeJson(file, [...current.filter(item => !belongsToFixture(item)), ...records], 0o600);
}

function importFixture(): void {
  const bundle = verifyFixture();
  const password = String(process.env.BEAUTY_SHOWCASE_PASSWORD || '');
  if (password.length < 10) throw new Error('BEAUTY_SHOWCASE_PASSWORD with at least 10 characters is required');
  if (getLocalTenant(TENANT_ID)) updateLocalDataTenant(TENANT_ID, bundle.tenant);
  else createLocalDataTenant(bundle.tenant);
  const accounts = readLocalAccountRecords(localAccountRecordsFile());
  const salt = randomBytes(16).toString('hex');
  writeLocalAccountRecords(localAccountRecordsFile(), [...accounts.filter(item => item.email !== EMAIL && item.userId !== bundle.account.userId), {
    ...bundle.account, role: bundle.account.role === 'admin' ? 'admin' : undefined, salt,
    passwordHash: scryptSync(password, salt, 64).toString('hex'),
  }]);
  for (const collection of collections) mergeTenantRecords(path.resolve(ROOT, 'data', 'local-store', `${collection}.json`), bundle.collections[collection] || []);
  mergeTenantRecords(path.resolve(ROOT, 'data', 'materials.json'), bundle.materials);
  for (const source of filesBelow(FIXTURE_MEDIA_ROOT)) {
    const target = path.resolve(ROOT, 'data', 'media', 'tenants', TENANT_ID, path.relative(FIXTURE_MEDIA_ROOT, source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  console.log(JSON.stringify({ ok: true, mode: 'import', tenantId: TENANT_ID, email: EMAIL }, null, 2));
}

const mode = process.argv[2] || 'verify';
if (mode === 'export') exportFixture();
else if (mode === 'verify') verifyFixture();
else if (mode === 'import') importFixture();
else throw new Error('mode must be export, verify, or import');

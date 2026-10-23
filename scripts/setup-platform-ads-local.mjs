import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Isolated, ignored runtime state. Never touches the shared preview or production.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'tmp/platform-ads-live');
const origin = 'http://127.0.0.1:8891';
fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
const credentialsFile = path.join(runtime, 'credentials.json');
let credentials;
if (fs.existsSync(credentialsFile)) credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
else {
  credentials = { adminEmail: 'platform-ads-admin@local.test', adminPassword: randomBytes(36).toString('base64url'), email: 'platform-ads-live@local.test', password: randomBytes(32).toString('base64url') };
  fs.writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
if (!process.argv.includes('--seed')) {
  const binary = process.env.PLATFORM_ADS_PB_BINARY;
  if (!binary || !path.isAbsolute(binary)) throw new Error('PLATFORM_ADS_PB_BINARY must identify the installed binary');
  execFileSync(binary, ['superuser', 'upsert', credentials.adminEmail, credentials.adminPassword, `--dir=${path.join(runtime, 'pb_data')}`, `--migrationsDir=${path.join(root, 'pb_migrations')}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const settings = {
    PORT: '8890', PB_URL: origin, PB_ADMIN_EMAIL: credentials.adminEmail, PB_ADMIN_PASSWORD: credentials.adminPassword,
    ENABLE_LOCAL_DEV_FALLBACK: 'false', DISABLE_LOCAL_AUTH_FALLBACK: 'true', DATA_BACKEND: 'pocketbase',
    META_ADS_API_VERSION: 'v26.0', PLATFORM_ADS_RELEASE_MODE: 'paused_only', PLATFORM_ADS_AUTOMATION_ENABLED: 'false',
    PROCESS_ROLE: 'all', LINGSHU_LOCAL_PORT: '8890', LINGSHU_LOCAL_PREVIEW: '0',
  };
  fs.writeFileSync(path.join(runtime, 'runtime.env'), Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  console.log('Isolated advertising runtime configured: frontend 5187, backend 8890, database 8891; paused_only.');
} else {
  const authenticated = await fetch(`${origin}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: credentials.adminEmail, password: credentials.adminPassword }) });
  if (!authenticated.ok) throw new Error(`Database authentication failed: ${authenticated.status}`);
  const { token } = await authenticated.json();
  async function request(endpoint, method = 'GET', data) {
    const response = await fetch(`${origin}/api/collections/${endpoint}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    if (!response.ok) throw new Error(`Local database ${method} ${endpoint}: ${response.status}`);
    return response.json();
  }
  const existing = await request(`users/records?filter=${encodeURIComponent(`email="${credentials.email}"`)}`);
  if (existing.items.length) { console.log('Isolated advertising login already exists.'); process.exit(0); }
  const tenant = await request('tenants/records', 'POST', { name: 'Meta 暂停创建联调', subscriptionStatus: 'active', subscriptionPlan: 'professional', createdAt: new Date().toISOString() });
  const user = await request('users/records', 'POST', { email: credentials.email, password: credentials.password, passwordConfirm: credentials.password, name: 'Meta 广告联调', tenantId: tenant.id, role: 'admin', verified: true });
  console.log(JSON.stringify({ database: origin, tenantId: tenant.id, userId: user.id, role: user.role }));
}

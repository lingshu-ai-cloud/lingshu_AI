import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = path.join(root, 'data', 'external-customer-service-demo-profile.json');
const baseUrl = String(process.env.EXTERNAL_DEMO_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const email = String(process.env.EXTERNAL_DEMO_EMAIL || '').trim().toLowerCase();
const password = String(process.env.EXTERNAL_DEMO_PASSWORD || '');
const accountName = String(process.env.EXTERNAL_DEMO_ACCOUNT_NAME || '智能客服对外演示').trim();
const pbUrl = String(process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const pbAdminEmail = String(process.env.PB_ADMIN_EMAIL || '').trim();
const pbAdminPassword = String(process.env.PB_ADMIN_PASSWORD || '');

if (!email || !password) throw new Error('EXTERNAL_DEMO_EMAIL / EXTERNAL_DEMO_PASSWORD are required');

type RecordMap = Record<string, unknown>;

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function pocketBaseToken(): Promise<string> {
  if (!pbAdminEmail || !pbAdminPassword) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are required to provision the demo account');
  const body = JSON.stringify({ identity: pbAdminEmail, password: pbAdminPassword });
  for (const authPath of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const response = await fetch(`${pbUrl}${authPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!response.ok) continue;
    const data = await response.json() as { token?: string };
    if (data.token) return data.token;
  }
  throw new Error('PocketBase administrator login failed');
}

async function pocketBaseRequest<T>(token: string, urlPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${pbUrl}${urlPath}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: token },
  });
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(`${urlPath} failed (${response.status}): ${data.message || 'unknown error'}`);
  return data;
}

async function findPocketBaseRecord(token: string, collection: string, filter: string): Promise<RecordMap | null> {
  const query = new URLSearchParams({ page: '1', perPage: '1', filter });
  const result = await pocketBaseRequest<{ items?: RecordMap[] }>(token, `/api/collections/${collection}/records?${query}`);
  return result.items?.[0] ?? null;
}

async function ensureExternalDemoAccount(): Promise<void> {
  const token = await pocketBaseToken();
  const existingUser = await findPocketBaseRecord(token, 'users', `email = "${escapeFilterValue(email)}"`);
  let tenantId = String(existingUser?.tenantId || '');
  const tenantBody = {
    name: '苏州凌锐智能装备有限公司',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: '',
    registeredEmail: email,
    registeredAt: new Date().toISOString(),
  };
  if (tenantId) {
    await pocketBaseRequest(token, `/api/collections/tenants/records/${tenantId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tenantBody),
    });
  } else {
    const tenant = await pocketBaseRequest<RecordMap>(token, '/api/collections/tenants/records', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...tenantBody, createdAt: new Date().toISOString() }),
    });
    tenantId = String(tenant.id || '');
  }
  if (!tenantId) throw new Error('Demo tenant provisioning failed');
  const userBody = {
    email,
    password,
    passwordConfirm: password,
    name: accountName,
    tenantId,
    role: 'admin',
    emailVisibility: true,
  };
  if (existingUser?.id) {
    await pocketBaseRequest(token, `/api/collections/users/records/${existingUser.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody),
    });
  } else {
    await pocketBaseRequest(token, '/api/collections/users/records', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody),
    });
  }
}

async function jsonRequest<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${urlPath}`, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(`${urlPath} failed (${response.status}): ${data.message || data.error || 'unknown error'}`);
  return data;
}

await ensureExternalDemoAccount();

const login = await jsonRequest<{ token: string; tenant?: { id?: string } }>('/api/overseas/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.token) throw new Error('Demo login did not return a token');

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
await jsonRequest('/api/overseas/enterprise/profile', {
  method: 'POST',
  headers,
  body: JSON.stringify(profile),
});
const statusResponse = await jsonRequest<{ status?: { enabled?: boolean }; enabled?: boolean }>('/api/overseas/enterprise/customer-service/status', {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ enabled: true }),
});
const customerServiceEnabled = Boolean(statusResponse.status?.enabled ?? statusResponse.enabled);
const savedProfile = await jsonRequest<{ company?: { name?: string }; products?: { items?: unknown[] }; faq?: unknown[] }>('/api/overseas/enterprise/profile', { headers });

if (!customerServiceEnabled) throw new Error('Customer service master switch was not enabled');
if (savedProfile.company?.name !== '苏州凌锐智能装备有限公司') throw new Error('Enterprise profile verification failed');

console.log(JSON.stringify({
  ok: true,
  email,
  tenantId: login.tenant?.id || '',
  company: savedProfile.company.name,
  products: savedProfile.products?.items?.length || 0,
  faq: savedProfile.faq?.length || 0,
  customerServiceEnabled: true,
}));

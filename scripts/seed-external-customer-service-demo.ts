import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = path.join(root, 'data', 'external-customer-service-demo-profile.json');
const baseUrl = String(process.env.EXTERNAL_DEMO_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const email = String(process.env.EXTERNAL_DEMO_EMAIL || '').trim().toLowerCase();
const password = String(process.env.EXTERNAL_DEMO_PASSWORD || '');

if (!email || !password) throw new Error('EXTERNAL_DEMO_EMAIL / EXTERNAL_DEMO_PASSWORD are required');

async function jsonRequest<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${urlPath}`, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(`${urlPath} failed (${response.status}): ${data.message || data.error || 'unknown error'}`);
  return data;
}

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
const status = await jsonRequest<{ enabled?: boolean }>('/api/overseas/enterprise/customer-service/status', {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ enabled: true }),
});
const savedProfile = await jsonRequest<{ company?: { name?: string }; products?: { items?: unknown[] }; faq?: unknown[] }>('/api/overseas/enterprise/profile', { headers });

if (!status.enabled) throw new Error('Customer service master switch was not enabled');
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

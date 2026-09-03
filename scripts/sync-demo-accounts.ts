/**
 * Sync demo/test accounts from data/demo-account-registry.json into PocketBase.
 *
 * Passwords are accepted only from deployment secrets and are never written to
 * the registry. Existing registry password fields are ignored and scrubbed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.production'), override: true });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const REGISTRY_FILE = path.join(__dirname, '..', 'data', 'demo-account-registry.json');

type RegistryEntry = {
  email: string;
  name?: string;
  role?: 'super_admin' | 'admin' | 'social_operator' | 'customer_service';
  userId?: string;
  tenantId?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  status?: 'available' | 'trialing' | 'expired' | 'customer' | 'admin';
};

type RecordMap = Record<string, unknown>;

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function authToken(): Promise<string> {
  if (!EMAIL || !PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set');
  const body = JSON.stringify({ identity: EMAIL, password: PASSWORD });
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) continue;
    const json = await res.json() as { token?: string };
    if (json.token) return json.token;
  }
  throw new Error('PocketBase admin login failed');
}

async function pbRequest<T>(token: string, urlPath: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PB_URL}${urlPath}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: token,
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${urlPath} failed ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

async function findOne(token: string, collection: string, filter: string): Promise<RecordMap | null> {
  const params = new URLSearchParams({ page: '1', perPage: '1', filter });
  const json = await pbRequest<{ items?: RecordMap[] }>(token, `/api/collections/${collection}/records?${params}`);
  return json.items?.[0] ?? null;
}

async function createTenant(token: string, entry: RegistryEntry): Promise<RecordMap> {
  const now = new Date().toISOString();
  const isAdmin = entry.status === 'admin';
  const isCustomer = entry.status === 'customer';
  return await pbRequest<RecordMap>(token, '/api/collections/tenants/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: entry.name || entry.email.split('@')[0],
      subscriptionStatus: isAdmin || isCustomer ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : isCustomer ? 'customer' : 'trial',
      subscriptionExpiresAt: isAdmin || isCustomer ? '' : (entry.expiresAt || ''),
      ...(isCustomer ? { registeredEmail: entry.email, registeredAt: entry.activatedAt || now } : {}),
      createdAt: now,
    }),
  });
}

async function patchTenant(token: string, tenantId: string, entry: RegistryEntry): Promise<void> {
  const isAdmin = entry.status === 'admin';
  const isCustomer = entry.status === 'customer';
  await pbRequest<RecordMap>(token, `/api/collections/tenants/records/${tenantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptionStatus: isAdmin || isCustomer ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : isCustomer ? 'customer' : 'trial',
      subscriptionExpiresAt: isAdmin || isCustomer ? '' : (entry.expiresAt || ''),
      ...(isCustomer ? { registeredEmail: entry.email } : {}),
    }),
  });
}

async function syncAccount(token: string, entry: RegistryEntry, password: string): Promise<{ email: string; action: string; userId: string; tenantId: string }> {
  const email = entry.email.trim().toLowerCase();
  const existing = await findOne(token, 'users', `email = "${escapeFilterValue(email)}"`);
  let tenantId = String(existing?.tenantId || entry.tenantId || '');
  if (tenantId) {
    try {
      await patchTenant(token, tenantId, entry);
    } catch {
      const tenant = await createTenant(token, entry);
      tenantId = String(tenant.id);
    }
  } else {
    const tenant = await createTenant(token, entry);
    tenantId = String(tenant.id);
  }

  if (existing?.id) {
    await pbRequest<RecordMap>(token, `/api/collections/users/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(entry.status !== 'admin' ? {
          password,
          passwordConfirm: password,
        } : {}),
        tenantId,
        emailVisibility: true,
        name: entry.name || String(existing.name || email.split('@')[0]),
        role: entry.role || String(existing.role || 'admin'),
      }),
    });
    return { email, action: 'updated', userId: String(existing.id), tenantId };
  }

  const created = await pbRequest<RecordMap>(token, '/api/collections/users/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      passwordConfirm: password,
      name: entry.name || email.split('@')[0],
      tenantId,
      role: entry.role || 'admin',
      emailVisibility: true,
    }),
  });
  return { email, action: 'created', userId: String(created.id), tenantId };
}

async function main(): Promise<void> {
  const rawRegistry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')) as Record<string, RegistryEntry & { password?: unknown; rotationPassword?: unknown }>;
  const registry = Object.fromEntries(Object.entries(rawRegistry).map(([key, value]) => {
    const { password: _legacyPassword, rotationPassword: _legacyRotationPassword, ...safe } = value;
    return [key, safe];
  })) as Record<string, RegistryEntry>;
  const workbenchAdminEmail = String(process.env.WORKBENCH_ADMIN_EMAIL || '').trim().toLowerCase();
  const workbenchAdminPassword = String(process.env.WORKBENCH_ADMIN_PASSWORD || '');
  let passwordSecrets: Record<string, string> = {};
  try {
    passwordSecrets = JSON.parse(String(process.env.DEMO_ACCOUNT_PASSWORDS_JSON || '{}')) as Record<string, string>;
  } catch {
    throw new Error('DEMO_ACCOUNT_PASSWORDS_JSON must be a JSON object keyed by email');
  }
  const accounts = Object.values(registry)
    .filter((entry) => entry.email)
    .map(entry => {
      const email = entry.email.trim().toLowerCase();
      const password = entry.status === 'admin' && email === workbenchAdminEmail
        ? workbenchAdminPassword
        : String(passwordSecrets[email] || '');
      return { entry, password };
    })
    .filter(item => item.password.length >= 12);
  const token = await authToken();

  const nextRegistry = { ...registry };
  const summary = { created: 0, updated: 0, failed: 0 };
  for (const { entry, password } of accounts) {
    try {
      const result = await syncAccount(token, entry, password);
      summary[result.action as 'created' | 'updated'] += 1;
      nextRegistry[result.email] = {
        ...nextRegistry[result.email],
        ...entry,
        email: result.email,
        userId: result.userId,
        tenantId: result.tenantId,
      };
      console.log(`  ${result.action}: ${result.email}`);
    } catch (error) {
      summary.failed += 1;
      console.warn(`  failed: ${entry.email} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(nextRegistry, null, 2), 'utf8');
  console.log(`✓ demo account sync complete. created=${summary.created}, updated=${summary.updated}, failed=${summary.failed}, target=${PB_URL}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('✗ demo account sync failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

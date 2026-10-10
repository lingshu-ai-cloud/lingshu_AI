/**
 * Provision explicitly selected demo/test accounts in PocketBase.
 *
 * Passwords are accepted only through DEMO_ACCOUNT_BOOTSTRAP_JSON for this
 * process invocation. They are sent to PocketBase and never written to the
 * registry, console, or another application data store.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let oneTimeBootstrapJson = process.env.DEMO_ACCOUNT_BOOTSTRAP_JSON;
delete process.env.DEMO_ACCOUNT_BOOTSTRAP_JSON;
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.production'), override: true });
delete process.env.DEMO_ACCOUNT_BOOTSTRAP_JSON;

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const REGISTRY_FILE = path.join(__dirname, '..', 'data', 'demo-account-registry.json');
const REGISTRY_BACKUP_FILE = path.join(__dirname, '..', 'data', 'demo-account-registry.backup.json');

type AccountStatus = 'available' | 'trialing' | 'expired' | 'customer' | 'admin';
type AccountRole = 'super_admin' | 'admin' | 'social_operator' | 'customer_service';
type CredentialState = 'active_hash_only' | 'external_secret' | 'password_reset_required' | 'expired_locked';

const ACCOUNT_STATUSES = new Set<AccountStatus>(['available', 'trialing', 'expired', 'customer', 'admin']);
const ACCOUNT_ROLES = new Set<AccountRole>(['super_admin', 'admin', 'social_operator', 'customer_service']);
const CREDENTIAL_STATES = new Set<CredentialState>([
  'active_hash_only',
  'external_secret',
  'password_reset_required',
  'expired_locked',
]);

type RegistryEntry = {
  email: string;
  name?: string;
  role?: AccountRole;
  userId?: string;
  tenantId?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  status?: AccountStatus;
  credentialState?: CredentialState;
};

export type OneTimeBootstrapAccount = {
  email: string;
  password: string;
  name?: string;
  role?: AccountRole;
  tenantId?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  status?: AccountStatus;
};

type RecordMap = Record<string, unknown>;

export class PocketBaseRequestError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly urlPath: string,
    detail: string,
  ) {
    super(`${method} ${urlPath} failed ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'PocketBaseRequestError';
  }
}

export function isPocketBaseNotFound(error: unknown): boolean {
  return error instanceof PocketBaseRequestError && error.status === 404;
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function sanitizeDemoRegistryRecord(record: Record<string, unknown>): RegistryEntry {
  const {
    password: discardedPassword,
    rotationPassword: discardedRotationPassword,
    registeredPasswordCipher: discardedRegistrationCipher,
    ...safeRecord
  } = record;
  const email = normalizeEmail(safeRecord.email);
  const hadRecoverableCredential = Boolean(
    discardedPassword || discardedRotationPassword || discardedRegistrationCipher,
  );
  const configuredState = String(safeRecord.credentialState || '') as CredentialState;
  const credentialState: CredentialState = safeRecord.status === 'expired' || safeRecord.rotatedAt
    ? 'expired_locked'
    : hadRecoverableCredential
      ? 'password_reset_required'
      : CREDENTIAL_STATES.has(configuredState)
        ? configuredState
        : safeRecord.userId
          ? 'active_hash_only'
          : 'password_reset_required';
  return { ...safeRecord, email, credentialState } as RegistryEntry;
}

function sanitizeRegistry(registry: Record<string, Record<string, unknown>>): Record<string, RegistryEntry> {
  const sanitized: Record<string, RegistryEntry> = {};
  for (const [key, value] of Object.entries(registry)) {
    if (!value || typeof value !== 'object') continue;
    const entry = sanitizeDemoRegistryRecord({ ...value, email: value.email || key });
    if (entry.email) sanitized[entry.email] = entry;
  }
  return sanitized;
}

function writeSecureRegistryFile(file: string, contents: string): void {
  const temporaryFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, contents, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryFile, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Some platforms ignore POSIX modes. */ }
}

function writeRegistry(registry: Record<string, RegistryEntry>): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  const contents = JSON.stringify(sanitizeRegistry(registry), null, 2);
  writeSecureRegistryFile(REGISTRY_BACKUP_FILE, contents);
  writeSecureRegistryFile(REGISTRY_FILE, contents);
}

function readRegistryFile(file: string): Record<string, Record<string, unknown>> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function readRegistrySource(): {
  raw: Record<string, Record<string, unknown>>;
  registry: Record<string, RegistryEntry>;
} {
  const primary = readRegistryFile(REGISTRY_FILE);
  const raw = primary && Object.keys(primary).length > 0
    ? primary
    : readRegistryFile(REGISTRY_BACKUP_FILE) ?? primary ?? {};
  return { raw, registry: sanitizeRegistry(raw) };
}

export function legacyCredentialEmails(registry: Record<string, Record<string, unknown>>): string[] {
  return Object.entries(registry)
    .filter(([, entry]) => ['password', 'rotationPassword', 'registeredPasswordCipher']
      .some(field => Boolean(entry?.[field])))
    .map(([key, entry]) => normalizeEmail(entry.email || key))
    .filter(Boolean)
    .sort();
}

export function parseOneTimeBootstrapAccounts(rawValue: string | undefined): OneTimeBootstrapAccount[] {
  if (!rawValue?.trim()) {
    throw new Error(
      'DEMO_ACCOUNT_BOOTSTRAP_JSON is required and must contain an explicit one-time account credential array.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error('DEMO_ACCOUNT_BOOTSTRAP_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('DEMO_ACCOUNT_BOOTSTRAP_JSON must be a non-empty array');
  }
  const seen = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`bootstrap account ${index + 1} must be an object`);
    const account = value as Record<string, unknown>;
    const email = normalizeEmail(account.email);
    const password = String(account.password || '');
    const role = String(account.role || '') as AccountRole;
    const status = String(account.status || '') as AccountStatus;
    if (!email || !email.includes('@')) throw new Error(`bootstrap account ${index + 1} has an invalid email`);
    if (seen.has(email)) throw new Error(`duplicate bootstrap account: ${email}`);
    if (password.length < 12) throw new Error(`bootstrap password for ${email} must contain at least 12 characters`);
    if (role && !ACCOUNT_ROLES.has(role)) throw new Error(`bootstrap account ${email} has an invalid role`);
    if (status && !ACCOUNT_STATUSES.has(status)) throw new Error(`bootstrap account ${email} has an invalid status`);
    seen.add(email);
    return {
      email,
      password,
      name: String(account.name || '').trim() || undefined,
      role: role || undefined,
      tenantId: String(account.tenantId || '').trim() || undefined,
      activatedAt: account.activatedAt ? String(account.activatedAt) : undefined,
      expiresAt: account.expiresAt ? String(account.expiresAt) : undefined,
      status: status || undefined,
    };
  });
}

export function assertDemoBootstrapActivationAllowed(entry: {
  email: string;
  status?: AccountStatus;
  role?: AccountRole;
}): void {
  if (!entry.status || !ACCOUNT_STATUSES.has(entry.status)) {
    throw new Error(`bootstrap for ${entry.email} requires an explicit valid account status`);
  }
  if (entry.status === 'expired') {
    throw new Error(
      `bootstrap for expired account ${entry.email} is blocked; provide an explicit non-expired status after authorization`,
    );
  }
  if (!entry.role || !ACCOUNT_ROLES.has(entry.role)) {
    throw new Error(`bootstrap for ${entry.email} requires an explicit valid account role`);
  }
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function authToken(): Promise<string> {
  if (!EMAIL || !PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set');
  const body = JSON.stringify({ identity: EMAIL, password: PASSWORD });
  for (const endpoint of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const response = await fetch(`${PB_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) continue;
    const json = await response.json() as { token?: string };
    if (json.token) return json.token;
  }
  throw new Error('PocketBase admin login failed');
}

async function pbRequest<T>(token: string, urlPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${PB_URL}${urlPath}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: token },
  });
  if (!response.ok) {
    throw new PocketBaseRequestError(
      response.status,
      init.method || 'GET',
      urlPath,
      await response.text(),
    );
  }
  return await response.json() as T;
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
  return pbRequest<RecordMap>(token, '/api/collections/tenants/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: entry.name || entry.email.split('@')[0],
      registeredEmail: entry.email,
      subscriptionStatus: isAdmin || isCustomer ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : isCustomer ? 'customer' : 'trial',
      subscriptionExpiresAt: isAdmin || isCustomer ? '' : (entry.expiresAt || ''),
      ...(isCustomer ? { registeredAt: entry.activatedAt || now } : {}),
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
      registeredEmail: entry.email,
      subscriptionStatus: isAdmin || isCustomer ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : isCustomer ? 'customer' : 'trial',
      subscriptionExpiresAt: isAdmin || isCustomer ? '' : (entry.expiresAt || ''),
    }),
  });
}

async function syncAccount(
  token: string,
  entry: RegistryEntry,
  oneTimePassword: string,
  checkpointTenant: (tenantId: string) => void,
): Promise<{ email: string; action: 'created' | 'updated'; userId: string; tenantId: string }> {
  const email = normalizeEmail(entry.email);
  const existing = await findOne(token, 'users', `email = "${escapeFilterValue(email)}"`);
  let tenantId = String(existing?.tenantId || entry.tenantId || '');
  if (!tenantId) {
    const reusableTenant = await findOne(token, 'tenants', `registeredEmail = "${escapeFilterValue(email)}"`);
    tenantId = String(reusableTenant?.id || '');
  }
  if (tenantId) {
    try {
      await patchTenant(token, tenantId, entry);
    } catch (error) {
      if (!isPocketBaseNotFound(error)) throw error;
      const reusableTenant = await findOne(token, 'tenants', `registeredEmail = "${escapeFilterValue(email)}"`);
      if (reusableTenant?.id) {
        tenantId = String(reusableTenant.id);
      } else {
        const tenant = await createTenant(token, entry);
        tenantId = String(tenant.id);
      }
    }
  } else {
    const tenant = await createTenant(token, entry);
    tenantId = String(tenant.id);
  }
  if (!tenantId) throw new Error(`tenant bootstrap returned no id for ${email}`);
  checkpointTenant(tenantId);

  const userPayload = {
    password: oneTimePassword,
    passwordConfirm: oneTimePassword,
    tenantId,
    emailVisibility: true,
    name: entry.name || String(existing?.name || email.split('@')[0]),
    role: entry.role || String(existing?.role || 'admin'),
  };
  if (existing?.id) {
    await pbRequest<RecordMap>(token, `/api/collections/users/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userPayload),
    });
    return { email, action: 'updated', userId: String(existing.id), tenantId };
  }
  const created = await pbRequest<RecordMap>(token, '/api/collections/users/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, ...userPayload }),
  });
  return { email, action: 'created', userId: String(created.id), tenantId };
}

export async function main(): Promise<void> {
  const rawBootstrap = oneTimeBootstrapJson;
  oneTimeBootstrapJson = undefined;
  const bootstrapAccounts = parseOneTimeBootstrapAccounts(rawBootstrap);
  const { raw: rawRegistry, registry } = readRegistrySource();
  const bootstrapEmails = new Set(bootstrapAccounts.map(account => account.email));
  const uncoveredLegacyAccounts = legacyCredentialEmails(rawRegistry)
    .filter(email => !bootstrapEmails.has(email));
  if (uncoveredLegacyAccounts.length) {
    throw new Error(
      `Legacy registry credentials require an explicit reset before scrub: ${uncoveredLegacyAccounts.join(', ')}`,
    );
  }
  const token = await authToken();
  const nextRegistry = { ...registry };
  const summary = { created: 0, updated: 0, failed: 0 };
  for (const bootstrap of bootstrapAccounts) {
    const { password, ...metadata } = bootstrap;
    const providedMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined),
    );
    const entry = sanitizeDemoRegistryRecord({
      ...registry[bootstrap.email],
      ...providedMetadata,
      email: bootstrap.email,
      status: bootstrap.status ?? registry[bootstrap.email]?.status,
    });
    try {
      assertDemoBootstrapActivationAllowed(entry);
      const result = await syncAccount(token, entry, password, (tenantId) => {
        nextRegistry[entry.email] = sanitizeDemoRegistryRecord({
          ...entry,
          tenantId,
          credentialState: 'password_reset_required',
        });
      });
      summary[result.action] += 1;
      nextRegistry[result.email] = sanitizeDemoRegistryRecord({
        ...entry,
        email: result.email,
        userId: result.userId,
        tenantId: result.tenantId,
        credentialState: 'active_hash_only',
      });
      console.log(`  ${result.action}: ${result.email}`);
    } catch (error) {
      summary.failed += 1;
      console.warn(`  failed: ${entry.email} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (summary.failed === 0) writeRegistry(nextRegistry);
  console.log(`✓ demo account bootstrap complete. created=${summary.created}, updated=${summary.updated}, failed=${summary.failed}, target=${PB_URL}`);
  if (summary.failed > 0) process.exitCode = 1;
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error('✗ Demo account bootstrap failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

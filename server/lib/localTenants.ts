import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCAL_TENANTS_FILE = path.join(__dirname, '../../data/local-auth-tenants.json');
const INVITE_CLAIM_TTL_MS = 10 * 60 * 1000;

function localTenantsFile(): string {
  return process.env.LOCAL_TENANTS_FILE || DEFAULT_LOCAL_TENANTS_FILE;
}

export interface LocalTenantRecord {
  id: string;
  name: string;
  companyName: string;
  contactName: string;
  contact: string;
  industry: string;
  notes: string;
  inviteCode: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  registeredAt?: string;
  registeredEmail?: string;
  /** @deprecated Cleared on the next write; passwords must never be recoverable. */
  registeredPasswordCipher?: string;
  registrationInviteCode?: string;
  registrationClaimToken?: string;
  registrationClaimedAt?: string;
  registrationClaimEmail?: string;
}

function readLocalTenants(): LocalTenantRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(localTenantsFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalTenants(tenants: LocalTenantRecord[]): void {
  const file = localTenantsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(tenants, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows and some containers may ignore POSIX file modes.
  }
}

function withTenantLock<T>(operation: () => T): T {
  const file = localTenantsFile();
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = fs.openSync(lockFile, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 30_000) fs.unlinkSync(lockFile);
      } catch {
        // The owner may have released it between stat and unlink.
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (descriptor === null) throw new Error('local tenant registry is busy');
  try {
    return operation();
  } finally {
    try { fs.closeSync(descriptor); } catch { /* already closed */ }
    try { fs.unlinkSync(lockFile); } catch { /* already released */ }
  }
}

function claimIsActive(tenant: LocalTenantRecord, now = Date.now()): boolean {
  if (!tenant.registrationClaimToken || !tenant.registrationClaimedAt) return false;
  const claimedAt = Date.parse(tenant.registrationClaimedAt);
  return Number.isFinite(claimedAt) && now - claimedAt < INVITE_CLAIM_TTL_MS;
}

export function listLocalTenants(): LocalTenantRecord[] {
  return readLocalTenants();
}

export function getLocalTenant(tenantId: string): LocalTenantRecord | null {
  return readLocalTenants().find(tenant => tenant.id === tenantId) ?? null;
}

export function findLocalTenantByInvite(inviteCode: string): LocalTenantRecord | null {
  const code = String(inviteCode || '').trim();
  if (!code) return null;
  return readLocalTenants().find(tenant => tenant.inviteCode === code && !tenant.registeredAt && !claimIsActive(tenant)) ?? null;
}

export function findLocalTenantByRegistrationInvite(inviteCode: string): LocalTenantRecord | null {
  const code = String(inviteCode || '').trim();
  if (!code) return null;
  return readLocalTenants().find(tenant => tenant.registrationInviteCode === code) ?? null;
}

export function createLocalInviteTenant(input: {
  companyName: string;
  contactName?: string;
  industry?: string;
  notes?: string;
  inviteCode: string;
}): LocalTenantRecord {
  const companyName = String(input.companyName || '').trim();
  const contactName = String(input.contactName || '').trim();
  const tenant: LocalTenantRecord = {
    id: `local_tenant_customer_${randomUUID().replaceAll('-', '')}`,
    name: companyName,
    companyName,
    contactName,
    contact: contactName,
    industry: String(input.industry || '').trim(),
    notes: String(input.notes || '').trim(),
    inviteCode: String(input.inviteCode || '').trim(),
    subscriptionStatus: 'pending_delivery',
    subscriptionPlan: 'delivery',
    subscriptionExpiresAt: null,
    createdAt: new Date().toISOString(),
  };
  withTenantLock(() => writeLocalTenants([tenant, ...readLocalTenants()]));
  return tenant;
}

export function promoteLocalTrialTenant(input: {
  tenantId: string;
  companyName: string;
  contactName?: string;
  industry?: string;
  email: string;
  registeredAt?: string;
}): LocalTenantRecord {
  return withTenantLock(() => {
    const tenants = readLocalTenants();
    const index = tenants.findIndex(tenant => tenant.id === input.tenantId);
    const existing = index >= 0 ? tenants[index] : null;
    const now = new Date().toISOString();
    const next: LocalTenantRecord = {
    id: input.tenantId,
    name: input.companyName || existing?.name || input.email.split('@')[0],
    companyName: input.companyName || existing?.companyName || input.email.split('@')[0],
    contactName: input.contactName ?? existing?.contactName ?? '',
    contact: input.contactName ?? existing?.contact ?? '',
    industry: input.industry ?? existing?.industry ?? '',
    notes: existing?.notes ?? '',
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
    createdAt: existing?.createdAt ?? input.registeredAt ?? now,
    registeredAt: existing?.registeredAt ?? input.registeredAt ?? now,
    registeredEmail: input.email.trim().toLowerCase(),
    registrationInviteCode: existing?.registrationInviteCode ?? '',
  };
    if (index >= 0) tenants[index] = next;
    else tenants.unshift(next);
    writeLocalTenants(tenants);
    return next;
  });
}

export function claimLocalTenantInvite(input: {
  inviteCode: string;
  email: string;
}): { tenant: LocalTenantRecord; claimToken: string } | null {
  return withTenantLock(() => {
    const tenants = readLocalTenants();
    const index = tenants.findIndex(tenant => tenant.inviteCode === input.inviteCode && !tenant.registeredAt);
    if (index < 0 || claimIsActive(tenants[index])) return null;
    const claimToken = randomUUID();
    tenants[index] = {
      ...tenants[index],
      registrationClaimToken: claimToken,
      registrationClaimedAt: new Date().toISOString(),
      registrationClaimEmail: String(input.email || '').trim().toLowerCase(),
    };
    writeLocalTenants(tenants);
    return { tenant: tenants[index], claimToken };
  });
}

export function finalizeLocalTenantInvite(input: {
  inviteCode: string;
  email: string;
  claimToken: string;
}): LocalTenantRecord | null {
  return withTenantLock(() => {
    const tenants = readLocalTenants();
    const index = tenants.findIndex(tenant => (
      tenant.inviteCode === input.inviteCode
      && tenant.registrationClaimToken === input.claimToken
      && !tenant.registeredAt
    ));
    if (index < 0) return null;
    const current = tenants[index];
    const { registeredPasswordCipher: _legacySecret, ...safeCurrent } = current;
    tenants[index] = {
      ...safeCurrent,
      inviteCode: '',
      registrationInviteCode: current.inviteCode,
      registrationClaimToken: '',
      registrationClaimedAt: '',
      registrationClaimEmail: '',
      subscriptionStatus: 'active',
      subscriptionPlan: 'customer',
      subscriptionExpiresAt: null,
      registeredAt: new Date().toISOString(),
      registeredEmail: String(input.email || '').trim().toLowerCase(),
    };
    writeLocalTenants(tenants);
    return tenants[index];
  });
}

export function releaseLocalTenantInviteClaim(input: { inviteCode: string; claimToken: string }): boolean {
  return withTenantLock(() => {
    const tenants = readLocalTenants();
    const index = tenants.findIndex(tenant => (
      tenant.inviteCode === input.inviteCode && tenant.registrationClaimToken === input.claimToken && !tenant.registeredAt
    ));
    if (index < 0) return false;
    tenants[index] = {
      ...tenants[index],
      registrationClaimToken: '',
      registrationClaimedAt: '',
      registrationClaimEmail: '',
    };
    writeLocalTenants(tenants);
    return true;
  });
}

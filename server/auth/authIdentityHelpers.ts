import { scryptSync, timingSafeEqual } from 'node:crypto';
import { createPbRequestSignal, getPbAdminToken, getPbUrl } from '../storage/pb.js';
import { localAccountRecordsFile, readLocalAccountRecords, writeLocalAccountRecords, type LocalStoredAccount } from '../lib/localAccountStore.js';
import { localPreviewOrigins } from '../lib/localPreviewOrigins.js';
import { verifyLocalIdentity, type VerifiedLocalIdentity } from './localIdentity.js';
import type { OrganizationRole } from '../lib/organizationRole.js';

export interface PbUser { id: string; email?: string; name?: string; tenantId?: string; role?: OrganizationRole }
export type LocalAccount = LocalStoredAccount;

export function isLocalPreviewLoopbackAddress(address: string | undefined): boolean {
  const normalized = String(address || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

export function localPreviewRequestRejection(origin: string | undefined, remoteAddress: string | undefined):
  'local_preview_origin_required' | 'local_preview_loopback_required' | null {
  if (!localPreviewOrigins().has(String(origin || ''))) return 'local_preview_origin_required';
  if (!isLocalPreviewLoopbackAddress(remoteAddress)) return 'local_preview_loopback_required';
  return null;
}

export function localId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

export function readLocalAccounts(): LocalAccount[] {
  return readLocalAccountRecords(localAccountRecordsFile());
}

export function writeLocalAccounts(accounts: LocalAccount[]): void {
  writeLocalAccountRecords(localAccountRecordsFile(), accounts);
}

export function passwordHash(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

export function localPasswordMatches(account: LocalAccount, password: string): boolean {
  try {
    const stored = Buffer.from(account.passwordHash, 'hex');
    const candidate = passwordHash(password, account.salt);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  } catch {
    return false;
  }
}

export function parseLocalToken(authHeader: string | undefined): VerifiedLocalIdentity | null {
  return verifyLocalIdentity(authHeader);
}

async function resolveLoginIdentity(identity: string): Promise<string> {
  const raw = String(identity).trim();
  if (raw.includes('@')) return raw;
  const adminToken = await getPbAdminToken();
  if (!adminToken) return raw;
  const normalized = raw.replace(/\s+/g, ' ');
  const filter = `name = "${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  try {
    const res = await fetch(`${getPbUrl()}/api/collections/users/records?perPage=1&filter=${encodeURIComponent(filter)}`, {
      headers: { Authorization: adminToken }, signal: createPbRequestSignal(),
    });
    if (!res.ok) return raw;
    const json = (await res.json()) as { items?: PbUser[] };
    return json.items?.[0]?.email || raw;
  } catch {
    return raw;
  }
}

export async function pbLogin(identity: string, password: string): Promise<{ token: string; record: PbUser } | null> {
  try {
    const loginIdentity = await resolveLoginIdentity(identity);
    const res = await fetch(`${getPbUrl()}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: loginIdentity, password }), signal: createPbRequestSignal(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; record: PbUser };
  } catch {
    return null;
  }
}

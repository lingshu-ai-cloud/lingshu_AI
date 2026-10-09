/**
 * PocketBase implementation of DataStore + AuthProvider.
 *
 * This is the ONLY file that knows PocketBase's filter-string syntax and auth
 * endpoints. It wraps the low-level fetch helpers in `pb.ts`. When migrating
 * off PocketBase, write a sibling `supabaseStore.ts` against the same
 * interfaces and switch the export in `index.ts` — nothing else changes.
 */
import {
  pbGetStrict,
  pbCreateStrict,
  pbPatchStrict,
  pbDeleteStrict,
  pbListStrict,
  pbRequestTimeoutMs,
  getTenantIdFromToken,
} from './pb.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import type {
  AuthProvider,
  CompareExpected,
  DataStore,
  Identity,
  ListQuery,
  ListResult,
  Record_,
  Where,
} from './datastore.js';
import { verifySupportAccessToken } from '../lib/supportAccess.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { isLocalDemoAuthorization, verifyLocalIdentity } from '../auth/localIdentity.js';
import { bindDataAuthority, currentDataAuthority } from './dataAuthority.js';
import {
  createLocalDataTenant,
  deleteLocalInviteTenant,
  listLocalTenants,
  updateLocalDataTenant,
} from '../lib/localTenants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STORE_DIR = process.env.LOCAL_STORE_DIR?.trim()
  ? path.resolve(process.env.LOCAL_STORE_DIR)
  : path.join(__dirname, '../../data/local-store');

function localCollectionPath(collection: string): string {
  return path.join(LOCAL_STORE_DIR, `${collection.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readLocalCollection<T = Record_>(collection: string): T[] {
  if (!localFallbacksEnabled()) return [];
  if (collection === 'tenants') return listLocalTenants() as T[];
  try {
    const parsed = JSON.parse(fs.readFileSync(localCollectionPath(collection), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCollection(collection: string, records: unknown[]): void {
  fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true });
  const file = localCollectionPath(collection);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Some platforms ignore POSIX file modes.
  }
}

function sortLocalRecords<T extends Record<string, unknown>>(items: T[], sort?: string): T[] {
  if (!sort) return items;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = typeof av === 'string' ? Date.parse(av) : Number(av);
    const bn = typeof bv === 'string' ? Date.parse(bv) : Number(bv);
    const comparison = Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : String(av ?? '').localeCompare(String(bv ?? ''));
    return desc ? -comparison : comparison;
  });
}

function filterLocalRecords<T extends Record<string, unknown>>(items: T[], where?: Where): T[] {
  if (!where) return items;
  return items.filter(item => Object.entries(where).every(([key, value]) => String(item[key] ?? '') === String(value)));
}

function localCreate<T = Record_>(collection: string, data: Record<string, unknown>): T | null {
  if (!localFallbacksEnabled()) return null;
  if (collection === 'tenants') return createLocalDataTenant(data) as T;
  const records = readLocalCollection<Record_>(collection);
  const now = new Date().toISOString();
  const requestedId = String(data.id || '');
  if (requestedId && records.some(record => record.id === requestedId)) return null;
  const record = {
    id: String(data.id || `${collection}_${randomUUID().replaceAll('-', '')}`),
    created: data.created || now,
    updated: data.updated || now,
    ...data,
  } as Record_;
  records.unshift(record);
  writeLocalCollection(collection, records);
  return record as T;
}

function localUpdate(collection: string, id: string, data: Record<string, unknown>): boolean {
  if (!localFallbacksEnabled()) return false;
  if (collection === 'tenants') return updateLocalDataTenant(id, data);
  const records = readLocalCollection<Record_>(collection);
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return false;
  records[index] = { ...records[index], ...data, updated: new Date().toISOString() };
  writeLocalCollection(collection, records);
  return true;
}

function localCompareAndSwap(
  collection: string,
  id: string,
  expected: CompareExpected,
  data: Record<string, unknown>,
): boolean {
  if (!localFallbacksEnabled()) return false;
  const records = readLocalCollection<Record_>(collection);
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return false;
  const current = records[index];
  if (!Object.entries(expected).every(([key, value]) => isDeepStrictEqual(current[key], value))) return false;
  records[index] = { ...current, ...data, updated: new Date().toISOString() };
  writeLocalCollection(collection, records);
  return true;
}

const compareAndSwapTails = new Map<string, Promise<void>>();
const CAS_CLAIM_COLLECTION = 'datastore_cas_claims';
// A claim may cover create/read/ownership-check/PATCH/verification requests.
// Each PocketBase request is independently bounded by pbRequestTimeoutMs().
// Five complete request windows plus a margin keeps a claimant alive longer
// than any target write it could still issue. Recovery is deliberately limited
// to an exact operation replay; a different operation never steals by clock.
const CAS_CLAIM_LEASE_MS = Math.max(120_000, (pbRequestTimeoutMs() * 5) + 30_000);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function recordMatches(record: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => canonicalJson(record[key]) === canonicalJson(value));
}

function casFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function newCasClaimId(): string {
  // PocketBase record ids are exactly 15 lower-case alphanumeric characters.
  // A unique target_key index elects the winner. Per-owner ids prevent an old
  // owner from deleting a replacement claim after its lease expired.
  return randomUUID().replaceAll('-', '').slice(0, 15);
}

type TargetClaim = {
  claimId: string;
  operationFingerprint: string;
  ownerToken: string;
  ownsClaim: boolean;
  existingClaim: Record<string, unknown> | null;
};

function claimTargetKey(collection: string, id: string): string {
  return `${collection}:${id}`;
}

function claimLeaseExpired(claim: Record<string, unknown>, nowMs = Date.now()): boolean {
  const explicitExpiry = Date.parse(String(claim.lease_expires_at || ''));
  if (Number.isFinite(explicitExpiry)) return explicitExpiry <= nowMs;
  const created = Date.parse(String(claim.created || claim.created_at || ''));
  return Number.isFinite(created) && created + CAS_CLAIM_LEASE_MS <= nowMs;
}

async function currentPocketBaseTargetClaim(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const targetKey = claimTargetKey(collection, id);
  const result = await pbListStrict<Record<string, unknown>>(CAS_CLAIM_COLLECTION, {
    filter: `target_key = ${pbValue(targetKey)}`,
    perPage: 1,
  });
  return result.items[0] ?? null;
}

async function createPocketBaseTargetClaim(
  collection: string,
  id: string,
  operationFingerprint: string,
  expectedFingerprint: string,
  ownerToken: string,
): Promise<TargetClaim | null> {
  const claimId = newCasClaimId();
  const now = Date.now();
  const created = await pbCreateStrict(CAS_CLAIM_COLLECTION, {
    id: claimId,
    target_key: claimTargetKey(collection, id),
    expected_fingerprint: expectedFingerprint,
    operation_fingerprint: operationFingerprint,
    owner_token: ownerToken,
    created_at: new Date(now).toISOString(),
    lease_expires_at: new Date(now + CAS_CLAIM_LEASE_MS).toISOString(),
  });
  return created
    ? { claimId, operationFingerprint, ownerToken, ownsClaim: true, existingClaim: null }
    : null;
}

async function acquirePocketBaseTargetClaim(
  collection: string,
  id: string,
  operation: Record<string, unknown>,
): Promise<TargetClaim> {
  const operationFingerprint = casFingerprint(operation);
  const expectedFingerprint = casFingerprint(operation.expected ?? null);
  const ownerToken = randomUUID();
  try {
    const created = await createPocketBaseTargetClaim(
      collection,
      id,
      operationFingerprint,
      expectedFingerprint,
      ownerToken,
    );
    if (created) return created;
    throw new Error('PocketBase target claim was not created');
  } catch (claimError) {
    // Only a readable existing claim proves contention. A missing claim is a
    // lock-service outage and must be propagated rather than downgraded.
    const existingClaim = await currentPocketBaseTargetClaim(collection, id);
    if (!existingClaim) throw claimError;
    const existingClaimId = String(existingClaim.id || '');
    const existingOwnerToken = String(existingClaim.owner_token || '');
    const exactReplay = existingClaim.operation_fingerprint === operationFingerprint;
    if (exactReplay && existingOwnerToken === ownerToken && existingClaimId) {
      // The create response may have been lost after PocketBase committed it.
      // The unguessable owner token proves this request is the actual owner.
      return {
        claimId: existingClaimId,
        operationFingerprint,
        ownerToken,
        ownsClaim: true,
        existingClaim,
      };
    }
    if (!exactReplay || !claimLeaseExpired(existingClaim) || !existingClaimId || !existingOwnerToken) {
      return {
        claimId: existingClaimId,
        operationFingerprint,
        ownerToken,
        ownsClaim: false,
        existingClaim,
      };
    }

    // Recovery is only for the exact same operation. Re-read the old owner's
    // row before deleting it. The owner-specific record id makes cleanup ABA
    // safe, while the unique target_key index elects at most one replacement.
    const reread = await pbGetStrict(CAS_CLAIM_COLLECTION, existingClaimId);
    if (
      !reread
      || reread.owner_token !== existingOwnerToken
      || reread.operation_fingerprint !== operationFingerprint
      || !claimLeaseExpired(reread)
    ) {
      const current = await currentPocketBaseTargetClaim(collection, id);
      return {
        claimId: String(current?.id || existingClaimId),
        operationFingerprint,
        ownerToken,
        ownsClaim: false,
        existingClaim: current,
      };
    }
    const removed = await pbDeleteStrict(CAS_CLAIM_COLLECTION, existingClaimId);
    if (!removed) {
      const current = await currentPocketBaseTargetClaim(collection, id);
      return {
        claimId: String(current?.id || existingClaimId),
        operationFingerprint,
        ownerToken,
        ownsClaim: false,
        existingClaim: current,
      };
    }
    try {
      const replacement = await createPocketBaseTargetClaim(
        collection,
        id,
        operationFingerprint,
        expectedFingerprint,
        ownerToken,
      );
      if (replacement) return replacement;
    } catch {
      // A peer may have won the target_key race after the expired row was
      // removed. Read that winner below and fail closed.
    }
    const current = await currentPocketBaseTargetClaim(collection, id);
    if (!current) throw claimError;
    return {
      claimId: String(current.id || ''),
      operationFingerprint,
      ownerToken,
      ownsClaim: false,
      existingClaim: current,
    };
  }
}

async function stillOwnPocketBaseTargetClaim(claim: TargetClaim): Promise<boolean> {
  if (!claim.ownsClaim || !claim.claimId || !claim.ownerToken) return false;
  const current = await pbGetStrict(CAS_CLAIM_COLLECTION, claim.claimId);
  return Boolean(
    current
    && current.owner_token === claim.ownerToken
    && current.operation_fingerprint === claim.operationFingerprint,
  );
}

async function releasePocketBaseTargetClaim(claim: TargetClaim): Promise<void> {
  if (!claim.ownsClaim) return;
  // Never delete a replacement owner's row. Cleanup failure is safe: the exact
  // operation can recover after the conservative lease; different operations
  // continue to fail closed.
  if (!await stillOwnPocketBaseTargetClaim(claim).catch(() => false)) return;
  await pbDeleteStrict(CAS_CLAIM_COLLECTION, claim.claimId).catch(() => false);
}

async function serializeCompareAndSwap<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = compareAndSwapTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => tail);
  compareAndSwapTails.set(key, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (compareAndSwapTails.get(key) === queued) compareAndSwapTails.delete(key);
  }
}

function localDelete(collection: string, id: string): boolean {
  if (!localFallbacksEnabled()) return false;
  if (collection === 'tenants') return deleteLocalInviteTenant(id);
  const records = readLocalCollection<Record_>(collection);
  const next = records.filter(record => record.id !== id);
  if (next.length === records.length) return false;
  writeLocalCollection(collection, next);
  return true;
}

function localList<T = Record_>(collection: string, query: ListQuery = {}): ListResult<T> {
  const page = query.page ?? 1;
  const perPage = query.perPage ?? 20;
  const filtered = sortLocalRecords(filterLocalRecords(readLocalCollection<Record<string, unknown>>(collection), query.where), query.sort);
  const start = (page - 1) * perPage;
  return {
    items: filtered.slice(start, start + perPage) as T[],
    totalItems: filtered.length,
    totalPages: Math.ceil(filtered.length / perPage),
    page,
    perPage,
  };
}

/** Escape a value for inclusion in a PocketBase filter string. */
function pbValue(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Translate a backend-neutral `where` object into a PB filter string. */
function toPbFilter(where?: Where): string | undefined {
  if (!where) return undefined;
  const parts = Object.entries(where)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k} = ${pbValue(v)}`);
  return parts.length ? parts.join(' && ') : undefined;
}

export const pbStore: DataStore = {
  async getById<T = Record_>(collection: string, id: string) {
    const authority = currentDataAuthority();
    if (authority === 'local') {
      return readLocalCollection<T & { id: string }>(collection).find(record => record.id === id) ?? null;
    }
    try {
      const remote = await pbGetStrict(collection, id) as T | null;
      if (remote) return remote;
      return null;
    } catch (error) {
      if (!authority && localFallbacksEnabled()) {
        return readLocalCollection<T & { id: string }>(collection).find(record => record.id === id) ?? null;
      }
      throw error;
    }
  },

  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    const authority = currentDataAuthority();
    if (authority === 'local') return localCreate<T>(collection, data);
    try {
      const remote = await pbCreateStrict(collection, data) as T | null;
      return remote;
    } catch (error) {
      if (!authority && localFallbacksEnabled()) return localCreate<T>(collection, data);
      throw error;
    }
  },

  async update(collection: string, id: string, data: Record<string, unknown>) {
    const authority = currentDataAuthority();
    if (authority === 'local') return localUpdate(collection, id, data);
    try {
      const claim = await acquirePocketBaseTargetClaim(collection, id, { kind: 'update', data });
      if (!claim.ownsClaim) {
        const current = await pbGetStrict(collection, id) as Record<string, unknown> | null;
        return Boolean(
          claim.existingClaim?.operation_fingerprint === claim.operationFingerprint
          && current
          && recordMatches(current, data)
        );
      }
      let releaseClaim = false;
      try {
        if (!await stillOwnPocketBaseTargetClaim(claim)) return false;
        const patched = await pbPatchStrict(collection, id, data);
        if (!patched) {
          releaseClaim = true;
          return false;
        }
        const verified = await pbGetStrict(collection, id) as Record<string, unknown> | null;
        if (!verified || !recordMatches(verified, data)) return false;
        releaseClaim = true;
        return true;
      } finally {
        if (releaseClaim) await releasePocketBaseTargetClaim(claim);
      }
    } catch (error) {
      if (!authority && localFallbacksEnabled()) return localUpdate(collection, id, data);
      throw error;
    }
  },

  async compareAndSwap(collection, id, expected, data) {
    const authority = currentDataAuthority();
    if (authority === 'local') {
      return serializeCompareAndSwap(`local:${collection}:${id}`, async () => (
        localCompareAndSwap(collection, id, expected, data)
      ));
    }
    try {
      const claim = await acquirePocketBaseTargetClaim(collection, id, {
        kind: 'compare_and_swap',
        expected,
        data,
      });
      if (!claim.ownsClaim) {
        const current = await pbGetStrict(collection, id) as Record<string, unknown> | null;
        if (
          claim.existingClaim?.operation_fingerprint === claim.operationFingerprint
          && current
          && !recordMatches(current, expected)
          && recordMatches(current, data)
        ) {
          // Exact replay after a winner committed but its response was lost.
          return true;
        }
        return false;
      }

      let releaseClaim = false;
      try {
        const current = await pbGetStrict(collection, id) as Record<string, unknown> | null;
        if (!current || !recordMatches(current, expected)) {
          releaseClaim = true;
          return Boolean(current && recordMatches(current, data));
        }
        if (!await stillOwnPocketBaseTargetClaim(claim)) return false;
        const patched = await pbPatchStrict(collection, id, data);
        if (!patched) {
          releaseClaim = true;
          return false;
        }
        const verified = await pbGetStrict(collection, id) as Record<string, unknown> | null;
        if (!verified || !recordMatches(verified, data)) {
          // PATCH outcome is uncertain. Keep the claim: availability may be
          // reduced, but no peer can silently overwrite from the stale state.
          return false;
        }
        releaseClaim = true;
        return true;
      } finally {
        if (releaseClaim) await releasePocketBaseTargetClaim(claim);
      }
    } catch (error) {
      if (!authority && localFallbacksEnabled()) {
        return serializeCompareAndSwap(`local:${collection}:${id}`, async () => (
          localCompareAndSwap(collection, id, expected, data)
        ));
      }
      throw error;
    }
  },

  async delete(collection: string, id: string) {
    const authority = currentDataAuthority();
    if (authority === 'local') return localDelete(collection, id);
    try {
      const remote = await pbDeleteStrict(collection, id);
      return remote;
    } catch (error) {
      if (!authority && localFallbacksEnabled()) return localDelete(collection, id);
      throw error;
    }
  },

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const authority = currentDataAuthority();
    if (authority === 'local') return localList<T>(collection, query);
    try {
      const remote = await pbListStrict<T>(collection, {
        filter: toPbFilter(query.where),
        sort: query.sort, // PB's `-field`/`field` convention matches our neutral one
        page: query.page,
        perPage: query.perPage,
      });
      // An authoritative empty collection is still a successful PocketBase
      // response. Never replace it with realistic-looking demo records.
      return remote;
    } catch (error) {
      if (!authority && localFallbacksEnabled()) return localList<T>(collection, query);
      throw error;
    }
  },
};

export const pbAuth: AuthProvider = {
  async verifyToken(authHeader: string | undefined): Promise<Identity | null> {
    const supportAccess = verifySupportAccessToken(authHeader);
    if (supportAccess) {
      bindDataAuthority('pocketbase');
      return { ...supportAccess, dataAuthority: 'pocketbase' };
    }
    if (isLocalDemoAuthorization(authHeader)) {
      const local = verifyLocalIdentity(authHeader);
      if (!local) return null;
      bindDataAuthority('local');
      return { userId: local.userId, tenantId: local.tenantId, dataAuthority: 'local' };
    }
    const remote = await getTenantIdFromToken(authHeader);
    if (!remote) return null;
    bindDataAuthority('pocketbase');
    return { ...remote, dataAuthority: 'pocketbase' };
  },
};

/**
 * PocketBase implementation of DataStore + AuthProvider.
 *
 * This is the ONLY file that knows PocketBase's filter-string syntax and auth
 * endpoints. It wraps the low-level fetch helpers in `pb.ts`. When migrating
 * off PocketBase, write a sibling `supabaseStore.ts` against the same
 * interfaces and switch the export in `index.ts` — nothing else changes.
 */
import {
  pbGet,
  pbCreate,
  pbPatch,
  pbDelete,
  pbList,
  pbCompareAndSet,
  pbCreateIfAbsent,
  getTenantIdFromToken,
  isPbFallbackEligible,
} from './pb.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuthProvider,
  DataStore,
  Identity,
  LteWhere,
  ListQuery,
  ListResult,
  Record_,
  Where,
} from './datastore.js';
import { verifySupportAccessToken } from '../lib/supportAccess.js';
import { validateAuthSession } from '../security/authSessions.js';

const LOCAL_AUTH_PREFIX = 'local-demo.';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STORE_DIR = process.env.LOCAL_STORE_DIR?.trim()
  ? path.resolve(process.env.LOCAL_STORE_DIR)
  : path.join(__dirname, '../../data/local-store');

function isLocalDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_LOCAL_STORE_FALLBACK === 'true';
}

function isLocalAuthFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_LOCAL_AUTH_FALLBACK !== 'true';
}

function parseLocalToken(authHeader: string | undefined): Identity | null {
  if (!isLocalAuthFallbackEnabled()) return null;
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith(LOCAL_AUTH_PREFIX)) return null;
  try {
    const data = JSON.parse(Buffer.from(token.slice(LOCAL_AUTH_PREFIX.length), 'base64url').toString('utf8')) as Partial<Identity>;
    return data.userId && data.tenantId ? { userId: data.userId, tenantId: data.tenantId } : null;
  } catch {
    return null;
  }
}

function localCollectionPath(collection: string): string {
  return path.join(LOCAL_STORE_DIR, `${collection.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readLocalCollection<T = Record_>(collection: string): T[] {
  if (!isLocalDevFallbackEnabled()) return [];
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
  fs.writeFileSync(file, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Some platforms ignore POSIX file modes.
  }
}

function sortLocalRecords<T extends Record<string, unknown>>(items: T[], sort?: string): T[] {
  if (!sort) return items;
  const fields = sort.split(',').map(item => item.trim()).filter(Boolean).map(item => ({
    desc: item.startsWith('-'),
    key: item.startsWith('-') ? item.slice(1) : item,
  }));
  return [...items].sort((a, b) => {
    for (const { key, desc } of fields) {
      const av = a[key];
      const bv = b[key];
      const an = typeof av === 'string' ? Date.parse(av) : Number(av);
      const bn = typeof bv === 'string' ? Date.parse(bv) : Number(bv);
      const comparison = Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn
        : String(av ?? '').localeCompare(String(bv ?? ''));
      if (comparison !== 0) return desc ? -comparison : comparison;
    }
    return 0;
  });
}

function boundedLteEntries(lte?: LteWhere): Array<[string, string | number]> {
  const entries = Object.entries(lte ?? {});
  if (entries.length > 1) throw new Error('datastore_lte_supports_one_field');
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new Error('datastore_filter_field_invalid');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('datastore_lte_value_invalid');
  }
  return entries;
}

function filterLocalRecords<T extends Record<string, unknown>>(items: T[], where?: Where, lte?: LteWhere): T[] {
  const upperBounds = boundedLteEntries(lte);
  return items.filter(item => {
    if (where && !Object.entries(where).every(([key, value]) => String(item[key] ?? '') === String(value))) return false;
    return upperBounds.every(([key, expected]) => {
      const actual = item[key];
      if (actual === undefined || actual === null || actual === '') return false;
      if (typeof expected === 'number') {
        const numeric = Number(actual);
        return Number.isFinite(numeric) && numeric <= expected;
      }
      return String(actual) <= expected;
    });
  });
}

function localCreate<T = Record_>(collection: string, data: Record<string, unknown>): T | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const records = readLocalCollection<Record_>(collection);
  const now = new Date().toISOString();
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
  if (!isLocalDevFallbackEnabled()) return false;
  const records = readLocalCollection<Record_>(collection);
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return false;
  records[index] = { ...records[index], ...data, updated: new Date().toISOString() };
  writeLocalCollection(collection, records);
  return true;
}

function localDelete(collection: string, id: string): boolean {
  if (!isLocalDevFallbackEnabled()) return false;
  const records = readLocalCollection<Record_>(collection);
  const next = records.filter(record => record.id !== id);
  if (next.length === records.length) return false;
  writeLocalCollection(collection, next);
  return true;
}

function localList<T = Record_>(collection: string, query: ListQuery = {}): ListResult<T> {
  const page = query.page ?? 1;
  const perPage = query.perPage ?? 20;
  const filtered = sortLocalRecords(filterLocalRecords(
    readLocalCollection<Record<string, unknown>>(collection),
    query.where,
    query.lte,
  ), query.sort);
  const start = (page - 1) * perPage;
  return {
    items: filtered.slice(start, start + perPage) as T[],
    totalItems: query.skipTotal ? -1 : filtered.length,
    totalPages: query.skipTotal ? -1 : Math.ceil(filtered.length / perPage),
    page,
    perPage,
  };
}

function localCompareAndSet<T extends Record_>(
  collection: string,
  id: string,
  expected: Where,
  data: Record<string, unknown>,
) {
  const records = readLocalCollection<Record_>(collection);
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return { ok: false as const, reason: 'not_found' as const };
  const current = records[index]!;
  const matches = Object.entries(expected).every(([key, value]) => String(current[key] ?? '') === String(value));
  if (!matches) return { ok: false as const, reason: 'conflict' as const, current: current as T };
  const next = { ...current, ...data, updated: new Date().toISOString() } as Record_;
  records[index] = next;
  writeLocalCollection(collection, records);
  return { ok: true as const, record: next as T };
}

function localCreateIfAbsent<T extends Record_>(
  collection: string,
  uniqueWhere: Where,
  data: Record<string, unknown>,
): { created: boolean; record: T } | null {
  const records = readLocalCollection<Record_>(collection);
  const existing = records.find(record => Object.entries(uniqueWhere)
    .every(([key, value]) => String(record[key] ?? '') === String(value)));
  if (existing) return { created: false, record: existing as T };
  const created = localCreate<T>(collection, { ...data, ...uniqueWhere });
  return created ? { created: true, record: created } : null;
}

function canUseLocalFallback(error: unknown): boolean {
  return isLocalDevFallbackEnabled() && isPbFallbackEligible(error);
}

/** Escape a value for inclusion in a PocketBase filter string. */
function pbValue(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Translate a backend-neutral `where` object into a PB filter string. */
function toPbFilter(where?: Where, lte?: LteWhere): string | undefined {
  const parts = Object.entries(where ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) throw new Error('datastore_filter_field_invalid');
      return `${k} = ${pbValue(v)}`;
    });
  for (const [key, upperBound] of boundedLteEntries(lte)) {
    parts.push(`${key} <= ${pbValue(upperBound)}`);
  }
  return parts.length ? parts.join(' && ') : undefined;
}

export const pbStore: DataStore = {
  async getById<T = Record_>(collection: string, id: string) {
    try {
      return await pbGet(collection, id) as T | null;
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      return readLocalCollection<T & { id: string }>(collection).find(record => record.id === id) ?? null;
    }
  },

  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    try {
      return await pbCreate(collection, data) as T;
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      const local = localCreate<T>(collection, data);
      if (!local) throw error;
      return local;
    }
  },

  async update(collection: string, id: string, data: Record<string, unknown>) {
    try {
      return await pbPatch(collection, id, data);
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      return localUpdate(collection, id, data);
    }
  },

  async delete(collection: string, id: string) {
    try {
      return await pbDelete(collection, id);
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      return localDelete(collection, id);
    }
  },

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    try {
      const remote = await pbList<T>(collection, {
        filter: toPbFilter(query.where, query.lte),
        sort: query.sort, // PB's `-field`/`field` convention matches our neutral one
        page: query.page,
        perPage: query.perPage,
        skipTotal: query.skipTotal,
      });
      // A valid empty PocketBase result is authoritative. Mixing it with stale
      // local data breaks tenant isolation and can masquerade as persistence.
      return remote;
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      return localList<T>(collection, query);
    }
  },

  async compareAndSet<T = Record_>(collection: string, id: string, expected: Where, data: Record<string, unknown>) {
    try {
      return await pbCompareAndSet<T & Record<string, unknown>>(collection, id, expected, data) as import('./datastore.js').AtomicCompareResult<T>;
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      return localCompareAndSet<T & Record_>(collection, id, expected, data) as import('./datastore.js').AtomicCompareResult<T>;
    }
  },

  async createIfAbsent<T = Record_>(collection: string, uniqueWhere: Where, data: Record<string, unknown>) {
    try {
      return await pbCreateIfAbsent<T & Record<string, unknown>>(collection, uniqueWhere, data) as { created: boolean; record: T };
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      const local = localCreateIfAbsent<T & Record_>(collection, uniqueWhere, data);
      if (!local) throw error;
      return local as { created: boolean; record: T };
    }
  },
};

export const pbAuth: AuthProvider = {
  async verifyToken(authHeader: string | undefined): Promise<Identity | null> {
    const supportAccess = verifySupportAccessToken(authHeader);
    if (supportAccess) return supportAccess;
    const local = parseLocalToken(authHeader);
    if (local) return local;
    const identity = await getTenantIdFromToken(authHeader);
    if (!identity) return null;
    return await validateAuthSession({ authHeader, identity, dataStore: pbStore }) ? identity : null;
  },
};

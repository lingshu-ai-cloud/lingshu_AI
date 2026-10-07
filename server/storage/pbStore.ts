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
  getTenantIdFromToken,
} from './pb.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuthProvider,
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
      const remote = await pbPatchStrict(collection, id, data);
      return remote;
    } catch (error) {
      if (!authority && localFallbacksEnabled()) return localUpdate(collection, id, data);
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

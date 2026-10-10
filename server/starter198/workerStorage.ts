import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { dataBackend, store } from '../storage/index.js';
import { adminFetch, pbListStrict } from '../storage/pb.js';

function pbValue(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function filter(where: ListQuery['where']): string | undefined {
  const values = Object.entries(where ?? {}).map(([key, value]) => `${key} = ${pbValue(value)}`);
  return values.length ? values.join(' && ') : undefined;
}

async function recordResponse<T>(
  response: Response,
  collection: string,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${collection} ${operation} failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const record = await response.json() as T;
  const identity = record && typeof record === 'object'
    ? record as unknown as { id?: unknown }
    : null;
  if (!identity || typeof identity.id !== 'string' || !identity.id) {
    throw new Error(`${collection} ${operation} returned an invalid record`);
  }
  return record;
}

const strictPocketBaseWorkerStore: DataStore = {
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const response = await adminFetch(
      `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    );
    if (response.status === 404) return null;
    return recordResponse<T>(response, collection, 'read');
  },
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const response = await adminFetch(`/api/collections/${encodeURIComponent(collection)}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return recordResponse<T>(response, collection, 'create');
  },
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const response = await adminFetch(
      `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    );
    await recordResponse<Record_>(response, collection, 'update');
    return true;
  },
  async delete(collection: string, id: string): Promise<boolean> {
    const response = await adminFetch(
      `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${collection} delete failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    return true;
  },
  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    return pbListStrict<T>(collection, {
      filter: filter(query.where),
      sort: query.sort,
      page: query.page,
      perPage: query.perPage,
    });
  },
};

/**
 * The shared application store intentionally supports a local development
 * fallback. Background repair workers must never use that fallback in
 * production because it can split leases and artifacts across two stores.
 */
export function starterWorkerDataStore(dataStore: DataStore, env: NodeJS.ProcessEnv = process.env): DataStore {
  return env.NODE_ENV === 'production' && dataStore === store && dataBackend === 'pocketbase'
    ? strictPocketBaseWorkerStore
    : dataStore;
}

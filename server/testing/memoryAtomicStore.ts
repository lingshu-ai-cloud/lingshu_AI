import type {
  AtomicCompareResult,
  DataStore,
  ListQuery,
  ListResult,
  Record_,
  Where,
} from '../storage/datastore.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function matches(record: Record_, where: Where = {}): boolean {
  return Object.entries(where).every(([key, value]) => String(record[key] ?? '') === String(value));
}

/** A clone-on-read in-memory store that preserves the atomic contracts used by reliability tests. */
export class MemoryAtomicStore implements DataStore {
  private readonly records = new Map<string, Map<string, Record_>>();
  private createSerial = Promise.resolve();
  private sequence = 0;

  private bucket(collection: string): Map<string, Record_> {
    const existing = this.records.get(collection);
    if (existing) return existing;
    const created = new Map<string, Record_>();
    this.records.set(collection, created);
    return created;
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const record = this.bucket(collection).get(id);
    return record ? clone(record) as T : null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T> {
    const record = { id: String(data.id || `record-${++this.sequence}`), ...clone(data) } as Record_;
    this.bucket(collection).set(record.id, record);
    return clone(record) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const current = this.bucket(collection).get(id);
    if (!current) return false;
    this.bucket(collection).set(id, { ...current, ...clone(data) });
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.bucket(collection).delete(id);
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let records = [...this.bucket(collection).values()].filter(record => matches(record, query.where));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      records = records.sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
    }
    const perPage = query.perPage || 20;
    const page = query.page || 1;
    const start = (page - 1) * perPage;
    return {
      items: clone(records.slice(start, start + perPage)) as T[],
      totalItems: records.length,
      totalPages: records.length ? Math.ceil(records.length / perPage) : 0,
      page,
      perPage,
    };
  }

  async compareAndSet<T = Record_>(
    collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    const current = this.bucket(collection).get(id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (!matches(current, expected)) return { ok: false, reason: 'conflict', current: clone(current) as T };
    const record = { ...current, ...clone(data) } as Record_;
    this.bucket(collection).set(id, record);
    return { ok: true, record: clone(record) as T };
  }

  async createIfAbsent<T = Record_>(
    collection: string,
    uniqueWhere: Where,
    data: Record<string, unknown>,
  ): Promise<{ created: boolean; record: T }> {
    let release: (() => void) | undefined;
    const previous = this.createSerial;
    this.createSerial = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const existing = [...this.bucket(collection).values()].find(record => matches(record, uniqueWhere));
      if (existing) return { created: false, record: clone(existing) as T };
      const record = await this.create<T>(collection, { ...data, ...uniqueWhere });
      return { created: true, record };
    } finally {
      release?.();
    }
  }

  all<T = Record_>(collection: string): T[] {
    return clone([...this.bucket(collection).values()]) as T[];
  }
}

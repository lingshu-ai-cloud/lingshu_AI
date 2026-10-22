/** Bounded, tenant-keyed cache for public read models only; never cache credentials. */
export function creativeReadCache<T>(ttlMs: number, limit = 200) {
  const values = new Map<string, { expires: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  return async (tenantId: string, resourceId: string, read: () => Promise<T>): Promise<T> => {
    const key = JSON.stringify([tenantId, resourceId]), existing = values.get(key);
    if (existing && existing.expires > Date.now()) return structuredClone(existing.value);
    const inflight = pending.get(key);
    if (inflight) return structuredClone(await inflight);
    if (pending.size >= limit) throw new Error('Creative read capacity exceeded');
    const promise = read().then(value => {
      values.delete(key);
      while (values.size >= limit) values.delete(values.keys().next().value!);
      values.set(key, { expires: Date.now() + ttlMs, value: structuredClone(value) });
      return value;
    });
    pending.set(key, promise);
    try { return structuredClone(await promise); } finally { pending.delete(key); }
  };
}

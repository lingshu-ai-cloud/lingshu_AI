/** Single-instance optimistic write guard. Database transactions are needed for multiple writers. */
export function createProjectRevisionGuard() {
  const pending = new Map<string, Promise<unknown>>();
  return async <T>(key: string, write: () => Promise<T>): Promise<T> => {
    const operation = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(write);
    pending.set(key, operation);
    try { return await operation; } finally { if (pending.get(key) === operation) pending.delete(key); }
  };
}
export function projectRevisionMatches(expected: unknown, current: string, required: boolean) {
  return expected === current || (!required && expected === undefined);
}

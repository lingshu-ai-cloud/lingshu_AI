import { store } from '../storage/index.js';

/** Read newest pages until the reconnect cursor is reached. A long-lived run
 * must not get stuck after the first 500 persisted mouse/business events. */
export async function listRunEventsAfter<T extends { id: string; sequence: number }>(tenantId: string, runId: string, after: number): Promise<T[]> {
  const events = new Map<string, T>();
  for (let page = 1; ; page++) {
    const result = await store.list<T>('run_events', { where: { tenant_id: tenantId, run_id: runId }, sort: '-sequence', perPage: 500, page });
    for (const event of result.items) if (Number(event.sequence) > after) events.set(event.id, event);
    if (!result.items.length || page >= result.totalPages || result.items.some(event => Number(event.sequence) <= after)) break;
  }
  return [...events.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

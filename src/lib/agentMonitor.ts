import type { RunEvent } from './digitalEmployees';

/** A delayed overview response must never rewind the events already streamed. */
export function mergeMonitorEvents(runId: string, current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of [...incoming, ...current]) if (event.run_id === runId) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence).slice(-2000);
}

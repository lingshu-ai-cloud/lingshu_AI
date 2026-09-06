import type { RunEvent } from './digitalEmployees';

/** A delayed overview response must never rewind the events already streamed. */
export function mergeMonitorEvents(runId: string, current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of [...incoming, ...current]) if (event.run_id === runId) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence).slice(-2000);
}

/** Collapse adjacent identical events for display only; retain the original audit stream. */
export function groupMonitorEvents(events: RunEvent[]): Array<RunEvent & { repeatCount: number; firstOccurredAt: string }> {
  const groups: Array<RunEvent & { repeatCount: number; firstOccurredAt: string }> = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (previous && previous.run_id === event.run_id && previous.task_id === event.task_id
      && previous.type === event.type && previous.level === event.level && previous.summary === event.summary
      && event.level !== 'error' && event.level !== 'success') {
      groups[groups.length - 1] = { ...event, repeatCount: previous.repeatCount + 1, firstOccurredAt: previous.firstOccurredAt };
    } else groups.push({ ...event, repeatCount: 1, firstOccurredAt: event.occurred_at });
  }
  return groups;
}

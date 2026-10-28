import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { SOCIAL_IMAGE_TASKS_COLLECTION } from './socialImageTask.js';

/** Completed node transitions are the only timing samples; pending or blocked runs are not durations. */
export function imageNodeDurationSamples(tasks: SocialImageCreationTask[], nodeId: string, excludeTaskId: string): number[] {
  const samples: number[] = [];
  for (const task of tasks) {
    if (task.id === excludeTaskId) continue;
    const events = task.productionRuntime?.events || [];
    for (let index = 0; index < events.length - 1; index += 1) {
      const current = events[index]!, next = events[index + 1]!;
      if (current.nodeId !== nodeId || !['waiting', 'running'].includes(current.status)
        || next.nodeId === nodeId || ['blocked', 'needs_review', 'outcome_unknown'].includes(next.status)) continue;
      const seconds = (Date.parse(next.occurredAt) - Date.parse(current.occurredAt)) / 1000;
      if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600) samples.push(seconds);
    }
  }
  return samples.slice(-30);
}

export async function readImageNodeDurationHistory(store: DataStore, tenantId: string, task: SocialImageCreationTask): Promise<number[]> {
  const nodeId = task.productionRuntime?.currentNode;
  if (!nodeId) return [];
  const rows = await store.list<{ id: string; spec?: { socialImageTask?: SocialImageCreationTask } }>(SOCIAL_IMAGE_TASKS_COLLECTION,
    { where: { tenant_id: tenantId }, perPage: 100 });
  return imageNodeDurationSamples(rows.items.map(row => row.spec?.socialImageTask).filter((item): item is SocialImageCreationTask => !!item
    && item.creationPath === task.creationPath && item.imageType === task.imageType), nodeId, task.id);
}

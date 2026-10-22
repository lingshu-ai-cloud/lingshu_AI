import type { DataStore } from '../storage/datastore.js';
import { jsonObject, DIGITAL_EMPLOYEE_COLLECTION as COLLECTION,
  type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import { recordBelongsToTask, taskScope } from './taskEvidenceProjection.js';

/** The correction scope includes every task whose dependency chain reaches the changed task. */
export function downstreamTasks(tasks: TaskRecord[], current: TaskRecord, includeDownstream: boolean): TaskRecord[] {
  if (!includeDownstream) return [current];
  const selectedKeys = new Set([current.task_key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (selectedKeys.has(task.task_key)) continue;
      const dependencies = jsonObject<string[]>(task.depends_on, []);
      if (dependencies.some(key => selectedKeys.has(key))) {
        selectedKeys.add(task.task_key);
        changed = true;
      }
    }
  }
  return tasks.filter(task => selectedKeys.has(task.task_key)).sort((left, right) => left.sequence - right.sequence);
}

export function outputHasExternalReceipt(task: TaskRecord): boolean {
  const output = jsonObject<Record<string, unknown>>(task.output, {});
  if (output.externalPublishPerformed === true || Number(output.messagesSent || 0) > 0) return true;
  const proof = jsonObject<Record<string, unknown>>(output.proof, {});
  if (task.task_key === 'platform_publish' && Number(proof.value || 0) > 0 && proof.status === 'available') return true;
  if (task.task_key === 'followup_dispatch' && Number(proof.value || 0) > 0 && proof.status === 'available') return true;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (['platformPostId', 'platform_post_id', 'providerMessageId', 'provider_message_id'].some(key => Boolean(String(record[key] || '').trim()))) return true;
    if (Object.keys(jsonObject(record.providerReceipt, {})).length || Object.keys(jsonObject(record.provider_receipt, {})).length) return true;
    return Object.values(record).some(visit);
  };
  return visit(output);
}

export function postHasPublishedReceipt(post: StoredRecord): boolean {
  if (String(post.platform_post_id || '').trim()) return true;
  const stats = jsonObject<Record<string, unknown>>(post.stats, {});
  if (['published', 'partial'].includes(String(stats.status || ''))) return true;
  const publishResults = stats.publishResults || post.publishResults;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (['published', 'success', 'succeeded'].includes(String(record.status || '').toLowerCase())) return true;
    if (['platformPostId', 'platform_post_id'].some(key => Boolean(String(record[key] || '').trim()))) return true;
    return Object.values(record).some(visit);
  };
  return visit(publishResults);
}

/** A missing task-local receipt cannot prove safety: inspect posts and send records too. */
export async function irreversibleEffects(input: {
  store: Pick<DataStore, 'list'>;
  tenantId: string;
  run: RunRecord;
  affected: TaskRecord[];
  followupRunHasExternalReceipt: (tenantId: string, runId: string) => Promise<boolean>;
}): Promise<Array<Record<string, unknown>>> {
  const { store, tenantId, run, affected } = input;
  const effects: Array<Record<string, unknown>> = affected.filter(outputHasExternalReceipt).map(task => ({
    type: task.task_key === 'followup_dispatch' ? 'send_receipt' : 'publish_receipt',
    taskId: task.id, taskKey: task.task_key,
    businessRefs: jsonObject(task.business_refs, []),
  }));
  for (const task of affected) {
    if (effects.some(effect => effect.taskId === task.id) || task.status !== 'succeeded') continue;
    if (!['platform_publish', 'followup_dispatch'].includes(task.task_key)) continue;
    const externalEffect = String(task.external_effect || (task.task_key === 'platform_publish' ? 'publish' : 'send'));
    if (!['publish', 'send'].includes(externalEffect)) continue;
    const refs = jsonObject<unknown[]>(task.business_refs, []);
    if (!refs.length) effects.push({ type: 'conservative_external_effect_guard', taskId: task.id, taskKey: task.task_key, externalEffect });
  }
  if (affected.some(task => task.task_key === 'platform_publish')) {
    const [posts, allTasks] = await Promise.all([
      store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 }),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    ]);
    const publishTasks = affected.filter(task => task.task_key === 'platform_publish');
    const published = posts.items.filter(post => publishTasks.some(task =>
      recordBelongsToTask(post, run, taskScope(task, allTasks.items))) && postHasPublishedReceipt(post));
    if (published.length) effects.push({ type: 'publish_receipt', source: 'posts.platform_post_id + stats.publishResults',
      postIds: published.slice(0, 20).map(post => post.id), count: published.length });
  }
  if (affected.some(task => task.task_key === 'followup_dispatch')
    && await input.followupRunHasExternalReceipt(tenantId, run.id)) {
    effects.push({ type: 'send_receipt', runId: run.id, source: 'followup_batch_items' });
  }
  return effects;
}

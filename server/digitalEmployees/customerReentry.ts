import { store } from '../storage/index.js';
import { beijingDate } from './runtimeSchedule.js';
type Row = { id: string; [key: string]: any };
const object = (value: any) => { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return value || {}; };
async function all(collection: string, where: Record<string, string | number | boolean>): Promise<Row[]> {
  const rows: Row[] = []; let page = 1;
  for (;;) {
    const result = await store.list<Row>(collection, { where, page, perPage: 200 });
    rows.push(...result.items);
    if (!result.items.length || page >= result.totalPages) return rows;
    page += 1;
  }
}
async function update(collection: string, id: string, patch: Record<string, unknown>) {
  if (!await store.update(collection, id, patch)) throw new Error(`customer_reentry_storage_failed:${collection}:${id}`);
}
/** Called within the run lock. Persist intent first so a partial write resumes after restart. */
export async function reopenNoDataCustomerBranch(input: { tenantId: string; run: Row; tasks: Row[]; startsAt: string; endsAt: string; customerIds: string[]; now?: Date; onReopened?: (ids: string[]) => Promise<void> }): Promise<boolean> {
  const now = input.now || new Date(), day = beijingDate(now);
  if (day < input.startsAt || day > input.endsAt || ['cancelled', 'failed', 'paused', 'waiting_human'].includes(input.run.status)) return false;
  const keys = ['customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'];
  const anchor = input.tasks.find(task => task.task_key === 'customer_segmentation') || input.tasks.find(task => task.task_key === 'followup_batch_draft');
  if (!anchor) return false;
  const pending = object(object(anchor.output).customerReentryPending);
  const resume = Array.isArray(pending.customerIds) && pending.customerIds.length > 0;
  const empty = input.tasks.filter(task => keys.includes(task.task_key) && task.status === 'skipped' && object(task.output).dataStatus === 'no_data');
  if (!resume && !empty.some(task => ['customer_segmentation', 'followup_batch_draft'].includes(task.task_key))) return false;
  const events = await all('run_events', { tenant_id: input.tenantId, run_id: input.run.id, type: 'customer.no_data_reopened' });
  const seen = new Set<string>(events.flatMap(event => object(event.payload).customerIds || []));
  const added: string[] = resume ? pending.customerIds : [...new Set(input.customerIds)].filter(id => !seen.has(id));
  if (!added.length) return false;
  // If the event persisted and only intent cleanup failed, do not reset tasks again.
  if (resume && added.every(id => seen.has(id))) {
    const output = { ...object(anchor.output), customerReentryPending: null };
    await update('workflow_tasks', anchor.id, { output }); anchor.output = output;
    return true;
  }
  const batches = await all('followup_batches', { tenant_id: input.tenantId, run_id: input.run.id });
  for (const batch of batches) {
    const items = await all('followup_batch_items', { tenant_id: input.tenantId, batch_id: batch.id });
    if (items.some(item => item.provider_message_id || item.sent_at || ['sending', 'sent', 'partial_sent'].includes(item.status) || Object.keys(object(item.provider_receipt)).length)) return false;
  }
  if (!resume) {
    const intent = { customerIds: added, startedAt: now.toISOString() };
    const output = { ...object(anchor.output), customerReentryPending: intent };
    await update('workflow_tasks', anchor.id, { output }); anchor.output = output;
  }
  const segments = await all('customer_segments', { tenant_id: input.tenantId, run_id: input.run.id });
  for (const segment of segments) await update('customer_segments', segment.id, { status: 'superseded' });
  for (const batch of batches) await update('followup_batches', batch.id, { status: 'superseded' });
  const affected = input.tasks.filter(task => keys.includes(task.task_key) || task.task_key === 'weekly_review');
  for (const task of affected) {
    const patch = { status: 'pending', output: { reopenedForNewCustomers: added, reopenedAt: pending.startedAt || now.toISOString(), ...(task.id === anchor.id ? { customerReentryPending: object(anchor.output).customerReentryPending } : {}) }, business_refs: [], blocked_reason: '', updated_at: now.toISOString() };
    await update('workflow_tasks', task.id, patch); Object.assign(task, patch);
  }
  const approvals = await all('approval_requests', { tenant_id: input.tenantId, run_id: input.run.id, status: 'pending' });
  for (const approval of approvals.filter(item => affected.some(task => task.id === item.task_id))) await update('approval_requests', approval.id, { status: 'superseded' });
  if (input.run.goal_id) await update('weekly_goals', input.run.goal_id, { status: 'active' });
  const patch = { status: 'running', completed_at: '' };
  await update('workflow_runs', input.run.id, patch); Object.assign(input.run, patch);
  if (input.onReopened) await input.onReopened(added);
  const output = { ...object(anchor.output), customerReentryPending: null };
  await update('workflow_tasks', anchor.id, { output }); anchor.output = output;
  return true;
}

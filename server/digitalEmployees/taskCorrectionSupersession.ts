import type { DataStore } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject,
  type ApprovalRecord, type ContentBatchPlanRecord, type RunRecord,
  type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import type { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import type { getFollowupBatchItems, FollowupBatchRecord } from './customerWorkflow.js';
import { resumeContentProjectForTaskControl } from './contentProductionProjectState.js';
import { contentProjectLineageFields } from './contentProjectLineage.js';

/** Invalidate only the affected business state after a task correction.
 * The caller must hold the run lock and pass tenant-scoped dependencies. */
export async function supersedeAffectedBusinessState(input: {
  store: DataStore;
  tenantId: string;
  run: RunRecord;
  affected: TaskRecord[];
  now: string;
  controlJob: typeof controlContentExecutionJob;
  getFollowupBatchItems: typeof getFollowupBatchItems;
}): Promise<void> {
  const { store, tenantId, run, affected, now } = input;
  const affectedIds = new Set(affected.map(task => task.id));
  const affectedKeys = new Set(affected.map(task => task.task_key));
  if (affectedKeys.has('content_mode_routing') || affectedKeys.has('content_production')) {
    const jobs = await store.list<StoredRecord>('content_execution_jobs', {
      where: { tenant_id: tenantId, run_id: run.id }, perPage: 500,
    });
    for (const job of jobs.items.filter(item => !['succeeded', 'cancelled'].includes(String(item.status || '')))) {
      await input.controlJob({ dataStore: store, tenantId, jobId: job.id,
        action: 'cancel', now: new Date(now) });
    }
  }
  if (affectedKeys.has('content_mode_routing')) {
    const batches = await store.list<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans,
      { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
    for (const batch of batches.items.filter(item => item.status !== 'superseded')) {
      await store.update(COLLECTION.contentBatchPlans, batch.id, { status: 'superseded', updated_at: now });
    }
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    for (const project of projects.items) {
      const spec = jsonObject<Record<string, unknown>>(project.spec, {});
      const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
      if (String(spec.workflowRunId || '') !== run.id || automation.managedBy !== 'digital_employee'
        || automation.stage === 'superseded') continue;
      await store.update('studio_projects', project.id, { status: 'draft', spec: { ...spec,
        automation: { ...automation, stage: 'superseded', status: 'superseded', supersededAt: now,
          supersededReason: '编导方向调整后原内容订单失效' } }, updated_at: now });
    }
  } else if (affectedKeys.has('content_production')) {
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    for (const project of projects.items) {
      const spec = resumeContentProjectForTaskControl({ project, runId: run.id, affectedTaskIds: affectedIds, now });
      if (spec) await store.update('studio_projects', project.id, { spec,
        ...contentProjectLineageFields({ tenantId, spec, current: project }), updated_at: now });
    }
  }
  if (affectedKeys.has('customer_segmentation')) {
    const segments = await store.list<StoredRecord>(COLLECTION.segments,
      { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const segment of segments.items.filter(item => !['superseded', 'cancelled'].includes(String(item.status || '')))) {
      await store.update(COLLECTION.segments, segment.id, { status: 'superseded', updated_at: now });
    }
  }
  if (affectedKeys.has('followup_batch_draft')) {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches,
      { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const batch of batches.items.filter(item => !['superseded', 'cancelled'].includes(item.status))) {
      await store.update(COLLECTION.followupBatches, batch.id, { status: 'superseded', updated_at: now });
      const items = await input.getFollowupBatchItems(tenantId, batch.id);
      for (const item of items.filter(entry => !['sent', 'delivered'].includes(entry.status))) {
        await store.update(COLLECTION.followupItems, item.id, { status: 'superseded', updated_at: now });
      }
    }
  } else if (affectedKeys.has('followup_batch_approval')) {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches,
      { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const batch of batches.items.filter(item => ['approved', 'rejected', 'pending_approval'].includes(item.status))) {
      await store.update(COLLECTION.followupBatches, batch.id, { status: 'draft', approval_id: '',
        approved_version: 0, approved_by: '', approved_at: '', updated_at: now });
      const items = await input.getFollowupBatchItems(tenantId, batch.id);
      for (const item of items.filter(entry => ['approved', 'rejected'].includes(entry.status))) {
        await store.update(COLLECTION.followupItems, item.id, { status: 'draft', approved_at: '', updated_at: now });
      }
    }
  }
  const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals,
    { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
  for (const approval of approvals.items.filter(item => affectedIds.has(item.task_id)
    && item.status !== 'superseded')) {
    await store.update(COLLECTION.approvals, approval.id, { status: 'superseded',
      decision_note: '任务纠偏后原审批版本失效', decided_at: now });
  }
}

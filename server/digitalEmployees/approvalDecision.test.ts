import assert from 'node:assert/strict';
import {
  createDigitalEmployeeApprovalDecisionApplication,
  DigitalEmployeeApprovalDecisionError,
  type DigitalEmployeeApprovalDecisionDependencies,
} from './approvalDecision.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import type { PublishingApprovalPackage } from './publishingExecution.js';

type Row = { id: string; [key: string]: any };

function memoryStore(seed: Record<string, Row[]>): DataStore & { rows: Record<string, Row[]> } {
  const rows = structuredClone(seed);
  return {
    rows,
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows[collection]?.find(item => item.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `${collection}-${(rows[collection]?.length ?? 0) + 1}`, ...structuredClone(data) };
      (rows[collection] ||= []).push(row);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const row = rows[collection]?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      return true;
    },
    async delete(collection: string, id: string) {
      const before = rows[collection]?.length ?? 0;
      rows[collection] = (rows[collection] ?? []).filter(item => item.id !== id);
      return rows[collection].length !== before;
    },
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = (rows[collection] ?? []).filter(item => Object.entries(query.where ?? {})
        .every(([key, value]) => item[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = query.sort.replace(/^-/, '');
        items = [...items].sort((left, right) => {
          const compared = left[key] > right[key] ? 1 : left[key] < right[key] ? -1 : 0;
          return descending ? -compared : compared;
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 100;
      return {
        items: structuredClone(items.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: items.length,
        totalPages: Math.ceil(items.length / perPage),
        page,
        perPage,
      };
    },
  };
}

const fixedNow = new Date('2026-09-12T08:00:00.000Z');
const publishingPackage: PublishingApprovalPackage = {
  schemaVersion: 1,
  contentHash: 'frozen-hash',
  allowRealPublishing: false,
  items: [{
    sourceProjectId: 'project-1',
    platform: 'facebook',
    accountIds: ['account-1'],
    accountLabels: ['Page'],
    title: 'Frozen title',
    description: 'Frozen caption',
    videoPath: '/render/final.mp4',
    scheduledAt: '2026-09-13T12:00:00.000Z',
    sourceClaim: {
      schemaVersion: 1, sourceKind: 'digital_employee_project', projectId: 'project-1',
      sourceVideoPath: '/render/final.mp4', deliveryVideoPath: '/render/final.mp4',
      generationKind: 'digital_employee', generationProvenance: 'digital_employee',
      qualityStatus: 'passed', publishable: true, generationRecordId: 'generation-1', sourceFingerprint: 'fingerprint-1',
    },
  }],
};

function contentSeed(taskKey = 'content_release_approval'): Record<string, Row[]> {
  return {
    approval_requests: [{
      id: 'approval-1', tenant_id: 'tenant-1', run_id: 'run-1', task_id: 'task-1',
      status: 'pending', subject_version: 7, content_hash: 'frozen-hash',
      evidence: [{ type: 'starter_content_subject', contentHash: 'frozen-hash' }],
      created_at: '2026-09-12T07:00:00.000Z',
    }],
    workflow_tasks: [{
      id: 'task-1', tenant_id: 'tenant-1', run_id: 'run-1', task_key: taskKey,
      status: 'waiting_approval', task_version: 7, sequence: 1,
    }],
    workflow_runs: [{ id: 'run-1', tenant_id: 'tenant-1', goal_id: 'goal-1', status: 'waiting_approval' }],
    weekly_goals: [{ id: 'goal-1', tenant_id: 'tenant-1', status: 'active', content_platforms: ['facebook'] }],
  };
}

function harness(seed = contentSeed(), packageResult = publishingPackage) {
  const store = memoryStore(seed);
  const calls = {
    packageInputs: [] as any[],
    calendarInputs: [] as any[],
    followupInputs: [] as any[],
    audits: [] as any[],
    events: [] as any[],
    continuations: [] as any[],
    publicationTasks: [] as any[],
    connectedAccountReads: 0,
  };
  const dependencies: DigitalEmployeeApprovalDecisionDependencies = {
    store,
    now: () => fixedNow,
    async buildPublishingPackage(input) {
      calls.packageInputs.push(input);
      return structuredClone(packageResult);
    },
    async listConnectedPublishingAccounts() {
      calls.connectedAccountReads += 1;
      return [{ accountId: 'account-1', platform: 'facebook' }];
    },
    async createPublishingCalendarEntries(input) {
      calls.calendarInputs.push(input);
      return [{ id: 'post-1', status: 'awaiting_manual_publish' }];
    },
    async applyFollowupBatchDecision(input) { calls.followupInputs.push(input); },
    async appendAudit(input) { calls.audits.push(input); },
    async appendEvent(input) { calls.events.push(input); },
    async continueRun(tenantId, runId) { calls.continuations.push({ tenantId, runId }); },
    async enqueueStarterPublicationPackageTask(input) {
      calls.publicationTasks.push(input);
      return { taskId: 'publication-package:task-1', created: calls.publicationTasks.length === 1 };
    },
  };
  return { store, calls, dependencies, decide: createDigitalEmployeeApprovalDecisionApplication(dependencies) };
}

{
  const { store, calls, decide } = harness(contentSeed('starter_content_release_approval'));
  const result = await decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved', policy: 'starter_198',
  });
  assert.equal(result.publicationPackageTaskId, 'publication-package:task-1');
  assert.equal(calls.packageInputs.length, 0, 'starter approval must not build the account-bound legacy package');
  assert.equal(calls.connectedAccountReads, 0, 'a white-label customer needs no connected publishing account');
  assert.equal(calls.calendarInputs.length, 0, 'starter approval must not create official-account calendar entries');
  assert.equal(calls.continuations.length, 0, 'starter approval must not advance into legacy platform publishing');
  assert.deepEqual(calls.publicationTasks, [{
    tenantId: 'tenant-1', runId: 'run-1', approvalId: 'approval-1', approvalTaskId: 'task-1',
    subjectVersion: '7', contentHash: 'frozen-hash',
  }]);
  assert.equal(store.rows.approval_requests[0].status, 'approved');
  assert.equal(store.rows.workflow_tasks[0].status, 'succeeded');
  assert.equal(store.rows.workflow_tasks[0].output.publicationState, 'package_generation_queued');
  assert.equal(store.rows.workflow_tasks[0].output.externalPublishPerformed, false);
  assert.equal(store.rows.workflow_runs[0].status, 'waiting_human', 'the legacy graph must remain frozen');
  assert.equal(calls.events[0].payload.externalPublishPerformed, false);
}

{
  const seed = contentSeed('starter_content_release_approval');
  seed.approval_requests[0].content_hash = '';
  const { calls, decide } = harness(seed);
  await expectDecisionError(() => decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved', policy: 'starter_198',
  }), 'approval_content_hash_missing');
  assert.equal(calls.publicationTasks.length, 0);
}

{
  const seed = contentSeed('starter_content_release_approval');
  seed.approval_requests[0].evidence = [{ type: 'starter_content_subject', contentHash: 'changed-hash' }];
  const { calls, decide } = harness(seed);
  await expectDecisionError(() => decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved', policy: 'starter_198',
  }), 'approval_subject_changed');
  assert.equal(calls.publicationTasks.length, 0, 'a changed canonical subject must not enqueue work');
}

async function expectDecisionError(action: () => Promise<unknown>, code: string, status = 409) {
  await assert.rejects(action, error => error instanceof DigitalEmployeeApprovalDecisionError
    && error.code === code && error.status === status);
}

{
  const { store, calls, decide } = harness();
  const result = await decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved', note: '  ship it  ',
  });
  assert.equal(result.state, 'decided');
  assert.deepEqual(result.publishingEntries, [{ id: 'post-1', status: 'awaiting_manual_publish' }]);
  assert.equal(calls.packageInputs[0].scheduleAnchor, '2026-09-12T07:00:00.000Z', 'hash must use the original frozen schedule anchor');
  assert.equal(calls.calendarInputs[0].approvedContentHash, 'frozen-hash');
  assert.equal(store.rows.approval_requests[0].status, 'approved');
  assert.equal(store.rows.approval_requests[0].decided_by, 'owner-1');
  assert.equal(store.rows.workflow_tasks[0].status, 'succeeded');
  assert.deepEqual(store.rows.workflow_tasks[0].output.publishingEntries, [{ id: 'post-1', status: 'awaiting_manual_publish' }]);
  assert.equal(store.rows.workflow_runs[0].status, 'running');
  assert.deepEqual(calls.audits.map(item => item.action), ['approval.decided']);
  assert.deepEqual(calls.events.map(item => [item.type, item.level]), [['approval.decided', 'success']]);
  assert.deepEqual(calls.continuations, [{ tenantId: 'tenant-1', runId: 'run-1' }]);
}

{
  const { store, calls, decide } = harness();
  await expectDecisionError(() => decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '6', decision: 'approved',
  }), 'approval_subject_changed');
  assert.equal(store.rows.approval_requests[0].status, 'pending');
  assert.equal(calls.calendarInputs.length, 0);
  assert.equal(calls.audits.length, 0);
}

{
  const changed = { ...publishingPackage, contentHash: 'new-hash' };
  const { store, calls, decide } = harness(contentSeed(), changed);
  await expectDecisionError(() => decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved',
  }), 'approval_subject_changed');
  assert.equal(store.rows.approval_requests[0].status, 'superseded', 'a changed immutable subject invalidates the approval');
  assert.equal(calls.calendarInputs.length, 0);
  assert.equal(calls.audits.length, 0);
}

{
  const { store, calls, dependencies } = harness();
  dependencies.listConnectedPublishingAccounts = async () => [{ accountId: 'account-1', platform: 'instagram' }];
  const decide = createDigitalEmployeeApprovalDecisionApplication(dependencies);
  await expectDecisionError(() => decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '7', decision: 'approved',
  }), 'publishing_accounts_invalid');
  assert.equal(store.rows.approval_requests[0].status, 'pending');
  assert.equal(calls.calendarInputs.length, 0);
}

{
  const seed: Record<string, Row[]> = {
    approval_requests: [{
      id: 'approval-followup', tenant_id: 'tenant-1', run_id: 'run-1', task_id: 'task-followup',
      status: 'pending', subject_version: 3, content_hash: 'batch-hash', created_at: fixedNow.toISOString(),
    }],
    workflow_tasks: [{
      id: 'task-followup', tenant_id: 'tenant-1', run_id: 'run-1', task_key: 'followup_batch_approval',
      status: 'waiting_approval', task_version: 1,
    }],
    workflow_runs: [{ id: 'run-1', tenant_id: 'tenant-1', goal_id: 'goal-1', status: 'waiting_approval' }],
    weekly_goals: [{ id: 'goal-1', tenant_id: 'tenant-1', status: 'active' }],
    followup_batches: [{
      id: 'batch-old', tenant_id: 'tenant-1', run_id: 'run-1', version: 2, content_hash: 'old-hash',
    }, {
      id: 'batch-3', tenant_id: 'tenant-1', run_id: 'run-1', version: 3, content_hash: 'batch-hash',
    }],
  };
  const { store, calls, decide } = harness(seed);
  await decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-followup',
    expectedSubjectVersion: '3', decision: 'rejected', note: 'Change tone',
  });
  assert.deepEqual(calls.followupInputs, [{
    tenantId: 'tenant-1', batchId: 'batch-3', decision: 'rejected',
    userId: 'owner-1', approvalId: 'approval-followup',
  }]);
  assert.equal(store.rows.workflow_tasks[0].status, 'failed');
  assert.equal(store.rows.workflow_runs[0].status, 'waiting_external');
  assert.equal(store.rows.weekly_goals[0].status, 'active');
  assert.deepEqual(calls.events.map(item => item.level), ['error']);
  assert.equal(calls.continuations.length, 0, 'rejection must not advance downstream work');
}

{
  const { store, calls, decide } = harness();
  await Promise.all([
    decide({ tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1', decision: 'approved' }),
    decide({ tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1', decision: 'approved' }),
  ]);
  assert.equal(store.rows.approval_requests[0].status, 'approved');
  assert.equal(calls.calendarInputs.length, 1, 'the run lock must serialize duplicate decisions');
  assert.equal(calls.audits.length, 1);
}

{
  const { calls, decide } = harness();
  await expectDecisionError(() => decide({
    tenantId: 'tenant-other', userId: 'owner-1', approvalId: 'approval-1', decision: 'approved',
  }), 'approval_not_found', 404);
  assert.equal(calls.calendarInputs.length, 0, 'cross-tenant IDs must never reach an external-effect adapter');
}

console.log('Digital Employee approval application: immutable subject, tenant account binding, downstream state, audit/event, follow-up and serialization passed');

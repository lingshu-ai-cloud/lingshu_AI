import { STARTER_198_PROFILE_VERSION } from '../../shared/contracts/starter198.js';
import type { DataStore } from '../storage/datastore.js';
import {
  starter198AccessCycleOpen,
} from './profile.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import {
  starterQuoteDraftLineageValid,
  starterQuoteInquiryStorageFields,
  starterQuoteWorkflowBindingForRun,
  type StarterQuoteInquiryIdentity,
  type StarterQuoteInquiryLineage,
} from './quoteLineage.js';
import { object, stableHash, stringArray, text } from './orchestratorWorkerValues.js';
import { withStarter198RunMutationLease } from './runMutationLease.js';
import {
  listStarter198PendingApprovals,
  listStarter198TasksForRun,
  STARTER_198_STANDARD_TASK_KEYS,
  starter198RunInScope,
  starter198TaskInScope,
} from './workflowScope.js';

const INQUIRY_TASK_KEY = 'starter_inquiry_intake';
const QUOTE_TASK_KEY = 'starter_quote_draft';
const CLOSED_RUN_STATUSES = new Set([
  'waiting_approval', 'waiting_human', 'paused', 'cancelling',
  'cancelled', 'failed', 'succeeded', 'completed',
]);
const RECOVERABLE_WAIT_REASONS: Record<typeof INQUIRY_TASK_KEY | typeof QUOTE_TASK_KEY, ReadonlySet<string>> = {
  [INQUIRY_TASK_KEY]: new Set([
    'quote_inquiry_not_received',
    'quote_inquiry_status_not_mature',
    'quote_inquiry_indexed_query_unavailable',
    'quote_inquiry_query_incomplete',
  ]),
  [QUOTE_TASK_KEY]: new Set([
    'quote_draft_not_ready',
    'quote_draft_status_not_mature',
    'quote_draft_indexed_query_unavailable',
    'quote_draft_query_incomplete',
    'quote_draft_inquiry_checkpoint_not_ready',
    'quote_draft_inquiry_lineage_not_ready',
  ]),
};
const CURRENT_DRAFT_STATUSES = new Set(['draft_ready', 'exception_pending', 'approved', 'returned']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface StarterQuoteArtifactWakeupResult {
  state: 'ignored' | 'ready';
  reason: string;
  resetTaskIds: string[];
  alreadyResetTaskIds: string[];
  runResumed: boolean;
}

export class StarterQuoteArtifactWakeupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StarterQuoteArtifactWakeupError';
  }
}

const ignored = (reason: string): StarterQuoteArtifactWakeupResult => ({
  state: 'ignored',
  reason,
  resetTaskIds: [],
  alreadyResetTaskIds: [],
  runResumed: false,
});

function expectedGraphTask(input: {
  task: StarterRecord;
  tenantId: string;
  runId: string;
  taskKey: typeof INQUIRY_TASK_KEY | typeof QUOTE_TASK_KEY;
  taskId: string;
}): boolean {
  const task = input.task;
  const inquiry = input.taskKey === INQUIRY_TASK_KEY;
  const dependencies = stringArray(task.depends_on);
  return starter198TaskInScope(task, input.tenantId, input.runId)
    && task.id === input.taskId
    && text(task.task_key) === input.taskKey
    && Number(task.sequence) === (inquiry ? 8 : 9)
    && stableHash(dependencies) === stableHash(inquiry ? ['starter_context_snapshot'] : [INQUIRY_TASK_KEY])
    && text(task.agent_role) === 'sales'
    && text(task.business_domain) === 'customer'
    && text(task.capability_key) === 'quotation.calculate'
    && text(task.execution_mode) === (inquiry ? 'observe' : 'internal')
    && text(task.external_effect) === (inquiry ? 'none' : 'draft')
    && task.automatic_execution_allowed === true
    && text(task.policy_source) === STARTER_198_PROFILE_VERSION;
}

function exactBinding(left: StarterQuoteInquiryLineage['binding'], right: StarterQuoteInquiryLineage['binding']): boolean {
  return stableHash(left) === stableHash(right);
}

function exactInquiryIdentity(lineage: StarterQuoteInquiryLineage): StarterQuoteInquiryIdentity {
  return {
    inquiryId: lineage.inquiryId,
    inquiryVersion: lineage.inquiryVersion,
    sourceChannel: lineage.sourceChannel,
    sourceReferenceHash: lineage.sourceReferenceHash,
    sku: lineage.sku,
    quantity: lineage.quantity,
    destinationCountry: lineage.destinationCountry,
  };
}

function lineageArtifactsValid(input: {
  tenantId: string;
  inquiry: StarterRecord | null;
  draft: StarterRecord | null;
  expectedDraftId: string;
  expected: StarterQuoteInquiryLineage;
}): boolean {
  const { expected, inquiry, draft } = input;
  if (!inquiry || !draft
    || inquiry.id !== expected.inquiryRecordId
    || text(inquiry.tenant_id) !== input.tenantId
    || text(inquiry.status) !== 'received'
    || text(inquiry.source_type) !== 'manual_structured'
    || inquiry.test_record !== false
    || text(inquiry.inquiry_id) !== expected.inquiryId
    || text(inquiry.inquiry_version) !== expected.inquiryVersion
    || text(inquiry.source_channel) !== expected.sourceChannel
    || text(inquiry.source_reference_hash) !== expected.sourceReferenceHash
    || text(inquiry.sku) !== expected.sku
    || Number(inquiry.quantity) !== expected.quantity
    || text(inquiry.destination_country) !== expected.destinationCountry
    || text(inquiry.request_hash) !== expected.requestHash
    || text(inquiry.lineage_hash) !== expected.lineageHash
    || !HASH_PATTERN.test(expected.requestHash)
    || !HASH_PATTERN.test(expected.lineageHash)
    || draft.id !== input.expectedDraftId
    || text(draft.tenant_id) !== input.tenantId
    || !CURRENT_DRAFT_STATUSES.has(text(draft.status))) return false;
  const inquiryFields = starterQuoteInquiryStorageFields({
    tenantId: input.tenantId,
    // Do not pass the wider lineage object into a hash input. TypeScript's
    // structural assignability would retain its extra runtime properties and
    // produce a different digest from the one persisted at admission.
    identity: exactInquiryIdentity(expected),
    requestHash: expected.requestHash,
    binding: expected.binding,
  });
  return Object.entries(inquiryFields).every(([key, value]) => inquiry[key] === value)
    && starterQuoteDraftLineageValid({
      tenantId: input.tenantId,
      draft,
      inquiry: expected,
    });
}

function recoverableWait(task: StarterRecord, taskKey: typeof INQUIRY_TASK_KEY | typeof QUOTE_TASK_KEY): string | null {
  if (text(task.status) !== 'waiting_external') return null;
  const output = object(task.output);
  const reason = text(output?.reasonCode);
  return output?.schemaVersion === 'starter-198.sales-artifact-adapter-wait.v1'
    && text(output.executionStatus) === 'waiting_external'
    && text(output.taskKey) === taskKey
    && text(output.adapter) === 'indexed_quote_lineage_observer_v1'
    && RECOVERABLE_WAIT_REASONS[taskKey].has(reason)
    ? reason
    : null;
}

function wakeMarker(input: {
  task: StarterRecord;
  taskKey: typeof INQUIRY_TASK_KEY | typeof QUOTE_TASK_KEY;
  expected: StarterQuoteInquiryLineage;
  draftId: string;
  priorReasonCode: string;
  resetAt: string;
}): Record<string, unknown> {
  const priorOutput = object(input.task.output);
  return {
    schemaVersion: 'starter-198.quote-artifact-wakeup.v1',
    executionStatus: 'pending',
    wakeSource: 'indexed_quote_lineage_observer_v1',
    taskKey: input.taskKey,
    runId: input.expected.binding.runId,
    taskId: input.task.id,
    inquiryLineageHash: input.expected.lineageHash,
    draftId: input.draftId,
    priorReasonCode: input.priorReasonCode,
    resetAt: input.resetAt,
    ...(object(priorOutput?.metering) ? { metering: priorOutput?.metering } : {}),
  };
}

function exactWakeMarker(input: {
  task: StarterRecord;
  taskKey: typeof INQUIRY_TASK_KEY | typeof QUOTE_TASK_KEY;
  expected: StarterQuoteInquiryLineage;
  draftId: string;
}): boolean {
  if (text(input.task.status) !== 'pending') return false;
  const output = object(input.task.output);
  return output?.schemaVersion === 'starter-198.quote-artifact-wakeup.v1'
    && text(output.executionStatus) === 'pending'
    && text(output.wakeSource) === 'indexed_quote_lineage_observer_v1'
    && text(output.taskKey) === input.taskKey
    && text(output.runId) === input.expected.binding.runId
    && text(output.taskId) === input.task.id
    && text(output.inquiryLineageHash) === input.expected.lineageHash
    && text(output.draftId) === input.draftId
    && RECOVERABLE_WAIT_REASONS[input.taskKey].has(text(output.priorReasonCode))
    && Number.isFinite(Date.parse(text(output.resetAt)));
}

/**
 * Event hook for a quote inquiry and deterministic draft that are already
 * durably stored with exact workflow lineage. This performs no quotation and
 * no external effect; it only re-arms the two fixed sales observer tasks.
 */
export async function notifyStarterQuoteArtifactsReady(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  inquiry: StarterQuoteInquiryLineage;
  draftId: string;
  now?: () => Date;
}): Promise<StarterQuoteArtifactWakeupResult> {
  if (input.inquiry.tenantId !== input.tenantId
    || !input.inquiry.inquiryRecordId
    || !input.draftId
    || !input.inquiry.binding.runId) return ignored('invalid_wakeup_identity');

  return withStarter198RunMutationLease({
    dataStore: input.dataStore,
    tenantId: input.tenantId,
    runId: input.inquiry.binding.runId,
    action: async () => {
      const at = input.now?.() ?? new Date();
      const access = await input.repository.access(input.tenantId);
      if (!starter198AccessCycleOpen(access, at)) return ignored('access_cycle_closed');
      const run = await input.repository.get(
        STARTER_COLLECTIONS.runs,
        input.tenantId,
        input.inquiry.binding.runId,
      );
      if (!starter198RunInScope(run, input.tenantId)) return ignored('run_not_starter_198');
      const runStatus = text(run.status);
      if (CLOSED_RUN_STATUSES.has(runStatus)) return ignored(`run_${runStatus}`);
      if (runStatus !== 'waiting_external' && runStatus !== 'running') return ignored('run_not_wakeable');

      const binding = await starterQuoteWorkflowBindingForRun({
        repository: input.repository,
        tenantId: input.tenantId,
        access,
        run,
      });
      if (!exactBinding(binding, input.inquiry.binding)) return ignored('workflow_binding_changed');

      const tasks = await listStarter198TasksForRun(
        input.repository,
        input.tenantId,
        run.id,
      );
      const taskKeys = tasks.map(task => text(task.task_key));
      if (tasks.length !== STARTER_198_STANDARD_TASK_KEYS.length
        || stableHash(taskKeys) !== stableHash(STARTER_198_STANDARD_TASK_KEYS)) {
        throw new StarterQuoteArtifactWakeupError('starter_quote_wakeup_graph_integrity_violation');
      }
      const byKey = new Map(tasks.map(task => [text(task.task_key), task]));
      const inquiryTask = byKey.get(INQUIRY_TASK_KEY);
      const quoteTask = byKey.get(QUOTE_TASK_KEY);
      if (!inquiryTask || !quoteTask || !expectedGraphTask({
        task: inquiryTask,
        tenantId: input.tenantId,
        runId: run.id,
        taskKey: INQUIRY_TASK_KEY,
        taskId: binding.inquiryTaskId,
      }) || !expectedGraphTask({
        task: quoteTask,
        tenantId: input.tenantId,
        runId: run.id,
        taskKey: QUOTE_TASK_KEY,
        taskId: binding.quoteTaskId,
      })) {
        throw new StarterQuoteArtifactWakeupError('starter_quote_wakeup_graph_integrity_violation');
      }

      const [inquiryRecord, draft] = await Promise.all([
        input.repository.get(
          STARTER_COLLECTIONS.quoteInquiries,
          input.tenantId,
          input.inquiry.inquiryRecordId,
        ),
        input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, input.draftId),
      ]);
      if (!lineageArtifactsValid({
        tenantId: input.tenantId,
        inquiry: inquiryRecord,
        draft,
        expectedDraftId: input.draftId,
        expected: input.inquiry,
      })) return ignored('quote_lineage_not_exact');

      const resetAt = at.toISOString();
      const resetTaskIds: string[] = [];
      const alreadyResetTaskIds: string[] = [];
      for (const [task, taskKey] of [
        [inquiryTask, INQUIRY_TASK_KEY],
        [quoteTask, QUOTE_TASK_KEY],
      ] as const) {
        const priorReasonCode = recoverableWait(task, taskKey);
        if (!priorReasonCode) {
          if (exactWakeMarker({ task, taskKey, expected: input.inquiry, draftId: input.draftId })) {
            alreadyResetTaskIds.push(task.id);
          }
          continue;
        }
        const marker = wakeMarker({
          task,
          taskKey,
          expected: input.inquiry,
          draftId: input.draftId,
          priorReasonCode,
          resetAt,
        });
        await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, task.id, {
          status: 'pending',
          blocked_reason: '',
          output: marker,
          updated_at: resetAt,
        });
        const written = await input.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, task.id);
        if (!written || !exactWakeMarker({
          task: written,
          taskKey,
          expected: input.inquiry,
          draftId: input.draftId,
        })) {
          throw new StarterQuoteArtifactWakeupError('starter_quote_wakeup_task_write_lost');
        }
        resetTaskIds.push(task.id);
      }

      const wakeEvidenceFound = resetTaskIds.length > 0 || alreadyResetTaskIds.length > 0;
      if (!wakeEvidenceFound) return ignored('no_recoverable_sales_wait');

      const pendingApprovals = await listStarter198PendingApprovals({
        repository: input.repository,
        tenantId: input.tenantId,
        run,
        tasks,
      });
      let runResumed = false;
      if (pendingApprovals.length === 0) {
        const currentRun = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, run.id);
        if (starter198RunInScope(currentRun, input.tenantId)
          && text(currentRun.status) === 'waiting_external') {
          await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
            status: 'running',
            current_controller: 'agent',
            pause_reason: '',
            completed_at: '',
          });
          const writtenRun = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, run.id);
          if (!starter198RunInScope(writtenRun, input.tenantId) || text(writtenRun.status) !== 'running') {
            throw new StarterQuoteArtifactWakeupError('starter_quote_wakeup_run_write_lost');
          }
          runResumed = true;
        }
      }
      return {
        state: 'ready',
        reason: runResumed ? 'starter_sales_tasks_woken' : 'starter_sales_tasks_rearmed',
        resetTaskIds,
        alreadyResetTaskIds,
        runResumed,
      };
    },
  });
}

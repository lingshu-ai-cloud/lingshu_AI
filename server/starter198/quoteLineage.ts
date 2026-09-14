import { STARTER_198_PROFILE_VERSION } from '../../shared/contracts/starter198.js';
import { evidenceHash } from '../quotation/canonical.js';
import type { Starter198AccessSnapshot } from './profile.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import { object, stableHash, text } from './orchestratorWorkerValues.js';

const ACTIVE_RUN_STATUSES = [
  'initializing',
  'queued',
  'planning',
  'running',
  'waiting_external',
  'waiting_approval',
  'waiting_human',
  'paused',
  'cancelling',
] as const;

const INQUIRY_TASK_KEY = 'starter_inquiry_intake';
const QUOTE_TASK_KEY = 'starter_quote_draft';
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export const STARTER_QUOTE_INQUIRY_SCHEMA = 'starter-198.quote-inquiry.v2' as const;
export const STARTER_QUOTE_DRAFT_SCHEMA = 'starter-198.quote-draft.v2' as const;

export interface StarterQuoteWorkflowBinding {
  schemaVersion: 'starter-198.quote-workflow-binding.v1';
  runId: string;
  cycleId: string;
  initializationId: string;
  inputVersion: string;
  entitlementSnapshotId: string;
  inquiryTaskId: string;
  quoteTaskId: string;
}

export interface StarterQuoteInquiryIdentity {
  inquiryId: string;
  inquiryVersion: string;
  sourceChannel: string;
  sourceReferenceHash: string;
  sku: string;
  quantity: number;
  destinationCountry: string;
}

export interface StarterQuoteInquiryLineage extends StarterQuoteInquiryIdentity {
  tenantId: string;
  requestHash: string;
  inquiryRecordId: string;
  lineageHash: string;
  binding: StarterQuoteWorkflowBinding;
}

function validIdentity(value: string): boolean {
  return Boolean(value) && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function complete<T extends StarterRecord>(
  result: { items: T[]; totalItems: number },
  code: string,
): T[] {
  if (!Array.isArray(result.items) || !Number.isFinite(result.totalItems)
    || result.totalItems !== result.items.length) {
    throw new Starter198RuntimePortError(code, 503);
  }
  return result.items;
}

export function starterQuoteCycleId(
  access: Pick<Starter198AccessSnapshot, 'recordId' | 'cycleStartedAt' | 'cycleEndsAt'>,
): string {
  return `cycle:${stableHash({
    recordId: access.recordId,
    startedAt: access.cycleStartedAt,
    endsAt: access.cycleEndsAt,
  }).slice(0, 32)}`;
}

function validateRunContext(
  run: StarterRecord,
  tenantId: string,
  access: Starter198AccessSnapshot,
): { initializationId: string; inputVersion: string } {
  const context = object(run.starter_context);
  const initializationId = text(context?.initializationId);
  const inputVersion = text(context?.inputVersion);
  if (text(run.tenant_id) !== tenantId
    || text(run.product_profile) !== 'starter_198'
    || !context
    || context.schemaVersion !== 'starter-198.run-initialization.v1'
    || text(context.runId) !== run.id
    || text(run.starter_initialization_id) !== initializationId
    || text(run.starter_input_version) !== inputVersion
    || text(context.entitlementSnapshotId) !== access.entitlementSnapshotId
    || !validIdentity(initializationId)
    || !HASH_PATTERN.test(inputVersion)) {
    throw new Starter198RuntimePortError('starter_198_quote_run_lineage_invalid', 503);
  }
  return { initializationId, inputVersion };
}

async function boundTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  taskKey: string;
}): Promise<StarterRecord> {
  const rows = complete(await input.repository.list(STARTER_COLLECTIONS.tasks, input.tenantId, {
    where: {
      run_id: input.runId,
      task_key: input.taskKey,
      policy_source: STARTER_198_PROFILE_VERSION,
    },
    perPage: 2,
  }), 'starter_198_quote_task_query_incomplete');
  if (rows.length !== 1) {
    throw new Starter198RuntimePortError(
      rows.length ? 'starter_198_quote_task_lineage_ambiguous' : 'starter_198_quote_task_lineage_missing',
      503,
    );
  }
  const task = rows[0];
  if (text(task.run_id) !== input.runId
    || text(task.task_key) !== input.taskKey
    || text(task.policy_source) !== STARTER_198_PROFILE_VERSION
    || text(task.agent_role) !== 'sales'
    || !validIdentity(task.id)) {
    throw new Starter198RuntimePortError('starter_198_quote_task_lineage_invalid', 503);
  }
  return task;
}

export async function starterQuoteWorkflowBindingForRun(input: {
  repository: Starter198Repository;
  tenantId: string;
  access: Starter198AccessSnapshot;
  run: StarterRecord;
}): Promise<StarterQuoteWorkflowBinding> {
  const context = validateRunContext(input.run, input.tenantId, input.access);
  const [inquiryTask, quoteTask] = await Promise.all([
    boundTask({ ...input, runId: input.run.id, taskKey: INQUIRY_TASK_KEY }),
    boundTask({ ...input, runId: input.run.id, taskKey: QUOTE_TASK_KEY }),
  ]);
  return {
    schemaVersion: 'starter-198.quote-workflow-binding.v1',
    runId: input.run.id,
    cycleId: starterQuoteCycleId(input.access),
    initializationId: context.initializationId,
    inputVersion: context.inputVersion,
    entitlementSnapshotId: input.access.entitlementSnapshotId,
    inquiryTaskId: inquiryTask.id,
    quoteTaskId: quoteTask.id,
  };
}

export async function resolveActiveStarterQuoteWorkflowBinding(input: {
  repository: Starter198Repository;
  tenantId: string;
  access: Starter198AccessSnapshot;
}): Promise<StarterQuoteWorkflowBinding | null> {
  const pages = await Promise.all(ACTIVE_RUN_STATUSES.map(status => input.repository.list(
    STARTER_COLLECTIONS.runs,
    input.tenantId,
    { where: { product_profile: 'starter_198', status }, perPage: 2 },
  )));
  const runs = pages.flatMap(page => complete(page, 'starter_198_quote_run_query_incomplete'));
  const unique = [...new Map(runs.map(run => [run.id, run])).values()];
  if (unique.length > 1) {
    throw new Starter198RuntimePortError('starter_198_quote_run_lineage_ambiguous', 503);
  }
  return unique[0]
    ? starterQuoteWorkflowBindingForRun({ ...input, run: unique[0] })
    : null;
}

function bindingEvidence(binding: StarterQuoteWorkflowBinding): Record<string, unknown> {
  return {
    schemaVersion: binding.schemaVersion,
    runId: binding.runId,
    cycleId: binding.cycleId,
    initializationId: binding.initializationId,
    inputVersion: binding.inputVersion,
    entitlementSnapshotId: binding.entitlementSnapshotId,
    inquiryTaskId: binding.inquiryTaskId,
    quoteTaskId: binding.quoteTaskId,
  };
}

export function starterQuoteInquiryRequestHash(input: {
  identity: StarterQuoteInquiryIdentity;
  binding?: StarterQuoteWorkflowBinding | null;
}): string {
  const value: Record<string, unknown> = {
    inquiryId: input.identity.inquiryId,
    inquiryVersion: input.identity.inquiryVersion,
    sourceChannel: input.identity.sourceChannel,
    sourceReferenceHash: input.identity.sourceReferenceHash,
    sku: input.identity.sku,
    quantity: input.identity.quantity,
    destinationCountry: input.identity.destinationCountry,
  };
  if (input.binding) {
    value.schemaVersion = STARTER_QUOTE_INQUIRY_SCHEMA;
    value.workflowBinding = bindingEvidence(input.binding);
  }
  return stableHash(value);
}

export function starterQuoteInquiryLineageHash(input: {
  tenantId: string;
  identity: StarterQuoteInquiryIdentity;
  requestHash: string;
  binding: StarterQuoteWorkflowBinding;
}): string {
  return stableHash({
    schemaVersion: 'starter-198.quote-inquiry-lineage.v1',
    tenantId: input.tenantId,
    ...bindingEvidence(input.binding),
    ...input.identity,
    requestHash: input.requestHash,
  });
}

export function starterQuoteInquiryStorageFields(input: {
  tenantId: string;
  identity: StarterQuoteInquiryIdentity;
  requestHash: string;
  binding: StarterQuoteWorkflowBinding;
}): Record<string, unknown> {
  return {
    schema_version: STARTER_QUOTE_INQUIRY_SCHEMA,
    run_id: input.binding.runId,
    cycle_id: input.binding.cycleId,
    workflow_task_id: input.binding.inquiryTaskId,
    initialization_id: input.binding.initializationId,
    entitlement_snapshot_id: input.binding.entitlementSnapshotId,
    lineage_hash: starterQuoteInquiryLineageHash(input),
  };
}

function draftLineageHash(input: {
  tenantId: string;
  draft: StarterRecord;
  inquiry: StarterQuoteInquiryLineage;
}): string {
  return stableHash({
    schemaVersion: 'starter-198.quote-draft-lineage.v1',
    tenantId: input.tenantId,
    ...bindingEvidence(input.inquiry.binding),
    inquiryRecordId: input.inquiry.inquiryRecordId,
    inquiryId: input.inquiry.inquiryId,
    inquiryVersion: input.inquiry.inquiryVersion,
    inquiryRequestHash: input.inquiry.requestHash,
    inquiryLineageHash: input.inquiry.lineageHash,
    ruleSetKey: text(input.draft.rule_set_key),
    ruleSetVersion: text(input.draft.rule_set_version),
    ruleHash: text(input.draft.rule_hash),
    inputHash: text(input.draft.input_hash),
    calculationHash: text(input.draft.calculation_hash),
    requestHash: text(input.draft.request_hash),
  });
}

export function starterQuoteDraftStorageFields(input: {
  tenantId: string;
  draft: StarterRecord;
  inquiry: StarterQuoteInquiryLineage;
}): Record<string, unknown> {
  return {
    schema_version: STARTER_QUOTE_DRAFT_SCHEMA,
    run_id: input.inquiry.binding.runId,
    cycle_id: input.inquiry.binding.cycleId,
    workflow_task_id: input.inquiry.binding.quoteTaskId,
    inquiry_task_id: input.inquiry.binding.inquiryTaskId,
    initialization_id: input.inquiry.binding.initializationId,
    entitlement_snapshot_id: input.inquiry.binding.entitlementSnapshotId,
    inquiry_record_id: input.inquiry.inquiryRecordId,
    inquiry_request_hash: input.inquiry.requestHash,
    inquiry_lineage_hash: input.inquiry.lineageHash,
    lineage_hash: draftLineageHash(input),
  };
}

export async function persistStarterQuoteDraftLineage(input: {
  repository: Starter198Repository;
  tenantId: string;
  draftId: string;
  inquiry: StarterQuoteInquiryLineage;
}): Promise<void> {
  const current = await input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, input.draftId);
  if (!current
    || text(current.inquiry_id) !== input.inquiry.inquiryId
    || text(current.inquiry_version) !== input.inquiry.inquiryVersion
    || !HASH_PATTERN.test(text(current.rule_hash))
    || !HASH_PATTERN.test(text(current.input_hash))
    || !HASH_PATTERN.test(text(current.calculation_hash))
    || !HASH_PATTERN.test(text(current.request_hash))) {
    throw new Starter198RuntimePortError('starter_198_quote_draft_lineage_invalid', 503);
  }
  const fields = starterQuoteDraftStorageFields({ ...input, draft: current });
  for (const [key, value] of Object.entries(fields)) {
    if (text(current[key]) && current[key] !== value) {
      throw new Starter198RuntimePortError('starter_198_quote_draft_lineage_conflict', 503);
    }
  }
  await input.repository.update(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, input.draftId, fields);
  const written = await input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, input.draftId);
  if (!written || Object.entries(fields).some(([key, value]) => written[key] !== value)) {
    throw new Starter198RuntimePortError('starter_198_quote_draft_lineage_storage_unavailable', 503);
  }
}

export function starterQuoteDraftLineageValid(input: {
  tenantId: string;
  draft: StarterRecord;
  inquiry: StarterQuoteInquiryLineage;
}): boolean {
  const fields = starterQuoteDraftStorageFields(input);
  return Object.entries(fields).every(([key, value]) => input.draft[key] === value)
    && text(input.draft.schema_version) === STARTER_QUOTE_DRAFT_SCHEMA
    && evidenceHash({
      ruleSetRef: {
        key: text(input.draft.rule_set_key),
        version: text(input.draft.rule_set_version),
        hash: text(input.draft.rule_hash),
      },
      inputHash: text(input.draft.input_hash),
    }) === text(input.draft.request_hash);
}

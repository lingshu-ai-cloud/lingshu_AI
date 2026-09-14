import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE_VERSION,
  STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
  type Starter198QuoteInquiryInput,
  type Starter198QuoteRuleSetupInput,
} from '../../shared/contracts/starter198.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
  releaseDurableOperationLease,
} from '../runtime/durableLease.js';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import {
  notifyStarterQuoteArtifactsReady,
} from './quoteArtifactWakeup.js';
import type { StarterQuoteInquiryLineage } from './quoteLineage.js';
import { createStarter198QuoteSelfServicePort } from './quoteSelfService.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';

type Row = Record_ & Record<string, unknown>;

const TENANT = 'quote-wakeup-tenant';
const OTHER_TENANT = 'quote-wakeup-foreign';
const RUN_ID = 'quote-wakeup-run';
const INITIALIZATION_ID = 'quote-wakeup-initialization';
const INPUT_VERSION = 'b'.repeat(64);
const ENTITLEMENT_ID = 'quote-wakeup-entitlement';
const INQUIRY_TASK_ID = 'quote-wakeup-inquiry-task';
const QUOTE_TASK_ID = 'quote-wakeup-draft-task';
const APPROVAL_TASK_ID = 'quote-wakeup-content-approval-task';
const NOW = new Date('2026-09-12T08:00:00.000Z');

const RULE: Starter198QuoteRuleSetupInput = Object.freeze({
  sku: 'SKU-198',
  currency: 'USD',
  unitPrice: '12.50',
  unitCost: '5.00',
  moq: 100,
  incoterm: 'FOB',
  shippingFlatFee: '20.00',
  taxRateBps: 0,
  paymentTerm: 'T/T 30% deposit, 70% before shipment',
  leadTimeDays: 21,
  validDays: 14,
  minMarginBps: 1_000,
  sourceReference: 'catalog:quote-wakeup-2026-09',
});

const INQUIRY: Starter198QuoteInquiryInput = Object.freeze({
  sourceChannel: 'whatsapp',
  sourceReference: 'wa:quote-wakeup-lead-9001',
  quantity: 100,
  destinationCountry: 'DE',
});

const TASK_KEYS = [
  'starter_context_snapshot',
  'starter_content_research',
  'starter_content_production',
  'starter_content_quality_gate',
  STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
  'starter_publication_package',
  'starter_publication_evidence',
  'starter_inquiry_intake',
  'starter_quote_draft',
  'starter_result_summary',
] as const;

function waitOutput(taskKey: 'starter_inquiry_intake' | 'starter_quote_draft', reasonCode: string) {
  return {
    schemaVersion: 'starter-198.sales-artifact-adapter-wait.v1',
    executionStatus: 'waiting_external',
    taskKey,
    adapter: 'indexed_quote_lineage_observer_v1',
    reasonCode,
    providerCalls: 0,
    externalEffectsPerformed: false,
  };
}

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Row[]>();
  readonly writes: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = [];
  readonly failUpdateOnce = new Set<string>();

  seed(collection: string, data: Record<string, unknown>): Row {
    const requestedId = typeof data.id === 'string' ? data.id : '';
    const row = {
      ...structuredClone(data),
      id: requestedId || `record_${String(++this.sequence).padStart(6, '0')}`,
    } as Row;
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return row;
  }

  row(collection: string, id: string): Row {
    const found = (this.rows.get(collection) ?? []).find(candidate => candidate.id === id);
    assert.ok(found, `missing ${collection}:${id}`);
    return found;
  }

  collection(collection: string, tenantId?: string): Row[] {
    return (this.rows.get(collection) ?? []).filter(row => !tenantId || row.tenant_id === tenantId);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const row = this.collection(collection).find(candidate => candidate.id === id);
    return structuredClone(row ?? null) as T | null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.collection(collection);
    const tenantId = data.tenant_id;
    const duplicate = collection === DURABLE_OPERATION_LEASE_COLLECTION
      ? rows.some(row => row.tenant_id === tenantId
        && row.lease_scope === data.lease_scope
        && row.subject_id === data.subject_id)
      : collection === STARTER_COLLECTIONS.quoteRuleSets
        ? rows.some(row => row.tenant_id === tenantId && (
          row.idempotency_key === data.idempotency_key
          || (row.rule_set_key === data.rule_set_key && row.version === data.version)
        ))
        : collection === STARTER_COLLECTIONS.quoteInquiries
          ? rows.some(row => row.tenant_id === tenantId && (
            row.idempotency_key === data.idempotency_key
            || (row.inquiry_id === data.inquiry_id && row.inquiry_version === data.inquiry_version)
            || (row.lineage_hash && row.lineage_hash === data.lineage_hash)
          ))
          : collection === STARTER_COLLECTIONS.quoteDrafts
            ? rows.some(row => row.tenant_id === tenantId && row.idempotency_key === data.idempotency_key)
            : collection === 'quote_exception_requests'
              ? rows.some(row => row.tenant_id === tenantId && (
                row.draft_id === data.draft_id || row.idempotency_key === data.idempotency_key
              ))
              : false;
    return duplicate ? null : structuredClone(this.seed(collection, data)) as T;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (this.failUpdateOnce.delete(id)) throw new Error(`injected update failure:${id}`);
    const row = this.collection(collection).find(candidate => candidate.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(patch));
    if (collection !== DURABLE_OPERATION_LEASE_COLLECTION) {
      this.writes.push({ collection, id, patch: structuredClone(patch) });
    }
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const rows = this.collection(collection);
    const next = rows.filter(row => row.id !== id);
    this.rows.set(collection, next);
    return next.length !== rows.length;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let rows = this.collection(collection).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      rows = [...rows].sort((left, right) => {
        const leftValue = left[key];
        const rightValue = right[key];
        const compared = typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
        return descending ? -compared : compared;
      });
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const offset = (page - 1) * perPage;
    return {
      items: structuredClone(rows.slice(offset, offset + perPage)) as T[],
      totalItems: rows.length,
      totalPages: rows.length ? Math.ceil(rows.length / perPage) : 0,
      page,
      perPage,
    };
  }
}

function seedAccess(store: MemoryStore, tenantId = TENANT): void {
  store.seed(STARTER_COLLECTIONS.access, {
    id: tenantId === TENANT ? 'quote-wakeup-access' : 'quote-wakeup-foreign-access',
    tenant_id: tenantId,
    product_profile: 'starter_198',
    profile_version: STARTER_198_PROFILE_VERSION,
    entitlement_snapshot_id: tenantId === TENANT ? ENTITLEMENT_ID : 'quote-wakeup-foreign-entitlement',
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: STARTER_198_DEFAULT_LIMITS,
    status: 'active',
    cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  });
}

function seedGraph(store: MemoryStore, input: {
  runStatus?: string;
  inquiryStatus?: string;
  quoteStatus?: string;
  inquiryReason?: string;
  quoteReason?: string;
  pendingApproval?: boolean;
} = {}): void {
  store.seed(STARTER_COLLECTIONS.runs, {
    id: RUN_ID,
    tenant_id: TENANT,
    status: input.runStatus ?? 'waiting_external',
    product_profile: 'starter_198',
    starter_initialization_id: INITIALIZATION_ID,
    starter_input_version: INPUT_VERSION,
    starter_context: {
      schemaVersion: 'starter-198.run-initialization.v1',
      runId: RUN_ID,
      initializationId: INITIALIZATION_ID,
      inputVersion: INPUT_VERSION,
      entitlementSnapshotId: ENTITLEMENT_ID,
    },
  });
  TASK_KEYS.forEach((taskKey, index) => {
    const sales = taskKey === 'starter_inquiry_intake' || taskKey === 'starter_quote_draft';
    const inquiryTask = taskKey === 'starter_inquiry_intake';
    const quoteTask = taskKey === 'starter_quote_draft';
    const status = inquiryTask
      ? input.inquiryStatus ?? 'waiting_external'
      : quoteTask
        ? input.quoteStatus ?? 'pending'
        : 'pending';
    store.seed(STARTER_COLLECTIONS.tasks, {
      id: inquiryTask ? INQUIRY_TASK_ID : quoteTask ? QUOTE_TASK_ID
        : taskKey === STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY ? APPROVAL_TASK_ID
          : `quote-wakeup-task-${index + 1}`,
      tenant_id: TENANT,
      run_id: RUN_ID,
      task_key: taskKey,
      policy_source: STARTER_198_PROFILE_VERSION,
      sequence: index + 1,
      status,
      depends_on: inquiryTask ? ['starter_context_snapshot']
        : quoteTask ? ['starter_inquiry_intake'] : [],
      ...(sales ? {
        agent_role: 'sales',
        business_domain: 'customer',
        capability_key: 'quotation.calculate',
        execution_mode: inquiryTask ? 'observe' : 'internal',
        external_effect: inquiryTask ? 'none' : 'draft',
        automatic_execution_allowed: true,
      } : {}),
      ...(inquiryTask && status === 'waiting_external' ? {
        output: waitOutput(taskKey, input.inquiryReason ?? 'quote_inquiry_not_received'),
      } : {}),
      ...(quoteTask && status === 'waiting_external' ? {
        output: waitOutput(taskKey, input.quoteReason ?? 'quote_draft_not_ready'),
      } : {}),
    });
  });
  if (input.pendingApproval) {
    store.seed(STARTER_COLLECTIONS.approvals, {
      id: 'quote-wakeup-content-approval',
      tenant_id: TENANT,
      run_id: RUN_ID,
      task_id: APPROVAL_TASK_ID,
      status: 'pending',
      created_at: NOW.toISOString(),
    });
  }
}

async function fixture(input: Parameters<typeof seedGraph>[1] = {}) {
  const store = new MemoryStore();
  seedAccess(store);
  seedGraph(store, input);
  const repository = createStarter198Repository(store);
  const port = createStarter198QuoteSelfServicePort({
    dataStore: store,
    repository,
    now: () => new Date(NOW),
  });
  await port.confirmRule({
    tenantId: TENANT,
    userId: 'quote-wakeup-owner',
    role: 'owner',
    setup: RULE,
    idempotencyKey: 'quote-wakeup-rule-command',
  });
  const submit = () => port.submitInquiry({
    tenantId: TENANT,
    userId: 'quote-wakeup-sales-user',
    role: 'customer_service',
    inquiry: INQUIRY,
    idempotencyKey: 'quote-wakeup-inquiry-command',
  });
  return { store, repository, port, submit };
}

function storedLineage(store: MemoryStore): { inquiry: StarterQuoteInquiryLineage; draftId: string } {
  const inquiry = store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT)[0];
  const draft = store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT)[0];
  assert.ok(inquiry);
  assert.ok(draft);
  return {
    inquiry: {
      tenantId: TENANT,
      inquiryId: String(inquiry.inquiry_id),
      inquiryVersion: String(inquiry.inquiry_version),
      sourceChannel: String(inquiry.source_channel),
      sourceReferenceHash: String(inquiry.source_reference_hash),
      sku: String(inquiry.sku),
      quantity: Number(inquiry.quantity),
      destinationCountry: String(inquiry.destination_country),
      requestHash: String(inquiry.request_hash),
      inquiryRecordId: inquiry.id,
      lineageHash: String(inquiry.lineage_hash),
      binding: {
        schemaVersion: 'starter-198.quote-workflow-binding.v1',
        runId: RUN_ID,
        cycleId: String(inquiry.cycle_id),
        initializationId: INITIALIZATION_ID,
        inputVersion: INPUT_VERSION,
        entitlementSnapshotId: ENTITLEMENT_ID,
        inquiryTaskId: INQUIRY_TASK_ID,
        quoteTaskId: QUOTE_TASK_ID,
      },
    },
    draftId: draft.id,
  };
}

function taskRunWriteCount(store: MemoryStore): number {
  return store.writes.filter(write => write.collection === STARTER_COLLECTIONS.tasks
    || write.collection === STARTER_COLLECTIONS.runs).length;
}

test('durably stored quote lineage wakes the exact recoverable sales task and replay is idempotent', async () => {
  const setup = await fixture();
  const first = await setup.submit();
  assert.equal(first.repeated, false);
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, QUOTE_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'running');
  const marker = setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).output as Record<string, unknown>;
  assert.equal(marker.schemaVersion, 'starter-198.quote-artifact-wakeup.v1');
  assert.equal(marker.wakeSource, 'indexed_quote_lineage_observer_v1');

  const writesBeforeReplay = taskRunWriteCount(setup.store);
  const replay = await setup.submit();
  assert.equal(replay.repeated, true);
  assert.equal(replay.draftId, first.draftId);
  assert.equal(taskRunWriteCount(setup.store), writesBeforeReplay);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT).length, 1);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT).length, 1);
});

test('a mid-task wake failure does not falsify quote submission and exact replay completes repair', async () => {
  const setup = await fixture({ quoteStatus: 'waiting_external' });
  setup.store.failUpdateOnce.add(QUOTE_TASK_ID);
  const submitted = await setup.submit();
  assert.equal(submitted.status, 'draft_ready');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, QUOTE_TASK_ID).status, 'waiting_external');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'waiting_external');
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT).length, 1);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT).length, 1);

  const repaired = await setup.submit();
  assert.equal(repaired.repeated, true);
  assert.equal(repaired.draftId, submitted.draftId);
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, QUOTE_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'running');
});

test('a run-resume write failure leaves committed quote success and replay resumes from wake markers', async () => {
  const setup = await fixture({ quoteStatus: 'waiting_external' });
  setup.store.failUpdateOnce.add(RUN_ID);
  const submitted = await setup.submit();
  assert.equal(submitted.status, 'draft_ready');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, QUOTE_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'waiting_external');

  const repaired = await setup.submit();
  assert.equal(repaired.repeated, true);
  assert.equal(repaired.draftId, submitted.draftId);
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'running');
});

test('foreign run-mutation lease defers only wake-up and exact replay repairs after release', async () => {
  const setup = await fixture();
  const lease = await acquireDurableOperationLease({
    dataStore: setup.store,
    tenantId: TENANT,
    scope: 'starter-run-mutation',
    subjectId: RUN_ID,
    ownerId: 'foreign-quote-runtime',
    leaseDurationMs: 60_000,
  });
  assert.ok(lease);
  const submitted = await setup.submit();
  assert.equal(submitted.status, 'draft_ready');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'waiting_external');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'waiting_external');
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT).length, 1);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT).length, 1);

  await releaseDurableOperationLease({ dataStore: setup.store, lease });
  const repaired = await setup.submit();
  assert.equal(repaired.repeated, true);
  assert.equal(repaired.draftId, submitted.draftId);
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'pending');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'running');
});

test('human-owned run states and pending content approval are never overridden', async () => {
  for (const status of ['waiting_approval', 'waiting_human', 'paused', 'cancelling']) {
    const setup = await fixture({ runStatus: status });
    const submitted = await setup.submit();
    assert.equal(submitted.status, 'draft_ready');
    assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, status);
    assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'waiting_external');
  }

  const approval = await fixture({ pendingApproval: true });
  await approval.submit();
  assert.equal(approval.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'pending');
  assert.equal(approval.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'waiting_external');
});

test('non-recoverable observer waits are not reset by a new quote artifact', async () => {
  const setup = await fixture({
    inquiryReason: 'quote_inquiry_integrity_invalid',
    quoteStatus: 'waiting_external',
    quoteReason: 'quote_draft_integrity_invalid',
  });
  const writesBefore = taskRunWriteCount(setup.store);
  const submitted = await setup.submit();
  assert.equal(submitted.status, 'draft_ready');
  assert.equal(taskRunWriteCount(setup.store), writesBefore);
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status, 'waiting_external');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.tasks, QUOTE_TASK_ID).status, 'waiting_external');
  assert.equal(setup.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status, 'waiting_external');
});

test('cross-tenant, expired-cycle, terminal-run and legacy lineage attempts fail closed', async () => {
  const crossTenant = await fixture();
  await crossTenant.submit();
  const crossLineage = storedLineage(crossTenant.store);
  const writesBeforeCrossTenant = taskRunWriteCount(crossTenant.store);
  const ignoredCrossTenant = await notifyStarterQuoteArtifactsReady({
    dataStore: crossTenant.store,
    repository: crossTenant.repository,
    tenantId: OTHER_TENANT,
    inquiry: crossLineage.inquiry,
    draftId: crossLineage.draftId,
    now: () => NOW,
  });
  assert.equal(ignoredCrossTenant.reason, 'invalid_wakeup_identity');
  assert.equal(taskRunWriteCount(crossTenant.store), writesBeforeCrossTenant);

  const expired = await fixture();
  await expired.submit();
  const expiredLineage = storedLineage(expired.store);
  expired.store.row(STARTER_COLLECTIONS.access, 'quote-wakeup-access').cycle_ends_at = '2026-09-10T00:00:00.000Z';
  expired.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status = 'waiting_external';
  expired.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status = 'waiting_external';
  expired.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).output = waitOutput(
    'starter_inquiry_intake', 'quote_inquiry_not_received',
  );
  const writesBeforeExpired = taskRunWriteCount(expired.store);
  const ignoredExpired = await notifyStarterQuoteArtifactsReady({
    dataStore: expired.store,
    repository: expired.repository,
    tenantId: TENANT,
    inquiry: expiredLineage.inquiry,
    draftId: expiredLineage.draftId,
    now: () => NOW,
  });
  assert.equal(ignoredExpired.reason, 'access_cycle_closed');
  assert.equal(taskRunWriteCount(expired.store), writesBeforeExpired);

  const terminal = await fixture();
  await terminal.submit();
  const terminalLineage = storedLineage(terminal.store);
  terminal.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status = 'cancelled';
  terminal.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status = 'waiting_external';
  terminal.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).output = waitOutput(
    'starter_inquiry_intake', 'quote_inquiry_not_received',
  );
  const writesBeforeTerminal = taskRunWriteCount(terminal.store);
  const ignoredTerminal = await notifyStarterQuoteArtifactsReady({
    dataStore: terminal.store,
    repository: terminal.repository,
    tenantId: TENANT,
    inquiry: terminalLineage.inquiry,
    draftId: terminalLineage.draftId,
    now: () => NOW,
  });
  assert.equal(ignoredTerminal.reason, 'run_cancelled');
  assert.equal(taskRunWriteCount(terminal.store), writesBeforeTerminal);

  const legacy = await fixture();
  await legacy.submit();
  const legacyLineage = storedLineage(legacy.store);
  legacy.store.row(STARTER_COLLECTIONS.runs, RUN_ID).status = 'waiting_external';
  legacy.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).status = 'waiting_external';
  legacy.store.row(STARTER_COLLECTIONS.tasks, INQUIRY_TASK_ID).output = waitOutput(
    'starter_inquiry_intake', 'quote_inquiry_not_received',
  );
  legacy.store.row(STARTER_COLLECTIONS.quoteInquiries, legacyLineage.inquiry.inquiryRecordId).lineage_hash = '';
  const writesBeforeLegacy = taskRunWriteCount(legacy.store);
  const ignoredLegacy = await notifyStarterQuoteArtifactsReady({
    dataStore: legacy.store,
    repository: legacy.repository,
    tenantId: TENANT,
    inquiry: legacyLineage.inquiry,
    draftId: legacyLineage.draftId,
    now: () => NOW,
  });
  assert.equal(ignoredLegacy.reason, 'quote_lineage_not_exact');
  assert.equal(taskRunWriteCount(legacy.store), writesBeforeLegacy);
});

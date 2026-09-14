import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE_VERSION,
  type Starter198QuoteInquiryInput,
  type Starter198QuoteRuleSetupInput,
} from '../../shared/contracts/starter198.js';
import {
  createStarterPublicationPackage,
  submitStarterPublicationEvidence,
  verifyStarterPublicationEvidence,
} from '../publishing/starterPublicationPackage.js';
import { QuotationService } from '../quotation/service.js';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { prepareStarterResultSummaryHandler } from './resultSummary.js';
import {
  prepareStarterInquiryIntakeAdapter,
  prepareStarterQuoteDraftAdapter,
} from './salesArtifactAdapter.js';
import { createStarter198QuoteSelfServicePort } from './quoteSelfService.js';
import { stableHash } from './orchestratorWorkerValues.js';
import { STARTER_198_STANDARD_TASK_KEYS } from './workflowScope.js';

type Row = Record_ & Record<string, unknown>;

const TENANT = 'sales-adapter-tenant';
const OTHER_TENANT = 'sales-adapter-other';
const RUN_ID = 'sales-adapter-run';
const INTAKE_TASK_ID = 'sales-inquiry-task';
const QUOTE_TASK_ID = 'sales-quote-task';
const EVIDENCE_TASK_ID = 'sales-publication-evidence-task';
const SUMMARY_TASK_ID = 'sales-result-summary-task';
const INPUT_VERSION = 'a'.repeat(64);
const INITIALIZATION_ID = 'sales-adapter-initialization';
const ENTITLEMENT_ID = 'sales-adapter-entitlement';
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
  sourceReference: 'catalog:2026-09',
});

const INQUIRY: Starter198QuoteInquiryInput = Object.freeze({
  sourceChannel: 'whatsapp',
  sourceReference: 'wa:private-lead-9001',
  quantity: 100,
  destinationCountry: 'DE',
});

class MemoryStore implements DataStore {
  private sequence = 0;
  writes = 0;
  readonly rows = new Map<string, Row[]>();
  readonly listQueries: Array<{ collection: string; query: ListQuery }> = [];
  truncateCollection = '';

  seed(collection: string, data: Record<string, unknown>): Row {
    const row = { id: `record_${String(++this.sequence).padStart(6, '0')}`, ...structuredClone(data) } as Row;
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return row;
  }

  collection(collection: string, tenantId?: string): Row[] {
    return (this.rows.get(collection) ?? []).filter(row => !tenantId || row.tenant_id === tenantId);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const row = this.collection(collection).find(item => item.id === id);
    return row ? structuredClone(row) as T : null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    this.writes += 1;
    const rows = this.collection(collection);
    const tenantId = data.tenant_id;
    const duplicate = collection === STARTER_COLLECTIONS.quoteRuleSets
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
          ? rows.some(row => row.tenant_id === tenantId && (
            row.idempotency_key === data.idempotency_key
            || (row.lineage_hash && row.lineage_hash === data.lineage_hash)
          ))
          : collection === 'quote_exception_requests'
            ? rows.some(row => row.tenant_id === tenantId && (
              row.draft_id === data.draft_id || row.idempotency_key === data.idempotency_key
            ))
            : false;
    return duplicate ? null : structuredClone(this.seed(collection, data)) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    this.writes += 1;
    const row = this.collection(collection).find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    this.writes += 1;
    const rows = this.collection(collection);
    const next = rows.filter(row => row.id !== id);
    this.rows.set(collection, next);
    return next.length !== rows.length;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    this.listQueries.push({ collection, query: structuredClone(query) });
    let rows = this.collection(collection).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      rows = [...rows].sort((left, right) => {
        const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''), undefined, { numeric: true });
        return descending ? -compared : compared;
      });
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const start = (page - 1) * perPage;
    const totalItems = rows.length;
    let items = rows.slice(start, start + perPage);
    if (this.truncateCollection === collection && items.length) items = items.slice(0, Math.max(0, items.length - 1));
    return {
      items: structuredClone(items) as T[],
      totalItems,
      totalPages: totalItems ? Math.ceil(totalItems / perPage) : 0,
      page,
      perPage,
    };
  }
}

function seedFoundation(store: MemoryStore): {
  intakeTask: Row;
  quoteTask: Row;
  evidenceTask: Row;
  summaryTask: Row;
} {
  store.seed(STARTER_COLLECTIONS.access, {
    tenant_id: TENANT,
    product_profile: 'starter_198',
    profile_version: STARTER_198_PROFILE_VERSION,
    entitlement_snapshot_id: ENTITLEMENT_ID,
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: STARTER_198_DEFAULT_LIMITS,
    status: 'active',
    cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  });
  store.seed(STARTER_COLLECTIONS.runs, {
    tenant_id: TENANT,
    id: RUN_ID,
    status: 'waiting_external',
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
  const tasks = STARTER_198_STANDARD_TASK_KEYS.map((taskKey, index) => store.seed(
    STARTER_COLLECTIONS.tasks,
    {
      tenant_id: TENANT,
      id: taskKey === 'starter_inquiry_intake'
        ? INTAKE_TASK_ID
        : taskKey === 'starter_quote_draft'
          ? QUOTE_TASK_ID
          : taskKey === 'starter_publication_evidence'
            ? EVIDENCE_TASK_ID
            : taskKey === 'starter_result_summary'
              ? SUMMARY_TASK_ID
              : `sales-foundation-task-${index + 1}`,
      run_id: RUN_ID,
      task_key: taskKey,
      sequence: index + 1,
      policy_source: STARTER_198_PROFILE_VERSION,
      agent_role: taskKey === 'starter_inquiry_intake' || taskKey === 'starter_quote_draft'
        ? 'sales'
        : taskKey === 'starter_publication_package' || taskKey === 'starter_publication_evidence'
          ? 'traffic'
          : taskKey === 'starter_result_summary' || taskKey === 'starter_context_snapshot'
            ? 'orchestrator'
            : 'content',
      business_domain: taskKey === 'starter_inquiry_intake' || taskKey === 'starter_quote_draft'
        ? 'customer'
        : 'test',
      capability_key: taskKey === 'starter_inquiry_intake' || taskKey === 'starter_quote_draft'
        ? 'quotation.calculate'
        : 'test.fixture',
      execution_mode: taskKey === 'starter_quote_draft' ? 'internal' : 'observe',
      external_effect: taskKey === 'starter_quote_draft' ? 'draft' : 'none',
      automatic_execution_allowed: true,
      depends_on: taskKey === 'starter_inquiry_intake'
        ? ['starter_context_snapshot']
        : taskKey === 'starter_quote_draft'
          ? ['starter_inquiry_intake']
          : [],
      status: 'pending',
    },
  ));
  return {
    intakeTask: tasks[7],
    quoteTask: tasks[8],
    evidenceTask: tasks[6],
    summaryTask: tasks[9],
  };
}

async function fixture() {
  const store = new MemoryStore();
  const { intakeTask, quoteTask, evidenceTask, summaryTask } = seedFoundation(store);
  const repository = createStarter198Repository(store);
  const quotePort = createStarter198QuoteSelfServicePort({ dataStore: store, repository, now: () => NOW });
  const quotation = new QuotationService(store, () => NOW);
  await quotePort.confirmRule({
    tenantId: TENANT, userId: 'owner-user', role: 'owner', setup: RULE, idempotencyKey: 'sales-rule-0001',
  });
  const quote = await quotePort.submitInquiry({
    tenantId: TENANT, userId: 'sales-user', role: 'customer_service', inquiry: INQUIRY,
    idempotencyKey: 'sales-inquiry-0001',
  });
  const base = {
    repository,
    tenantId: TENANT,
    run: (await repository.get(STARTER_COLLECTIONS.runs, TENANT, RUN_ID))!,
    frozen: {
      initializationId: INITIALIZATION_ID,
      inputVersion: INPUT_VERSION,
      entitlementSnapshotId: ENTITLEMENT_ID,
    },
  };
  return {
    store,
    repository,
    quotePort,
    quotation,
    quote,
    evidenceTask,
    summaryTask,
    intakeContext: { ...base, task: intakeTask },
    quoteContext: { ...base, task: quoteTask },
  };
}

function persistIntakeCheckpointInFixture(
  setup: Awaited<ReturnType<typeof fixture>>,
  output: Record<string, unknown>,
): void {
  const task = setup.store.collection(STARTER_COLLECTIONS.tasks, TENANT)
    .find(row => row.id === INTAKE_TASK_ID)!;
  task.status = 'succeeded';
  task.output = structuredClone(output);
}

test('self-service writes indexed run/cycle lineage and adapters observe it at zero cost without providers', async () => {
  const setup = await fixture();
  const inquiryRows = setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT);
  const draftRows = setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT);
  assert.equal(inquiryRows.length, 1);
  assert.equal(draftRows.length, 1);
  for (const row of [...inquiryRows, ...draftRows]) {
    assert.equal(row.run_id, RUN_ID);
    assert.match(String(row.cycle_id), /^cycle:[a-f0-9]{32}$/);
    assert.match(String(row.lineage_hash), /^[a-f0-9]{64}$/);
  }
  assert.equal(inquiryRows[0].workflow_task_id, INTAKE_TASK_ID);
  assert.equal(draftRows[0].workflow_task_id, QUOTE_TASK_ID);
  assert.equal(draftRows[0].inquiry_record_id, inquiryRows[0].id);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network access is forbidden');
  }) as typeof fetch;
  const writesBefore = setup.store.writes;
  try {
    const intake = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
    persistIntakeCheckpointInFixture(setup, intake.output);
    const draft = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
    assert.equal(intake.status, 'succeeded');
    assert.equal(intake.output.schemaVersion, 'starter-198.inquiry-intake-adapter-output.v1');
    assert.equal(draft.status, 'succeeded');
    assert.equal(draft.output.schemaVersion, 'starter-198.quote-draft-adapter-output.v1');
    assert.deepEqual((draft.output.canonicalQuote as Record<string, unknown>).total, {
      currency: 'USD', decimal: '1270.00',
    });
    for (const output of [intake.output, draft.output]) {
      assert.equal(output.providerCalls, 0);
      assert.equal(output.externalEffectsPerformed, false);
      assert.equal(output.externalMessageSent, false);
      assert.deepEqual(output.usageObservation, {
        inputTokens: 0, outputTokens: 0, cacheTokens: 0, costCny: 0,
      });
      assert.doesNotMatch(JSON.stringify(output), /private-lead|owner-user|sales-user|record_\d+/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
  assert.equal(setup.store.writes, writesBefore, 'both adapters must remain strictly read-only');
  const quoteQueries = setup.store.listQueries.filter(item => (
    item.collection === STARTER_COLLECTIONS.quoteInquiries
    || item.collection === STARTER_COLLECTIONS.quoteDrafts
  ));
  assert.ok(quoteQueries.length >= 3);
  for (const { query } of quoteQueries.slice(-3)) {
    assert.equal(query.where?.run_id, RUN_ID);
    assert.match(String(query.where?.cycle_id), /^cycle:/);
    assert.ok(query.where?.workflow_task_id, 'artifact reads must be constrained by an indexed task lineage');
  }
});

test('exact replay preserves one inquiry, one draft and the same immutable lineage', async () => {
  const setup = await fixture();
  const firstInquiry = structuredClone(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT)[0]);
  const firstDraft = structuredClone(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT)[0]);
  const replay = await setup.quotePort.submitInquiry({
    tenantId: TENANT,
    userId: 'another-sales-user',
    role: 'customer_service',
    inquiry: INQUIRY,
    idempotencyKey: 'sales-inquiry-replay',
  });
  assert.equal(replay.inquiryId, setup.quote.inquiryId);
  assert.equal(replay.draftId, setup.quote.draftId);
  assert.equal(replay.repeated, true);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT).length, 1);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT).length, 1);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT)[0].lineage_hash, firstInquiry.lineage_hash);
  assert.equal(setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT)[0].lineage_hash, firstDraft.lineage_hash);
});

test('missing, cross-tenant, immature, ambiguous and truncated inquiry evidence remain structured waiting', async () => {
  const setup = await fixture();
  const inquiries = setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT);
  const canonical = inquiries[0];

  canonical.status = 'processing';
  let result = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(result.status, 'waiting_external');
  assert.equal(result.output.reasonCode, 'quote_inquiry_status_not_mature');
  canonical.status = 'received';

  setup.store.seed(STARTER_COLLECTIONS.quoteInquiries, {
    ...structuredClone(canonical), id: 'ambiguous-inquiry', tenant_id: TENANT,
  });
  result = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(result.output.reasonCode, 'quote_inquiry_canonical_ambiguous');
  setup.store.rows.set(STARTER_COLLECTIONS.quoteInquiries, [canonical]);

  setup.store.truncateCollection = STARTER_COLLECTIONS.quoteInquiries;
  result = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(result.output.reasonCode, 'quote_inquiry_query_incomplete');
  setup.store.truncateCollection = '';

  canonical.tenant_id = OTHER_TENANT;
  result = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(result.output.reasonCode, 'quote_inquiry_not_received');
});

test('tampered inquiry or quote hashes and multiple current drafts never become successful output', async () => {
  const setup = await fixture();
  const inquiry = setup.store.collection(STARTER_COLLECTIONS.quoteInquiries, TENANT)[0];
  const draft = setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT)[0];

  const intake = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(intake.status, 'succeeded');
  persistIntakeCheckpointInFixture(setup, intake.output);

  const originalInquiryHash = inquiry.request_hash;
  inquiry.request_hash = 'f'.repeat(64);
  let result = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(result.output.reasonCode, 'quote_inquiry_integrity_invalid');
  inquiry.request_hash = originalInquiryHash;

  const calculation = draft.calculation as Record<string, unknown>;
  const total = calculation.total as Record<string, unknown>;
  const originalTotal = total.decimal;
  total.decimal = '0.01';
  result = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(result.output.reasonCode, 'quote_draft_integrity_invalid');
  total.decimal = originalTotal;

  draft.tenant_id = OTHER_TENANT;
  result = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(result.output.reasonCode, 'quote_draft_not_ready');
  draft.tenant_id = TENANT;

  draft.status = 'calculating';
  result = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(result.output.reasonCode, 'quote_draft_status_not_mature');
  draft.status = 'draft_ready';

  setup.store.seed(STARTER_COLLECTIONS.quoteDrafts, {
    ...structuredClone(draft), id: 'second-current-draft', tenant_id: TENANT,
  });
  result = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(result.output.reasonCode, 'quote_draft_canonical_ambiguous');

  setup.store.truncateCollection = STARTER_COLLECTIONS.quoteDrafts;
  result = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(result.output.reasonCode, 'quote_draft_query_incomplete');
});

test('result summary requires exact canonical quote approval and publication evidence lineage', async () => {
  const setup = await fixture();
  const intake = await prepareStarterInquiryIntakeAdapter(setup.intakeContext);
  assert.equal(intake.status, 'succeeded');
  persistIntakeCheckpointInFixture(setup, intake.output);

  const quoteTask = setup.store.collection(STARTER_COLLECTIONS.tasks, TENANT)
    .find(row => row.id === QUOTE_TASK_ID)!;
  const evidenceTask = setup.store.collection(STARTER_COLLECTIONS.tasks, TENANT)
    .find(row => row.id === EVIDENCE_TASK_ID)!;
  const summaryTask = setup.store.collection(STARTER_COLLECTIONS.tasks, TENANT)
    .find(row => row.id === SUMMARY_TASK_ID)!;
  const draftRow = setup.store.collection(STARTER_COLLECTIONS.quoteDrafts, TENANT)[0];
  const initialQuote = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(initialQuote.status, 'succeeded');
  quoteTask.status = 'succeeded';
  quoteTask.output = structuredClone(initialQuote.output);

  const created = await createStarterPublicationPackage({
    tenantId: TENANT,
    contentId: 'summary-content-one',
    contentVersion: '1',
    contentHash: 'b'.repeat(64),
    platform: 'tiktok',
    copy: { title: 'Summary test', body: 'Verified publication body', hashtags: ['B2B'] },
    assets: [{
      kind: 'video', fileName: 'summary.mp4',
      downloadUrl: '/api/overseas/summary.mp4', contentHash: 'c'.repeat(64),
    }],
    workflowBinding: {
      schemaVersion: 'starter-198.publication-workflow-binding.v1',
      runId: RUN_ID,
      approvalId: 'summary-content-approval',
      approvalTaskId: 'sales-foundation-task-5',
      agentTaskId: 'summary-package-agent-task',
    },
    idempotencyKey: 'result-summary-publication-0001',
    now: NOW,
  }, setup.store);
  await submitStarterPublicationEvidence({
    tenantId: TENANT,
    packageId: created.package.packageId,
    contentHash: created.package.contentHash,
    platformPostId: 'private-platform-post-9001',
    submittedBy: 'private-publication-user',
    now: NOW,
  }, setup.store);
  const verified = await verifyStarterPublicationEvidence({
    tenantId: TENANT,
    packageId: created.package.packageId,
    verifier: 'platform_receipt',
    publiclyObservable: true,
    observedContentHash: created.package.contentHash,
    sourceReceiptHash: 'd'.repeat(64),
    verifierIdentity: 'trusted-summary-verifier-v1',
    now: NOW,
  }, setup.store);
  const evidenceBinding = {
    tenantId: TENANT,
    runId: RUN_ID,
    taskId: EVIDENCE_TASK_ID,
    packageId: verified.package.packageId,
    packageHash: verified.package.packageHash,
    contentId: verified.package.contentId,
    contentVersion: verified.package.contentVersion,
    contentHash: verified.package.contentHash,
    platform: verified.package.platform,
    evidenceHash: verified.evidence.evidenceHash,
    verificationReceiptHash: verified.evidence.verificationReceiptHash,
  };
  const evidenceCore = {
    schemaVersion: 'starter-198.publication-evidence-output.v1',
    executionStatus: 'completed',
    verificationStatus: 'verified',
    runId: RUN_ID,
    taskId: EVIDENCE_TASK_ID,
    packageId: verified.package.packageId,
    packageHash: verified.package.packageHash,
    contentId: verified.package.contentId,
    contentVersion: verified.package.contentVersion,
    contentHash: verified.package.contentHash,
    platform: verified.package.platform,
    evidenceHash: verified.evidence.evidenceHash,
    verifier: verified.evidence.verifier,
    verifiedAt: verified.evidence.verifiedAt,
    verificationReceiptHash: verified.evidence.verificationReceiptHash,
    reasonCode: '',
    bindingHash: stableHash(evidenceBinding),
    sourceReadOnly: true,
    providerCalls: 0,
    externalEffectsPerformed: false,
  };
  evidenceTask.status = 'succeeded';
  evidenceTask.output = { ...evidenceCore, outputHash: stableHash(evidenceCore) };

  const summaryContext = {
    dataStore: setup.store,
    repository: setup.repository,
    tenantId: TENANT,
    run: setup.quoteContext.run,
    task: summaryTask,
    now: NOW,
  };
  let summary = await prepareStarterResultSummaryHandler(summaryContext);
  assert.equal(summary.status, 'waiting_external');
  assert.equal(summary.output.reasonCode, 'result_summary_quote_approval_required');

  draftRow.status = 'approved';
  draftRow.approval_valid = true;
  draftRow.approval_evidence_id = 'missing-approval-evidence';
  draftRow.decided_at = NOW.toISOString();
  const selfAssertedApproval = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(selfAssertedApproval.status, 'succeeded');
  quoteTask.output = structuredClone(selfAssertedApproval.output);
  summary = await prepareStarterResultSummaryHandler(summaryContext);
  assert.equal(summary.status, 'waiting_external');
  assert.equal(summary.output.reasonCode, 'result_summary_quote_approval_evidence_invalid',
    'database status flags without immutable approval evidence must not produce success');
  draftRow.status = 'draft_ready';
  draftRow.approval_valid = false;
  delete draftRow.approval_evidence_id;
  delete draftRow.decided_at;

  await setup.quotation.approveDraft({
    tenantId: TENANT, userId: 'private-quote-approver', role: 'super_admin',
  }, setup.quote.draftId, 'result-summary-approval-0001');
  const approvedQuote = await prepareStarterQuoteDraftAdapter(setup.quoteContext);
  assert.equal(approvedQuote.status, 'succeeded');
  quoteTask.output = structuredClone(approvedQuote.output);
  summary = await prepareStarterResultSummaryHandler(summaryContext);
  assert.equal(summary.status, 'succeeded');
  assert.equal((summary.output.quotation as Row).draftStatus, 'approved');
  assert.equal((summary.output.quotation as Row).requiresHumanApproval, false);
  assert.doesNotMatch(
    JSON.stringify(summary.output),
    /private-publication-user|private-platform-post-9001|private-quote-approver|trusted-summary-verifier-v1/,
    'summary output must omit submitter, raw platform identifiers and verifier/approver identities',
  );

  const savedQuoteOutput = structuredClone(quoteTask.output) as Row;
  for (const mutate of [
    (output: Row) => { ((output.canonicalQuote as Row).total as Row).decimal = '-1.00'; },
    (output: Row) => { (output.canonicalQuote as Row).requiresHumanApproval = true; },
  ]) {
    const tampered = structuredClone(savedQuoteOutput) as Row;
    delete tampered.outputHash;
    mutate(tampered);
    tampered.outputHash = stableHash(tampered);
    quoteTask.output = tampered;
    summary = await prepareStarterResultSummaryHandler(summaryContext);
    assert.equal(summary.status, 'waiting_external');
    assert.equal(summary.output.reasonCode, 'result_summary_output_hash_invalid');
  }
  quoteTask.output = savedQuoteOutput;

  const savedLineage = draftRow.lineage_hash;
  draftRow.lineage_hash = 'e'.repeat(64);
  summary = await prepareStarterResultSummaryHandler(summaryContext);
  assert.equal(summary.status, 'waiting_external');
  assert.equal(summary.output.reasonCode, 'result_summary_quote_canonical_changed');
  draftRow.lineage_hash = savedLineage;

  const approvalRow = setup.store.collection(STARTER_COLLECTIONS.quoteApprovalEvidence, TENANT)[0];
  const savedEnvelopeHash = approvalRow.envelope_hash;
  approvalRow.envelope_hash = 'f'.repeat(64);
  summary = await prepareStarterResultSummaryHandler(summaryContext);
  assert.equal(summary.status, 'waiting_external');
  assert.equal(summary.output.reasonCode, 'result_summary_quote_approval_evidence_invalid');
  approvalRow.envelope_hash = savedEnvelopeHash;

  const savedEvidenceOutput = structuredClone(evidenceTask.output) as Row;
  for (const [field, value] of [
    ['runId', 'foreign-summary-run'],
    ['taskId', 'foreign-summary-evidence-task'],
  ] as const) {
    const tampered = structuredClone(savedEvidenceOutput) as Row;
    delete tampered.outputHash;
    tampered[field] = value;
    tampered.outputHash = stableHash(tampered);
    evidenceTask.output = tampered;
    summary = await prepareStarterResultSummaryHandler(summaryContext);
    assert.equal(summary.status, 'waiting_external');
    assert.equal(summary.output.reasonCode, 'result_summary_publication_evidence_changed');
  }
  evidenceTask.output = savedEvidenceOutput;
});

test('quote workflow lineage migration is additive, indexed and does not infer historical bindings', async () => {
  const source = await readFile(
    new URL('../../pb_migrations/1789862400_bind_starter_quote_workflow_lineage.js', import.meta.url),
    'utf8',
  );
  for (const field of ['run_id', 'cycle_id', 'workflow_task_id', 'lineage_hash']) {
    assert.match(source, new RegExp(`"${field}"`));
  }
  assert.match(source, /idx_starter_quote_inquiry_workflow/);
  assert.match(source, /idx_starter_quote_draft_workflow_inquiry/);
  assert.match(source, /CREATE UNIQUE INDEX idx_starter_quote_(?:inquiry|draft)_lineage/);
  assert.doesNotMatch(source, /findAllRecords/);
  assert.match(source, /Existing rows[\s\S]*intentionally unbound/);
});

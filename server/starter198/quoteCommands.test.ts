import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE,
  STARTER_198_PROFILE_VERSION,
  type Starter198QuoteInquiryInput,
  type Starter198QuoteRuleSetupInput,
  type Starter198ResourceLimits,
} from '../../shared/contracts/starter198.js';
import {
  parseStarter198CommandInput,
  runStarter198Command,
  Starter198CommandError,
} from './commands.js';
import type { Starter198AccessSnapshot } from './profile.js';
import {
  STARTER_COLLECTIONS,
  type StarterCollection,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import type { Starter198QuoteSelfServicePort } from './runtimePorts.js';
import { starterCommandAllowed } from './workspace.js';
import { buildStarter198CapabilityManifest } from './profile.js';

const TENANT_ID = 'starter-quote-command-tenant';
const NOW = new Date('2026-09-12T08:00:00.000Z');

const LIMITS: Starter198ResourceLimits = {
  workspaceCount: 1,
  brandCount: 1,
  memberCount: 3,
  agentTeamCount: 1,
  productCount: 1,
  marketCount: 2,
  buyerPersonaCount: 3,
  languageCount: 2,
  primaryPlatformCount: 2,
  concurrentRunCount: 1,
  contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3,
  publicationPackageCountPerContent: 2,
  assistedSessionCount: 5,
  inquiryAiCountPerCycle: 100,
  quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0,
  budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

const RULE = {
  sku: 'VACUUM-500',
  currency: 'USD',
  unitPrice: '12.50',
  unitCost: '8.00',
  moq: 100,
  incoterm: 'FOB',
  shippingFlatFee: '75.00',
  taxRateBps: 0,
  paymentTerm: 'T/T 30% deposit, 70% before shipment',
  leadTimeDays: 30,
  validDays: 14,
  minMarginBps: 1_000,
  sourceReference: 'erp:price-book-2026-q3',
} satisfies Starter198QuoteRuleSetupInput;

const INQUIRY = {
  sourceChannel: 'whatsapp',
  sourceReference: 'wa:buyer-private-reference-9001',
  quantity: 500,
  destinationCountry: 'DE',
} satisfies Starter198QuoteInquiryInput;

function accessSnapshot(options: { quotationEnabled?: boolean; quoteLimit?: number } = {}): Starter198AccessSnapshot {
  return {
    recordId: 'starter-access-1',
    tenantId: TENANT_ID,
    productProfile: STARTER_198_PROFILE,
    profileVersion: STARTER_198_PROFILE_VERSION,
    entitlementSnapshotId: 'entitlement-snapshot-v1',
    entitlements: STARTER_198_CAPABILITIES.map(capability => ({
      capability,
      enabled: capability === 'quotation.calculate' ? options.quotationEnabled !== false : true,
    })),
    resourceLimits: {
      ...LIMITS,
      quoteDraftCountPerCycle: options.quoteLimit ?? LIMITS.quoteDraftCountPerCycle,
    },
    status: 'active',
    cycleStartedAt: '2026-09-12T00:00:00.000Z',
    cycleEndsAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryRepository implements Starter198Repository {
  private sequence = 0;
  readonly rows = new Map<string, StarterRecord[]>();

  constructor(readonly snapshot: Starter198AccessSnapshot = accessSnapshot()) {}

  collection(collection: string): StarterRecord[] {
    return clone(this.rows.get(collection) ?? []);
  }

  async list(
    collection: StarterCollection,
    tenantId: string,
    query: { page?: number; perPage?: number; sort?: string; where?: Record<string, string | number | boolean> } = {},
  ) {
    let rows = (this.rows.get(collection) ?? []).filter(row => row.tenant_id === tenantId);
    rows = rows.filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 500;
    const start = (page - 1) * perPage;
    return {
      items: clone(rows.slice(start, start + perPage)),
      totalItems: rows.length,
      totalPages: Math.ceil(rows.length / perPage),
      page,
      perPage,
    };
  }

  async get(
    collection: StarterCollection,
    tenantId: string,
    id: string,
  ): Promise<StarterRecord | null> {
    return clone((this.rows.get(collection) ?? []).find(row => row.tenant_id === tenantId && row.id === id) ?? null);
  }

  async create(
    collection: StarterCollection,
    tenantId: string,
    data: Record<string, unknown>,
  ): Promise<StarterRecord> {
    const bucket = this.rows.get(collection) ?? [];
    const row = {
      id: `${collection}-${String(++this.sequence).padStart(4, '0')}`,
      ...clone(data),
      tenant_id: tenantId,
    };
    bucket.push(row);
    this.rows.set(collection, bucket);
    return clone(row);
  }

  async update(
    collection: StarterCollection,
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const row = (this.rows.get(collection) ?? []).find(item => item.tenant_id === tenantId && item.id === id);
    if (!row) throw new Error('test_record_not_found');
    Object.assign(row, clone(data));
  }

  async access(tenantId: string): Promise<Starter198AccessSnapshot> {
    assert.equal(tenantId, this.snapshot.tenantId);
    return clone(this.snapshot);
  }
}

class FailCommandFinalizeOnceRepository extends MemoryRepository {
  private remainingFailures = 1;

  override async update(
    collection: StarterCollection,
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (collection === STARTER_COLLECTIONS.commands
      && data.status === 'succeeded'
      && this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error('simulated_command_finalize_failure');
    }
    await super.update(collection, tenantId, id, data);
  }
}

function observedQuotePort() {
  const confirmCalls: Parameters<Starter198QuoteSelfServicePort['confirmRule']>[0][] = [];
  const inquiryCalls: Parameters<Starter198QuoteSelfServicePort['submitInquiry']>[0][] = [];
  const port: Starter198QuoteSelfServicePort = {
    async confirmRule(input) {
      confirmCalls.push(clone(input));
      return {
        ruleSetKey: 'sku:VACUUM-500',
        ruleSetVersion: 'rule-version-v1',
        sku: input.setup.sku,
        created: confirmCalls.length === 1,
      };
    },
    async submitInquiry(input) {
      inquiryCalls.push(clone(input));
      return {
        inquiryId: 'starter-inquiry-v1',
        inquiryVersion: 'inquiry-version-v1',
        draftId: 'quote-draft-v1',
        status: 'draft_ready',
        total: { currency: 'USD', decimal: '6325.00' },
        repeated: inquiryCalls.length > 1,
      };
    },
  };
  return { port, confirmCalls, inquiryCalls };
}

function isCommandError(code: string, status: number) {
  return (error: unknown): boolean => error instanceof Starter198CommandError
    && error.code === code
    && error.status === status;
}

test('quote commands parse canonical inputs and reject malformed command envelopes', () => {
  const rule = parseStarter198CommandInput({
    command: 'confirm_quote_rule',
    idempotencyKey: 'quote-rule-command-0001',
    payload: RULE,
  });
  assert.equal(rule.command, 'confirm_quote_rule');
  assert.deepEqual(rule.payload, RULE);

  const inquiry = parseStarter198CommandInput({
    command: 'submit_quote_inquiry',
    idempotencyKey: 'quote-inquiry-command-0001',
    payload: INQUIRY,
  });
  assert.equal(inquiry.command, 'submit_quote_inquiry');
  assert.deepEqual(inquiry.payload, INQUIRY);

  assert.throws(
    () => parseStarter198CommandInput({
      command: 'submit_quote_inquiry',
      idempotencyKey: 'quote-inquiry-command-0002',
      payload: INQUIRY,
      directAgentCommand: true,
    }),
    isCommandError('starter_198_command_invalid', 400),
  );
  assert.throws(
    () => parseStarter198CommandInput({
      command: 'sales.quote.create',
      idempotencyKey: 'direct-sales-command-0001',
      payload: { targetAgent: 'sales' },
    }),
    isCommandError('starter_198_orchestrator_only', 403),
  );
});

test('quote payload shape drift is rejected before journaling or port invocation', async () => {
  const repository = new MemoryRepository();
  const observed = observedQuotePort();
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'owner-a',
      role: 'owner',
      request: {
        command: 'confirm_quote_rule',
        idempotencyKey: 'invalid-rule-command-0001',
        payload: { ...RULE, moq: '100' },
      },
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_quote_rule_invalid', 400),
  );
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'sales-a',
      role: 'customer_service',
      request: {
        command: 'submit_quote_inquiry',
        idempotencyKey: 'invalid-inquiry-command-0001',
        payload: { ...INQUIRY, quantity: 500, customerEmail: 'must-not-be-accepted@example.com' },
      },
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_command_payload_invalid', 400),
  );
  assert.equal(observed.confirmCalls.length, 0);
  assert.equal(observed.inquiryCalls.length, 0);
  assert.equal(repository.collection(STARTER_COLLECTIONS.commands).length, 0);
});

test('quote command authorization matches role and quotation capability boundaries', async () => {
  const manifest = buildStarter198CapabilityManifest(accessSnapshot(), NOW);
  assert.equal(starterCommandAllowed(manifest, 'owner', 'confirm_quote_rule'), true);
  assert.equal(starterCommandAllowed(manifest, 'admin', 'confirm_quote_rule'), true);
  assert.equal(starterCommandAllowed(manifest, 'operator', 'confirm_quote_rule'), false);
  assert.equal(starterCommandAllowed(manifest, 'customer_service', 'confirm_quote_rule'), false);
  assert.equal(starterCommandAllowed(manifest, 'owner', 'submit_quote_inquiry'), true);
  assert.equal(starterCommandAllowed(manifest, 'admin', 'submit_quote_inquiry'), true);
  assert.equal(starterCommandAllowed(manifest, 'customer_service', 'submit_quote_inquiry'), true);
  assert.equal(starterCommandAllowed(manifest, 'operator', 'submit_quote_inquiry'), false);

  const disabledManifest = buildStarter198CapabilityManifest(accessSnapshot({ quotationEnabled: false }), NOW);
  assert.equal(starterCommandAllowed(disabledManifest, 'owner', 'confirm_quote_rule'), false);
  assert.equal(starterCommandAllowed(disabledManifest, 'customer_service', 'submit_quote_inquiry'), false);
  const zeroLimitManifest = buildStarter198CapabilityManifest(accessSnapshot({ quoteLimit: 0 }), NOW);
  assert.equal(starterCommandAllowed(zeroLimitManifest, 'owner', 'submit_quote_inquiry'), false);

  const repository = new MemoryRepository();
  const observed = observedQuotePort();
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'operator-a',
      role: 'operator',
      request: {
        command: 'submit_quote_inquiry',
        idempotencyKey: 'operator-quote-command-0001',
        payload: INQUIRY,
      },
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_command_forbidden', 403),
  );
  assert.equal(observed.inquiryCalls.length, 0);
  assert.equal(repository.collection(STARTER_COLLECTIONS.commands).length, 0,
    'authorization must fail before a command journal row or port side effect is created');

  const capabilityDisabledRepository = new MemoryRepository(accessSnapshot({ quotationEnabled: false }));
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'owner-a',
      role: 'owner',
      request: {
        command: 'confirm_quote_rule',
        idempotencyKey: 'disabled-quote-command-0001',
        payload: RULE,
      },
      dependencies: {
        repository: capabilityDisabledRepository,
        quoteSelfService: observed.port,
        now: () => NOW,
      },
    }),
    isCommandError('starter_198_command_forbidden', 403),
  );
  assert.equal(observed.confirmCalls.length, 0);
  assert.equal(capabilityDisabledRepository.collection(STARTER_COLLECTIONS.commands).length, 0,
    'a disabled quotation capability must fail before journaling or invoking the port');
});

test('quote commands pass tenant, actor, role, payload and idempotency key to the port', async () => {
  const repository = new MemoryRepository();
  const observed = observedQuotePort();

  const ruleResult = await runStarter198Command({
    tenantId: TENANT_ID,
    userId: 'owner-a',
    role: 'owner',
    request: {
      command: 'confirm_quote_rule',
      idempotencyKey: 'quote-rule-command-0003',
      payload: RULE,
    },
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.equal(ruleResult.status, 200);
  assert.equal(ruleResult.body.accepted, true);
  assert.deepEqual(observed.confirmCalls, [{
    tenantId: TENANT_ID,
    userId: 'owner-a',
    role: 'owner',
    setup: RULE,
    idempotencyKey: 'quote-rule-command-0003',
  }]);

  const inquiryResult = await runStarter198Command({
    tenantId: TENANT_ID,
    userId: 'sales-a',
    role: 'customer_service',
    request: {
      command: 'submit_quote_inquiry',
      idempotencyKey: 'quote-inquiry-command-0003',
      payload: INQUIRY,
    },
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.equal(inquiryResult.status, 200);
  assert.equal(inquiryResult.body.accepted, true);
  assert.deepEqual(observed.inquiryCalls, [{
    tenantId: TENANT_ID,
    userId: 'sales-a',
    role: 'customer_service',
    inquiry: INQUIRY,
    idempotencyKey: 'quote-inquiry-command-0003',
  }]);
});

test('quote command audit payload never persists a plaintext source reference', async () => {
  const repository = new MemoryRepository();
  const observed = observedQuotePort();
  await runStarter198Command({
    tenantId: TENANT_ID,
    userId: 'owner-a',
    role: 'owner',
    request: {
      command: 'confirm_quote_rule',
      idempotencyKey: 'quote-rule-audit-0001',
      payload: RULE,
    },
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  await runStarter198Command({
    tenantId: TENANT_ID,
    userId: 'sales-a',
    role: 'customer_service',
    request: {
      command: 'submit_quote_inquiry',
      idempotencyKey: 'quote-inquiry-audit-0001',
      payload: INQUIRY,
    },
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });

  const records = repository.collection(STARTER_COLLECTIONS.commands);
  assert.equal(records.length, 2);
  for (const record of records) {
    const serialized = JSON.stringify(record);
    assert.doesNotMatch(serialized, /erp:price-book-2026-q3|wa:buyer-private-reference-9001/);
    const payload = record.payload as Record<string, unknown>;
    assert.match(String(payload.sourceReference), /^sha256:[a-f0-9]{64}$/);
  }
});

test('successful quote commands replay journal results without invoking the port twice', async () => {
  const repository = new MemoryRepository();
  const observed = observedQuotePort();
  const ruleRequest = {
    command: 'confirm_quote_rule' as const,
    idempotencyKey: 'quote-rule-replay-0001',
    payload: RULE,
  };
  const inquiryRequest = {
    command: 'submit_quote_inquiry' as const,
    idempotencyKey: 'quote-inquiry-replay-0001',
    payload: INQUIRY,
  };

  const firstRule = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'owner-a', role: 'owner', request: ruleRequest,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  const replayedRule = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'owner-a', role: 'owner', request: ruleRequest,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.deepEqual(replayedRule, firstRule);
  assert.equal(observed.confirmCalls.length, 1);

  const firstInquiry = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'sales-a', role: 'customer_service', request: inquiryRequest,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  const replayedInquiry = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'sales-a', role: 'customer_service', request: inquiryRequest,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.deepEqual(replayedInquiry, firstInquiry);
  assert.equal(observed.inquiryCalls.length, 1);
  assert.equal(repository.collection(STARTER_COLLECTIONS.commands).length, 2);
});

test('processing quote-rule command safely replays business idempotency and finalizes its journal', async () => {
  const repository = new FailCommandFinalizeOnceRepository();
  const observed = observedQuotePort();
  const request = {
    command: 'confirm_quote_rule' as const,
    idempotencyKey: 'quote-rule-crash-gap-0001',
    payload: RULE,
  };

  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID, userId: 'owner-a', role: 'owner', request,
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_command_journal_finalize_failed', 503),
  );
  assert.equal(observed.confirmCalls.length, 1);
  assert.equal(repository.collection(STARTER_COLLECTIONS.commands)[0]?.status, 'processing');

  const recovered = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'owner-a', role: 'owner', request,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.message, '当前报价规则已确认');
  assert.equal(observed.confirmCalls.length, 2, 'the deterministic port is replayed exactly once for recovery');
  const journal = repository.collection(STARTER_COLLECTIONS.commands)[0];
  assert.equal(journal?.status, 'succeeded');
  assert.equal((journal?.operation_result as Record<string, unknown>)?.created, false);

  const journalReplay = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'owner-a', role: 'owner', request,
    dependencies: { repository, now: () => NOW },
  });
  assert.deepEqual(journalReplay, recovered);
  assert.equal(observed.confirmCalls.length, 2, 'a finalized journal never calls the business port again');
});

test('processing inquiry stays unknown without its port, then safely recovers the same draft', async () => {
  const repository = new FailCommandFinalizeOnceRepository();
  const observed = observedQuotePort();
  const request = {
    command: 'submit_quote_inquiry' as const,
    idempotencyKey: 'quote-inquiry-crash-gap-0001',
    payload: INQUIRY,
  };

  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID, userId: 'sales-a', role: 'customer_service', request,
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_command_journal_finalize_failed', 503),
  );
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID, userId: 'sales-a', role: 'customer_service', request,
      dependencies: { repository, now: () => NOW },
    }),
    isCommandError('starter_198_command_state_unknown', 409),
  );
  assert.equal(repository.collection(STARTER_COLLECTIONS.commands)[0]?.status, 'processing',
    'a missing recovery port must not guess success or mark the command failed');
  assert.equal(observed.inquiryCalls.length, 1);

  const recovered = await runStarter198Command({
    tenantId: TENANT_ID, userId: 'sales-a', role: 'customer_service', request,
    dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.message, '已返回同一询盘的报价草稿');
  assert.equal(observed.inquiryCalls.length, 2);
  const journal = repository.collection(STARTER_COLLECTIONS.commands)[0];
  assert.equal(journal?.status, 'succeeded');
  assert.equal((journal?.operation_result as Record<string, unknown>)?.repeated, true);
});

test('missing quote self-service handler fails closed and the failure is stable on replay', async () => {
  const repository = new MemoryRepository();
  const request = {
    command: 'submit_quote_inquiry' as const,
    idempotencyKey: 'quote-handler-missing-0001',
    payload: INQUIRY,
  };
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'sales-a',
      role: 'customer_service',
      request,
      dependencies: { repository, now: () => NOW },
    }),
    isCommandError('starter_198_quote_self_service_unavailable', 503),
  );
  const failed = repository.collection(STARTER_COLLECTIONS.commands);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, 'failed');
  assert.equal(failed[0].error_code, 'starter_198_quote_self_service_unavailable');

  const observed = observedQuotePort();
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'sales-a',
      role: 'customer_service',
      request,
      dependencies: { repository, quoteSelfService: observed.port, now: () => NOW },
    }),
    isCommandError('starter_198_quote_self_service_unavailable', 503),
  );
  assert.equal(observed.inquiryCalls.length, 0,
    'a later handler injection must not replay a command whose original attempt failed closed');

  const missingRuleRepository = new MemoryRepository();
  await assert.rejects(
    runStarter198Command({
      tenantId: TENANT_ID,
      userId: 'owner-a',
      role: 'owner',
      request: {
        command: 'confirm_quote_rule',
        idempotencyKey: 'quote-rule-handler-missing-0001',
        payload: RULE,
      },
      dependencies: { repository: missingRuleRepository, now: () => NOW },
    }),
    isCommandError('starter_198_quote_self_service_unavailable', 503),
  );
  assert.equal(missingRuleRepository.collection(STARTER_COLLECTIONS.commands)[0]?.status, 'failed');
});

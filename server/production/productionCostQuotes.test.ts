import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionSpendWithinQuote,
  buildProductionCostQuote,
  createOrReuseProductionCostQuote,
  failProductionCostQuote,
  getProductionCostQuote,
  ProductionCostQuoteError,
  reserveProductionCostQuote,
  settleProductionCostQuote,
  type ProductionCostLedgerPort,
} from './productionCostQuotes.js';
import { createProductionTestStore } from './testStore.js';

function quoteInput(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'quote-task-001', taskId: 'task-1', runId: 'run-1', pricingVersion: 'prices-2026-10',
    budgetLimitCny: 5,
    lines: [
      { lineKey: 'library-clip', label: '复用企业素材片段', expectedUnitCostCny: 0, upperBoundUnitCostCny: 0, pricingSource: 'material-cache', explanation: '命中已入库片段，不触发供应商调用', reused: true },
      { lineKey: 'image-gen', label: '产品首帧生成', quantity: 2, unit: '张', expectedUnitCostCny: 0.3, upperBoundUnitCostCny: 0.5, pricingSource: 'provider-price-v3', explanation: '两张首帧，包含一次受控重试' },
    ],
    ...overrides,
  };
}

function fakeLedger(): ProductionCostLedgerPort & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async reserve(input) { calls.push({ action: 'reserve', ...input }); return { reservationId: 'reservation-1', executable: true, state: 'reserved' }; },
    async settle(input) { calls.push({ action: 'settle', ...input }); return { state: 'settled' }; },
    async fail(input) { calls.push({ action: 'fail', ...input }); return { state: 'failed' }; },
  };
}

test('production quote explains expected/upper bound and rejects budget overflow', () => {
  const quote = buildProductionCostQuote(quoteInput());
  assert.equal(quote.expectedCostCny, 0.6);
  assert.equal(quote.upperBoundCostCny, 1);
  assert.equal(quote.lines[0]?.reused, true);
  assert.throws(() => buildProductionCostQuote(quoteInput({ budgetLimitCny: 0.9 })),
    (error: unknown) => error instanceof ProductionCostQuoteError && error.code === 'production_cost_upper_bound_exceeds_budget');
  assert.throws(() => buildProductionCostQuote(quoteInput({
    lines: [{ lineKey: 'bad', label: '假复用', expectedUnitCostCny: 0.1, upperBoundUnitCostCny: 0.1, pricingSource: 'x', explanation: 'x', reused: true }],
  })), /production_cost_reused_line_must_be_free/);
});

test('production quote persists idempotently and isolates tenants', async () => {
  const store = createProductionTestStore();
  const first = await createOrReuseProductionCostQuote({ store, tenantId: 'tenant-a', quote: quoteInput() });
  const replay = await createOrReuseProductionCostQuote({ store, tenantId: 'tenant-a', quote: quoteInput() });
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.quote.id, first.quote.id);
  await assert.rejects(createOrReuseProductionCostQuote({
    store, tenantId: 'tenant-a', quote: quoteInput({ budgetLimitCny: 6 }),
  }), /production_cost_quote_idempotency_conflict/);
  assert.equal(await getProductionCostQuote({ store, tenantId: 'tenant-b', quoteId: first.quote.id }), null);
});

test('production quote reserves upper bound in ledger, gates spend and records actual settlement', async () => {
  const store = createProductionTestStore();
  const ledger = fakeLedger();
  const created = await createOrReuseProductionCostQuote({ store, tenantId: 'tenant-a', quote: quoteInput() });
  assert.throws(() => assertProductionSpendWithinQuote(created.quote, 1), /production_cost_quote_not_reserved/);
  const reserved = await reserveProductionCostQuote({ store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id });
  assert.equal(reserved.status, 'reserved');
  assert.equal(ledger.calls[0]?.upperBoundCostCny, 1, 'ledger reservation uses the hard upper bound');
  assert.doesNotThrow(() => assertProductionSpendWithinQuote(reserved, 1));
  assert.throws(() => assertProductionSpendWithinQuote(reserved, 1.01), /production_cost_upper_bound_exceeded/);
  const settled = await settleProductionCostQuote({
    store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id,
    actualLines: [
      { lineKey: 'library-clip', actualCostCny: 0, receiptRef: 'cache:clip' },
      { lineKey: 'image-gen', actualCostCny: 0.72, receiptRef: 'provider:receipt-1' },
    ],
  });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.actualCostCny, 0.72);
  assert.equal(ledger.calls[1]?.actualCostCny, 0.72);
  const replayed = await settleProductionCostQuote({
    store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id,
    actualLines: [
      { lineKey: 'library-clip', actualCostCny: 0, receiptRef: 'cache:clip' },
      { lineKey: 'image-gen', actualCostCny: 0.72, receiptRef: 'provider:receipt-1' },
    ],
  });
  assert.equal(replayed.status, 'settled');
  assert.equal(ledger.calls.length, 2, 'idempotent settlement must not charge the ledger twice');
  await assert.rejects(settleProductionCostQuote({
    store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id,
    actualLines: [
      { lineKey: 'library-clip', actualCostCny: 0, receiptRef: 'cache:clip' },
      { lineKey: 'image-gen', actualCostCny: 0.8, receiptRef: 'provider:receipt-2' },
    ],
  }), /production_cost_settlement_idempotency_conflict/);
});

test('settlement never hides a provider overrun', async () => {
  const store = createProductionTestStore();
  const ledger = fakeLedger();
  const created = await createOrReuseProductionCostQuote({ store, tenantId: 'tenant-a', quote: quoteInput({ idempotencyKey: 'quote-overrun-001' }) });
  await reserveProductionCostQuote({ store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id });
  const settled = await settleProductionCostQuote({
    store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id,
    actualLines: [
      { lineKey: 'library-clip', actualCostCny: 0 },
      { lineKey: 'image-gen', actualCostCny: 1.2, receiptRef: 'provider:overrun' },
    ],
  });
  assert.equal(settled.status, 'overrun');
  assert.equal(settled.actualCostCny, 1.2);
});

test('failed quote preserves unknown actual cost and keeps the reservation open for reconciliation', async () => {
  const store = createProductionTestStore();
  const ledger = fakeLedger();
  const created = await createOrReuseProductionCostQuote({
    store,
    tenantId: 'tenant-a',
    quote: quoteInput({ idempotencyKey: 'quote-failed-unknown-001' }),
  });
  await reserveProductionCostQuote({ store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id });

  const failed = await failProductionCostQuote({
    store,
    ledger,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
    reason: '供应商未返回账单',
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.actualCostCny, null, 'unknown provider cost must not become a fake zero');
  assert.equal(ledger.calls.length, 1, 'unknown provider cost must not terminalise and release the budget reserve');
  assert.equal((await getProductionCostQuote({
    store,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
  }))?.actualCostCny, null, 'persisted quote must preserve unknown cost after a fresh read');

  const reconciled = await failProductionCostQuote({
    store,
    ledger,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
    actualCostCny: 0.18,
    reason: '供应商账单延迟返回',
  });
  assert.equal(reconciled.actualCostCny, 0.18);
  assert.deepEqual(ledger.calls[1]?.actualCost, { status: 'known', settledCostCny: 0.18 });
  assert.equal((await getProductionCostQuote({
    store,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
  }))?.actualCostCny, 0.18, 'late verified cost must be persisted without a second failure record');
  await assert.rejects(failProductionCostQuote({
    store,
    ledger,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
    actualCostCny: 0.19,
    reason: '冲突账单',
  }), /production_cost_failure_reconciliation_conflict/);
});

test('failed quote sends known cost to ledger when provider amount is available', async () => {
  const store = createProductionTestStore();
  const ledger = fakeLedger();
  const created = await createOrReuseProductionCostQuote({
    store,
    tenantId: 'tenant-a',
    quote: quoteInput({ idempotencyKey: 'quote-failed-known-001' }),
  });
  await reserveProductionCostQuote({ store, ledger, tenantId: 'tenant-a', quoteId: created.quote.id });

  const failed = await failProductionCostQuote({
    store,
    ledger,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
    actualCostCny: 0.25,
    reason: '供应商生成失败但已计费',
  });

  assert.equal(failed.actualCostCny, 0.25);
  assert.deepEqual(ledger.calls[1]?.actualCost, { status: 'known', settledCostCny: 0.25 });
  assert.equal((await getProductionCostQuote({
    store,
    tenantId: 'tenant-a',
    quoteId: created.quote.id,
  }))?.actualCostCny, 0.25);
});

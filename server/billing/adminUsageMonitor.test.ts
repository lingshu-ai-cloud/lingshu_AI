import assert from 'node:assert/strict';
import test from 'node:test';
import type { Starter198Repository, StarterRecord } from '../starter198/repository.js';
import { adminUsageMonitorSnapshot } from './adminUsageMonitor.js';

const tenantId = 'tenant-real-usage';

function record(id: string, input: Partial<StarterRecord> = {}): StarterRecord {
  return {
    id,
    tenant_id: tenantId,
    schema_version: 'starter-198.usage.v1',
    run_id: `run-${id}`,
    task_id: `task-${id}`,
    agent_role: 'content',
    capability: 'studio.ai_video',
    reservation_id: `reservation-${id}`,
    event_type: 'terminal',
    state: 'settled',
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_tokens: 20,
      estimated_cost_cny: 0,
      reserved_cost_delta_cny: 0,
      settled_cost_cny: 0.42,
      cost_status: 'known',
      output_count: 1,
    },
    occurred_at: '2026-10-31T04:00:00.000Z',
    ...input,
  };
}

function repository(rows: StarterRecord[]): Starter198Repository {
  return {
    async list(_collection, requestedTenantId, query = {}) {
      const filtered = rows.filter(row => row.tenant_id === requestedTenantId);
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 500;
      return {
        items: filtered.slice((page - 1) * perPage, page * perPage),
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / perPage),
        page,
        perPage,
      };
    },
    async get() { return null; },
    async create() { throw new Error('not used'); },
    async update() { throw new Error('not used'); },
    async access() { throw new Error('not used'); },
  };
}

test('usage monitor totals only provider-measured terminal usage and keeps input/output separate', async () => {
  const rows = [
    record('measured'),
    record('failed-measured', { state: 'failed', usage: {
      input_tokens: 10, output_tokens: 5, cache_tokens: 0,
      estimated_cost_cny: null, reserved_cost_delta_cny: null, settled_cost_cny: null,
      cost_status: 'unknown', output_count: 0,
    } }),
    record('unmeasured', { usage: {
      input_tokens: null, output_tokens: null, cache_tokens: null,
      estimated_cost_cny: null, reserved_cost_delta_cny: null, settled_cost_cny: null,
      cost_status: 'unknown', output_count: 0,
    } }),
    record('reserve', { event_type: 'reserve', state: 'reserved' }),
    record('other-tenant', { tenant_id: 'tenant-other' }),
  ];

  const snapshot = await adminUsageMonitorSnapshot({
    tenantId,
    range: '7d',
    repository: repository(rows),
    now: new Date('2026-10-31T08:00:00.000Z'),
  });

  assert.equal(snapshot.hasMeasuredUsage, true);
  assert.equal(snapshot.totals.inputTokens, 130);
  assert.equal(snapshot.totals.outputTokens, 35);
  assert.equal(snapshot.totals.cacheTokens, 20);
  assert.equal(snapshot.totals.totalTokens, 165);
  assert.equal(snapshot.coverage.measuredTerminalCount, 2);
  assert.equal(snapshot.coverage.unmeasuredTerminalCount, 1);
  assert.equal(snapshot.coverage.failedTerminalCount, 1);
  assert.equal(snapshot.coverage.reserveExcludedCount, 1);
  assert.equal(snapshot.totals.settledCostCny, 0.42);
});

test('usage monitor does not fabricate zero usage when terminal receipts are unmeasured', async () => {
  const snapshot = await adminUsageMonitorSnapshot({
    tenantId,
    range: 'all',
    repository: repository([record('unknown', { usage: {
      input_tokens: null, output_tokens: null, cache_tokens: null,
      estimated_cost_cny: null, reserved_cost_delta_cny: null, settled_cost_cny: null,
      cost_status: 'unknown', output_count: 0,
    } })]),
    now: new Date('2026-10-31T08:00:00.000Z'),
  });

  assert.equal(snapshot.hasMeasuredUsage, false);
  assert.equal(snapshot.coverage.unmeasuredTerminalCount, 1);
  assert.equal(snapshot.totals.measuredEventCount, 0);
});

test('usage monitor applies the selected time window', async () => {
  const snapshot = await adminUsageMonitorSnapshot({
    tenantId,
    range: '7d',
    repository: repository([
      record('recent'),
      record('old', { occurred_at: '2026-09-01T04:00:00.000Z' }),
    ]),
    now: new Date('2026-10-31T08:00:00.000Z'),
  });
  assert.equal(snapshot.coverage.terminalEventCount, 1);
  assert.equal(snapshot.totals.inputTokens, 120);
});

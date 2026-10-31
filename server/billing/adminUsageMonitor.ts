import {
  STARTER_AGENT_ROLES,
  type Starter198Capability,
  type StarterAgentRole,
} from '../../shared/contracts/starter198.js';
import {
  STARTER_COLLECTIONS,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
} from '../starter198/repository.js';
import { parseUsageLedgerRecord } from '../starter198/usage.js';

export type AdminUsageRange = 'today' | '7d' | '30d' | 'all';

const MAX_SCAN_RECORDS = 50_000;
const PAGE_SIZE = 500;
const ROLE_LABELS: Record<StarterAgentRole, string> = {
  orchestrator: '灵小枢',
  content: '灵小图',
  traffic: '灵小量',
  sales: '灵小售',
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  outputCount: number;
  measuredEventCount: number;
  settledCostCny: number;
  knownCostEventCount: number;
};

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
    outputCount: 0,
    measuredEventCount: 0,
    settledCostCny: 0,
    knownCostEventCount: 0,
  };
}

function addMeasured(
  target: UsageTotals,
  usage: NonNullable<ReturnType<typeof parseUsageLedgerRecord>>,
): void {
  if (usage.inputTokens === null || usage.outputTokens === null || usage.cacheTokens === null) return;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheTokens += usage.cacheTokens;
  target.totalTokens += usage.inputTokens + usage.outputTokens;
  target.outputCount += usage.outputCount;
  target.measuredEventCount += 1;
  if (usage.settledCostCny !== null) {
    target.settledCostCny += usage.settledCostCny;
    target.knownCostEventCount += 1;
  }
}

function validTenantId(value: string): boolean {
  return Boolean(value) && value.length <= 200 && /^[a-z0-9:_.\/-]+$/i.test(value);
}

function rangeStart(range: AdminUsageRange, now: Date): Date | null {
  if (range === 'all') return null;
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const days = range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export class AdminUsageMonitorError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = 'AdminUsageMonitorError';
  }
}

export async function adminUsageMonitorSnapshot(input: {
  tenantId: string;
  range: AdminUsageRange;
  repository?: Starter198Repository;
  now?: Date;
}) {
  if (!validTenantId(input.tenantId)) throw new AdminUsageMonitorError('usage_monitor_tenant_invalid', 400);
  if (!['today', '7d', '30d', 'all'].includes(input.range)) {
    throw new AdminUsageMonitorError('usage_monitor_range_invalid', 400);
  }
  const repository = input.repository ?? starter198Repository;
  const now = input.now ?? new Date();
  const start = rangeStart(input.range, now);
  const records: StarterRecord[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await repository.list(STARTER_COLLECTIONS.usage, input.tenantId, {
      sort: '-occurred_at', page, perPage: PAGE_SIZE,
    });
    if (result.totalItems > MAX_SCAN_RECORDS) {
      throw new AdminUsageMonitorError('usage_monitor_scan_limit_exceeded');
    }
    records.push(...result.items);
    totalPages = Math.max(1, result.totalPages || Math.ceil(result.totalItems / PAGE_SIZE));
    page += 1;
  } while (page <= totalPages);

  const totals = emptyTotals();
  const byRole = Object.fromEntries(
    STARTER_AGENT_ROLES.map(role => [role, emptyTotals()]),
  ) as Record<StarterAgentRole, UsageTotals>;
  const byCapability = new Map<Starter198Capability, UsageTotals>();
  const recent: Array<{
    occurredAt: string;
    agentRole: StarterAgentRole;
    roleLabel: string;
    capability: Starter198Capability;
    state: 'settled' | 'failed';
    inputTokens: number | null;
    outputTokens: number | null;
    cacheTokens: number | null;
    totalTokens: number | null;
    outputCount: number;
    settledCostCny: number | null;
  }> = [];
  let reserveExcludedCount = 0;
  let terminalEventCount = 0;
  let unmeasuredTerminalCount = 0;
  let invalidTerminalCount = 0;
  let failedTerminalCount = 0;
  let unknownCostEventCount = 0;

  for (const record of records) {
    if (record.event_type === 'reserve') {
      reserveExcludedCount += 1;
      continue;
    }
    if (record.event_type !== 'terminal') continue;
    const rawOccurredAt = String(record.occurred_at ?? '');
    const occurredAtMs = Date.parse(rawOccurredAt);
    if (start && Number.isFinite(occurredAtMs) && occurredAtMs < start.getTime()) continue;
    if (Number.isFinite(occurredAtMs) && occurredAtMs > now.getTime()) continue;
    terminalEventCount += 1;
    if (record.state !== 'settled' && record.state !== 'failed') {
      invalidTerminalCount += 1;
      continue;
    }
    const usage = parseUsageLedgerRecord(record, input.tenantId);
    if (!usage) {
      invalidTerminalCount += 1;
      continue;
    }
    if (usage.costStatus === 'unknown' || usage.settledCostCny === null) unknownCostEventCount += 1;
    if (record.state === 'failed') failedTerminalCount += 1;
    const measured = usage.inputTokens !== null && usage.outputTokens !== null && usage.cacheTokens !== null;
    if (measured) {
      addMeasured(totals, usage);
      addMeasured(byRole[usage.agentRole], usage);
      const capabilityTotals = byCapability.get(usage.capability) ?? emptyTotals();
      addMeasured(capabilityTotals, usage);
      byCapability.set(usage.capability, capabilityTotals);
    } else {
      unmeasuredTerminalCount += 1;
    }
    if (recent.length < 50) {
      recent.push({
        occurredAt: usage.occurredAt,
        agentRole: usage.agentRole,
        roleLabel: ROLE_LABELS[usage.agentRole],
        capability: usage.capability,
        state: record.state,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheTokens: usage.cacheTokens,
        totalTokens: measured ? usage.inputTokens! + usage.outputTokens! : null,
        outputCount: usage.outputCount,
        settledCostCny: usage.settledCostCny,
      });
    }
  }

  totals.settledCostCny = roundMoney(totals.settledCostCny);
  for (const row of Object.values(byRole)) row.settledCostCny = roundMoney(row.settledCostCny);
  for (const row of byCapability.values()) row.settledCostCny = roundMoney(row.settledCostCny);

  return {
    generatedAt: now.toISOString(),
    source: 'starter_usage_ledger.terminal.provider_measurement',
    tenantId: input.tenantId,
    range: input.range,
    rangeStartedAt: start?.toISOString() ?? null,
    hasMeasuredUsage: totals.measuredEventCount > 0,
    totals,
    coverage: {
      scannedRecordCount: records.length,
      reserveExcludedCount,
      terminalEventCount,
      measuredTerminalCount: totals.measuredEventCount,
      unmeasuredTerminalCount,
      invalidTerminalCount,
      failedTerminalCount,
      unknownCostEventCount,
    },
    byRole: STARTER_AGENT_ROLES.map(role => ({ role, label: ROLE_LABELS[role], ...byRole[role] })),
    byCapability: [...byCapability.entries()]
      .map(([capability, values]) => ({ capability, ...values }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.capability.localeCompare(b.capability)),
    recent,
  };
}

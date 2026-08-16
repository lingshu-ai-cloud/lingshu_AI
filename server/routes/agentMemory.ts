import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';

export const agentMemoryRouter = Router();
agentMemoryRouter.use(requireAuth);

interface StrategyMemoryRecord {
  id: string;
  tenant_id: string;
  strategy_id?: unknown;
  adjustment?: unknown;
  evidence_count?: unknown;
  status?: unknown;
  source?: unknown;
  scenario?: unknown;
  signals?: unknown;
  intent?: unknown;
  strategy_steps?: unknown;
  risk_link?: unknown;
  escalate?: unknown;
  created?: unknown;
  updated?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Explicit allow-list: tenant_id and PocketBase internals must never reach clients. */
export function strategyMemoryToClient(record: StrategyMemoryRecord) {
  return {
    id: record.id,
    strategyId: text(record.strategy_id),
    adjustment: text(record.adjustment),
    evidenceCount: Number.isFinite(Number(record.evidence_count)) ? Number(record.evidence_count) : 0,
    status: text(record.status),
    source: text(record.source),
    scenario: text(record.scenario),
    signals: stringList(record.signals),
    intent: text(record.intent),
    strategySteps: stringList(record.strategy_steps),
    riskLink: text(record.risk_link),
    escalate: text(record.escalate),
    created: text(record.created),
    updated: text(record.updated),
  };
}

agentMemoryRouter.get('/strategies', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<StrategyMemoryRecord>('response_strategy_memory', {
    where: { tenant_id: tenantId },
    sort: '-updated',
    page: 1,
    perPage: 200,
  });

  res.json({
    items: result.items.map(strategyMemoryToClient),
    total: result.totalItems,
  });
});

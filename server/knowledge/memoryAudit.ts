import { store } from '../storage/index.js';

const COLLECTION = 'agent_memory_audit';

export interface MemoryAuditInput {
  tenantId: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  replyId?: string;
  customerId?: string;
  nodeId?: string;
  memoryIds?: string[];
  strategyIds?: string[];
  modelVersion?: string;
  knowledgeVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryAuditRecord {
  id: string;
  tenant_id: string;
  actor_user_id?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  reply_id?: string;
  customer_id?: string;
  node_id?: string;
  memory_ids?: string[] | string;
  strategy_ids?: string[] | string;
  model_version?: string;
  knowledge_version?: string;
  metadata?: Record<string, unknown> | string;
  created_at?: string;
  created?: string;
}

function compactIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map(value => String(value || '').trim()).filter(Boolean))).slice(0, 100);
}

/** Auditing must never make customer reply generation unavailable. */
export async function recordMemoryAudit(input: MemoryAuditInput): Promise<void> {
  if (!input.tenantId || !input.action) return;
  try {
    await store.create(COLLECTION, {
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId || '',
      action: input.action.slice(0, 120),
      target_type: input.targetType || '',
      target_id: input.targetId || '',
      reply_id: input.replyId || '',
      customer_id: input.customerId || '',
      node_id: input.nodeId || '',
      memory_ids: compactIds(input.memoryIds),
      strategy_ids: compactIds(input.strategyIds),
      model_version: input.modelVersion || '',
      knowledge_version: input.knowledgeVersion || '',
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[agent-memory:audit-write-failed]', error);
  }
}

/** Keep lightweight usage counters for tenant strategies; the audit log remains the source of truth. */
export async function touchStrategyUsage(tenantId: string, strategyIds: string[]): Promise<void> {
  const ids = compactIds(strategyIds);
  if (!tenantId || !ids.length) return;
  try {
    const result = await store.list<{ id: string; strategy_id?: string; use_count?: number | string }>(
      'response_strategy_memory',
      { where: { tenant_id: tenantId, status: 'active' }, perPage: 500 },
    );
    const now = new Date().toISOString();
    await Promise.allSettled(result.items
      .filter(item => ids.includes(String(item.strategy_id || '').trim()))
      .map(item => store.update('response_strategy_memory', item.id, {
        use_count: Math.max(0, Number(item.use_count || 0)) + 1,
        last_used_at: now,
      })));
  } catch (error) {
    console.warn('[agent-memory:strategy-usage-write-failed]', error);
  }
}

export function parseAuditJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';

export const DECISION_MEMORY_COLLECTION = 'assistant_decision_memories';
export interface DecisionMemoryScope { tenantId: string; userId: string }
export interface DecisionMemory extends Record<string, unknown> {
  id: string; tenant_id: string; user_id: string; memory_id: string; version: number;
  content: string; status: 'confirmed' | 'revoked'; source_message_id: string;
  confirmed_at: string; created_at: string; expires_at: string; schema_version: string;
}
export class DecisionMemoryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function required(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DecisionMemoryError('invalid_decision_memory_input');
  return value.trim();
}
function scopeWhere(scope: DecisionMemoryScope) {
  return { tenant_id: required(scope.tenantId, 120), user_id: required(scope.userId, 120) };
}
async function latest(scope: DecisionMemoryScope, memoryId: string, dataStore: DataStore) {
  const result = await dataStore.list<DecisionMemory>(DECISION_MEMORY_COLLECTION, {
    where: { ...scopeWhere(scope), memory_id: required(memoryId, 120) }, sort: '-version', perPage: 1, page: 1,
  });
  return result.items.find(row => row.tenant_id === scope.tenantId && row.user_id === scope.userId && row.memory_id === memoryId) ?? null;
}
export interface ConfirmDecisionInput {
  content: string; sourceMessageId: string; explicitlyConfirmed: true; expiresAt?: string;
}
async function append(scope: DecisionMemoryScope, input: ConfirmDecisionInput, memoryId: string, version: number, status: DecisionMemory['status'], dataStore: DataStore) {
  if (input.explicitlyConfirmed !== true) throw new DecisionMemoryError('explicit_user_confirmation_required');
  const where = scopeWhere(scope);
  const expiry = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiry && !Number.isFinite(expiry.getTime())) throw new DecisionMemoryError('invalid_decision_expiry');
  const expiresAt = expiry ? expiry.toISOString() : '';
  const now = new Date().toISOString();
  if (expiresAt && expiresAt <= now) throw new DecisionMemoryError('decision_expiry_must_be_future');
  const row: DecisionMemory = {
    id: createHash('sha256').update(JSON.stringify([where.tenant_id, where.user_id, memoryId, version])).digest('hex').slice(0, 15),
    ...where, memory_id: memoryId, version, content: required(input.content, 2000), status,
    source_message_id: required(input.sourceMessageId, 180), confirmed_at: now, created_at: now,
    expires_at: expiresAt, schema_version: 'assistant-decision-v1',
  };
  // Immutable revision IDs prevent concurrent writers from silently overwriting a decision.
  const existing = await dataStore.getById(DECISION_MEMORY_COLLECTION, row.id);
  if (existing) throw new DecisionMemoryError('decision_version_conflict', 409);
  try {
    const saved = await dataStore.create<DecisionMemory>(DECISION_MEMORY_COLLECTION, row);
    if (!saved) throw new DecisionMemoryError('decision_version_conflict', 409);
    return saved;
  } catch (error) {
    if (await dataStore.getById(DECISION_MEMORY_COLLECTION, row.id)) throw new DecisionMemoryError('decision_version_conflict', 409);
    throw error;
  }
}
/** Invoke only from authenticated explicit confirmation actions, never model extraction. */
export async function recordDecisionMemory(scope: DecisionMemoryScope, input: ConfirmDecisionInput, dataStore: DataStore = store) {
  return append(scope, input, randomUUID(), 1, 'confirmed', dataStore);
}
export async function updateDecisionMemory(scope: DecisionMemoryScope, memoryId: string, expectedVersion: number, input: ConfirmDecisionInput, dataStore: DataStore = store) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new DecisionMemoryError('invalid_decision_version');
  const current = await latest(scope, memoryId, dataStore);
  if (!current) throw new DecisionMemoryError('decision_not_found', 404);
  if (current.version !== expectedVersion) throw new DecisionMemoryError('decision_version_conflict', 409);
  return append(scope, input, memoryId, current.version + 1, 'confirmed', dataStore);
}
export async function revokeDecisionMemory(scope: DecisionMemoryScope, memoryId: string, expectedVersion: number, sourceMessageId: string, dataStore: DataStore = store) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new DecisionMemoryError('invalid_decision_version');
  const current = await latest(scope, memoryId, dataStore);
  if (!current) throw new DecisionMemoryError('decision_not_found', 404);
  if (current.version !== expectedVersion) throw new DecisionMemoryError('decision_version_conflict', 409);
  return append(scope, { content: current.content, sourceMessageId, explicitlyConfirmed: true }, memoryId, current.version + 1, 'revoked', dataStore);
}
/** Recent bounded retrieval; latest lookup prevents old revisions resurrecting revoked decisions. */
export async function listDecisionMemories(scope: DecisionMemoryScope, options: { limit?: number; includeRevoked?: boolean; now?: Date } = {}, dataStore: DataStore = store): Promise<DecisionMemory[]> {
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || !Number.isInteger(options.limit) || options.limit < 1)) throw new DecisionMemoryError('invalid_decision_limit');
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit || 12)));
  const candidates = await dataStore.list<DecisionMemory>(DECISION_MEMORY_COLLECTION, { where: scopeWhere(scope), sort: '-created_at', perPage: 100, page: 1 });
  const keys = [...new Set(candidates.items.filter(row => row.tenant_id === scope.tenantId && row.user_id === scope.userId).map(row => row.memory_id))].slice(0, 20);
  const rows = await Promise.all(keys.map(key => latest(scope, key, dataStore)));
  const now = (options.now || new Date()).toISOString();
  return rows.filter((row): row is DecisionMemory => Boolean(row && (options.includeRevoked || row.status === 'confirmed') && (!row.expires_at || row.expires_at > now))).slice(0, limit);
}

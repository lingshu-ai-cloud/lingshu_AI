import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from './auth.js';
import { store } from '../storage/index.js';
import {
  distillResponseStrategyPreference,
  distillSalesStyleProfile,
  discoverResponseStrategy,
  sanitizeStyleText,
  styleEvidenceReadiness,
  styleMemoryUsable,
  type StyleMemoryRecord,
} from '../knowledge/styleMemory.js';
import {
  CUSTOMER_MEMORY_COLLECTION,
  createCustomerMemory,
  customerMemoryKeyAllowed,
  customerMemoryToClient,
  listCustomerMemories,
  type CustomerMemoryRecord,
  type CustomerMemorySource,
  type CustomerMemoryStatus,
} from '../knowledge/customerMemory.js';
import { parseAuditJson, recordMemoryAudit, type MemoryAuditRecord } from '../knowledge/memoryAudit.js';
import { callLLM } from '../agents/llm.js';

const STYLE_COLLECTION = 'style_memory';
const STRATEGY_COLLECTION = 'response_strategy_memory';
const AUDIT_COLLECTION = 'agent_memory_audit';

export const agentMemoryRouter = Router();
agentMemoryRouter.use(requireAuth);

interface StrategyMemoryRecord {
  id: string;
  tenant_id: string;
  strategy_id?: unknown;
  adjustment?: unknown;
  evidence_count?: unknown;
  evidence_customer_count?: unknown;
  evidence_period_count?: unknown;
  status?: unknown;
  source?: unknown;
  scenario?: unknown;
  signals?: unknown;
  intent?: unknown;
  strategy_steps?: unknown;
  risk_link?: unknown;
  risk_boundary?: unknown;
  escalate?: unknown;
  version?: unknown;
  rollout_percent?: unknown;
  previous_snapshot?: unknown;
  confirmed_at?: unknown;
  last_used_at?: unknown;
  use_count?: unknown;
  created?: unknown;
  updated?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function strategyIds(record: StyleMemoryRecord): string[] {
  return stringList(record.strategy_ids);
}

function evidencePeriodCount(evidence: StyleMemoryRecord[]): number {
  return new Set(evidence.map(item => {
    const date = new Date(text(item.created));
    if (!Number.isFinite(date.getTime())) return '';
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + yearStart.getUTCDay() + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }).filter(Boolean)).size;
}

async function roleForRequest(req: Request, res: Response): Promise<OrganizationRole | null> {
  const { userId, supportAccess } = res.locals as AuthLocals;
  if (supportAccess) return null;
  return requestOrganizationRoleStrict(req.headers.authorization, userId);
}

async function requireMemoryManager(req: Request, res: Response): Promise<boolean> {
  const role = await roleForRequest(req, res);
  if (role !== 'super_admin' && role !== 'admin') {
    res.status(403).json({ error: 'memory_manager_required', message: '只有超级管理员和管理员可以治理企业学习数据。' });
    return false;
  }
  return true;
}

async function tenantRecord<T extends { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
  const record = await store.getById<T>(collection, id);
  return record?.tenant_id === tenantId ? record : null;
}

async function listAllTenantRecords<T>(collection: string, tenantId: string, sort = '-created', limit = 10_000): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; items.length < limit; page += 1) {
    const result = await store.list<T>(collection, { where: { tenant_id: tenantId }, sort, page, perPage: 500 });
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) break;
  }
  return items.slice(0, limit);
}

function learningModelStatus() {
  const configuredFile = text(process.env.DASHSCOPE_API_KEY_FILE) || path.join(os.homedir(), '.config/lingshu/dashscope.key');
  const keyConfigured = Boolean(text(process.env.DASHSCOPE_API_KEY)) || fs.existsSync(configuredFile);
  return {
    backend: 'qwen',
    configured: keyConfigured,
    styleModel: text(process.env.STYLE_MEMORY_MODEL) || 'qwen-plus',
    strategyModel: text(process.env.STRATEGY_LEARNING_MODEL) || text(process.env.STYLE_MEMORY_MODEL) || 'qwen-plus',
    timeoutMs: boundedNumber(process.env.QWEN_REQUEST_TIMEOUT_MS, 30_000, 300_000, 120_000),
    maxRetries: boundedNumber(process.env.QWEN_MAX_RETRIES, 0, 2, 0),
    degradation: '学习失败时保留现有画像和策略；客户回复仍使用确定性兜底，不会因学习服务失败而中断。',
  };
}

function styleEvidenceToClient(record: StyleMemoryRecord) {
  return {
    id: record.id,
    customerId: text(record.customer_id),
    triggerMessage: sanitizeStyleText(record.trigger_message),
    draftOriginal: sanitizeStyleText(record.draft_original),
    finalSent: sanitizeStyleText(record.final_sent),
    edited: Boolean(record.edited),
    category: text(record.category) || 'reply',
    outcome: text(record.outcome),
    strategyIds: strategyIds(record),
    status: text(record.status) || 'confirmed',
    learningScope: text(record.learning_scope) || 'enterprise_style',
    sourceKind: text(record.source_kind) || 'legacy',
    evidenceSource: sanitizeStyleText(record.evidence_source || record.source || '历史员工回复记录'),
    nodeId: text(record.node_id),
    riskLevel: text(record.risk_level),
    diffTags: stringList(record.diff_tags),
    interventionType: text(record.intervention_type),
    outcome3Turn: text(record.outcome_3_turn),
    outcome24h: text(record.outcome_24h),
    finalOutcome: text(record.outcome),
    factLearningAllowed: false,
    expiresAt: text(record.expires_at),
    confirmedAt: text(record.confirmed_at),
    created: text(record.created || record.confirmed_at),
    updated: text(record.updated || record.confirmed_at),
    deletionScope: '仅删除学习证据，不删除原始会话或聊天记录。',
  };
}

/** Explicit allow-list: tenant_id, actor IDs and PocketBase internals never reach clients. */
export function strategyMemoryToClient(record: StrategyMemoryRecord, evidence: StyleMemoryRecord[] = []) {
  return {
    id: record.id,
    strategyId: text(record.strategy_id),
    adjustment: sanitizeStyleText(record.adjustment),
    evidenceCount: Number.isFinite(Number(record.evidence_count)) ? Number(record.evidence_count) : evidence.length,
    evidenceCustomerCount: Number.isFinite(Number(record.evidence_customer_count)) ? Number(record.evidence_customer_count) : new Set(evidence.map(item => item.customer_id).filter(Boolean)).size,
    evidencePeriodCount: Number.isFinite(Number(record.evidence_period_count)) ? Number(record.evidence_period_count) : evidencePeriodCount(evidence),
    status: text(record.status) || 'candidate',
    source: text(record.source),
    scenario: sanitizeStyleText(record.scenario),
    signals: stringList(record.signals).map(sanitizeStyleText),
    intent: sanitizeStyleText(record.intent),
    strategySteps: stringList(record.strategy_steps).map(sanitizeStyleText),
    riskLink: text(record.risk_link),
    riskBoundary: sanitizeStyleText(record.risk_boundary),
    escalate: sanitizeStyleText(record.escalate),
    version: Math.max(1, Number(record.version || 1)),
    rolloutPercent: boundedNumber(record.rollout_percent, 0, 100, text(record.status) === 'active' ? 100 : 0),
    confirmedAt: text(record.confirmed_at),
    lastUsedAt: text(record.last_used_at),
    useCount: Math.max(0, Number(record.use_count || 0)),
    evidence: evidence.slice(0, 5).map(item => ({
      id: item.id,
      customerId: text(item.customer_id),
      nodeId: text(item.node_id),
      buyer: sanitizeStyleText(item.trigger_message).slice(0, 360),
      aiDraft: sanitizeStyleText(item.draft_original).slice(0, 360),
      humanFinal: sanitizeStyleText(item.final_sent).slice(0, 360),
      outcome: text(item.outcome),
      created: text(item.created),
    })),
    created: text(record.created),
    updated: text(record.updated),
  };
}

agentMemoryRouter.get('/overview', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const role = await roleForRequest(req, res);
  const readiness = await styleEvidenceReadiness(tenantId);
  res.json({
    canManage: role === 'super_admin' || role === 'admin',
    role: role || 'read_only',
    model: learningModelStatus(),
    readiness,
    thresholds: {
      styleProfile: { evidence: 20, customers: 3 },
      strategyCandidate: { evidence: 5, customers: 3, timePeriods: 2 },
    },
    governance: {
      customerMemoryIsolated: true,
      factsNeverLearnedFromConversation: true,
      learningDeletionSeparateFromConversationDeletion: true,
      outcomeAssociationIsNotCausation: true,
    },
  });
});

agentMemoryRouter.post('/model-check', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const model = learningModelStatus();
  if (!model.configured) { res.status(503).json({ error: 'learning_model_not_configured', model }); return; }
  const startedAt = Date.now();
  try {
    const answer = await callLLM('Return strict JSON only: {"status":"ok"}. Do not include any other text.', {
      backend: 'qwen', model: model.strategyModel,
    });
    const ok = /"status"\s*:\s*"ok"/i.test(answer);
    await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'learning_model_health_checked', targetType: 'learning_model', modelVersion: model.strategyModel, metadata: { ok, latencyMs: Date.now() - startedAt } });
    res.status(ok ? 200 : 502).json({ ok, latencyMs: Date.now() - startedAt, model });
  } catch (error) {
    await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'learning_model_health_check_failed', targetType: 'learning_model', modelVersion: model.strategyModel, metadata: { latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) } });
    res.status(503).json({ error: 'learning_model_unavailable', latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error), model });
  }
});

agentMemoryRouter.get('/style-evidence', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const items = await listAllTenantRecords<StyleMemoryRecord>(STYLE_COLLECTION, tenantId, '-created');
  res.json({ items: items.map(styleEvidenceToClient), total: items.length, complete: items.length < 10_000 });
});

agentMemoryRouter.patch('/style-evidence/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<StyleMemoryRecord>(STYLE_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'style_evidence_not_found' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const update: Record<string, unknown> = { updated_by: userId };
  if (body.status !== undefined) {
    const next = text(body.status);
    if (!['pending', 'confirmed', 'paused'].includes(next)) { res.status(400).json({ error: 'invalid_style_status' }); return; }
    update.status = next;
    if (next === 'confirmed') {
      update.confirmed_by = userId;
      update.confirmed_at = new Date().toISOString();
    }
  }
  if (body.triggerMessage !== undefined) update.trigger_message = sanitizeStyleText(body.triggerMessage);
  if (body.draftOriginal !== undefined) update.draft_original = sanitizeStyleText(body.draftOriginal);
  if (body.finalSent !== undefined) update.final_sent = sanitizeStyleText(body.finalSent);
  if (body.category !== undefined) update.category = text(body.category).slice(0, 80);
  if (body.expiresAt !== undefined) {
    const expiresAt = text(body.expiresAt);
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) { res.status(400).json({ error: 'invalid_style_evidence_expiry' }); return; }
    update.expires_at = expiresAt;
  }
  const ok = await store.update(STYLE_COLLECTION, record.id, update);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'style_evidence_updated', targetType: 'style_evidence', targetId: record.id, customerId: text(record.customer_id), nodeId: text(record.node_id), metadata: { fields: Object.keys(update), status: update.status, conversationDeleted: false } });
  res.json({ ok });
});

agentMemoryRouter.delete('/style-evidence/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  if (String(req.query.deleteSource || '') === 'true') {
    res.status(409).json({ error: 'separate_conversation_deletion_required', message: '删除学习证据与删除原始会话是两个独立操作。此接口不会删除聊天记录。' });
    return;
  }
  const record = await tenantRecord<StyleMemoryRecord>(STYLE_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'style_evidence_not_found' }); return; }
  const ok = await store.delete(STYLE_COLLECTION, record.id);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'style_evidence_deleted', targetType: 'style_evidence', targetId: record.id, customerId: text(record.customer_id), nodeId: text(record.node_id), metadata: { conversationDeleted: false } });
  res.json({ ok, conversationDeleted: false });
});

agentMemoryRouter.post('/style/relearn', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const model = learningModelStatus();
  if (!model.configured) { res.status(503).json({ error: 'learning_model_not_configured', model }); return; }
  const readiness = await styleEvidenceReadiness(tenantId);
  if (readiness.editedConfirmed < 5 || readiness.customerCount < 3) {
    res.status(409).json({ error: 'insufficient_confirmed_evidence', readiness, required: { evidence: 5, customers: 3 } });
    return;
  }
  try {
    const evidenceResult = await store.list<StyleMemoryRecord>(STYLE_COLLECTION, { where: { tenant_id: tenantId, edited: true }, sort: '-created', perPage: 500 });
    const ids = Array.from(new Set(evidenceResult.items.filter(item => !item.status || item.status === 'confirmed').flatMap(strategyIds)));
    const [profile, discovered, ...preferences] = await Promise.all([
      distillSalesStyleProfile(tenantId, true),
      discoverResponseStrategy(tenantId),
      ...ids.map(id => distillResponseStrategyPreference(tenantId, id)),
    ]);
    await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'manual_relearn_completed', targetType: 'enterprise_learning', modelVersion: model.strategyModel, metadata: { profileUpdated: Boolean(profile), discoveredStrategyId: discovered, adjustedStrategies: preferences.filter(Boolean), readiness } });
    res.json({ ok: true, profileUpdated: Boolean(profile), discoveredStrategyId: discovered, adjustedStrategyIds: ids.filter((_, index) => Boolean(preferences[index])), readiness });
  } catch (error) {
    await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'manual_relearn_failed', targetType: 'enterprise_learning', modelVersion: model.strategyModel, metadata: { message: error instanceof Error ? error.message : String(error) } });
    res.status(503).json({ error: 'learning_model_failed', message: error instanceof Error ? error.message : String(error), model });
  }
});

agentMemoryRouter.get('/customer-memories', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = text(req.query.customerId);
  const items = await listCustomerMemories(tenantId, customerId);
  res.json({ items: items.map(customerMemoryToClient), total: items.length });
});

agentMemoryRouter.post('/customer-memories', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const sourceKind: CustomerMemorySource = body.sourceKind === 'ai_inferred' ? 'ai_inferred' : 'human';
  const requestedStatus: CustomerMemoryStatus = body.status === 'confirmed' ? 'confirmed' : 'pending';
  try {
    const created = await createCustomerMemory({
      tenantId,
      customerId: text(body.customerId),
      key: text(body.key),
      value: text(body.value),
      evidence: text(body.evidence),
      sourceKind,
      status: requestedStatus,
      confidence: boundedNumber(body.confidence, 0, 1, sourceKind === 'human' ? 1 : 0.5),
      expiresAt: text(body.expiresAt),
      actorUserId: userId,
    });
    if (!created) { res.status(503).json({ error: 'customer_memory_create_failed' }); return; }
    await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'customer_memory_created', targetType: 'customer_memory', targetId: created.id, customerId: created.customer_id, memoryIds: [created.id], metadata: { key: created.memory_key, status: created.status, sourceKind: created.source_kind } });
    res.status(201).json({ item: customerMemoryToClient(created) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'customer_memory_invalid' });
  }
});

agentMemoryRouter.patch('/customer-memories/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<CustomerMemoryRecord>(CUSTOMER_MEMORY_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'customer_memory_not_found' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const update: Record<string, unknown> = { updated_by: userId };
  if (body.key !== undefined) {
    if (!customerMemoryKeyAllowed(body.key)) { res.status(400).json({ error: 'customer_memory_key_not_allowed' }); return; }
    update.memory_key = text(body.key);
  }
  if (body.value !== undefined) {
    const value = sanitizeStyleText(body.value).slice(0, 1000);
    if (!value) { res.status(400).json({ error: 'customer_memory_value_required' }); return; }
    update.memory_value = value;
  }
  if (body.evidence !== undefined) update.evidence = sanitizeStyleText(body.evidence).slice(0, 1000);
  if (body.expiresAt !== undefined) {
    const expiresAt = text(body.expiresAt);
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) { res.status(400).json({ error: 'invalid_customer_memory_expiry' }); return; }
    update.expires_at = expiresAt;
  }
  if (body.status !== undefined) {
    const next = text(body.status) as CustomerMemoryStatus;
    if (!['pending', 'confirmed', 'paused'].includes(next)) { res.status(400).json({ error: 'invalid_customer_memory_status' }); return; }
    if (next === 'confirmed' && record.source_kind === 'ai_inferred') {
      const siblings = await listCustomerMemories(tenantId, record.customer_id);
      const human = siblings.find(item => item.id !== record.id && item.memory_key === (text(update.memory_key) || record.memory_key) && item.status === 'confirmed' && item.source_kind === 'human');
      if (human) {
        update.status = 'conflict';
        update.conflict_with = human.id;
      } else update.status = next;
    } else update.status = next;
    if (update.status === 'confirmed') {
      update.confirmed_by = userId;
      update.confirmed_at = new Date().toISOString();
    }
  }
  const ok = await store.update(CUSTOMER_MEMORY_COLLECTION, record.id, update);
  if (ok && update.status === 'confirmed' && record.source_kind !== 'ai_inferred') {
    const siblings = await listCustomerMemories(tenantId, record.customer_id);
    await Promise.all(siblings.filter(item => item.id !== record.id && item.memory_key === (text(update.memory_key) || record.memory_key) && item.status === 'confirmed').map(item => store.update(CUSTOMER_MEMORY_COLLECTION, item.id, { status: 'superseded', superseded_by: record.id, updated_by: userId })));
  }
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'customer_memory_updated', targetType: 'customer_memory', targetId: record.id, customerId: record.customer_id, memoryIds: [record.id], metadata: { fields: Object.keys(update), status: update.status } });
  res.json({ ok });
});

agentMemoryRouter.delete('/customer-memories/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<CustomerMemoryRecord>(CUSTOMER_MEMORY_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'customer_memory_not_found' }); return; }
  const ok = await store.delete(CUSTOMER_MEMORY_COLLECTION, record.id);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'customer_memory_deleted', targetType: 'customer_memory', targetId: record.id, customerId: record.customer_id, memoryIds: [record.id], metadata: { conversationDeleted: false } });
  res.json({ ok, conversationDeleted: false });
});

agentMemoryRouter.get('/strategies', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const [strategyItems, evidenceItems] = await Promise.all([
    listAllTenantRecords<StrategyMemoryRecord>(STRATEGY_COLLECTION, tenantId, '-updated'),
    listAllTenantRecords<StyleMemoryRecord>(STYLE_COLLECTION, tenantId, '-created'),
  ]);
  res.json({
    items: strategyItems.map(item => strategyMemoryToClient(item, evidenceItems.filter(evidence => strategyIds(evidence).includes(text(item.strategy_id))))),
    total: strategyItems.length,
    successRateAvailable: false,
    successRateReason: '尚未完成策略—客户阶段—订单结果的因果归因；仅展示证据和使用记录。',
  });
});

agentMemoryRouter.patch('/strategies/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<StrategyMemoryRecord>(STRATEGY_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'strategy_not_found' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const update: Record<string, unknown> = { updated_by: userId };
  const previous = {
    adjustment: record.adjustment, status: record.status, scenario: record.scenario, signals: record.signals,
    intent: record.intent, strategy_steps: record.strategy_steps, risk_link: record.risk_link,
    risk_boundary: record.risk_boundary, escalate: record.escalate, rollout_percent: record.rollout_percent,
  };
  if (body.status !== undefined) {
    const next = text(body.status);
    if (!['candidate', 'active', 'paused', 'archived'].includes(next)) { res.status(400).json({ error: 'invalid_strategy_status' }); return; }
    if (next === 'active') {
      const allEvidence = await listAllTenantRecords<StyleMemoryRecord>(STYLE_COLLECTION, tenantId, '-created');
      const usableEvidence = allEvidence.filter(item => item.edited && styleMemoryUsable(item) && strategyIds(item).includes(text(record.strategy_id)));
      const evidenceCount = usableEvidence.length;
      const customerCount = new Set(usableEvidence.map(item => text(item.customer_id)).filter(Boolean)).size;
      const periodCount = evidencePeriodCount(usableEvidence);
      if (evidenceCount < 5 || customerCount < 3 || periodCount < 2) {
        res.status(409).json({
          error: 'strategy_evidence_threshold_not_met',
          actual: { evidence: evidenceCount, customers: customerCount, timePeriods: periodCount },
          required: { evidence: 5, customers: 3, timePeriods: 2 },
        });
        return;
      }
      update.evidence_count = evidenceCount;
      update.evidence_customer_count = customerCount;
      update.evidence_period_count = periodCount;
    }
    update.status = next;
    if (next === 'active') {
      update.confirmed_by = userId;
      update.confirmed_at = new Date().toISOString();
      update.rollout_percent = boundedNumber(body.rolloutPercent, 1, 100, text(record.status) === 'candidate' ? 10 : 100);
    }
  }
  if (body.adjustment !== undefined) update.adjustment = sanitizeStyleText(body.adjustment).slice(0, 1200);
  if (body.scenario !== undefined) update.scenario = sanitizeStyleText(body.scenario).slice(0, 240);
  if (body.signals !== undefined) update.signals = stringList(body.signals).map(sanitizeStyleText).slice(0, 20);
  if (body.intent !== undefined) update.intent = sanitizeStyleText(body.intent).slice(0, 500);
  if (body.strategySteps !== undefined) update.strategy_steps = stringList(body.strategySteps).map(sanitizeStyleText).slice(0, 10);
  if (body.riskLink !== undefined) update.risk_link = text(body.riskLink).slice(0, 30);
  if (body.riskBoundary !== undefined) update.risk_boundary = sanitizeStyleText(body.riskBoundary).slice(0, 1000);
  if (body.escalate !== undefined) update.escalate = sanitizeStyleText(body.escalate).slice(0, 500);
  if (body.rolloutPercent !== undefined && update.status !== 'active') update.rollout_percent = boundedNumber(body.rolloutPercent, 0, 100, Number(record.rollout_percent || 0));
  update.previous_snapshot = previous;
  update.version = Math.max(1, Number(record.version || 1)) + 1;
  const ok = await store.update(STRATEGY_COLLECTION, record.id, update);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'strategy_updated', targetType: 'response_strategy', targetId: record.id, strategyIds: [text(record.strategy_id)], metadata: { fields: Object.keys(update), previousVersion: Number(record.version || 1), version: update.version, status: update.status, rolloutPercent: update.rollout_percent } });
  res.json({ ok, version: update.version });
});

agentMemoryRouter.post('/strategies/:id/rollback', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<StrategyMemoryRecord>(STRATEGY_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'strategy_not_found' }); return; }
  const previous = parseAuditJson(record.previous_snapshot);
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) { res.status(409).json({ error: 'strategy_rollback_unavailable' }); return; }
  const currentSnapshot = {
    adjustment: record.adjustment, status: record.status, scenario: record.scenario, signals: record.signals,
    intent: record.intent, strategy_steps: record.strategy_steps, risk_link: record.risk_link,
    risk_boundary: record.risk_boundary, escalate: record.escalate, rollout_percent: record.rollout_percent,
  };
  const ok = await store.update(STRATEGY_COLLECTION, record.id, {
    ...(previous as Record<string, unknown>),
    previous_snapshot: currentSnapshot,
    version: Math.max(1, Number(record.version || 1)) + 1,
    updated_by: userId,
  });
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'strategy_rolled_back', targetType: 'response_strategy', targetId: record.id, strategyIds: [text(record.strategy_id)], metadata: { fromVersion: Number(record.version || 1), toSnapshot: previous } });
  res.json({ ok });
});

agentMemoryRouter.delete('/strategies/:id', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await tenantRecord<StrategyMemoryRecord>(STRATEGY_COLLECTION, req.params.id, tenantId);
  if (!record) { res.status(404).json({ error: 'strategy_not_found' }); return; }
  const ok = await store.delete(STRATEGY_COLLECTION, record.id);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'strategy_deleted', targetType: 'response_strategy', targetId: record.id, strategyIds: [text(record.strategy_id)], metadata: { evidenceDeleted: false, conversationDeleted: false } });
  res.json({ ok, evidenceDeleted: false, conversationDeleted: false });
});

agentMemoryRouter.get('/audit', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<MemoryAuditRecord>(AUDIT_COLLECTION, { where: { tenant_id: tenantId }, sort: '-created_at', page: 1, perPage: 200 });
  res.json({
    items: result.items.map(item => ({
      id: item.id,
      action: text(item.action),
      targetType: text(item.target_type),
      targetId: text(item.target_id),
      replyId: text(item.reply_id),
      customerId: text(item.customer_id),
      nodeId: text(item.node_id),
      memoryIds: stringList(item.memory_ids),
      strategyIds: stringList(item.strategy_ids),
      modelVersion: text(item.model_version),
      knowledgeVersion: text(item.knowledge_version),
      metadata: parseAuditJson(item.metadata),
      createdAt: text(item.created_at || item.created),
    })),
    total: result.totalItems,
  });
});

agentMemoryRouter.get('/backup', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const [styles, customers, strategies] = await Promise.all([
    listAllTenantRecords<StyleMemoryRecord>(STYLE_COLLECTION, tenantId, '-created'),
    listAllTenantRecords<CustomerMemoryRecord>(CUSTOMER_MEMORY_COLLECTION, tenantId, '-created'),
    listAllTenantRecords<StrategyMemoryRecord>(STRATEGY_COLLECTION, tenantId, '-created'),
  ]);
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'tenant_memory_backup_exported', targetType: 'tenant_memory_backup', metadata: { styleCount: styles.length, customerMemoryCount: customers.length, strategyCount: strategies.length } });
  res.setHeader('Content-Disposition', `attachment; filename="agent-memory-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ schemaVersion: 1, sourceTenantId: tenantId, exportedAt: new Date().toISOString(), records: { styleMemory: styles, customerMemory: customers, responseStrategies: strategies } });
});

agentMemoryRouter.post('/backup/restore', async (req, res) => {
  if (!await requireMemoryManager(req, res)) return;
  const { tenantId, userId } = res.locals as AuthLocals;
  const backup = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  if (backup.sourceTenantId !== tenantId || Number(backup.schemaVersion) !== 1) {
    res.status(409).json({ error: 'backup_tenant_mismatch', message: '备份只能恢复到原企业；服务端会强制覆盖 tenant_id，禁止跨企业串数据。' });
    return;
  }
  const records = backup.records && typeof backup.records === 'object' ? backup.records as Record<string, unknown> : {};
  const groups: Array<{ collection: string; items: unknown[] }> = [
    { collection: STYLE_COLLECTION, items: Array.isArray(records.styleMemory) ? records.styleMemory : [] },
    { collection: CUSTOMER_MEMORY_COLLECTION, items: Array.isArray(records.customerMemory) ? records.customerMemory : [] },
    { collection: STRATEGY_COLLECTION, items: Array.isArray(records.responseStrategies) ? records.responseStrategies : [] },
  ];
  let restored = 0;
  for (const group of groups) {
    for (const raw of group.items.slice(0, 5000)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const source = raw as Record<string, unknown>;
      const id = text(source.id);
      const { id: _id, tenant_id: _tenant, created: _created, updated: _updated, collectionId: _collectionId, collectionName: _collectionName, expand: _expand, ...safe } = source;
      const existing = id ? await store.getById<{ id: string; tenant_id: string }>(group.collection, id) : null;
      if (existing && existing.tenant_id !== tenantId) {
        res.status(409).json({ error: 'backup_record_tenant_collision', recordId: id });
        return;
      }
      const payload = { ...safe, tenant_id: tenantId, updated_by: userId };
      const ok = existing ? await store.update(group.collection, id, payload) : Boolean(await store.create(group.collection, payload));
      if (ok) restored += 1;
    }
  }
  await recordMemoryAudit({ tenantId, actorUserId: userId, action: 'tenant_memory_backup_restored', targetType: 'tenant_memory_backup', metadata: { restored, sourceExportedAt: backup.exportedAt } });
  res.json({ ok: true, restored, tenantIsolated: true });
});

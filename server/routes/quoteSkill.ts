import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { requestOrganizationRoleStrict } from './auth.js';
import { applyQuoteDraftPatch, buildQuoteDraft, catalogProductsFromEnterprise, composeQuoteReply } from '../quoteSkill/engine.js';
import type { QuoteSkillDraft } from '../quoteSkill/types.js';

const DRAFT_COLLECTION = 'quote_skill_drafts';
const EVENT_COLLECTION = 'quote_skill_events';
const EDITABLE_FIELDS = new Set(['productName', 'sku', 'quantity', 'unit', 'material', 'deliveryDate', 'destination', 'incoterm', 'packaging', 'drawingVersion', 'unitPrice', 'currency', 'leadTime', 'paymentTerms', 'validityDays']);
const INCOTERMS = new Set(['', 'EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
const CURRENCIES = new Set(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'HKD']);

type StoredDraft = {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: string;
  payload: QuoteSkillDraft | string;
  created_by: string;
  updated_at: string;
};

type QuoteSkillDeps = {
  dataStore?: DataStore;
  authMiddleware?: RequestHandler;
  readEnterpriseProfile?: typeof readTenantEnterpriseProfile;
  enabled?: (tenantId: string) => boolean;
  reportError?: (error: unknown) => void;
  canConfirm?: (req: Request, userId: string) => Promise<boolean>;
};

function draftPayload(record: StoredDraft | null): QuoteSkillDraft | null {
  if (!record) return null;
  const parsed = typeof record.payload === 'string' ? (() => { try { return JSON.parse(record.payload); } catch { return null; } })() : record.payload;
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Partial<QuoteSkillDraft>;
  if (!value.customerId || !value.status) return null;
  const draft = {
    ...value,
    id: record.id,
    revision: Number.isInteger(value.revision) && Number(value.revision) > 0 ? Number(value.revision) : 1,
    version: Number.isInteger(value.version) && Number(value.version) > 0 ? Number(value.version) : 1,
    customerLanguage: String(value.customerLanguage || 'English'),
    incoterm: String(value.incoterm || ''),
    packaging: String(value.packaging || ''),
    drawingVersion: String(value.drawingVersion || ''),
    missingFields: Array.isArray(value.missingFields) ? value.missingFields.map(String) : [],
    blockers: Array.isArray(value.blockers) ? value.blockers.map(String) : [],
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    pricingExplanation: Array.isArray(value.pricingExplanation) ? value.pricingExplanation.map(String) : [],
    clarificationQuestions: Array.isArray(value.clarificationQuestions) ? value.clarificationQuestions.map(String) : [],
  } as QuoteSkillDraft;
  if (!Number.isFinite(draft.quantity) || Number(draft.quantity) <= 0) draft.quantity = null;
  if (!Number.isFinite(draft.unitPrice) || Number(draft.unitPrice) <= 0) draft.unitPrice = null;
  if (!Number.isInteger(draft.validityDays) || draft.validityDays < 1 || draft.validityDays > 365) draft.validityDays = 15;
  draft.subtotal = draft.quantity != null && draft.unitPrice != null ? Number((draft.quantity * draft.unitPrice).toFixed(2)) : null;
  draft.missingFields = [
    !draft.productName ? '具体产品或 SKU' : '',
    draft.quantity == null ? '采购数量' : '',
    !draft.material ? '材料/规格' : '',
    !draft.destination ? '交货地点或港口' : '',
    !draft.incoterm ? '贸易术语' : '',
    !draft.leadTime && !draft.deliveryDate ? '交期' : '',
    !draft.paymentTerms ? '付款条款' : '',
  ].filter(Boolean);
  draft.blockers = draft.blockers.filter(item => {
    if (draft.unitPrice != null && /没有可核验单价|未匹配到企业产品目录|仅人工报价/.test(item)) return false;
    if (/数量低于 MOQ/.test(item)) return false;
    return true;
  });
  if (draft.unitPrice == null && !draft.blockers.some(item => /没有可核验单价/.test(item))) draft.blockers.push('产品目录没有可核验单价');
  if (draft.matchedProduct?.moq != null && draft.quantity != null && draft.quantity < draft.matchedProduct.moq) draft.blockers.push(`数量低于 MOQ ${draft.matchedProduct.moq}`);
  draft.pricingExplanation = [
    draft.matchedProduct
      ? `匹配产品：${draft.matchedProduct.sku ? `${draft.matchedProduct.sku} · ` : ''}${draft.matchedProduct.name}`
      : `产品由人工确认：${draft.productName || '待确认'}`,
    draft.unitPrice != null
      ? `价格来源：${draft.matchedProduct?.priceSource || '人工填写'} ${draft.currency} ${draft.unitPrice}/${draft.unit}`
      : '价格待人工填写，Agent 不猜测单价',
    draft.leadTime || draft.deliveryDate ? `参考交期：${draft.leadTime || draft.deliveryDate}` : '交期待人工确认',
  ];
  const chinese = /^(?:zh|中文|chinese)/i.test(draft.customerLanguage || '');
  draft.clarificationQuestions = (chinese ? [
    !draft.productName ? '请确认具体产品名称或 SKU。' : '',
    draft.quantity == null ? '请问本次需要报价的数量是多少？' : '',
    !draft.material ? '请确认所需材料和关键规格。' : '',
    !draft.destination ? '请确认本次报价的交货地点或港口。' : '',
    !draft.incoterm ? '请确认本次报价使用的贸易术语，例如 EXW、FOB 或 DDP。' : '',
    !draft.leadTime && !draft.deliveryDate ? '请确认目标交期。' : '',
    !draft.paymentTerms ? '请确认期望的付款条款。' : '',
  ] : [
    !draft.productName ? 'Could you confirm the exact product name or SKU?' : '',
    draft.quantity == null ? 'What quantity would you like us to quote?' : '',
    !draft.material ? 'Could you confirm the required material and key specifications?' : '',
    !draft.destination ? 'What named delivery place or port should we use for this quotation?' : '',
    !draft.incoterm ? 'Which Incoterm should we use for this quotation (for example, EXW, FOB or DDP)?' : '',
    !draft.leadTime && !draft.deliveryDate ? 'What is your target lead time or delivery date?' : '',
    !draft.paymentTerms ? 'What payment terms should we use for this quotation?' : '',
  ]).filter(Boolean);
  if (draft.status !== 'confirmed') draft.status = draft.missingFields.length || draft.blockers.length ? 'needs_clarification' : 'ready_for_review';
  return draft;
}

function boundedText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function expectedRevision(body: unknown): number | null {
  const value = body && typeof body === 'object' ? Number((body as Record<string, unknown>).expectedRevision) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function validatePatch(body: unknown): { patch?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_quote_patch' };
  const source = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in source)) continue;
    const value = source[field];
    if (field === 'quantity' || field === 'unitPrice') {
      if (value == null || value === '') { patch[field] = null; continue; }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1_000_000_000) return { error: `${field}_must_be_positive` };
      patch[field] = numeric;
      continue;
    }
    if (field === 'validityDays') {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 365) return { error: 'validity_days_out_of_range' };
      patch[field] = numeric;
      continue;
    }
    const valueText = boundedText(value, field === 'paymentTerms' ? 500 : 200);
    if (field === 'currency' && !CURRENCIES.has(valueText.toUpperCase())) return { error: 'unsupported_currency' };
    if (field === 'incoterm' && !INCOTERMS.has(valueText.toUpperCase())) return { error: 'unsupported_incoterm' };
    patch[field] = field === 'currency' ? valueText.toUpperCase() : valueText;
  }
  return { patch };
}

async function ownedDraft(dataStore: DataStore, id: string, tenantId: string): Promise<{ record: StoredDraft; draft: QuoteSkillDraft } | null> {
  const record = await dataStore.getById<StoredDraft>(DRAFT_COLLECTION, id);
  const draft = draftPayload(record);
  return record && draft && record.tenant_id === tenantId ? { record, draft } : null;
}

async function audit(dataStore: DataStore, input: {
  tenantId: string;
  customerId: string;
  quoteId: string;
  actorId: string;
  action: 'created' | 'updated' | 'confirmed' | 'reply_generated';
  revision: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const created = await dataStore.create(EVENT_COLLECTION, {
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      quote_id: input.quoteId,
      actor_id: input.actorId,
      action: input.action,
      revision: input.revision,
      details: input.details || {},
      created_at: new Date().toISOString(),
    });
    if (!created) console.warn(`[quote-skill] audit write failed: ${input.action} ${input.quoteId}`);
  } catch (error) {
    console.warn(`[quote-skill] audit write failed: ${input.action} ${input.quoteId}`, error);
  }
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
}

function createKeyedLock() {
  const pending = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    pending.set(key, current);
    try { return await current; }
    finally { if (pending.get(key) === current) pending.delete(key); }
  };
}

export function createQuoteSkillRouter(deps: QuoteSkillDeps = {}): Router {
  const router = Router();
  const dataStore = deps.dataStore || store;
  const profileReader = deps.readEnterpriseProfile || readTenantEnterpriseProfile;
  const reportError = deps.reportError || ((error: unknown) => console.error('[quote-skill] request failed', error));
  const canConfirm = deps.canConfirm || (async (req: Request, userId: string) => {
    const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
    return role === 'super_admin' || role === 'admin' || role === 'customer_service';
  });
  const withDraftLock = createKeyedLock();
  router.use(deps.authMiddleware || requireAuth);
  const enabled = deps.enabled || ((tenantId: string) => {
    if (process.env.NODE_ENV === 'production' && process.env.QUOTE_SKILL_ENABLED !== 'true') return false;
    const allowlist = String(process.env.QUOTE_SKILL_TENANT_ALLOWLIST || '').split(/[\s,;]+/).map(value => value.trim()).filter(Boolean);
    return allowlist.length === 0 || allowlist.includes(tenantId);
  });
  router.get('/availability', (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ enabled: enabled(tenantId) });
  });
  router.use((_req, res, next) => {
    const { tenantId } = res.locals as AuthLocals;
    if (!enabled(tenantId)) { res.status(404).json({ error: 'quote_skill_disabled' }); return; }
    next();
  });

  router.get('/customers/:customerId/latest', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const customerId = boundedText(req.params.customerId, 160);
    if (!customerId) { res.status(400).json({ error: 'customer_id_required' }); return; }
    const result = await dataStore.list<StoredDraft>(DRAFT_COLLECTION, {
      where: { tenant_id: tenantId, customer_id: customerId }, sort: '-updated_at', page: 1, perPage: 1,
    });
    res.json({ draft: draftPayload(result.items[0] || null) });
  }));

  router.post('/drafts', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const customerId = boundedText(req.body?.customerId, 160);
    if (!customerId) { res.status(400).json({ error: 'customer_id_required', message: '缺少客户标识。' }); return; }
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.map((value: unknown) => boundedText(value, 4_000)).filter(Boolean).slice(-12) : [];
    if (!messages.length && !boundedText(req.body?.productHint, 200)) {
      res.status(400).json({ error: 'quote_context_required', message: '至少需要一条客户消息或产品信息。' }); return;
    }
    await withDraftLock(`${tenantId}:customer:${customerId}`, async () => {
    const [profile, priorResult] = await Promise.all([
      profileReader(tenantId),
      dataStore.list<StoredDraft>(DRAFT_COLLECTION, { where: { tenant_id: tenantId, customer_id: customerId }, sort: '-updated_at', page: 1, perPage: 1 }),
    ]);
    const previous = draftPayload(priorResult.items[0] || null);
    const draft = buildQuoteDraft({
      customerId,
      customerName: boundedText(req.body?.customerName, 200),
      customerLanguage: boundedText(req.body?.customerLanguage, 40),
      productHint: boundedText(req.body?.productHint, 200),
      messages,
      products: catalogProductsFromEnterprise((profile.products?.items || []) as Array<Record<string, unknown>>),
      rules: profile.bizRules || {},
    });
    draft.version = (previous?.version || 0) + 1;
    if (previous?.id) draft.supersedesId = previous.id;
    const previousUpdatedAt = Date.parse(previous?.updatedAt || '');
    if (Number.isFinite(previousUpdatedAt) && Date.parse(draft.updatedAt) <= previousUpdatedAt) {
      const monotonicTime = new Date(previousUpdatedAt + 1).toISOString();
      draft.createdAt = monotonicTime;
      draft.updatedAt = monotonicTime;
    }
    const created = await dataStore.create<StoredDraft>(DRAFT_COLLECTION, {
      tenant_id: tenantId, customer_id: customerId, status: draft.status, payload: draft, created_by: userId, updated_at: draft.updatedAt,
    });
    const stored = draftPayload(created);
    if (!stored) { res.status(503).json({ error: 'quote_storage_unavailable', message: '报价草稿暂时无法保存。' }); return; }
    await audit(dataStore, { tenantId, customerId, quoteId: stored.id!, actorId: userId, action: 'created', revision: stored.revision, details: { status: stored.status, version: stored.version, supersedesId: stored.supersedesId } });
    res.status(201).json({ draft: stored });
    });
  }));

  router.patch('/drafts/:id', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const id = boundedText(req.params.id, 160);
    await withDraftLock(`${tenantId}:${id}`, async () => {
    const owned = await ownedDraft(dataStore, id, tenantId);
    if (!owned) { res.status(404).json({ error: 'quote_not_found' }); return; }
    if (owned.draft.status === 'confirmed') { res.status(409).json({ error: 'confirmed_quote_immutable', message: '已确认报价不可覆盖，请创建新版本。' }); return; }
    const revision = expectedRevision(req.body);
    if (revision == null) { res.status(400).json({ error: 'expected_revision_required', message: '缺少报价版本，请刷新后重试。' }); return; }
    if (revision !== owned.draft.revision) { res.status(409).json({ error: 'quote_version_conflict', message: '报价已被其他成员更新，请刷新后重试。', draft: owned.draft }); return; }
    const validated = validatePatch(req.body);
    if (!validated.patch) { res.status(400).json({ error: validated.error, message: '报价字段格式不正确。' }); return; }
    const changedFields = Object.keys(validated.patch);
    if (!changedFields.length) { res.status(400).json({ error: 'empty_quote_patch' }); return; }
    const draft = applyQuoteDraftPatch(owned.draft, validated.patch);
    draft.revision = owned.draft.revision + 1;
    const ok = await dataStore.update(DRAFT_COLLECTION, owned.record.id, { status: draft.status, payload: draft, updated_at: draft.updatedAt });
    if (!ok) { res.status(503).json({ error: 'quote_storage_unavailable' }); return; }
    await audit(dataStore, { tenantId, customerId: draft.customerId, quoteId: owned.record.id, actorId: userId, action: 'updated', revision: draft.revision, details: { changedFields, status: draft.status } });
    res.json({ draft: { ...draft, id: owned.record.id } });
    });
  }));

  router.post('/drafts/:id/confirm', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const id = boundedText(req.params.id, 160);
    await withDraftLock(`${tenantId}:${id}`, async () => {
    const owned = await ownedDraft(dataStore, id, tenantId);
    if (!owned) { res.status(404).json({ error: 'quote_not_found' }); return; }
    if (owned.draft.status === 'confirmed') {
      res.json({ draft: owned.draft, safety: { action: 'formal_quote', risk: 'L4', autoSendAllowed: false } }); return;
    }
    if (!await canConfirm(req, userId)) {
      res.status(403).json({ error: 'quote_confirmation_forbidden', message: '当前角色无权确认正式报价。' }); return;
    }
    const revision = expectedRevision(req.body);
    if (revision == null) { res.status(400).json({ error: 'expected_revision_required', message: '缺少报价版本，请刷新后重试。' }); return; }
    if (revision !== owned.draft.revision) { res.status(409).json({ error: 'quote_version_conflict', message: '报价已被其他成员更新，请刷新后重试。', draft: owned.draft }); return; }
    if (owned.draft.missingFields.length || owned.draft.blockers.length || owned.draft.unitPrice == null || owned.draft.unitPrice <= 0 || owned.draft.quantity == null || owned.draft.quantity <= 0) {
      res.status(409).json({ error: 'quote_not_ready', message: '请先补齐报价信息并处理风险项。', draft: owned.draft }); return;
    }
    const now = new Date().toISOString();
    const draft: QuoteSkillDraft = { ...owned.draft, revision: owned.draft.revision + 1, status: 'confirmed', humanConfirmationRequired: true, confirmedBy: userId, confirmedAt: now, updatedAt: now };
    const ok = await dataStore.update(DRAFT_COLLECTION, owned.record.id, { status: draft.status, payload: draft, updated_at: now });
    if (!ok) { res.status(503).json({ error: 'quote_storage_unavailable' }); return; }
    await audit(dataStore, { tenantId, customerId: draft.customerId, quoteId: owned.record.id, actorId: userId, action: 'confirmed', revision: draft.revision, details: { subtotal: draft.subtotal, currency: draft.currency } });
    res.json({ draft: { ...draft, id: owned.record.id }, safety: { action: 'formal_quote', risk: 'L4', autoSendAllowed: false } });
    });
  }));

  router.post('/drafts/:id/reply', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const owned = await ownedDraft(dataStore, boundedText(req.params.id, 160), tenantId);
    if (!owned) { res.status(404).json({ error: 'quote_not_found' }); return; }
    if (owned.draft.status !== 'confirmed') { res.status(409).json({ error: 'quote_not_confirmed', message: '报价经人工确认后才能生成对外回复。' }); return; }
    const reply = composeQuoteReply(owned.draft);
    await audit(dataStore, { tenantId, customerId: owned.draft.customerId, quoteId: owned.record.id, actorId: userId, action: 'reply_generated', revision: owned.draft.revision, details: { replyLength: reply.length } });
    res.json({ reply, safety: { action: 'formal_quote', risk: 'L4', autoSendAllowed: false } });
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    reportError(error);
    res.status(500).json({ error: 'quote_skill_internal_error', message: '报价能力暂时不可用，请稍后重试。' });
  });
  return router;
}

export const quoteSkillRouter = createQuoteSkillRouter();

import { Router } from 'express';
import { enforceSupportSessionReadOnly, requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { resolveCrawlStrategy } from '../lib/crawlKeywords.js';
import { buildSocialCrawlStrategy, type SocialSceneClusterInput } from '../../shared/socialInspirationStrategy.js';
import { buildDiscoverySummary, nextDiscoveryRunAt, normalizeModePolicies } from '../socialDiscovery/domain.js';
import { ensureSocialDiscoveryCollectionTask } from './scheduler.js';
import { DISCOVERY_RUN_COLLECTION, DISCOVERY_SCOPE_COLLECTION, executeApprovedDiscoveryRun, loadActiveDiscoveryScope, type DiscoveryScopeRecord } from '../socialDiscovery/service.js';
import type {
  SocialAccountTrackingDecision,
  SocialAudienceRole,
  SocialCompanyRole,
  SocialCrawlStrategy,
  SocialDiscoveryMode,
  SocialKeywordEvidenceSource,
  SocialInspirationCollectionRun,
  SocialBenchmarkAccountType,
} from '../../shared/contracts/socialContentWorkflow.js';

export const socialDiscoveryRouter = Router();
socialDiscoveryRouter.use(requireAuth);
socialDiscoveryRouter.use(enforceSupportSessionReadOnly);

const ACCOUNT_COLLECTION = 'social_tracked_accounts';

function unique(values: unknown, limit = 30): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function companyRole(value: unknown): SocialCompanyRole {
  return ['factory', 'brand', 'importer', 'distributor', 'retailer'].includes(String(value))
    ? value as SocialCompanyRole
    : 'brand';
}

function audienceRole(value: unknown): SocialAudienceRole {
  return ['brand_buyer', 'importer', 'distributor', 'retailer', 'consumer'].includes(String(value))
    ? value as SocialAudienceRole
    : 'consumer';
}

function discoveryModes(value: unknown): SocialDiscoveryMode[] {
  const modes = unique(value).filter((mode): mode is SocialDiscoveryMode => ['momentum', 'account', 'innovation'].includes(mode));
  return modes.length ? modes : ['momentum', 'account', 'innovation'];
}

function benchmarkAccounts(value: unknown): Array<{ accountRef: string; type: SocialBenchmarkAccountType; weight?: number }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(entry => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : { accountRef: entry };
    const accountRef = String(item.accountRef || '').trim();
    if (!accountRef) return [];
    const type = ['brand', 'factory', 'distributor', 'retailer', 'creator', 'media'].includes(String(item.type))
      ? item.type as SocialBenchmarkAccountType
      : 'brand';
    const weight = Number(item.weight);
    return [{ accountRef, type, ...(Number.isFinite(weight) ? { weight: Math.max(0, Math.min(1, weight)) } : {}) }];
  });
}

const latestScope = loadActiveDiscoveryScope;

async function derivedScope(tenantId: string): Promise<SocialCrawlStrategy> {
  const profile = await readTenantEnterpriseProfile(tenantId);
  return resolveCrawlStrategy({
    explicit: '',
    profile,
    platforms: ['tiktok', 'instagram', 'youtube', 'facebook'],
    businessGoal: '发现与当前产品、市场和沟通对象相符，并可迁移到生产的内容机会',
  });
}

socialDiscoveryRouter.get('/scope', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const existing = await latestScope(tenantId);
    const strategy = existing?.payload ?? await derivedScope(tenantId);
    res.json({
      scope: strategy,
      persisted: Boolean(existing),
      needsConfirmation: !existing || strategy.keywordSet.status !== 'active' || strategy.approval?.status !== 'approved',
    });
  } catch (error) {
    res.status(422).json({
      error: 'discovery_scope_unavailable',
      message: error instanceof Error ? error.message : '无法从企业资料建立发现范围',
    });
  }
});

socialDiscoveryRouter.put('/scope', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const body = (req.body || {}) as Record<string, unknown>;
  const productTerms = unique(body.productTerms?.valueOf ? body.productTerms : [], 8);
  const primaryProduct = String(body.productRef || '').trim();
  if (primaryProduct) productTerms.unshift(primaryProduct);
  const products = [...new Set(productTerms)].slice(0, 8);
  if (!products.length) {
    res.status(400).json({ error: 'product_required', message: '请至少选择一个真实产品，不能用行业占位词代替。' });
    return;
  }
  const market = String(body.market || '').trim();
  const language = String(body.language || '').trim();
  if (!market || !language) {
    res.status(400).json({ error: 'market_language_required', message: '请确认目标市场和内容语言。' });
    return;
  }

  const scenes = Array.isArray(body.sceneClusters) ? body.sceneClusters : [];
  const sceneClusters: SocialSceneClusterInput[] = scenes.slice(0, 20).map((entry, index) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const label = String(item.label || '').trim();
    return {
      label,
      productTask: String(item.productTask || products[0] || '').trim(),
      demandDimension: ['audience', 'scene', 'problem', 'desired_result', 'decision_concern', 'mechanism', 'proof'].includes(String(item.demandDimension))
        ? item.demandDimension as SocialSceneClusterInput['demandDimension']
        : 'scene',
      queryVariants: unique(item.queryVariants).length ? unique(item.queryVariants) : [label],
      evidence: ['user'] as SocialKeywordEvidenceSource[],
      status: item.status === 'watching' ? 'watching' as const : 'approved' as const,
    };
  }).filter(item => item.label);

  const previous = await latestScope(tenantId);
  const strategy = buildSocialCrawlStrategy({
    businessGoal: String(body.businessGoal || '发现与当前产品、市场和沟通对象相符，并可迁移到生产的内容机会').trim(),
    productTerms: products,
    sceneClusters,
    competitorTerms: unique(body.competitorTerms, 20),
    benchmarkAccounts: benchmarkAccounts(body.benchmarkAccounts),
    platforms: unique(body.platforms, 4).length ? unique(body.platforms, 4) : ['tiktok', 'instagram', 'youtube', 'facebook'],
    market,
    language,
    companyRole: companyRole(body.companyRole),
    audienceRole: audienceRole(body.audienceRole),
    lookbackDays: Number(body.lookbackDays || 7),
    resultLimit: Number(body.resultLimit || 30),
    budgetLimitCny: body.budgetLimitCny === null || body.budgetLimitCny === '' ? null : Number(body.budgetLimitCny),
    productionGap: String(body.productionGap || '').trim() || null,
  });
  strategy.keywordSet.createdBy = 'user';
  strategy.keywordSet.version = Math.max(1, Number(previous?.version || 0) + 1);
  strategy.discoveryBrief.keywordSetVersion = strategy.keywordSet.version;
  strategy.discoveryBrief.discoveryModes = discoveryModes(body.discoveryModes);
  strategy.discoveryBrief.modePolicies = normalizeModePolicies(body.modePolicies, strategy.discoveryBrief.discoveryModes, strategy.discoveryBrief.resultLimit, strategy.discoveryBrief.platforms);
  strategy.discoveryBrief.createdBy = 'director_agent';
  strategy.createdBy = 'user';
  strategy.approval = { status: 'approved', approvedBy: 'user', approvedAt: new Date().toISOString(), scopeVersion: strategy.keywordSet.version };

  const now = new Date().toISOString();
  const data = {
    tenant_id: tenantId,
    keyword_set_id: strategy.keywordSet.keywordSetId,
    version: strategy.keywordSet.version,
    status: 'active',
    payload: strategy,
    created_by: userId,
    created_at: now,
    updated_at: now,
  };
  if (previous) await store.update(DISCOVERY_SCOPE_COLLECTION, previous.id, { status: 'retired', updated_at: now });
  const saved = await store.create<DiscoveryScopeRecord>(DISCOVERY_SCOPE_COLLECTION, data);
  if (!saved && previous) await store.update(DISCOVERY_SCOPE_COLLECTION, previous.id, { status: 'active', updated_at: previous.updated_at });
  if (!saved) {
    res.status(503).json({ error: 'discovery_scope_storage_unavailable', message: '发现范围暂时无法保存，请稍后重试。' });
    return;
  }
  ensureSocialDiscoveryCollectionTask({ tenantId, discoveryScopeId: saved.id, discoveryScopeVersion: saved.version });
  res.json({ scope: strategy, persisted: true, needsConfirmation: false });
});

socialDiscoveryRouter.get('/accounts', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<SocialAccountTrackingDecision & { id: string }>(ACCOUNT_COLLECTION, {
    where: { tenant_id: tenantId }, sort: '-updated_at', page: 1, perPage: 200,
  });
  res.json({ items: result.items });
});

socialDiscoveryRouter.put('/accounts/:accountId/decision', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const accountId = String(req.params.accountId || '').trim();
  const body = (req.body || {}) as Partial<SocialAccountTrackingDecision>;
  if (!accountId || !['trial', 'track', 'watch', 'stop'].includes(String(body.decision))) {
    res.status(400).json({ error: 'invalid_account_decision' });
    return;
  }
  if (body.decision === 'track' && (!unique(body.reasons).length || !unique(body.evidenceVideoIds).length)) {
    res.status(422).json({ error: 'account_promotion_evidence_required', message: '晋级长期对标前必须提交理由和真实内容证据。' });
    return;
  }
  // Director recommendations are evidence, not authority to promote an account.
  // A track recommendation remains in trial until the Business Agent confirms it.
  const status = body.decision === 'track' ? 'trial' : body.decision === 'watch' ? 'watching' : body.decision === 'stop' ? 'stopped' : 'trial';
  const decision: SocialAccountTrackingDecision = {
    accountId,
    decision: body.decision as SocialAccountTrackingDecision['decision'],
    status,
    accountRole: body.accountRole ?? 'expression_reference',
    reasons: unique(body.reasons),
    evidenceVideoIds: unique(body.evidenceVideoIds),
    relatedSceneIds: unique(body.relatedSceneIds),
    missingEvidence: unique(body.missingEvidence),
    nextReviewAt: body.nextReviewAt,
    recommendedCadence: body.recommendedCadence,
    confidence: Math.max(0, Math.min(1, Number(body.confidence || 0))),
    recommendedBy: 'director_agent',
    businessConfirmation: body.decision === 'track'
      ? { status: 'pending', confirmedBy: null, decisionRef: null, reason: null, confirmedAt: null }
      : undefined,
  };
  const existing = await store.list<{ id: string }>(ACCOUNT_COLLECTION, { where: { tenant_id: tenantId, accountId }, page: 1, perPage: 1 });
  const record = { tenant_id: tenantId, ...decision, updated_by: userId, updated_at: new Date().toISOString() };
  const saved = existing.items[0]
    ? await store.update(ACCOUNT_COLLECTION, existing.items[0].id, record)
    : Boolean(await store.create(ACCOUNT_COLLECTION, record));
  if (!saved) {
    res.status(503).json({ error: 'account_decision_storage_unavailable' });
    return;
  }
  res.json({ item: decision });
});

socialDiscoveryRouter.post('/accounts/:accountId/business-confirmation', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const accountId = String(req.params.accountId || '').trim();
  const approved = (req.body as { approved?: unknown })?.approved;
  const decisionRef = String((req.body as { businessDecisionRef?: unknown })?.businessDecisionRef || '').trim();
  const reason = String((req.body as { reason?: unknown })?.reason || '').trim();
  if (!accountId || typeof approved !== 'boolean' || !decisionRef) {
    res.status(400).json({ error: 'invalid_business_confirmation', message: '经营 Agent 必须明确确认或拒绝账号晋级。' });
    return;
  }
  const existing = await store.list<(SocialAccountTrackingDecision & { id: string })>(ACCOUNT_COLLECTION, {
    where: { tenant_id: tenantId, accountId }, page: 1, perPage: 1,
  });
  const record = existing.items[0];
  if (!record || record.decision !== 'track' || record.businessConfirmation?.status !== 'pending') {
    res.status(409).json({ error: 'account_not_pending_confirmation' });
    return;
  }
  const now = new Date().toISOString();
  const confirmation = { status: approved ? 'confirmed' as const : 'rejected' as const, confirmedBy: 'business_agent' as const, decisionRef, reason: reason || null, confirmedAt: now };
  const item = { ...record, status: approved ? 'tracked' as const : 'trial' as const, businessConfirmation: confirmation };
  const saved = await store.update(ACCOUNT_COLLECTION, record.id, { status: item.status, businessConfirmation: confirmation, updated_by: userId, updated_at: now });
  if (!saved) return void res.status(503).json({ error: 'account_confirmation_storage_unavailable' });
  res.json({ item });
});

socialDiscoveryRouter.get('/runs', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<SocialInspirationCollectionRun & { id: string; tenant_id: string }>(DISCOVERY_RUN_COLLECTION, {
    where: { tenant_id: tenantId }, sort: '-startedAt', page: Math.max(1, Number(req.query.page || 1)), perPage: Math.min(100, Math.max(1, Number(req.query.perPage || 30))),
  });
  res.json(result);
});

socialDiscoveryRouter.get('/summary', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scope = await latestScope(tenantId);
  if (!scope) return void res.status(404).json({ error: 'discovery_scope_not_found' });
  const [runs, accounts] = await Promise.all([
    store.list<SocialInspirationCollectionRun>(DISCOVERY_RUN_COLLECTION, { where: { tenant_id: tenantId, keywordSetId: scope.keyword_set_id }, sort: '-startedAt', page: 1, perPage: 200 }),
    store.list<SocialAccountTrackingDecision>(ACCOUNT_COLLECTION, { where: { tenant_id: tenantId }, page: 1, perPage: 200 }),
  ]);
  const summary = buildDiscoverySummary({
    keywordSetId: scope.keyword_set_id,
    keywordSetVersion: scope.version,
    runs: runs.items,
    nextRunAt: nextDiscoveryRunAt(scope.payload.discoveryBrief, runs.items),
    enabledModes: scope.payload.discoveryBrief.discoveryModes.filter(mode => scope.payload.discoveryBrief.modePolicies?.[mode]?.enabled),
    pendingBusinessConfirmations: accounts.items.filter(item => item.businessConfirmation?.status === 'pending').length,
  });
  res.json({ summary });
});

socialDiscoveryRouter.post('/runs', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = (req.body || {}) as { discoveryModes?: unknown; triggerType?: unknown };
  if (body.triggerType === 'scheduled') return void res.status(403).json({ error: 'scheduled_trigger_internal_only' });
  try {
    const requestedModes = Array.isArray(body.discoveryModes) ? discoveryModes(body.discoveryModes) : undefined;
    const result = await executeApprovedDiscoveryRun({ tenantId, triggerType: body.triggerType === 'production_gap' ? 'production_gap' : 'manual', requestedModes });
    res.status(result.run ? 201 : 200).json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'discovery_run_failed';
    const status = code === 'discovery_scope_not_found' ? 404 : code === 'discovery_scope_not_approved' ? 409 : code.startsWith('discovery_run_scope_invalid') ? 422 : 503;
    res.status(status).json({ error: code });
  }
});

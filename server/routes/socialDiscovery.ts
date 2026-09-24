import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { resolveCrawlStrategy } from '../lib/crawlKeywords.js';
import { buildSocialCrawlStrategy, type SocialSceneClusterInput } from '../../shared/socialInspirationStrategy.js';
import type {
  SocialAccountTrackingDecision,
  SocialAudienceRole,
  SocialCompanyRole,
  SocialCrawlStrategy,
  SocialDiscoveryMode,
  SocialKeywordEvidenceSource,
} from '../../shared/contracts/socialContentWorkflow.js';

export const socialDiscoveryRouter = Router();
socialDiscoveryRouter.use(requireAuth);

const SCOPE_COLLECTION = 'social_discovery_scopes';
const ACCOUNT_COLLECTION = 'social_tracked_accounts';

type ScopeRecord = {
  id: string;
  tenant_id: string;
  keyword_set_id: string;
  version: number;
  status: 'active' | 'retired';
  payload: SocialCrawlStrategy;
  created_by: string;
  created_at: string;
  updated_at: string;
};

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

async function latestScope(tenantId: string): Promise<ScopeRecord | null> {
  const result = await store.list<ScopeRecord>(SCOPE_COLLECTION, {
    where: { tenant_id: tenantId, status: 'active' },
    sort: '-updated_at',
    page: 1,
    perPage: 1,
  });
  return result.items[0] ?? null;
}

async function derivedScope(tenantId: string): Promise<SocialCrawlStrategy> {
  const profile = await readTenantEnterpriseProfile(tenantId);
  return resolveCrawlStrategy({
    explicit: '',
    profile,
    platforms: ['tiktok', 'instagram', 'youtube'],
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
      needsConfirmation: strategy.keywordSet.status !== 'active',
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
    platforms: unique(body.platforms, 4).length ? unique(body.platforms, 4) : ['tiktok', 'instagram', 'youtube'],
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
  strategy.discoveryBrief.createdBy = 'director_agent';
  strategy.createdBy = 'user';

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
  if (previous) await store.update(SCOPE_COLLECTION, previous.id, { status: 'retired', updated_at: now });
  const saved = Boolean(await store.create(SCOPE_COLLECTION, data));
  if (!saved && previous) await store.update(SCOPE_COLLECTION, previous.id, { status: 'active', updated_at: previous.updated_at });
  if (!saved) {
    res.status(503).json({ error: 'discovery_scope_storage_unavailable', message: '发现范围暂时无法保存，请稍后重试。' });
    return;
  }
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
  const status = body.decision === 'track' ? 'tracked' : body.decision === 'watch' ? 'watching' : body.decision === 'stop' ? 'stopped' : 'trial';
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

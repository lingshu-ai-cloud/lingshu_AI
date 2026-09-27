import { discoveryCatalog } from '../lib/discoveryCatalog.js';
import { discoveryPerspective, generateProductKeywords } from '../lib/productDiscovery.js';
import { fiveProductKeywords } from '../../shared/productDiscovery.js';
import { Router } from 'express';
import { recommendDiscoveryKeywords } from '../lib/discoveryRecommendations.js';
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

socialDiscoveryRouter.get('/product-sources', async (_req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ products: discoveryCatalog(await readTenantEnterpriseProfile(tenantId)) });
  } catch { res.status(503).json({ message: '企业产品目录暂时无法读取，请重试。' }); }
});

socialDiscoveryRouter.post('/product-keywords', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = req.body || {};
  if (typeof body.market !== 'string' || !body.market.trim() || typeof body.language !== 'string' || !body.language.trim()) {
    res.status(400).json({ message: '请先确认目标市场和内容语言。' }); return;
  }
  if (body.documentText !== undefined && (typeof body.documentText !== 'string' || body.documentText.length > 80000)) {
    res.status(400).json({ message: '资料文字过多，请按产品方向拆分。' }); return;
  }
  try {
    const profile = await readTenantEnterpriseProfile(tenantId);
    const source = body.documentText?.trim() || JSON.stringify({ product: body.productRef, products: profile.products.items?.map(item => ({ name: item.name, category: item.category, highlights: item.highlights })) });
    if (source.length < 10 || source.length > 80000) { res.status(400).json({ message: '请上传适量产品资料或补全企业产品信息。' }); return; }
    const perspective = discoveryPerspective(String(body.companyRole || profile.company.companyType || ''), profile.socialStrategy?.enabledRoutes ?? []);
    let sourceRefs: string[] | undefined;
    if (Array.isArray(body.sourceRefs) && body.sourceRefs.length) {
      const catalog = discoveryCatalog(profile);
      const allowed = new Set(catalog.flatMap(product => [product.id, ...product.files.map(file => file.id)]));
      const refs = body.sourceRefs.filter((id: unknown): id is string => typeof id === 'string');
      if (refs.length !== body.sourceRefs.length || refs.some((id: string) => !allowed.has(id))) { res.status(400).json({ message: '所选产品资料已变化，请刷新目录重新选择。' }); return; }
      sourceRefs = refs;
    }
    const result = await generateProductKeywords({ source, sourceName: String(body.sourceName || '企业产品资料').slice(0, 180), perspective, market: body.market.slice(0, 100), language: body.language.slice(0, 100), focus: String(body.focus || '').slice(0, 300) });
    if (sourceRefs) result.sourceRefs = sourceRefs;
    res.json(result);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error && error.message.startsWith('未生成') ? error.message : '产品关键词生成失败，请稍后重试。' });
  }
});

socialDiscoveryRouter.post('/recommend', async (req, res) => {
  const body = req.body || {};
  if (![body.productRef, body.market, body.language].every(value => typeof value === 'string' && value.trim())) {
    res.status(400).json({ message: '请先填写主产品、目标市场和内容语言。' }); return;
  }
  try {
    const recommendations = await recommendDiscoveryKeywords({
      productRef: body.productRef.slice(0, 300), market: body.market.slice(0, 100), language: body.language.slice(0, 100),
      companyRole: companyRole(body.companyRole), audienceRole: audienceRole(body.audienceRole),
      scenes: unique(body.scenes, 20),
    });
    res.json(recommendations);
  } catch {
    res.status(502).json({ message: '推荐关键词暂时生成失败，请重试；已保存范围未改变。' });
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

  let approvedQueries: string[] | undefined;
  if (body.keywordRecommendation) {
    try { approvedQueries = fiveProductKeywords(body.keywordRecommendation as import('../../shared/productDiscovery.js').ProductKeywordRecommendation); }
    catch { res.status(400).json({ message: '请确认2个大词和3个中词，搜索词不能为空或重复。' }); return; }
  }
  const previous = await latestScope(tenantId);
  const strategy = buildSocialCrawlStrategy({
    businessGoal: String(body.businessGoal || '发现与当前产品、市场和沟通对象相符，并可迁移到生产的内容机会').trim(),
    productTerms: products,
    sceneClusters: approvedQueries ? [] : sceneClusters,
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
  if (approvedQueries) strategy.keywordRecommendation = body.keywordRecommendation as import('../../shared/productDiscovery.js').ProductKeywordRecommendation;
  const productQueries = approvedQueries ?? unique(body.productQueries, 5);
  if (productQueries.length) {
    strategy.keywordSet.graph.discoverySeeds = strategy.keywordSet.graph.discoverySeeds.slice(0, 1);
    strategy.keywordSet.graph.discoverySeeds[0].queryVariants = productQueries;
    strategy.keywords.find(item => item.category === 'discovery_seed')!.values = productQueries;
  }
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

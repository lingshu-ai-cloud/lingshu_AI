export const ENTERPRISE_ONBOARDING_SCHEMA_VERSION = 'enterprise-onboarding.v1' as const;

export type EnterpriseOnboardingSource = 'user_provided' | 'system_detected' | 'ai_suggested';
export type EnterpriseOnboardingStep = 1 | 2 | 3 | 4;
export type EnterpriseOnboardingContentStage = 'b2b_launch' | 'b2b_growth' | 'd2c_brand';

export const enterpriseOnboardingSourceLabel: Record<EnterpriseOnboardingSource, string> = {
  user_provided: '用户已提供',
  system_detected: '系统识别',
  ai_suggested: 'AI 建议',
};

export const enterpriseOnboardingFieldKeys = [
  'companyName', 'brandName', 'industry', 'primaryBusiness', 'companyIntro', 'brandTone',
  'products', 'focusProducts', 'targetMarket', 'targetBuyer', 'primaryPlatform', 'language',
  'contentStage', 'primaryCta',
] as const;

export type EnterpriseOnboardingFieldKey = typeof enterpriseOnboardingFieldKeys[number];

export type EnterpriseOnboardingAsset = {
  name: string;
  type: string;
  size: number;
  updatedAt: string;
  url?: string;
  sha256?: string;
};

export type EnterpriseOnboardingEvidenceRef = {
  id: string;
  kind: 'source_document';
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  url: string;
  capturedAt: string;
  status: 'uploaded';
};

export type EnterpriseOnboardingDataCoverage = {
  enterpriseIdentity: boolean;
  productProfile: boolean;
  targetMarket: boolean;
  operatingHistory: boolean;
  note: string;
};

export type EnterpriseOnboardingFocusProductProposal = {
  productId: string;
  category: string;
  highlights: string;
  description: string;
  reason: string;
  confidence: number;
  sourceRefs: string[];
};

export type EnterpriseOnboardingProposalSet = {
  schemaVersion: 'enterprise-onboarding-proposals.v1';
  inputHash: string;
  generatedAt: string;
  companyIntro: { value: string; confidence: number; sourceRefs: string[] };
  brandTone: { value: string; confidence: number; sourceRefs: string[] };
  focusProducts: EnterpriseOnboardingFocusProductProposal[];
  market: {
    targetBuyer: string;
    primaryPlatform: string;
    language: string;
    reason: string;
    confidence: number;
    sourceRefs: string[];
    coverage: EnterpriseOnboardingDataCoverage;
  };
};

export type EnterpriseOnboardingProduct = {
  id: string;
  productId?: string;
  sku?: string;
  name: string;
  category?: string;
  description?: string;
  highlights?: string;
  brand?: string;
  material?: string;
  imageUrl?: string;
  priceRange?: string;
  tagPrice?: string;
  retailPrice?: string;
  moq?: string;
  certifications?: string;
  color?: string;
  size?: string;
  attributes?: Record<string, unknown>;
  images?: EnterpriseOnboardingAsset[];
  videos?: EnterpriseOnboardingAsset[];
  documents?: EnterpriseOnboardingAsset[];
  factoryImages?: EnterpriseOnboardingAsset[];
  packagingImages?: EnterpriseOnboardingAsset[];
  certificateImages?: EnterpriseOnboardingAsset[];
  sceneImages?: EnterpriseOnboardingAsset[];
  brandAssets?: EnterpriseOnboardingAsset[];
};

export type EnterpriseOnboardingDraft = {
  schemaVersion: typeof ENTERPRISE_ONBOARDING_SCHEMA_VERSION;
  revision: number;
  currentStep: EnterpriseOnboardingStep;
  confirmationId: string;
  baseFactVersion: string;
  companyName: string;
  brandName: string;
  industry: string;
  primaryBusiness: string;
  companyIntro: string;
  brandTone: string;
  products: EnterpriseOnboardingProduct[];
  focusProductIds: string[];
  productsDeferred?: boolean;
  targetMarket: string;
  targetBuyer: string;
  primaryPlatform: string;
  language: string;
  contentStage?: EnterpriseOnboardingContentStage;
  primaryCta: string;
  evidenceRefs?: EnterpriseOnboardingEvidenceRef[];
  proposalSet?: EnterpriseOnboardingProposalSet;
  sources: Partial<Record<EnterpriseOnboardingFieldKey, EnterpriseOnboardingSource>>;
  updatedAt: string;
};

export type EnterpriseOnboardingConfirmation = Omit<EnterpriseOnboardingDraft, 'revision' | 'currentStep' | 'updatedAt'> & {
  draftRevision: number;
};

const text = (value: unknown, max = 500): string => String(value ?? '').trim().slice(0, max);
const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

function stableProductId(input: Record<string, unknown>, index: number): string {
  const supplied = text(input.id || input.productId || input.sku, 180);
  if (supplied) return supplied;
  const seed = `${text(input.name || input.title || input.productName, 240)}:${index}`;
  let hash = 2166136261;
  for (let offset = 0; offset < seed.length; offset += 1) {
    hash ^= seed.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }
  return `onboarding-product-${(hash >>> 0).toString(36)}`;
}

function assetArray(value: unknown): EnterpriseOnboardingAsset[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 100).flatMap(item => {
    const input = record(item);
    if (!input) return [];
    const name = text(input.name, 500);
    const type = text(input.type, 180);
    const updatedAt = text(input.updatedAt, 64);
    const size = Number(input.size);
    if (!name || !type || !updatedAt || !Number.isFinite(size) || size < 0) return [];
    const url = text(input.url, 2_000);
    const sha256 = text(input.sha256, 64).toLowerCase();
    return [{ name, type, size, updatedAt, ...(url ? { url } : {}), ...(/^[a-f0-9]{64}$/.test(sha256) ? { sha256 } : {}) }];
  });
}

function normalizeEvidenceRefs(value: unknown): EnterpriseOnboardingEvidenceRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value.slice(0, 20).flatMap(item => {
    const input = record(item);
    if (!input || input.kind !== 'source_document' || input.status !== 'uploaded') return [];
    const sha256 = text(input.sha256, 64).toLowerCase();
    const id = text(input.id, 160); const name = text(input.name, 500);
    const mimeType = text(input.mimeType, 180); const url = text(input.url, 2_000);
    const capturedAt = text(input.capturedAt, 64); const size = Number(input.size);
    if (!id || !name || !mimeType || !url.startsWith('/api/overseas/enterprise/assets/')
      || !capturedAt || !Number.isFinite(size) || size < 1 || !/^[a-f0-9]{64}$/.test(sha256)) return [];
    return [{ id, kind: 'source_document' as const, name, mimeType, size, sha256, url, capturedAt, status: 'uploaded' as const }];
  });
  return refs.length ? refs : undefined;
}

function confidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function stringList(value: unknown, maxItems = 20): string[] {
  return Array.isArray(value) ? [...new Set(value.map(item => text(item, 240)).filter(Boolean))].slice(0, maxItems) : [];
}

function normalizeProposalSet(value: unknown, productIds: Set<string>): EnterpriseOnboardingProposalSet | undefined {
  const input = record(value); const company = record(input?.companyIntro); const tone = record(input?.brandTone);
  const market = record(input?.market); const coverage = record(market?.coverage);
  const inputHash = text(input?.inputHash, 64).toLowerCase();
  if (input?.schemaVersion !== 'enterprise-onboarding-proposals.v1' || !/^[a-f0-9]{64}$/.test(inputHash)
    || !company || !tone || !market || !coverage) return undefined;
  const focusProducts = (Array.isArray(input.focusProducts) ? input.focusProducts : []).slice(0, 3).flatMap(item => {
    const proposal = record(item); const productId = text(proposal?.productId, 180);
    if (!proposal || !productIds.has(productId)) return [];
    return [{ productId, category: text(proposal.category, 240), highlights: text(proposal.highlights, 2_000),
      description: text(proposal.description, 2_000), reason: text(proposal.reason, 1_000),
      confidence: confidence(proposal.confidence), sourceRefs: stringList(proposal.sourceRefs) }];
  });
  return {
    schemaVersion: 'enterprise-onboarding-proposals.v1', inputHash, generatedAt: text(input.generatedAt, 64),
    companyIntro: { value: text(company.value, 2_000), confidence: confidence(company.confidence), sourceRefs: stringList(company.sourceRefs) },
    brandTone: { value: text(tone.value, 1_000), confidence: confidence(tone.confidence), sourceRefs: stringList(tone.sourceRefs) },
    focusProducts,
    market: { targetBuyer: text(market.targetBuyer, 500), primaryPlatform: text(market.primaryPlatform, 80),
      language: text(market.language, 80), reason: text(market.reason, 1_000), confidence: confidence(market.confidence),
      sourceRefs: stringList(market.sourceRefs), coverage: {
        enterpriseIdentity: coverage.enterpriseIdentity === true, productProfile: coverage.productProfile === true,
        targetMarket: coverage.targetMarket === true, operatingHistory: coverage.operatingHistory === true,
        note: text(coverage.note, 1_000),
      } },
  };
}

export function normalizeEnterpriseOnboardingProduct(value: unknown, index = 0): EnterpriseOnboardingProduct | null {
  const input = record(value);
  if (!input) return null;
  const name = text(input.name || input.title || input.productName, 240);
  if (!name) return null;
  const optionalText = (key: string, max = 500) => {
    const normalized = text(input[key], max);
    return normalized ? { [key]: normalized } : {};
  };
  const attributes = record(input.attributes) || undefined;
  return {
    id: stableProductId(input, index),
    ...optionalText('productId', 180), ...optionalText('sku', 180), name,
    ...optionalText('category', 240), ...optionalText('description', 2_000),
    ...optionalText('highlights', 2_000), ...optionalText('brand', 240),
    ...optionalText('material', 500), ...optionalText('imageUrl', 2_000),
    ...optionalText('priceRange'), ...optionalText('tagPrice'), ...optionalText('retailPrice'),
    ...optionalText('moq'), ...optionalText('certifications', 1_000),
    ...optionalText('color'), ...optionalText('size'),
    ...(attributes ? { attributes } : {}),
    ...Object.fromEntries([
      'images', 'videos', 'documents', 'factoryImages', 'packagingImages',
      'certificateImages', 'sceneImages', 'brandAssets',
    ].flatMap(key => {
      const items = assetArray(input[key]);
      return items ? [[key, items]] : [];
    })),
  };
}

function normalizeSources(value: unknown): EnterpriseOnboardingDraft['sources'] {
  const input = record(value) || {};
  return Object.fromEntries(enterpriseOnboardingFieldKeys.flatMap(key => {
    const source = input[key];
    return source === 'user_provided' || source === 'system_detected' || source === 'ai_suggested'
      ? [[key, source]]
      : [];
  }));
}

function normalizeStep(value: unknown): EnterpriseOnboardingStep {
  const step = Math.floor(Number(value));
  return step === 4 ? 3 : step >= 1 && step <= 3 ? step as EnterpriseOnboardingStep : 1;
}

export function normalizeEnterpriseOnboardingDraft(value: unknown): EnterpriseOnboardingDraft | null {
  const input = record(value);
  if (!input || input.schemaVersion !== ENTERPRISE_ONBOARDING_SCHEMA_VERSION) return null;
  const confirmationId = text(input.confirmationId, 160);
  if (!/^[a-zA-Z0-9:_-]{8,160}$/u.test(confirmationId)) return null;
  const products = (Array.isArray(input.products) ? input.products : [])
    .slice(0, 500)
    .map(normalizeEnterpriseOnboardingProduct)
    .filter((item): item is EnterpriseOnboardingProduct => Boolean(item));
  const productIds = new Set(products.map(product => product.id));
  const focusProductIds = Array.isArray(input.focusProductIds)
    ? [...new Set(input.focusProductIds.map(item => text(item, 180)).filter(id => productIds.has(id)))].slice(0, 3)
    : [];
  const stage = input.contentStage;
  const contentStage = stage === 'b2b_launch' || stage === 'b2b_growth' || stage === 'd2c_brand' ? stage : undefined;
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  const proposalSet = normalizeProposalSet(input.proposalSet, productIds);
  return {
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    currentStep: normalizeStep(input.currentStep),
    confirmationId,
    baseFactVersion: text(input.baseFactVersion, 180),
    companyName: text(input.companyName, 240), brandName: text(input.brandName, 240),
    industry: text(input.industry, 240), primaryBusiness: text(input.primaryBusiness, 1_000),
    companyIntro: text(input.companyIntro, 2_000), brandTone: text(input.brandTone, 1_000),
    products, focusProductIds, ...(input.productsDeferred === true ? { productsDeferred: true } : {}),
    targetMarket: text(input.targetMarket, 500), targetBuyer: text(input.targetBuyer, 500),
    primaryPlatform: text(input.primaryPlatform, 80), language: text(input.language, 80),
    ...(contentStage ? { contentStage } : {}), primaryCta: text(input.primaryCta, 500),
    ...(evidenceRefs ? { evidenceRefs } : {}), ...(proposalSet ? { proposalSet } : {}),
    sources: normalizeSources(input.sources), updatedAt: text(input.updatedAt, 64),
  };
}

export function validateEnterpriseOnboardingConfirmation(value: unknown): {
  confirmation: EnterpriseOnboardingConfirmation | null;
  missing: string[];
} {
  const input = record(value);
  const draft = normalizeEnterpriseOnboardingDraft(input ? {
    ...input,
    revision: input.draftRevision,
    currentStep: 3,
    updatedAt: '',
  } : null);
  if (!draft) return { confirmation: null, missing: ['确认资料格式'] };
  const focusProducts = draft.focusProductIds
    .map(id => draft.products.find(product => product.id === id))
    .filter((item): item is EnterpriseOnboardingProduct => Boolean(item));
  const missing = [
    !draft.baseFactVersion ? '企业事实版本' : '',
    !draft.companyName ? '企业名称' : '', !draft.brandName ? '品牌名称' : '',
    !draft.industry ? '行业/主营分类' : '', !draft.primaryBusiness ? '主营业务' : '',
    !draft.productsDeferred && !draft.products.length ? '至少一个产品' : '',
    !draft.productsDeferred && (focusProducts.length < 1 || focusProducts.length > 3) ? '1–3 个主推产品' : '',
    !draft.productsDeferred && focusProducts.some(product => !text(product.category)) ? '主推产品类目' : '',
    !draft.productsDeferred && focusProducts.some(product => !text(product.highlights || product.description)) ? '主推产品卖点' : '',
    !draft.targetMarket ? '目标市场' : '', !draft.targetBuyer ? '主推买家' : '',
    !draft.language ? '主要语言' : '',
    !draft.contentStage ? '社媒阶段' : '', !draft.primaryCta ? '唯一 CTA' : '',
  ].filter(Boolean);
  return {
    confirmation: missing.length ? null : {
      schemaVersion: draft.schemaVersion, confirmationId: draft.confirmationId,
      baseFactVersion: draft.baseFactVersion, companyName: draft.companyName, brandName: draft.brandName,
      industry: draft.industry, primaryBusiness: draft.primaryBusiness,
      companyIntro: draft.companyIntro, brandTone: draft.brandTone,
      products: draft.productsDeferred ? [] : draft.products, focusProductIds: draft.productsDeferred ? [] : draft.focusProductIds,
      ...(draft.productsDeferred ? { productsDeferred: true } : {}),
      targetMarket: draft.targetMarket, targetBuyer: draft.targetBuyer,
      primaryPlatform: draft.primaryPlatform, language: draft.language,
      ...(draft.contentStage ? { contentStage: draft.contentStage } : {}), primaryCta: draft.primaryCta,
      ...(draft.evidenceRefs ? { evidenceRefs: draft.evidenceRefs } : {}),
      ...(!draft.productsDeferred && draft.proposalSet ? { proposalSet: draft.proposalSet } : {}),
      sources: draft.sources, draftRevision: draft.revision,
    },
    missing,
  };
}

export function onboardingCompanyIntro(companyName: string, industry: string, primaryBusiness: string): string {
  return `${companyName.trim()}专注于${industry.trim()}领域，主要提供${primaryBusiness.trim()}。`;
}

export function onboardingBrandTone(): string {
  return '专业、清晰、可信；优先用可核验的产品事实和真实应用场景说明价值。';
}

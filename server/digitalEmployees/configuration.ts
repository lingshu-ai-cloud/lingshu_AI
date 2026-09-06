import { createHash } from 'node:crypto';
import { normalizeDigitalEmployeeConfig, type DigitalEmployeeConfig } from './domain.js';
import { resolveRuntimePolicy, type EffectiveRuntimePolicy } from './runtimePolicy.js';
export {
  approvalRequiredFor,
  automaticExecutionAllowed,
  parseFollowupCadence,
  parseReviewSchedule,
  parseSocialCadence,
  resolveRuntimePolicy,
} from './runtimePolicy.js';

export interface EnterpriseFactsProfile {
  company?: {
    name?: string;
    industry?: string;
    mainMarkets?: string;
    description?: string;
  };
  products?: {
    items?: Array<{ sku?: string; name?: string }>;
  };
  strategy?: {
    focusProducts?: string;
    focusMarkets?: string;
  };
  customers?: {
    targetProfiles?: string;
  };
}

export interface KnowledgeFactSnapshot {
  companyName: string;
  industry: string;
  primaryBusiness: string;
  targetMarkets: string;
  customerProfile: string;
  focusProducts: string;
}

export interface KnowledgeBinding {
  schemaVersion: 1;
  source: 'enterprise_profile';
  factsVersion: string;
  boundAt: string;
  references: {
    company: 'company';
    targetMarkets: 'strategy.focusMarkets|company.mainMarkets';
    customerProfile: 'customers.targetProfiles';
    focusProducts: 'strategy.focusProducts|products.items';
    products: Array<{ ref: string; name: string; sku: string }>;
  };
  snapshot: KnowledgeFactSnapshot;
  warnings: string[];
}

export interface ResolvedDigitalEmployeeConfiguration {
  config: DigitalEmployeeConfig;
  configVersion: number;
  policyVersion: string;
  knowledgeBinding: KnowledgeBinding;
  runtimePolicy: EffectiveRuntimePolicy;
}

const clean = (value: unknown, max = 500): string => String(value ?? '').trim().slice(0, max);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24);
}

function selectedProducts(profile: EnterpriseFactsProfile, focusProducts: string) {
  const requested = focusProducts.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const items = profile.products?.items || [];
  const matches = requested.length
    ? items.filter(item => requested.some(name => clean(item.name).toLowerCase() === name.toLowerCase() || clean(item.sku).toLowerCase() === name.toLowerCase()))
    : [];
  return matches.map((item, index) => ({
    ref: clean(item.sku) ? `products.items[sku=${clean(item.sku)}]` : `products.items[name=${clean(item.name) || index}]`,
    name: clean(item.name, 160),
    sku: clean(item.sku, 120),
  }));
}

export function resolveKnowledgeBinding(
  profile: EnterpriseFactsProfile,
  fallback: Partial<DigitalEmployeeConfig> = {},
  boundAt = new Date().toISOString(),
): KnowledgeBinding {
  const profileFocusProducts = clean(profile.strategy?.focusProducts, 500);
  const fallbackFocusProducts = clean(fallback.focusProducts, 500);
  const productNames = (profile.products?.items || []).map(item => clean(item.name, 160)).filter(Boolean);
  const snapshot: KnowledgeFactSnapshot = {
    companyName: clean(profile.company?.name, 120) || clean(fallback.companyName, 120),
    industry: clean(profile.company?.industry, 120) || clean(fallback.industry, 120),
    primaryBusiness: clean(profile.company?.description, 500) || clean(fallback.primaryBusiness, 500),
    targetMarkets: clean(profile.strategy?.focusMarkets, 300) || clean(profile.company?.mainMarkets, 300) || clean(fallback.targetMarkets, 300),
    customerProfile: clean(profile.customers?.targetProfiles, 500) || clean(fallback.customerProfile, 500),
    focusProducts: profileFocusProducts || fallbackFocusProducts || productNames.join('、').slice(0, 500),
  };
  const warnings: string[] = [];
  if (!snapshot.companyName) warnings.push('enterprise.company.name_missing');
  if (!snapshot.industry) warnings.push('enterprise.company.industry_missing');
  if (!snapshot.targetMarkets) warnings.push('enterprise.target_markets_missing');
  if (!snapshot.customerProfile) warnings.push('enterprise.customer_profile_missing');
  if (!snapshot.focusProducts) warnings.push('enterprise.focus_products_missing');
  return {
    schemaVersion: 1,
    source: 'enterprise_profile',
    factsVersion: fingerprint(snapshot),
    boundAt,
    references: {
      company: 'company',
      targetMarkets: 'strategy.focusMarkets|company.mainMarkets',
      customerProfile: 'customers.targetProfiles',
      focusProducts: 'strategy.focusProducts|products.items',
      products: selectedProducts(profile, snapshot.focusProducts),
    },
    snapshot,
    warnings,
  };
}

export function resolveDigitalEmployeeConfiguration(input: {
  config: Partial<DigitalEmployeeConfig>;
  enterpriseProfile: EnterpriseFactsProfile;
  configVersion?: number;
  boundAt?: string;
}): ResolvedDigitalEmployeeConfiguration {
  const normalized = normalizeDigitalEmployeeConfig(input.config);
  const knowledgeBinding = resolveKnowledgeBinding(input.enterpriseProfile, normalized, input.boundAt);
  const config = normalizeDigitalEmployeeConfig({ ...normalized, ...knowledgeBinding.snapshot });
  const runtimePolicy = resolveRuntimePolicy(config);
  return {
    config,
    configVersion: Math.max(1, Math.trunc(Number(input.configVersion) || 1)),
    policyVersion: fingerprint({ ...runtimePolicy, continuationPolicy: config.continuationPolicy }),
    knowledgeBinding,
    runtimePolicy,
  };
}

export function configurationSnapshot(resolved: ResolvedDigitalEmployeeConfiguration) {
  return {
    configSnapshot: resolved.config,
    configVersion: resolved.configVersion,
    policyVersion: resolved.policyVersion,
    knowledgeBinding: resolved.knowledgeBinding,
    runtimePolicy: resolved.runtimePolicy,
  };
}

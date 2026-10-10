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
  factVersion?: {
    id?: string;
    revision?: number;
    contentHash?: string;
  };
  company?: {
    name?: string;
    industry?: string;
    mainMarkets?: string;
    description?: string;
  };
  products?: {
    items?: Array<{ sku?: string; name?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  strategy?: {
    focusProducts?: string;
    focusMarkets?: string;
  };
  customers?: {
    targetProfiles?: string;
  };
  brand?: unknown;
  operations?: unknown;
  bizRules?: unknown;
  faq?: unknown;
  knowledge?: unknown;
  socialStrategy?: unknown;
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
  /**
   * Immutable enterprise/product payload paired with `factsVersion`.
   * Runtime work must read this copy, never the tenant's mutable profile.
   */
  enterpriseSnapshot: {
    schemaVersion: 1;
    factsVersion: string;
    profileHash: string;
    profile: EnterpriseFactsProfile;
  };
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

function plainClone<T>(value: T): T {
  // The binding is persisted in a JSON field. Normalize before hashing so a
  // database round trip cannot drop `undefined` properties and invalidate an
  // otherwise untouched frozen snapshot.
  return JSON.parse(JSON.stringify(value)) as T;
}

export function canonicalEnterpriseFactsVersion(profile: EnterpriseFactsProfile): string {
  return clean(profile.factVersion?.id, 160)
    || clean(profile.factVersion?.contentHash, 160)
    || '';
}

function frozenEnterpriseProfile(profile: EnterpriseFactsProfile): EnterpriseFactsProfile {
  // Only business facts needed by digital employees cross the run boundary.
  // Operational metadata (notifications, integrations and learning state) is
  // deliberately excluded so the snapshot stays bounded and credential-free.
  const source = profile as Record<string, unknown>;
  const keys = [
    'factVersion', 'company', 'products', 'brand', 'strategy', 'customers',
    'operations', 'bizRules', 'faq', 'knowledge', 'socialStrategy',
  ] as const;
  return plainClone(Object.fromEntries(keys
    .filter(key => source[key] !== undefined)
    .map(key => [key, source[key]])) as unknown as EnterpriseFactsProfile);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Read the immutable enterprise profile carried by a knowledge binding.
 * A mismatched label/payload pair is rejected instead of silently falling
 * back to current tenant facts. `allowLegacy` reconstructs only the facts
 * already present in an old binding; it never consults mutable storage.
 */
export function enterpriseProfileFromKnowledgeBinding(
  value: unknown,
  options: { allowLegacy?: boolean } = {},
): EnterpriseFactsProfile | null {
  const binding = objectValue(value);
  const factsVersion = clean(binding?.factsVersion, 160);
  if (!binding || !factsVersion) return null;
  const frozen = objectValue(binding.enterpriseSnapshot);
  const profile = objectValue(frozen?.profile);
  if (frozen && profile) {
    if (Number(frozen.schemaVersion) !== 1 || clean(frozen.factsVersion, 160) !== factsVersion) return null;
    if (!clean(frozen.profileHash, 160) || clean(frozen.profileHash, 160) !== fingerprint(profile)) return null;
    const profileVersion = objectValue(profile.factVersion);
    const profileVersionId = clean(profileVersion?.id, 160);
    const profileContentHash = clean(profileVersion?.contentHash, 160);
    if (profileVersionId && profileVersionId !== factsVersion && profileContentHash !== factsVersion) return null;
    return plainClone(profile as unknown as EnterpriseFactsProfile);
  }
  if (!options.allowLegacy) return null;
  const snapshot = objectValue(binding.snapshot);
  const references = objectValue(binding.references);
  if (!snapshot || !references) return null;
  const products = Array.isArray(references.products)
    ? references.products.map(candidate => objectValue(candidate)).filter((candidate): candidate is Record<string, unknown> => Boolean(candidate)).map(candidate => ({
      name: clean(candidate.name, 160),
      sku: clean(candidate.sku, 120),
    })).filter(candidate => candidate.name || candidate.sku)
    : [];
  return {
    factVersion: { id: factsVersion, revision: 0, contentHash: factsVersion },
    company: {
      name: clean(snapshot.companyName, 120),
      industry: clean(snapshot.industry, 120),
      description: clean(snapshot.primaryBusiness, 500),
      mainMarkets: clean(snapshot.targetMarkets, 300),
    },
    products: { items: products },
    strategy: {
      focusMarkets: clean(snapshot.targetMarkets, 300),
      focusProducts: clean(snapshot.focusProducts, 500),
    },
    customers: { targetProfiles: clean(snapshot.customerProfile, 500) },
    knowledge: '',
  };
}

export function knowledgeBindingFactState(
  binding: unknown,
  profile: EnterpriseFactsProfile,
): 'current' | 'stale' | 'missing' {
  const canonical = canonicalEnterpriseFactsVersion(profile);
  const saved = clean(objectValue(binding)?.factsVersion, 160);
  if (!canonical || !saved) return 'missing';
  return canonical === saved ? 'current' : 'stale';
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
  const factsVersion = canonicalEnterpriseFactsVersion(profile) || fingerprint(snapshot);
  const enterpriseProfile = frozenEnterpriseProfile(profile);
  return {
    schemaVersion: 1,
    source: 'enterprise_profile',
    // The enterprise center owns the canonical confirmed-fact version. Keep
    // the legacy snapshot fingerprint only for old rows that predate that
    // version so all newly configured agents bind to the same source version.
    factsVersion,
    boundAt,
    references: {
      company: 'company',
      targetMarkets: 'strategy.focusMarkets|company.mainMarkets',
      customerProfile: 'customers.targetProfiles',
      focusProducts: 'strategy.focusProducts|products.items',
      products: selectedProducts(profile, snapshot.focusProducts),
    },
    snapshot,
    enterpriseSnapshot: {
      schemaVersion: 1,
      factsVersion,
      profileHash: fingerprint(enterpriseProfile),
      profile: enterpriseProfile,
    },
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

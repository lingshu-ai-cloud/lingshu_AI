import { createHash } from 'node:crypto';
import { INTERNAL_BUDGET_FX } from '../../shared/contracts/internalBudgetFx.js';
import { findProductionPriceEntry, PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR, PRODUCTION_MODEL_PRICE_CATALOG_VERSION,
  PRODUCTION_MODEL_PRICE_VALID_FOR_MS, type ProductionModelPriceEntry } from '../../shared/contracts/productionModelPricingCatalog.js';
import type { SocialPaidOperationIntent, SocialVerifiedAccountTariff } from './socialContentTaskBudgetAuthority.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const normalized = (value: string) => value.replace(/\/+$/, '');
const validCredential = (value: string) => /^[a-f0-9]{64}$/.test(value);

export interface FixedProductionPricingBinding {
  baseUrl: string;
  credentialSha256: string;
  accountRef?: string;
  avatarType?: 'digital_twin' | 'photo_avatar' | 'studio_avatar';
}
export interface FixedProductionPricingEvidence {
  schemaVersion: 1;
  basis: 'fixed_published_estimate_ceiling';
  catalogVersion: string;
  catalogEntrySha256: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  validForMs: number;
  safetyFactor: number;
  fixedCnyPerUsd: number;
  provider: string;
  model: string;
  stage: string;
  configuration: string;
  accountRef: string;
  checkedAt: string;
  validUntil: string;
  providerBinding: FixedProductionPricingBinding;
}

const entryHash = (entry: ProductionModelPriceEntry) => sha(JSON.stringify({
  catalogVersion: PRODUCTION_MODEL_PRICE_CATALOG_VERSION, entry,
  safetyFactor: PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR, fixedCnyPerUsd: INTERNAL_BUDGET_FX.cnyPerUsd,
}));

function accountRefFor(provider: string, binding: FixedProductionPricingBinding) {
  return `${provider}:${sha(JSON.stringify({ baseUrl: normalized(binding.baseUrl), credentialSha256: binding.credentialSha256 }))}`;
}

function configuration(intent: SocialPaidOperationIntent, binding: FixedProductionPricingBinding) {
  if (intent.provider === 'heygen' && intent.model === 'avatar_iv') return binding.avatarType;
  return undefined;
}

function expectedBaseUrl(intent: SocialPaidOperationIntent) {
  if (intent.provider === 'seedance' || intent.provider === 'seedream') return 'https://ark.cn-beijing.volces.com/api/v3';
  if (intent.provider === 'wan') return 'https://dashscope.aliyuncs.com/api/v1';
  if (intent.provider === 'heygen') return intent.model === 'avatar_iv' ? 'https://api.heygen.com/v3/videos' : 'https://api.heygen.com/v3/voices/speech';
  if (intent.model === 'qwen3-tts-flash') return 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  if (intent.model === 'qwen3-asr-flash-filetrans') return 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
  if (intent.model === 'qwen3-asr-flash') return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  return null;
}

function metersFor(entry: ProductionModelPriceEntry) {
  return Object.fromEntries(entry.meters.map(meter => {
    const officialCny = meter.nativeCurrency === 'USD' ? meter.nativePrice * INTERNAL_BUDGET_FX.cnyPerUsd : meter.nativePrice;
    return [meter.unit, { priceCny: officialCny * PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR,
      unitsPerPrice: meter.unitsPerPrice, minimumUnits: meter.minimumUnits, increment: meter.increment }];
  }));
}

export function verifyFixedProductionPublishedTariff(tariff: SocialVerifiedAccountTariff): boolean {
  try {
    const evidence = tariff.fixedProductionPricingEvidence;
    if (!evidence || evidence.schemaVersion !== 1 || evidence.basis !== 'fixed_published_estimate_ceiling'
      || tariff.pricingBasis !== evidence.basis || tariff.verifiedAccountPrice !== false || tariff.currency !== 'CNY'
      || evidence.catalogVersion !== PRODUCTION_MODEL_PRICE_CATALOG_VERSION
      || evidence.validForMs !== PRODUCTION_MODEL_PRICE_VALID_FOR_MS
      || evidence.safetyFactor !== PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR
      || evidence.fixedCnyPerUsd !== INTERNAL_BUDGET_FX.cnyPerUsd
      || evidence.provider !== tariff.provider || evidence.model !== tariff.model || evidence.stage !== tariff.stage
      || evidence.accountRef !== tariff.accountRef || evidence.checkedAt !== tariff.checkedAt || evidence.validUntil !== tariff.validUntil
      || Date.parse(evidence.validUntil) - Date.parse(evidence.checkedAt) !== evidence.validForMs
      || !validCredential(evidence.providerBinding.credentialSha256)) return false;
    const expectedBase = expectedBaseUrl(tariff as SocialPaidOperationIntent);
    if (!expectedBase || normalized(evidence.providerBinding.baseUrl) !== expectedBase
      || accountRefFor(tariff.provider, evidence.providerBinding) !== tariff.accountRef) return false;
    const entry = findProductionPriceEntry({ provider: tariff.provider, model: tariff.model, stage: tariff.stage,
      configuration: evidence.configuration });
    if (!entry || entry.sourceUrl !== evidence.sourceUrl || entry.sourceCheckedAt !== evidence.sourceCheckedAt
      || entryHash(entry) !== evidence.catalogEntrySha256
      || tariff.evidenceRef !== `fixed-production-catalog:${evidence.catalogEntrySha256}`
      || JSON.stringify(tariff.meters) !== JSON.stringify(metersFor(entry))) return false;
    return true;
  } catch { return false; }
}

/** Network-free runtime reader. Refreshing supplier prices is a reviewed code
 * update; individual production tasks never scrape a pricing page. */
export function readFixedProductionPublishedTariff(intent: SocialPaidOperationIntent, binding: FixedProductionPricingBinding,
  now: Date = new Date()): SocialVerifiedAccountTariff | null {
  const expectedBase = expectedBaseUrl(intent);
  if (!expectedBase || normalized(binding.baseUrl) !== expectedBase || !validCredential(binding.credentialSha256)) return null;
  const entry = findProductionPriceEntry({ provider: intent.provider, model: intent.model, stage: intent.stage,
    configuration: configuration(intent, binding) });
  if (!entry || Object.keys(intent.maximumUnits).sort().join(',') !== entry.meters.map(row => row.unit).sort().join(',')) return null;
  const accountRef = accountRefFor(intent.provider, binding);
  if (accountRef !== intent.accountRef) return null;
  const checkedAt = entry.sourceCheckedAt;
  const validUntil = new Date(Date.parse(checkedAt) + PRODUCTION_MODEL_PRICE_VALID_FOR_MS).toISOString();
  if (now.getTime() < Date.parse(checkedAt) || now.getTime() >= Date.parse(validUntil)) return null;
  const evidence: FixedProductionPricingEvidence = { schemaVersion: 1, basis: 'fixed_published_estimate_ceiling',
    catalogVersion: PRODUCTION_MODEL_PRICE_CATALOG_VERSION, catalogEntrySha256: entryHash(entry),
    sourceUrl: entry.sourceUrl, sourceCheckedAt: entry.sourceCheckedAt, validForMs: PRODUCTION_MODEL_PRICE_VALID_FOR_MS,
    safetyFactor: PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR, fixedCnyPerUsd: INTERNAL_BUDGET_FX.cnyPerUsd,
    provider: intent.provider, model: intent.model, stage: intent.stage, configuration: entry.configuration,
    accountRef, checkedAt, validUntil, providerBinding: { ...binding, baseUrl: normalized(binding.baseUrl) } };
  const tariff: SocialVerifiedAccountTariff = { provider: intent.provider, model: intent.model, stage: intent.stage,
    accountRef, currency: 'CNY', verifiedAccountPrice: false, pricingBasis: evidence.basis,
    fixedProductionPricingEvidence: evidence, evidenceRef: `fixed-production-catalog:${evidence.catalogEntrySha256}`,
    checkedAt, validUntil, meters: metersFor(entry) };
  return verifyFixedProductionPublishedTariff(tariff) ? tariff : null;
}

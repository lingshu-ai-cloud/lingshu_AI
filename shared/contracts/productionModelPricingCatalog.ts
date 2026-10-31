import { budgetUsdFromCny, INTERNAL_BUDGET_FX } from './internalBudgetFx.js';

export const PRODUCTION_MODEL_PRICE_CATALOG_VERSION = 'production-model-pricing-2026-10-30.v1';
export const PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR = 1.25;
export const PRODUCTION_MODEL_PRICE_CHECKED_AT = '2026-10-30T00:00:00.000Z';
export const PRODUCTION_MODEL_PRICE_VALID_FOR_MS = 180 * 24 * 60 * 60 * 1000;

export type ProductionPriceUnit =
  | 'providerSeconds'
  | 'outputTokens'
  | 'inputImages'
  | 'outputImages'
  | 'characters'
  | 'audioSeconds';

export interface ProductionPriceMeter {
  unit: ProductionPriceUnit;
  nativeCurrency: 'CNY' | 'USD';
  nativePrice: number;
  unitsPerPrice: number;
  minimumUnits: number;
  increment: number;
}
export interface ProductionPriceCatalogEntry {
  key: string;
  provider: 'seedance' | 'seedream' | 'wan' | 'heygen' | 'qwen';
  model: string;
  configuration: string;
  stages: readonly string[];
  sourceUrl: string;
  sourceCheckedAt: string;
  meters: readonly ProductionPriceMeter[];
}

const VOLCENGINE_PRICE_URL = 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh';
const ALIBABA_PRICE_URL = 'https://help.aliyun.com/zh/model-studio/model-pricing';
const HEYGEN_PRICE_URL = 'https://help.heygen.com/en/articles/10060327-heygen-api-pricing-credits-explained';

const meter = (value: ProductionPriceMeter) => Object.freeze(value);
const entry = (value: ProductionPriceCatalogEntry) => Object.freeze({
  ...value, stages: Object.freeze([...value.stages]), meters: Object.freeze(value.meters.map(meter)),
});

/** Supplier list prices frozen for deterministic task estimation. Runtime
 * settlement still retains the supplier's actual receipt and native currency. */
export const PRODUCTION_MODEL_PRICE_CATALOG = Object.freeze({
  seedanceFast720pEstimate: entry({
    key: 'seedance-fast-720p-typical-second', provider: 'seedance', model: 'doubao-seedance-2-0-fast-260128',
    configuration: '720p-16:9-typical-second', stages: ['planning_video'], sourceUrl: VOLCENGINE_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'CNY', nativePrice: 0.80, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
  seedanceFastOutput: entry({
    key: 'seedance-fast-output-token', provider: 'seedance', model: 'doubao-seedance-2-0-fast-260128',
    configuration: 'standard-online-output-token-ceiling', stages: ['video', 'concept_video', 'presenter_video'],
    sourceUrl: VOLCENGINE_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    // Use the higher official no-input-video tier as a conservative ceiling.
    meters: [{ unit: 'outputTokens', nativeCurrency: 'CNY', nativePrice: 37, unitsPerPrice: 1_000_000, minimumUnits: 0, increment: 1 }],
  }),
  seedreamPro: entry({
    key: 'seedream-5-pro-single-image', provider: 'seedream', model: 'doubao-seedream-5-0-pro-260628',
    configuration: 'single-image-output-over-2.61mp-ceiling', stages: ['first_frame'], sourceUrl: VOLCENGINE_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [
      { unit: 'inputImages', nativeCurrency: 'CNY', nativePrice: 0.02, unitsPerPrice: 1, minimumUnits: 0, increment: 1 },
      { unit: 'outputImages', nativeCurrency: 'CNY', nativePrice: 0.60, unitsPerPrice: 1, minimumUnits: 0, increment: 1 },
    ],
  }),
  seedreamProPlanningImage: entry({
    key: 'seedream-5-pro-planning-image', provider: 'seedream', model: 'doubao-seedream-5-0-pro-260628',
    configuration: 'output-over-2.61mp-plus-four-inputs', stages: ['planning_image'], sourceUrl: VOLCENGINE_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    // One high-resolution output plus four conservatively billed references.
    meters: [{ unit: 'outputImages', nativeCurrency: 'CNY', nativePrice: 0.68, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
  seedreamFlash: entry({
    key: 'seedream-5-flash-single-image', provider: 'seedream', model: 'doubao-seedream-5-0-flash-260915',
    configuration: 'single-image-output', stages: ['first_frame'], sourceUrl: VOLCENGINE_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [
      { unit: 'inputImages', nativeCurrency: 'CNY', nativePrice: 0, unitsPerPrice: 1, minimumUnits: 0, increment: 1 },
      { unit: 'outputImages', nativeCurrency: 'CNY', nativePrice: 0.12, unitsPerPrice: 1, minimumUnits: 0, increment: 1 },
    ],
  }),
  wan26Silent720p: entry({
    key: 'wan-2.6-i2v-flash-silent-720p', provider: 'wan', model: 'wan2.6-i2v-flash',
    configuration: '720p-audio-false', stages: ['video'], sourceUrl: ALIBABA_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'CNY', nativePrice: 0.15, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
  wan22Silent720p: entry({
    key: 'wan-2.2-i2v-flash-silent-720p', provider: 'wan', model: 'wan2.2-i2v-flash',
    configuration: '720p-silent', stages: ['video'], sourceUrl: ALIBABA_PRICE_URL,
    sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'CNY', nativePrice: 0.20, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
  heygenAvatarPhoto: entry({
    key: 'heygen-avatar-iv-photo', provider: 'heygen', model: 'avatar_iv', configuration: 'photo_avatar',
    stages: ['presenter_video', 'tts'], sourceUrl: HEYGEN_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'USD', nativePrice: 2.31, unitsPerPrice: 60, minimumUnits: 0, increment: 0.001 }],
  }),
  heygenAvatarTwin: entry({
    key: 'heygen-avatar-iv-digital-twin', provider: 'heygen', model: 'avatar_iv', configuration: 'digital_twin',
    stages: ['presenter_video', 'tts'], sourceUrl: HEYGEN_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'USD', nativePrice: 4.83, unitsPerPrice: 60, minimumUnits: 0, increment: 0.001 }],
  }),
  heygenAvatarStudio: entry({
    key: 'heygen-avatar-iv-studio', provider: 'heygen', model: 'avatar_iv', configuration: 'studio_avatar',
    stages: ['presenter_video', 'tts'], sourceUrl: HEYGEN_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'providerSeconds', nativeCurrency: 'USD', nativePrice: 4.83, unitsPerPrice: 60, minimumUnits: 0, increment: 0.001 }],
  }),
  heygenStarfish: entry({
    key: 'heygen-starfish-tts', provider: 'heygen', model: 'starfish', configuration: 'speech', stages: ['tts'],
    sourceUrl: HEYGEN_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'audioSeconds', nativeCurrency: 'USD', nativePrice: 0.12, unitsPerPrice: 60, minimumUnits: 0, increment: 0.001 }],
  }),
  qwenTtsFlash: entry({
    key: 'qwen3-tts-flash', provider: 'qwen', model: 'qwen3-tts-flash', configuration: 'cn-beijing', stages: ['tts'],
    sourceUrl: ALIBABA_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'characters', nativeCurrency: 'CNY', nativePrice: 0.8, unitsPerPrice: 10_000, minimumUnits: 0, increment: 1 }],
  }),
  qwenAsrFlash: entry({
    key: 'qwen3-asr-flash', provider: 'qwen', model: 'qwen3-asr-flash', configuration: 'cn-beijing', stages: ['voice_asr'],
    sourceUrl: ALIBABA_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'audioSeconds', nativeCurrency: 'CNY', nativePrice: 0.00022, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
  qwenAsrFiletrans: entry({
    key: 'qwen3-asr-flash-filetrans', provider: 'qwen', model: 'qwen3-asr-flash-filetrans', configuration: 'cn-beijing', stages: ['voice_alignment'],
    sourceUrl: ALIBABA_PRICE_URL, sourceCheckedAt: PRODUCTION_MODEL_PRICE_CHECKED_AT,
    meters: [{ unit: 'audioSeconds', nativeCurrency: 'CNY', nativePrice: 0.00022, unitsPerPrice: 1, minimumUnits: 0, increment: 1 }],
  }),
});

export type ProductionModelPriceEntry = (typeof PRODUCTION_MODEL_PRICE_CATALOG)[keyof typeof PRODUCTION_MODEL_PRICE_CATALOG];

export const QWEN_VISION_PRICE_TIERS = Object.freeze({
  'qwen3-vl-plus': Object.freeze([
    Object.freeze({ maximumInputTokens: 32_768, inputCnyPerMillion: 1, outputCnyPerMillion: 10 }),
    Object.freeze({ maximumInputTokens: 131_072, inputCnyPerMillion: 1.5, outputCnyPerMillion: 15 }),
    Object.freeze({ maximumInputTokens: 262_144, inputCnyPerMillion: 3, outputCnyPerMillion: 30 }),
  ]),
  // Reviewed dedicated-page ceiling retained for the production model even
  // though the current aggregate price page no longer lists this legacy SKU.
  'qwen3-vl-flash': Object.freeze([
    Object.freeze({ maximumInputTokens: 262_144, inputCnyPerMillion: 0.6, outputCnyPerMillion: 6 }),
  ]),
});

const roundUsd = (value: number) => Math.ceil(value * 1_000_000 - 1e-6) / 1_000_000;
export function productionPriceToEstimatedUsd(meterValue: Pick<ProductionPriceMeter, 'nativeCurrency' | 'nativePrice'>) {
  const buffered = meterValue.nativePrice * PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR;
  return roundUsd(meterValue.nativeCurrency === 'USD' ? buffered : budgetUsdFromCny(buffered));
}

export function estimateQwenVisionUsd(input: { model: keyof typeof QWEN_VISION_PRICE_TIERS; inputTokens: number; outputTokens: number }) {
  if (![input.inputTokens, input.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error('qwen_vision_estimate_units_invalid');
  const tier = QWEN_VISION_PRICE_TIERS[input.model].find(row => input.inputTokens <= row.maximumInputTokens);
  if (!tier) throw new Error('qwen_vision_estimate_tier_missing');
  const officialCny = Number((input.inputTokens * tier.inputCnyPerMillion / 1_000_000
    + input.outputTokens * tier.outputCnyPerMillion / 1_000_000).toFixed(12));
  return Object.freeze({ model: input.model, inputTokens: input.inputTokens, outputTokens: input.outputTokens,
    tier, officialCny, estimatedUsd: budgetUsdFromCny(officialCny * PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR),
    safetyFactor: PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR, fxVersion: INTERNAL_BUDGET_FX.version,
    catalogVersion: PRODUCTION_MODEL_PRICE_CATALOG_VERSION });
}

export function findProductionPriceEntry(input: { provider: string; model: string; stage: string; configuration?: string }) {
  return Object.values(PRODUCTION_MODEL_PRICE_CATALOG).find(row => row.provider === input.provider && row.model === input.model
    && row.stages.includes(input.stage) && (!input.configuration || row.configuration === input.configuration)) || null;
}

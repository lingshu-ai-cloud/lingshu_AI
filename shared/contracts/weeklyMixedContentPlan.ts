import { budgetCnyFromUsd, INTERNAL_BUDGET_FX } from './internalBudgetFx.js';
import { PRODUCTION_MODEL_PRICE_CATALOG, PRODUCTION_MODEL_PRICE_CATALOG_VERSION,
  productionPriceToEstimatedUsd } from './productionModelPricingCatalog.js';

/** Planning only: these slots do not authorize production or publishing. */
export type WeeklyMixedContentKind = 'video' | 'image';
export interface WeeklyMixedContentSlot {
  slotId: string;
  accountId: string;
  platform: 'facebook' | 'linkedin';
  kind: WeeklyMixedContentKind;
  presentation: 'video' | 'image';
  productionRole: 'original' | 'adaptation';
  /** An adaptation must reuse this original and must not trigger another generation. */
  originalSlotId: string;
  /** Internal reference identity for an independently produced image; never expose the ID in UI. */
  referenceId?: string;
  referenceTitle?: string;
  referenceSourceUrl?: string;
  /** First analyzed image for the planning preview, not the post page URL. */
  referenceThumbnailUrl?: string;
  /** Draft product choice for an independently produced image; approval must freeze it. */
  productId?: string;
  productName?: string;
  /** Original creative intent; the reference caption is never copied as product copy. */
  contentTheme?: string;
}

/** Versioned, conservative planning assumptions; not a supplier quote or point price. */
export const WEEKLY_MIXED_USD_RATE_CARD = Object.freeze({
  version: `${PRODUCTION_MODEL_PRICE_CATALOG_VERSION}:weekly-mixed.v2`,
  videoModel: PRODUCTION_MODEL_PRICE_CATALOG.seedanceFast720pEstimate.model,
  videoConfiguration: PRODUCTION_MODEL_PRICE_CATALOG.seedanceFast720pEstimate.configuration,
  videoUsdPerSecond: productionPriceToEstimatedUsd(PRODUCTION_MODEL_PRICE_CATALOG.seedanceFast720pEstimate.meters[0]!),
  imageModel: PRODUCTION_MODEL_PRICE_CATALOG.seedreamProPlanningImage.model,
  imageConfiguration: PRODUCTION_MODEL_PRICE_CATALOG.seedreamProPlanningImage.configuration,
  imageUsdPerImage: productionPriceToEstimatedUsd(PRODUCTION_MODEL_PRICE_CATALOG.seedreamProPlanningImage.meters[0]!),
  sourceRef: 'docs/architecture/adr/2026-10-30-internal-usd-production-cost.md',
});

/** Read-only quote inputs, frozen per task before production. */
export interface WeeklyMixedEstimateBasis {
  /** Generated seconds per original video, not publication duration. */
  videoGeneratedSeconds: number;
  videoUsdPerSecond: number;
  imageUsdPerImage: number;
  videoAttempts: number;
  imageAttempts: number;
}

const DEFAULT_ESTIMATE_BASIS: WeeklyMixedEstimateBasis = {
  videoGeneratedSeconds: 30,
  videoUsdPerSecond: WEEKLY_MIXED_USD_RATE_CARD.videoUsdPerSecond,
  imageUsdPerImage: WEEKLY_MIXED_USD_RATE_CARD.imageUsdPerImage,
  videoAttempts: 1,
  imageAttempts: 1,
};

/** A deterministic management estimate. Existing CNY fields are compatibility
 * projections for legacy planning contracts, never paid-call authority. */
export function estimateWeeklyMixedProduction(slots: readonly WeeklyMixedContentSlot[],
  overrides: Partial<Pick<WeeklyMixedEstimateBasis, 'videoGeneratedSeconds' | 'videoAttempts' | 'imageAttempts'>> = {}) {
  const basis = { ...DEFAULT_ESTIMATE_BASIS, ...overrides };
  if (Object.values(basis).some(value => !Number.isFinite(value) || value <= 0) ||
    !Number.isSafeInteger(basis.videoAttempts) || !Number.isSafeInteger(basis.imageAttempts))
    throw new Error('weekly_mixed_estimate_basis_invalid');
  const originals = slots.filter(slot => slot.productionRole === 'original');
  const videos = originals.filter(slot => slot.kind === 'video').length;
  const images = originals.filter(slot => slot.kind === 'image').length;
  const roundUsd = (value: number) => {
    if (!Number.isFinite(value) || value * 1_000_000 > Number.MAX_SAFE_INTEGER)
      throw new Error('weekly_mixed_estimate_overflow');
    return value === 0 ? 0 : Math.ceil(value * 1_000_000 - 1e-6) / 1_000_000;
  };
  const roundCny = (value: number) => value === 0 ? 0 : Math.ceil(value * 100 - 1e-6) / 100;
  const unitVideoUsd = roundUsd(basis.videoGeneratedSeconds * basis.videoUsdPerSecond * basis.videoAttempts);
  const unitImageUsd = roundUsd(basis.imageUsdPerImage * basis.imageAttempts);
  const estimatedUsd = roundUsd(videos * unitVideoUsd + images * unitImageUsd);
  const unitVideoCny = roundCny(budgetCnyFromUsd(unitVideoUsd));
  const projectedCny = roundCny(budgetCnyFromUsd(estimatedUsd));
  return {
    estimatedUsd, currency: 'USD' as const, priceVersion: WEEKLY_MIXED_USD_RATE_CARD.version,
    fxVersion: INTERNAL_BUDGET_FX.version, unitVideoUsd, unitImageUsd,
    // Legacy planning readers still require min/max CNY. Both describe this
    // single deterministic task, not a token range or an execution limit.
    minCny: projectedCny, maxCny: projectedCny,
    videoOriginals: videos, imageOriginals: images, publicationCount: slots.length,
    unitVideoMinCny: unitVideoCny, unitVideoMaxCny: unitVideoCny, basis,
  };
}

/** The initial 15-publication recommendation, before topics or reference selection. */
export function recommendWeeklyMixedContent(input: { facebookAccountIds: [string, string]; linkedinAccountId: string }): WeeklyMixedContentSlot[] {
  const accounts = [...input.facebookAccountIds, input.linkedinAccountId].map(value => value.trim());
  if (accounts.some(value => !value) || new Set(accounts).size !== 3) throw new Error('weekly_mixed_content_distinct_accounts_required');
  const originals: WeeklyMixedContentSlot[] = [];
  for (const [accountIndex, accountId] of accounts.slice(0, 2).entries()) {
    for (const [kind, count] of [['video', 3], ['image', 2]] as const) {
      for (let i = 1; i <= count; i += 1) {
        const slotId = `facebook-${accountIndex + 1}-${kind}-${i}`;
        originals.push({ slotId, accountId, platform: 'facebook', kind, presentation: kind, productionRole: 'original', originalSlotId: slotId });
      }
    }
  }
  const imageOriginals = originals.filter(slot => slot.kind === 'image');
  const videoOriginal = originals.find(slot => slot.kind === 'video')!;
  const selected = [videoOriginal, ...imageOriginals];
  const adaptations: WeeklyMixedContentSlot[] = selected.map((source, index) => ({
    slotId: `linkedin-${index + 1}`, accountId: accounts[2]!, platform: 'linkedin', kind: source.kind,
    presentation: source.kind, productionRole: 'adaptation', originalSlotId: source.slotId,
  }));
  return [...originals, ...adaptations];
}

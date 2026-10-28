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
}

/** Read-only quote inputs. The amount is an estimate, never paid-call authority. */
export interface WeeklyMixedEstimateBasis {
  /** Illustrative generated seconds for each original video, not publication duration. */
  videoGeneratedSeconds: number;
  videoLowCnyPerSecond: number;
  videoHighCnyPerSecond: number;
  videoMaxAttempts: number;
  /** GPT Image 2 low-quality output tokens per image, estimated from public pricing. */
  imageOutputTokensMin: number;
  imageOutputTokensMax: number;
  imageInputTokensMin: number;
  imageInputTokensMax: number;
  textInputTokensMin: number;
  textInputTokensMax: number;
  usdToCny: number;
}

const DEFAULT_ESTIMATE_BASIS: WeeklyMixedEstimateBasis = {
  videoGeneratedSeconds: 30,
  videoLowCnyPerSecond: 0.14,
  videoHighCnyPerSecond: 0.28,
  videoMaxAttempts: 2,
  imageOutputTokensMin: 334, imageOutputTokensMax: 400,
  imageInputTokensMin: 4_000, imageInputTokensMax: 40_000,
  textInputTokensMin: 500, textInputTokensMax: 2_000,
  usdToCny: 7.2,
};

/** Public rate references: GPT Image 2 standard $4/M image input, $15/M image
 * output, $2.50/M text input (https://developers.openai.com/api/docs/pricing);
 * Seedance 1.0 480p ¥0.14/s and 720p ¥0.28/s
 * (https://docs.volcengine.com/docs/large-model-of-image-generation/package-billing-instructions).
 * Generated seconds, attempts, token amounts and 7.2 FX are planning assumptions,
 * not live quotes, supplier receipts or paid-call authority. */
export function estimateWeeklyMixedProduction(slots: readonly WeeklyMixedContentSlot[],
  overrides: Partial<WeeklyMixedEstimateBasis> = {}) {
  const basis = { ...DEFAULT_ESTIMATE_BASIS, ...overrides };
  if (Object.values(basis).some(value => !Number.isFinite(value) || value < 0) || basis.usdToCny <= 0)
    throw new Error('weekly_mixed_estimate_basis_invalid');
  const originals = slots.filter(slot => slot.productionRole === 'original');
  const videos = originals.filter(slot => slot.kind === 'video').length;
  const images = originals.filter(slot => slot.kind === 'image').length;
  const imageCost = (output: number, imageInput: number, textInput: number) =>
    (output * 15 + imageInput * 4 + textInput * 2.5) / 1_000_000 * basis.usdToCny;
  const round = (value: number) => Math.round(value * 100) / 100;
  const unitVideoMinCny = round(basis.videoGeneratedSeconds * basis.videoLowCnyPerSecond);
  const unitVideoMaxCny = round(basis.videoGeneratedSeconds * basis.videoHighCnyPerSecond * basis.videoMaxAttempts);
  const minCny = round(videos * unitVideoMinCny + images * imageCost(
    basis.imageOutputTokensMin, basis.imageInputTokensMin, basis.textInputTokensMin));
  const maxCny = round(videos * unitVideoMaxCny + images * imageCost(
    basis.imageOutputTokensMax, basis.imageInputTokensMax, basis.textInputTokensMax));
  return { minCny, maxCny, videoOriginals: videos, imageOriginals: images,
    publicationCount: slots.length, unitVideoMinCny, unitVideoMaxCny, basis };
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

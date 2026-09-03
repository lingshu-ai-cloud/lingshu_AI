export const DIGITAL_HUMAN_USAGE_PURPOSES = [
  'internal_preview',
  'customer_delivery',
  'paid_media',
  'organic_social',
] as const;

export type DigitalHumanUsagePurpose = typeof DIGITAL_HUMAN_USAGE_PURPOSES[number];

type DigitalHumanRightsAsset = {
  productionReady?: boolean;
  rightsStatus?: string;
  rightsUsageScope?: readonly unknown[];
};

const purposeSet = new Set<string>(DIGITAL_HUMAN_USAGE_PURPOSES);

/** Missing purpose is deliberately treated as an internal preview, never as publishable output. */
export function parseDigitalHumanUsagePurpose(value: unknown): DigitalHumanUsagePurpose | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'internal_preview';
  return purposeSet.has(normalized) ? normalized as DigitalHumanUsagePurpose : null;
}

export function normalizeDigitalHumanRightsUsageScope(value: unknown): DigitalHumanUsagePurpose[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item ?? '').trim())
    .filter((item): item is DigitalHumanUsagePurpose => purposeSet.has(item)))];
}

export function digitalHumanAssetSupportsUsage(
  asset: DigitalHumanRightsAsset,
  purpose: DigitalHumanUsagePurpose,
): boolean {
  return asset.productionReady === true
    && asset.rightsStatus === 'commercial_cleared'
    && normalizeDigitalHumanRightsUsageScope(asset.rightsUsageScope).includes(purpose);
}

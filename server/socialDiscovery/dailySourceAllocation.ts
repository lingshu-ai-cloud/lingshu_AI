import { WEEKLY_AUTOMATION_TEMPLATE } from '../../shared/weeklyAutomationTemplate.js';

const PLATFORM_WEIGHTS = [
  { platform: 'tiktok', weight: 4 },
  { platform: 'facebook', weight: 3 },
  { platform: 'instagram', weight: 2 },
  { platform: 'youtube', weight: 1 },
] as const;

export type DailySourcePlatform = typeof PLATFORM_WEIGHTS[number]['platform'];

/** A source-allocation helper for the existing approved discovery run, not a second crawler. */
export function planWeeklyKeywordSources(input: {
  refs: string[];
  platforms: string[];
  configuredAccountCount: number;
  businessDate?: string;
}): { sources: Array<{ ref: string; platform: DailySourcePlatform; limit: number }>; platformLimits: Map<DailySourcePlatform, number>; keywordLimit: number } {
  const refs = [...new Set(input.refs.map(ref => ref.trim()).filter(Boolean))];
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.businessDate ?? '') ? Date.parse(`${input.businessDate}T00:00:00Z`) / 86_400_000 : 0;
  const offset = refs.length ? ((Math.floor(day) % refs.length) + refs.length) % refs.length : 0;
  const rotatedRefs = [...refs.slice(offset), ...refs.slice(0, offset)];
  const selected = PLATFORM_WEIGHTS.filter(item => input.platforms.includes(item.platform));
  const total = WEEKLY_AUTOMATION_TEMPLATE.dailyCollectionLimit;
  if (!Number.isSafeInteger(input.configuredAccountCount) || input.configuredAccountCount < 0 || input.configuredAccountCount > total) {
    throw Error('daily_collection_account_minimum_exceeds_limit');
  }
  const keywordLimit = total - input.configuredAccountCount;
  if (!selected.length || !refs.length || !keywordLimit) return { sources: [], platformLimits: new Map(), keywordLimit };
  const sumWeights = selected.reduce((sum, item) => sum + item.weight, 0);
  const weighted = selected.map(item => ({ ...item, raw: keywordLimit * item.weight / sumWeights, limit: Math.floor(keywordLimit * item.weight / sumWeights) }));
  let remainder = keywordLimit - weighted.reduce((sum, item) => sum + item.limit, 0);
  for (const item of [...weighted].sort((a, b) => (b.raw - b.limit) - (a.raw - a.limit) || b.weight - a.weight)) {
    if (remainder-- <= 0) break;
    item.limit += 1;
  }
  const platformLimits = new Map(weighted.map(item => [item.platform, item.limit]));
  const remaining = new Map(platformLimits);
  const pairs = new Map<string, { ref: string; platform: DailySourcePlatform; limit: number }>();
  for (let index = 0; index < keywordLimit; index++) {
    const ref = rotatedRefs[index % rotatedRefs.length]!;
    const candidate = weighted
      .filter(item => (remaining.get(item.platform) ?? 0) > 0)
      .sort((a, b) => {
        const aUsed = pairs.get(`${a.platform}:${ref}`)?.limit ?? 0;
        const bUsed = pairs.get(`${b.platform}:${ref}`)?.limit ?? 0;
        return aUsed - bUsed || (remaining.get(b.platform) ?? 0) - (remaining.get(a.platform) ?? 0) || b.weight - a.weight;
      })[0];
    if (!candidate) throw Error('daily_collection_platform_allocation_incomplete');
    const key = `${candidate.platform}:${ref}`, existing = pairs.get(key);
    if (existing) existing.limit += 1;
    else pairs.set(key, { ref, platform: candidate.platform, limit: 1 });
    remaining.set(candidate.platform, (remaining.get(candidate.platform) ?? 0) - 1);
  }
  return { sources: [...pairs.values()], platformLimits, keywordLimit };
}

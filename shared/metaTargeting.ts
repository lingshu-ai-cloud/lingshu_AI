/** Explicit Meta targeting. IDs come from authenticated Graph search, never free text. */
export type MetaTargetOption = { id: string; name: string };
export type MetaTargeting = {
  ageMin: number; ageMax: number; gender: 'all' | 'male' | 'female';
  locales: MetaTargetOption[]; interests: MetaTargetOption[]; customAudiences: MetaTargetOption[];
  placementMode: 'automatic' | 'manual'; facebookPositions: string[]; instagramPositions: string[];
};
export const emptyMetaTargeting: MetaTargeting = { ageMin: 18, ageMax: 65, gender: 'all', locales: [], interests: [], customAudiences: [], placementMode: 'automatic', facebookPositions: [], instagramPositions: [] };
// Conservative video surface catalogue, NOT a live account eligibility response.
export const metaVideoPositions = {
  Facebook: [{ value: 'feed', label: 'Facebook 动态' }, { value: 'story', label: 'Facebook 快拍' }, { value: 'facebook_reels', label: 'Facebook Reels' }],
  Instagram: [{ value: 'stream', label: 'Instagram 动态' }, { value: 'story', label: 'Instagram 快拍' }, { value: 'reels', label: 'Instagram Reels' }],
};
export function normalizeMetaTargeting(value: unknown, channels?: string[]): MetaTargeting | undefined {
  if (value === undefined) return undefined; // Legacy drafts preserve their original execution semantics.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Meta 人群与版位配置无效');
  const r = value as Record<string, unknown>;
  const keys = Object.keys(emptyMetaTargeting);
  if (Object.keys(r).some(k => !keys.includes(k))) throw Error('包含未支持的人群或版位字段');
  if (!Number.isInteger(r.ageMin) || !Number.isInteger(r.ageMax) || Number(r.ageMin) < 18 || Number(r.ageMax) > 65 || Number(r.ageMin) > Number(r.ageMax)) throw Error('年龄范围须为 18 至 65+，最低年龄不得超过最高年龄');
  if (!['all', 'male', 'female'].includes(String(r.gender)) || !['automatic', 'manual'].includes(String(r.placementMode))) throw Error('人群或版位模式无效');
  const options = (key: string): MetaTargetOption[] => {
    if (!Array.isArray(r[key]) || r[key].length > 50) throw Error('平台定向选项最多 50 项');
    return [...new Map(r[key].map((v: unknown) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('平台定向选项格式无效');
      const o = v as Record<string, unknown>;
      if (typeof o.id !== 'string' || !/^\d{1,30}$/.test(o.id) || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 300) throw Error('请从平台返回结果中选择定向选项');
      if (key === 'locales' && (!Number.isSafeInteger(Number(o.id)) || Number(o.id) < 1 || Number(o.id) > 2147483647)) throw Error('平台语言标识无效');
      return [o.id, { id: o.id, name: o.name.trim() }] as const;
    })).values()];
  };
  const positions = (key: string, platform: keyof typeof metaVideoPositions) => {
    if (!Array.isArray(r[key]) || r[key].some(v => typeof v !== 'string' || !metaVideoPositions[platform].some(p => p.value === v))) throw Error('版位不在当前视频版位目录中');
    const values = [...new Set(r[key] as string[])].sort();
    if (channels && values.length && !channels.includes(platform)) throw Error(`请先选择 ${platform} 渠道，或清除其手动版位`);
    return values;
  };
  const result: MetaTargeting = { ageMin: Number(r.ageMin), ageMax: Number(r.ageMax), gender: r.gender as MetaTargeting['gender'], locales: options('locales'), interests: options('interests'), customAudiences: options('customAudiences'), placementMode: r.placementMode as MetaTargeting['placementMode'], facebookPositions: positions('facebookPositions', 'Facebook'), instagramPositions: positions('instagramPositions', 'Instagram') };
  if (result.placementMode === 'manual') {
    if (!result.facebookPositions.length && !result.instagramPositions.length) throw Error('手动版位至少选择一个位置');
    if (channels?.includes('Facebook') && !result.facebookPositions.length || channels?.includes('Instagram') && !result.instagramPositions.length) throw Error('每个已选渠道至少选择一个手动版位；不投放的渠道请取消勾选');
  } else if (result.facebookPositions.length || result.instagramPositions.length) throw Error('自动版位不能混用手动位置');
  if (channels?.some(c => !['Facebook', 'Instagram'].includes(c))) throw Error('此定向配置仅适用于 Meta 渠道');
  return result;
}
export function buildMetaTargeting(countries: string[], channels: string[], value?: MetaTargeting): Record<string, unknown> {
  const config = normalizeMetaTargeting(value, channels);
  return { geo_locations: { countries }, age_min: config?.ageMin ?? 18,
    publisher_platforms: channels.map(c => c === 'Facebook' ? 'facebook' : 'instagram'),
    ...(config ? { age_max: config.ageMax, ...(config.gender === 'all' ? {} : { genders: [config.gender === 'male' ? 1 : 2] }),
      ...(config.locales.length ? { locales: config.locales.map(o => Number(o.id)) } : {}),
      ...(config.interests.length ? { flexible_spec: [{ interests: config.interests.map(o => ({ id: o.id })) }] } : {}),
      ...(config.customAudiences.length ? { custom_audiences: config.customAudiences.map(o => ({ id: o.id })) } : {}),
      ...(config.placementMode === 'manual' ? { ...(channels.includes('Facebook') ? { facebook_positions: config.facebookPositions } : {}), ...(channels.includes('Instagram') ? { instagram_positions: config.instagramPositions } : {}) } : {}),
    } : {}),
  };
}
/** Compare restrictions, ignoring provider ordering, labels and unrelated response metadata. */
export function metaTargetingMatches(actual: Record<string, any> | undefined, expected: Record<string, any>): boolean {
  if (!actual) return false;
  if (Object.keys(actual.geo_locations || {}).some(k => !['countries', 'location_types'].includes(k)) || Number(actual.targeting_automation?.advantage_audience || 0) !== 0) return false;
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'name').sort().map(k => [k, canonical(v[k])])) : v;
  const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  if (!same(actual.geo_locations?.countries, expected.geo_locations.countries) || Number(actual.age_min) !== expected.age_min || expected.age_max !== undefined && Number(actual.age_max) !== expected.age_max) return false;
  for (const key of ['publisher_platforms', 'genders', 'locales', 'flexible_spec', 'custom_audiences', 'facebook_positions', 'instagram_positions']) {
    // Auto-placement may be expanded by Meta; explicit manual positions must match exactly.
    if (['facebook_positions', 'instagram_positions'].includes(key) && expected[key] === undefined) continue;
    if (!same(actual[key] || [], expected[key] || [])) return false;
  }
  return !actual.excluded_geo_locations && !actual.exclusions && !actual.excluded_custom_audiences?.length;
}

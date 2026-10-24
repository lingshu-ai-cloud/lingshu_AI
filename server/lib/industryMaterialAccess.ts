import type { DataStore } from '../storage/datastore.js';
import { materialSourceCategoryOf } from '../../shared/materialTaxonomy.js';

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function materialIndustryKey(value: unknown): string {
  const text = String(value || '').trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    beauty_skincare: ['美妆护肤', '美妆', '护肤', '化妆品', 'beauty', 'skincare'],
    apparel_textile: ['服装纺织', '服装', '纺织', 'apparel', 'textile'],
    metalworking: ['金属加工', 'metalworking'],
    universal_manufacturing: ['通用制造', 'universal_manufacturing'],
  };
  return Object.entries(aliases).find(([key, names]) => key === text || names.includes(text))?.[0] || text;
}

export async function readMaterialTenantIndustry(tenantId: string, dataStore?: Pick<DataStore, 'list'>,
  request?: (path: string) => Promise<Response>): Promise<string> {
  try {
    const result = dataStore
      ? await dataStore.list<Record<string, unknown>>('tenant_profiles', { where: { tenant_id: tenantId }, page: 1, perPage: 2 })
      : await request!(`/api/collections/tenant_profiles/records?perPage=2&filter=${encodeURIComponent(`tenant_id = ${JSON.stringify(tenantId)}`)}`).then(async response => {
        if (!response.ok) throw Error('profile unavailable');
        return await response.json() as { items: Record<string, unknown>[]; totalItems: number };
      });
    if (result.totalItems !== 1 || result.items[0]?.tenant_id !== tenantId) return '';
    return materialIndustryKey(object(object(result.items[0]?.profile).company).industry);
  } catch { return ''; }
}

export function officialIndustryMaterialVisible(item: Record<string, unknown>, industry: string): boolean {
  return item.scope === 'shared' && materialSourceCategoryOf(item) === 'official_import'
    && Boolean(industry) && materialIndustryKey(item.industry) === industry;
}

export function tenantUploadUsesReservedOrigin(input: Record<string, unknown>): boolean {
  const source = String(input.sourceType || '').toLowerCase();
  return materialSourceCategoryOf(input) !== 'local_upload' || input.scope === 'shared' || input.sourceCategory === 'official_import' || input.sourceCategory === 'user_generated'
    || input.folder === 'hot' || /official|licensed[-_ ]?stock|platform_operations|industry[-_ ]?material|seedance|seedream|gemini|qwen|aigc|ai[-_ ]?generated|^ai[-_]/.test(source);
}

export type TenantFaqPackOverrides = Record<string, { items: Array<{ q: string; a: string }> }>;
const packIds = new Set(['apparel', 'home', 'general'].flatMap(industry => ['presales', 'shipping', 'aftersales', 'credentials'].map(scenario => `${industry}/${scenario}`)));
/** Tenant-owned literal drafts only; shared files are never written. */
export function normalizeTenantFaqPacks(value: unknown): TenantFaqPackOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_tenant_faq_packs');
  const result: TenantFaqPackOverrides = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!packIds.has(id) || !raw || typeof raw !== 'object') throw Error('invalid_tenant_faq_pack');
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items) || !items.length || items.length > 50) throw Error('invalid_tenant_faq_pack_items');
    const seen = new Set<string>();
    result[id] = { items: items.map(item => {
      if (!item || typeof item !== 'object' || typeof item.q !== 'string' || typeof item.a !== 'string') throw Error('invalid_tenant_faq_entry');
      const q = item.q.trim(), a = item.a.trim(), key = q.toLowerCase();
      if (!q || q.length > 300 || !a || a.length > 5000 || seen.has(key)) throw Error('invalid_tenant_faq_entry');
      seen.add(key);
      return { q, a };
    }) };
  }
  return result;
}

import type { AdSourceEntry } from './adSourceLifecycle.js';
import type { AdCreativeLibraryItem, AdCreativeReport } from './platformAdCreativeLibrary.js';
import type { MetaAccountHistory } from './metaAccountHistory.js';
export type AdMaterialPlan = { id: string; name: string; goal: string; market: string; status: string };
export type AdMaterialAd = { accountId: string; accountName: string; connectionId: string; adId: string; executionId?: string; history?: MetaAccountHistory['items'][number]; currency: string; timezone?: string; reportedAt?: string; goal?: string; market?: string; taskId?: string };
export type AdMaterialDirectoryItem = { key: string; name: string; source?: AdSourceEntry; plans: AdMaterialPlan[]; bindings: NonNullable<AdCreativeLibraryItem['binding']>[]; ads: AdMaterialAd[] };
export type AdMaterialDirectory = { items: AdMaterialDirectoryItem[]; totalItems: number; page: number; perPage: number; totalPages: number; warnings: string[]; checkedAt: string; truncated: boolean };
/** A lineage/version key, never a filename or a provider video ID masquerading as a local fingerprint. */
export function materialSourceKey(source: AdSourceEntry) {
  if (source.verifiedSource && source.sourceTaskId && source.artifactId && source.sha256) return `${source.sourceTenantId || 'current'}:social:${source.sourceTaskId}:${source.artifactId}:${source.sha256}`;
  return `${source.sourceTenantId || 'current'}:${source.sourceId || 'current'}:${source.key}`;
}
export function materialReportGroups(reports: Array<AdCreativeReport & { market?: string }>) {
  const unique = [...new Map(reports.map(r => [`${r.accountId}:${r.adId}`, r])).values()];
  const groups = new Map<string, Array<AdCreativeReport & { market?: string }>>();
  for (const report of unique) {
    const key = JSON.stringify([report.accountId, report.currency, report.reportTimezone, report.window, report.metricLabel, report.market || '', report.attributionSpec]);
    groups.set(key, [...(groups.get(key) || []), report]);
  }
  return [...groups.values()].map(rows => ({ ...rows[0], adCount: rows.length, reportedAt: rows.map(r => r.reportedAt).filter(Boolean).sort()[0] || '',
    spend: rows.every(r => r.spend != null) ? rows.reduce((sum, r) => sum + r.spend!, 0) : null,
    impressions: rows.every(r => r.impressions != null) ? rows.reduce((sum, r) => sum + r.impressions!, 0) : null,
    results: rows.every(r => r.results != null) ? rows.reduce((sum, r) => sum + r.results!, 0) : null,
    // The cost is explicitly a derived weighted subtotal; never average native per-ad costs.
    derivedCost: rows.every(r => r.spend != null && r.results != null) && rows.reduce((sum, r) => sum + r.results!, 0) > 0
      ? rows.reduce((sum, r) => sum + r.spend!, 0) / rows.reduce((sum, r) => sum + r.results!, 0) : null,
  }));
}

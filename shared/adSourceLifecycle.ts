import type { MetaPerformanceReport } from './metaPerformance.js';
export interface AdSourceIdentity { origin: 'studio' | 'social'; projectId?: string; sourceTaskId?: string; artifactId?: string; sourceId?: string }
export interface AdHistorySource { id: string; tenantId: string; tenantName: string; label: string }
export interface AdSourceEntry extends AdSourceIdentity {
  key: string; name: string; status: string; createdAt: string;
  sha256: string; verifiedSource: boolean; note: string;
  sourceTenantId?: string; sourceTenantName?: string; sourceRevision?: string;
  sourceMediaStatus?: string;
}
export interface AdSourceCatalog { items: AdSourceEntry[]; page: number; perPage: number; totalItems: number; totalPages: number }
export interface AdSourceFileEvidence {
  id: string; state: 'verified' | 'fingerprinted' | 'missing' | 'unavailable' | 'mismatch';
  expectedSha256: string | null; actualSha256: string | null; expectedSize: number | null; actualSize: number | null; note: string;
}
export interface AdSourceLifecycle {
  source: AdSourceEntry; checkedAt: string; truncated: boolean; bindingCount: number;
  ads: Array<{ executionId: string; taskId: string; taskName: string; accountId: string; adId: string; mapping: string; report: MetaPerformanceReport | null; error: string }>;
  roi: null; crmInquiries: null; scopeNote: string;
  fileEvidence?: AdSourceFileEvidence[];
}
/** Retain only the same immutable source and exact account/ad snapshot on a failed refresh. */
export function preserveAdLifecycleReports(previous: AdSourceLifecycle | null, next: AdSourceLifecycle): AdSourceLifecycle {
  if (next.fileEvidence?.some(file => file.state !== 'verified')) return next;
  if (!previous || previous.source.key !== next.source.key || previous.source.sha256 !== next.source.sha256
    || previous.source.sourceTenantId !== next.source.sourceTenantId || previous.source.sourceRevision !== next.source.sourceRevision) return next;
  return { ...next, ads: next.ads.map(ad => ad.report || !ad.error ? ad : { ...ad, report: previous.ads.find(old => old.accountId === ad.accountId && old.adId === ad.adId)?.report || null }) };
}

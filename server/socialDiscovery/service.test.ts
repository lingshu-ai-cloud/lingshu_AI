import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import type { CandidateEvidenceWorkItem } from './candidateEvidenceWorker.js';
import { executeApprovedDiscoveryRun, type DiscoveryScopeRecord } from './service.js';
import type { VersionedCandidateEvidence } from './qualityOrchestration.js';

class MemoryStore implements DataStore {
  rows = new Map<string, Array<Record<string, unknown> & { id: string }>>();
  async getById<T>(collection: string, id: string): Promise<T | null> { return (this.rows.get(collection) ?? []).find(row => row.id === id) as T ?? null; }
  async create<T>(collection: string, data: Record<string, unknown>): Promise<T> { const row = { id: `${collection}-${(this.rows.get(collection) ?? []).length + 1}`, ...data }; this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]); return row as T; }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> { const rows = this.rows.get(collection) ?? []; const index = rows.findIndex(row => row.id === id); if (index < 0) return false; rows[index] = { ...rows[index], ...data }; return true; }
  async delete(): Promise<boolean> { return false; }
  async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 500 };
  }
}

function accepted(item: CandidateEvidenceWorkItem): VersionedCandidateEvidence {
  return {
    evidenceId: `evidence-${item.candidateId}`, version: 1, tenantId: item.tenantId, candidateId: item.candidateId,
    inputFingerprint: item.candidateId, evidence: {
      inspirationId: item.candidateId, discoveryPath: item.discoveryPath, sceneIds: [],
      relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: [], limitations: [] }, evidenceRefs: item.evidenceRefs ?? [],
    },
    g1: { runId: item.g1.runId, queryRef: item.g1.queryRef, discoveryMode: item.g1.discoveryMode, sourceType: 'keyword', sourceUrl: 'https://example.invalid', observedAt: '2026-09-26T00:00:00Z', publishedAt: 'unknown', followerCount: 'unknown', commentText: 'unknown', missingFields: [] },
    completeness: 'partial', createdAt: '2026-09-26T00:00:00Z', supersedesEvidenceId: null,
  };
}

test('approved collection calls CandidateEvidence worker and fills quota with qualified evidence, not imported rows', async () => {
  const dataStore = new MemoryStore();
  const scope: DiscoveryScopeRecord = {
    id: 'scope-1', tenant_id: 'tenant-1', keyword_set_id: 'keywords-1', version: 1, status: 'active', created_by: 'user', created_at: '', updated_at: '',
    payload: {
      crawlStrategyId: 'crawl-1', version: '1', businessGoal: 'goal', keywordSet: {} as never,
      discoveryBrief: {
        discoveryBriefId: 'brief-1', keywordSetId: 'keywords-1', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok'], lookbackDays: 7,
        resultLimit: 4, budgetLimitCny: 10, productionGap: null, createdBy: 'director_agent',
        modePolicies: { momentum: { enabled: true, sourceRefs: ['query-1', 'query-2'], platforms: ['tiktok'], resultLimit: 4, refreshIntervalMinutes: 60, budgetLimitCny: 10 } },
      },
      keywords: [], benchmarkAccounts: [], platformQuotas: [], refreshIntervalMinutes: 60, stopConditions: [], availableCapabilities: [], priorities: [], successCriteria: [], metricTargets: [], createdBy: 'business_agent',
      approval: { status: 'approved', scopeVersion: 1, approvedBy: 'user', approvedAt: '2026-09-26T00:00:00Z' }, market: 'US', language: 'en',
    } as any,
  };
  dataStore.rows.set('social_discovery_scopes', [scope]);
  let crawlCalls = 0;
  let workerCalls = 0;
  const result = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl() { crawlCalls += 1; return { platform: 'tiktok', keyword: 'q', imported: 10, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 10, source: 'r3', message: '', candidateIds: [`candidate-${crawlCalls}`], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems(input) { return [{ tenantId: input.tenantId, candidateId: input.result.candidateIds![0]!, discoveryPath: ['keyword', 'performance'], evidenceRefs: ['source'], g1: { runId: input.runId, queryRef: input.queryRef, discoveryMode: input.mode, sourceUrl: 'source' } }]; } },
    async runCandidateEvidence(items) { workerCalls += 1; return { accepted: items.map(accepted), suggestions: [], failed: [] }; },
  });
  assert.equal(crawlCalls, 2, 'ten imported rows from the first source must not fill a two-evidence quota');
  assert.equal(workerCalls, 2);
  assert.equal(result.run?.modeStats.momentum?.accepted, 2);
  assert.deepEqual(result.run?.evidenceOutcomes?.momentum?.acceptedCandidateIds, ['candidate-1', 'candidate-2']);
});

test('account discovery reads the current account library and forwards the saved name and date range', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('competitor_accounts', [{ id: 'account-1', tenantId: 'tenant-1', accountUrl: 'https://www.youtube.com/@demo', accountName: 'Demo Factory' }]);
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-1', tenant_id: 'tenant-1', keyword_set_id: 'keywords-1', version: 1, status: 'active',
    payload: {
      market: 'US', language: 'en', approval: { status: 'approved', scopeVersion: 1 },
      discoveryBrief: {
        discoveryBriefId: 'brief-1', keywordSetId: 'keywords-1', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: ['https://www.youtube.com/@old'], discoveryModes: ['account'],
        platforms: ['youtube'], lookbackDays: 7, resultLimit: 3, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent',
        modePolicies: { account: { enabled: true, sourceRefs: ['https://www.youtube.com/@old'], platforms: ['youtube'], resultLimit: 3, refreshIntervalMinutes: 60, budgetLimitCny: null } },
      },
    },
  }]);
  const calls: Array<{ accountUrl?: string; accountName?: string; dateFrom?: string; dateTo?: string; limit?: number }> = [];
  await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) {
      calls.push(input);
      return { platform: 'youtube', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: input.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] };
    },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.accountUrl, 'https://www.youtube.com/@demo');
  assert.equal(calls[0]?.accountName, 'Demo Factory');
  assert.equal(calls[0]?.limit, 1);
  assert.match(calls[0]?.dateFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.match(calls[0]?.dateTo ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

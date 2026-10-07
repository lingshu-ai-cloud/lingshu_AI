import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import { evaluateSocialDiscoveryReadiness, listSocialDiscoverySupply } from './supply.js';

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

function evidence(candidateId: string, evidenceId: string) {
  return {
    id: evidenceId, evidenceId, version: 1, tenantId: 'tenant-1', tenant_id: 'tenant-1', candidateId,
    inputFingerprint: candidateId,
    evidence: {
      inspirationId: candidateId, discoveryPath: ['keyword', 'performance'], sceneIds: ['scene-1'],
      relevance: { level: 'high', reasons: ['relevant'] },
      momentum: { level: 'high_performance', reasons: ['above baseline'], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
    },
    g1: { runId: 'run-1', queryRef: 'private label', discoveryMode: 'momentum', sourceType: 'keyword', sourceUrl: `https://www.tiktok.com/${candidateId}`, observedAt: '2026-10-07T00:00:00.000Z', publishedAt: 'unknown', followerCount: 'unknown', commentText: 'unknown', missingFields: [] },
    completeness: 'complete', createdAt: '2026-10-07T00:00:00.000Z', supersedesEvidenceId: null,
  };
}

test('server supply scoring and filters reject DTC sellers for a B2B audience', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-1', tenant_id: 'tenant-1', status: 'active', keyword_set_id: 'set-1', version: 1, created_by: 'user', created_at: '', updated_at: '',
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [{ sceneId: 'scene-1', status: 'approved' }] } } },
  }]);
  dataStore.rows.set('social_candidate_evidence', [evidence('video-b2b', 'evidence-b2b'), evidence('video-dtc', 'evidence-dtc')]);
  dataStore.rows.set('trend_videos', [
    { id: 'video-b2b', tenantId: 'tenant-1', platform: 'tiktok', title: 'OEM skincare factory private label wholesale', sourceUrl: 'https://www.tiktok.com/video-b2b' },
    { id: 'video-dtc', tenantId: 'tenant-1', platform: 'tiktok', title: 'Shop now add to cart discount code', sourceUrl: 'https://www.tiktok.com/video-dtc' },
  ]);
  const accepted = await listSocialDiscoverySupply({
    tenantId: 'tenant-1', dataStore, now: new Date('2026-10-07T01:00:00.000Z'),
    filters: { candidateType: 'video', decision: 'accepted', businessModel: 'b2b' },
  });
  assert.deepEqual(accepted.items.map(item => item.candidateId), ['video-b2b']);
  const rejected = await listSocialDiscoverySupply({ tenantId: 'tenant-1', dataStore, filters: { candidateType: 'video', decision: 'rejected' } });
  assert.equal(rejected.items[0]?.candidateId, 'video-dtc');
  assert.ok(rejected.items[0]?.score.blockers.some(item => item.includes('DTC')));
});

test('readiness is computed from accepted videos, confirmed accounts, and approved scenes', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-1', tenant_id: 'tenant-1', status: 'active', keyword_set_id: 'set-1', version: 1, created_by: 'user', created_at: '', updated_at: '',
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [{ sceneId: 'scene-1', status: 'approved' }] } } },
  }]);
  dataStore.rows.set('social_candidate_evidence', [evidence('video-b2b', 'evidence-b2b')]);
  dataStore.rows.set('trend_videos', [{ id: 'video-b2b', platform: 'tiktok', title: 'OEM factory wholesale supplier', sourceUrl: 'https://www.tiktok.com/video-b2b' }]);
  dataStore.rows.set('social_tracked_accounts', [{
    id: 'account-1', tenant_id: 'tenant-1', accountId: 'https://www.tiktok.com/@factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory',
    reasons: ['OEM factory'], evidenceVideoIds: ['video-b2b'], relatedSceneIds: ['scene-1'], missingEvidence: [], confidence: 0.9,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-07T00:00:00.000Z' },
  }]);
  const readiness = await evaluateSocialDiscoveryReadiness({ tenantId: 'tenant-1', dataStore, thresholds: { acceptedVideos: 1, benchmarkAccounts: 1, sceneClusters: 1 } });
  assert.equal(readiness.readyForOutline, true);
  assert.equal(readiness.readyForDetailedPlan, true);
  assert.deepEqual(readiness.gaps, []);
});

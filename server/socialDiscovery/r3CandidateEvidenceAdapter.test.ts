import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { createR3CandidateEvidenceAdapter } from './r3CandidateEvidenceAdapter.js';

test('R3 boundary maps crawler records without exposing crawler shape to evidence authority', async () => {
  const adapter = createR3CandidateEvidenceAdapter({
    async getById() { throw new Error('not expected'); }, async create() { return null; }, async update() { return false; }, async delete() { return false; },
    async list() { return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 1 }; },
  } as DataStore);
  const items = await adapter.toEvidenceWorkItems({
    tenantId: 'tenant-1', runId: 'run-1', scopeId: 'scope-1', scopeVersion: 2, mode: 'momentum', queryRef: 'sample', observedAt: '2026-09-26T00:00:00Z',
    result: { platform: 'tiktok', keyword: 'sample', imported: 1, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 1, source: 'r3', message: '', candidateIds: ['candidate-1'], items: [{ id: 'candidate-1', tenantId: 'tenant-1', sourceUrl: 'https://www.tiktok.com/video/1', crawledAt: '2026-09-26T00:00:00Z', aiAnalysis: JSON.stringify({ views: '12.5K', taskRelevance: 0.8, transferability: 0.7, uploadedAt: '2026-09-25', analysisQuality: 'video', discoveryOrigins: [{ runId: 'run-1', mode: 'momentum', queryRef: 'sample', observedAt: '2026-09-26T00:00:01Z' }] }) }] },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.candidateId, 'candidate-1');
  assert.equal(items[0]?.currentPerformance, 12_500);
  assert.deepEqual(items[0]?.discoveryPath, ['keyword', 'performance']);
  assert.equal(items[0]?.g1.observedAt, '2026-09-26T00:00:01Z');
  assert.deepEqual(items[0]?.evidenceRefs, ['https://www.tiktok.com/video/1']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { runCandidateEvidenceWorker, type CandidateEvidenceWorkItem } from './candidateEvidenceWorker.js';
import type { VersionedCandidateEvidence } from './qualityOrchestration.js';

const base: CandidateEvidenceWorkItem = { tenantId: 'tenant', candidateId: 'candidate', discoveryPath: ['keyword'], evidenceRefs: ['https://example.invalid/v'], g1: { runId: 'run', queryRef: 'query', discoveryMode: 'momentum', sourceUrl: 'https://example.invalid/v' } };

test('worker is the qualification boundary for source evidence and innovation gates', async () => {
  const persisted: string[] = [];
  const persist = async (item: CandidateEvidenceWorkItem): Promise<VersionedCandidateEvidence> => {
    persisted.push(item.candidateId);
    return { evidenceId: `e-${item.candidateId}`, version: 1, tenantId: item.tenantId, candidateId: item.candidateId, inputFingerprint: 'fp', evidence: { inspirationId: item.candidateId, discoveryPath: item.discoveryPath, sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'unknown', reasons: [], confidence: 0 }, transferability: { level: 'high', mechanisms: [], limitations: [] }, evidenceRefs: item.evidenceRefs ?? [] }, g1: { runId: 'run', queryRef: 'query', discoveryMode: 'momentum', sourceType: 'keyword', sourceUrl: 'source', observedAt: 'unknown', publishedAt: 'unknown', followerCount: 'unknown', commentText: 'unknown', missingFields: [] }, completeness: 'partial', createdAt: '', supersedesEvidenceId: null };
  };
  const result = await runCandidateEvidenceWorker([
    base,
    { ...base, candidateId: 'no-source', evidenceRefs: [], g1: { ...base.g1, sourceUrl: undefined } },
    { ...base, candidateId: 'innovation', discoveryPath: ['innovation'], innovationEvidence: { kind: 'comment_question', commentRefs: ['c1'], contentRefs: ['v1'] } },
  ], persist);
  assert.deepEqual(persisted, ['candidate']);
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(result.suggestions.map(item => item.candidateId), ['no-source', 'innovation']);
});

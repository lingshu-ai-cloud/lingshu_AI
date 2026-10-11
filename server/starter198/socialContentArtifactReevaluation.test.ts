import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { SocialContentAgentWorkflow, SocialReplicationEvaluation } from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { createSocialArtifactReevaluationService } from './socialContentArtifactReevaluation.js';
import { socialRequestHash } from './socialContentValidation.js';

const bytes = Buffer.from('immutable-owned-video-bytes');
const mediaSha256 = createHash('sha256').update(bytes).digest('hex');
const workflow = {
  replicationJob: { replicationJobId: 'replication-job', version: '1', factorSpecVersion: '1', factorSpecs: [] },
  executionPlan: { executionPlanId: 'execution-plan' },
} as unknown as SocialContentAgentWorkflow;
const script = { shots: [{ shotId: 'scene-1', startSeconds: 0, endSeconds: 2, purpose: 'proof', visualInstruction: '产品特写' }] } as never;
const evaluation = {
  evaluationId: 'evaluation-fixed', replicationJobId: 'replication-job', status: 'review_required',
} as unknown as SocialReplicationEvaluation;

class MemoryRepository implements Starter198Repository {
  readonly records: StarterRecord[];
  constructor(parent: StarterRecord) { this.records = [parent]; }
  async list(_collection: never, tenantId: string, query: { where?: Record<string, string | number | boolean> } = {}) {
    const items = this.records.filter(record => record.tenant_id === tenantId
      && Object.entries(query.where ?? {}).every(([key, value]) => record[key] === value));
    return { page: 1, perPage: 500, totalPages: 1, totalItems: items.length, items };
  }
  async get() { return null; }
  async create() { throw Error('unexpected direct create'); }
  async update() { throw Error('unexpected direct update'); }
  async access() { return {} as never; }
}

function fixture() {
  const parentContent = {
    productionResult: { productionResultId: 'production-result', executionPlanId: 'execution-plan' },
    replicationEvaluation: { evaluationId: 'old-evaluation', replicationJobId: 'replication-job', status: 'failed' },
    adaptedScript: '新的产品介绍',
  };
  const parent: StarterRecord = {
    id: 'parent-row', tenant_id: 'tenant', task_id: 'task', artifact_id: 'parent-artifact', artifact_kind: 'short_video',
    platform: 'tiktok', language: 'zh', version: '7', status: 'review_required', origin: 'agent',
    resource_ref: 'socialfile:file-1', content: parentContent, parent_artifact_id: '',
    content_hash: socialRequestHash({ resourceRef: 'socialfile:file-1', content: parentContent }),
    created_at: '2026-10-12T00:00:00.000Z', updated_at: '2026-10-12T00:00:00.000Z',
  };
  const repository = new MemoryRepository(parent);
  let evaluations = 0;
  let creations = 0;
  let evaluatorSawExistingFile = false;
  const service = createSocialArtifactReevaluationService({
    repository,
    ports: {
      openMedia: async () => ({
        file: { fileId: 'file-1', taskId: 'task', usage: 'artifact_media', fileRef: 'socialfile:file-1', name: 'video.mp4', mimeType: 'video/mp4', size: bytes.length, sha256: mediaSha256, storageKind: 'backend_file', createdAt: '' },
        body: (async function* () { yield bytes; })(),
      }),
      readDetail: async () => ({ agentWorkflow: workflow, replicationScript: script } as never),
      evaluate: async input => {
        evaluations += 1;
        evaluatorSawExistingFile = existsSync(input.outputVideoPath);
        assert.equal(input.productionResultId, 'production-result');
        return { evaluation, report: null };
      },
      createArtifact: async input => {
        creations += 1;
        assert.equal(input.requireHumanReview, true);
        assert.equal(input.value.resourceRef, parent.resource_ref);
        assert.equal(input.value.parentArtifactId, parent.artifact_id);
        const content = input.value.content!;
        const record: StarterRecord = {
          ...parent, id: 'child-row', artifact_id: 'child-artifact', version: '1', status: 'review_required',
          parent_artifact_id: parent.artifact_id, content,
          content_hash: socialRequestHash({ resourceRef: parent.resource_ref, content }),
        };
        repository.records.push(record);
        return { artifact: {
          artifactId: 'child-artifact', taskId: 'task', kind: 'short_video', platform: 'tiktok', language: 'zh',
          version: '1', status: 'review_required', origin: 'agent', resourceRef: parent.resource_ref as string,
          content, parentArtifactId: parent.artifact_id as string, createdAt: parent.created_at as string, updatedAt: parent.updated_at as string,
        }, task: {} as never };
      },
    },
  });
  const request = {
    tenantId: 'tenant', userId: 'owner', taskId: 'task', parentArtifactId: 'parent-artifact',
    parentArtifactVersion: '7', parentContentHash: parent.content_hash as string,
    expectedMediaSha256: mediaSha256, requestId: 'reevaluate-request-0001',
  };
  return { service, request, repository, counters: () => ({ evaluations, creations, evaluatorSawExistingFile }) };
}

test('existing artifact reevaluation creates one human-review child over the exact same owned bytes', async () => {
  const f = fixture();
  const first = await f.service.reevaluate(f.request);
  assert.equal(first.artifact.parentArtifactId, 'parent-artifact');
  assert.equal(first.artifact.resourceRef, 'socialfile:file-1');
  assert.equal(first.mediaSha256, mediaSha256);
  assert.equal(first.replayed, false);
  assert.equal(first.evaluation?.evaluationId, 'evaluation-fixed');
  assert.deepEqual(f.counters(), { evaluations: 1, creations: 1, evaluatorSawExistingFile: true });
  const childContent = first.artifact.content!;
  assert.equal((childContent.reevaluation as Record<string, unknown>).mediaSha256, mediaSha256);
  assert.equal((childContent.review as Record<string, unknown>).state, 'requires_user_approval');

  const replay = await f.service.reevaluate(f.request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.artifact.artifactId, first.artifact.artifactId);
  assert.deepEqual(f.counters(), { evaluations: 1, creations: 1, evaluatorSawExistingFile: true });
  assert.equal(f.repository.records.filter(record => record.parent_artifact_id === 'parent-artifact').length, 1);
});

test('reevaluation rejects parent version, content hash and media sha drift before evaluation', async () => {
  for (const patch of [
    { parentArtifactVersion: '8' },
    { parentContentHash: 'a'.repeat(64) },
    { expectedMediaSha256: 'b'.repeat(64) },
  ]) {
    const f = fixture();
    await assert.rejects(f.service.reevaluate({ ...f.request, ...patch }), /social_artifact_reevaluation_(?:parent_version_changed|parent_content_changed|media_changed)/);
    assert.equal(f.counters().evaluations, 0);
    assert.equal(f.counters().creations, 0);
  }
});

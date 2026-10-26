import { SOCIAL_TECHNICAL_REVIEW_POLICY } from './socialContentTechnicalReplayEvidence.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { SocialContentAgentWorkflow, SocialReplicationEvaluation } from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterCollection, type StarterRecord } from './repository.js';
import { createSocialArtifactReevaluationService, identityEvidenceFromAssetSupply } from './socialContentArtifactReevaluation.js';
import { socialRequestHash } from './socialContentValidation.js';

const bytes = Buffer.from('immutable-owned-video-bytes');
const mediaSha256 = createHash('sha256').update(bytes).digest('hex');
const workflow = {
  replicationJob: { replicationJobId: 'replication-job', version: '1', factorSpecVersion: '1', factorSpecs: [] },
  executionPlan: { executionPlanId: 'execution-plan' },
  directorBrief: { scenes: [] },
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
  async create(_collection: StarterCollection, _tenantId: string, _data: Record<string, unknown>): Promise<StarterRecord> {
    throw Error('unexpected direct create');
  }
  async update(_collection: StarterCollection, _tenantId: string, _id: string, _data: Record<string, unknown>): Promise<void> {
    throw Error('unexpected direct update');
  }
  async access() { return {} as never; }
}

function fixture(technical = false) {
  const parentContent:Record<string,unknown> = {
    productionResult: { productionResultId: 'production-result', executionPlanId: 'execution-plan' },
    replicationEvaluation: { evaluationId: 'old-evaluation', replicationJobId: 'replication-job', status: 'failed' },
    adaptedScript: '新的产品介绍',
  };
  if(technical)Object.assign(parentContent,{workflowSchema:'social-content.auto-production.v3',
    productionWorkspaceSource:{runId:'run-a',outputSha256:mediaSha256},technicalQualityReport:{policyVersion:'old'},
    review:{creativeChecksPassed:true},render:{completed:true},delivery:{status:'publish_candidate'}});
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
  let technicalEvaluations = 0;
  let evaluatorSawExistingFile = false;
  const service = createSocialArtifactReevaluationService({
    repository,
    ports: {
      openMedia: async () => ({
        file: { fileId: 'file-1', taskId: 'task', usage: 'artifact_media', fileRef: 'socialfile:file-1', name: 'video.mp4', mimeType: 'video/mp4', size: bytes.length, sha256: mediaSha256, storageKind: 'backend_file', createdAt: '' },
        body: (async function* () { yield bytes; })(),
      }),
      readDetail: async () => ({ agentWorkflow: workflow, replicationScript: script } as never),
      reevaluateTechnical: async input => {
        technicalEvaluations++;assert.equal(input.scope.runId,'run-a');assert.equal(input.outputSha256,mediaSha256);
        return {report:{schemaVersion:'initial-scene-quality.v1',policyVersion:SOCIAL_TECHNICAL_REVIEW_POLICY,
          visual:{passed:true,failures:[],metrics:{}},scenes:{passed:true,issues:[],checkedScenes:1},audio:{ok:true,error:null}} as never,
          approved:false,failures:['technical_measurement_unverified'],policyVersion:SOCIAL_TECHNICAL_REVIEW_POLICY,evidenceHash:'e'.repeat(64)};
      },
      evaluate: async input => {
        evaluations += 1;
        evaluatorSawExistingFile = existsSync(input.outputVideoPath);
        assert.equal(input.productionResultId, 'production-result');
        assert.equal(input.evidence?.referenceVideoPath, '/trusted/reference-38s.mp4');
        return { evaluation, report: null };
      },
      resolveReferenceVideoPath: async () => '/trusted/reference-38s.mp4',
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
  return { service, request, repository, technicalEvaluations:()=>technicalEvaluations, counters: () => ({ evaluations, creations, evaluatorSawExistingFile }) };
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

test('identity evidence is derived once per final scene only from completed authorized supply lineage', () => {
  const identityFactors = Array.from({ length: 5 }, (_, index) => ({
    factorId: `identity-${index}`, version: '1', beatId: `beat-${index}`, referenceShotId: `reference-${index}`,
    category: 'identity', description: `替换身份 ${index}`, causalRole: 'identity', causalStatus: 'observed_correlation',
    policy: 'replace_identity', importance: 'critical',
    target: { metric: 'identity', value: `source-${index}`, unit: null, regionRef: null, stateKey: 'identity' },
    tolerance: { metric: 'enum', minimum: null, maximum: null, allowedValues: [], maximumDeviation: null, unit: null, humanReviewWhen: [] },
    observationConfidence: 1, causalConfidence: 1, evidenceRefs: [],
    validator: { validatorId: `validator-${index}`, kind: 'vision_state', detector: 'identity', blocking: true, threshold: .8, evidenceOutput: ['identity'] },
    status: 'frozen', frozenAt: '2026-10-12T00:00:00.000Z', decisionOwner: 'director_agent',
  }));
  const scenes = identityFactors.map((factor, index) => ({
    sceneId: `scene-${index}`, referenceShotId: factor.referenceShotId,
    replicationFactors: [{ factorId: factor.factorId, semanticAdaptation: { status: 'applicable' } }],
    ...(index ? { productSceneReplication: { productIdentity: { groups: [{ referenceImageIds: [`enterprise-image-${index}`] }] } } } : {}),
  }));
  const identityWorkflow = {
    replicationJob: { replicationJobId: 'job', target: { productRef: 'enterprise-product' }, factorSpecs: identityFactors },
    directorBrief: { scenes },
  } as unknown as SocialContentAgentWorkflow;
  const shots = scenes.map((scene, index) => ({
    shotId: scene.sceneId, sceneId: scene.sceneId,
    sourceStrategy: index ? 'customer_product_image_animation' : 'authorized_digital_presenter',
    sourceRef: `owned-source-${index}`,
    provenance: { authorizationRef: index ? null : 'document://presenter-authorization' },
    attempts: [{
      sourceStrategy: index ? 'customer_product_image_animation' : 'authorized_digital_presenter',
      adapterId: 'trusted-adapter', status: 'completed', reason: null,
    }],
  }));
  const content = { assetSupplyExecution: { planVersion: '37', executedAt: '2026-10-12T00:00:00.000Z', shots } };
  const evidence = identityEvidenceFromAssetSupply({ workflow: identityWorkflow, parentContent: content });
  assert.equal(evidence.length, 5);
  assert.deepEqual(evidence.map(item => item.requirementId), identityFactors.map(item => item.factorId));
  assert.ok(evidence.every(item => item.provenance.detector === 'asset-supply-lineage'));
  assert.match(evidence[0]!.explanation!, /不声称完成像素级身份识别/);

  const missingSupply = identityEvidenceFromAssetSupply({
    workflow: identityWorkflow, parentContent: { assetSupplyExecution: { planVersion: '37', shots: [] } },
  });
  assert.deepEqual(missingSupply, [], 'no persisted supply record must remain missing evidence');
  const incomplete = structuredClone(content);
  (incomplete.assetSupplyExecution.shots[1]!.attempts[0] as { status: string }).status = 'failed';
  assert.equal(identityEvidenceFromAssetSupply({ workflow: identityWorkflow, parentContent: incomplete }).length, 4);
});


test('technical policy upgrade creates same-byte child without replication evaluation and preserves unknown',async()=>{
 const f=fixture(true),request={...f.request,mode:'technical' as const,expectedRunId:'run-a'};
 const result=await f.service.reevaluate(request),content=result.artifact.content!;
 assert.equal(result.replayed,false);assert.equal(f.technicalEvaluations(),1);assert.equal(f.counters().evaluations,0);
 assert.equal((content.review as Record<string,unknown>).technicalChecksPassed,false);
 assert.equal((content.review as Record<string,unknown>).automatedChecksPassed,false);
 assert.equal((content.delivery as Record<string,unknown>).status,'requires_revision');
 assert.equal((content.replicationEvaluation as Record<string,unknown>).evaluationId,'old-evaluation');
 assert.equal((content.reevaluation as Record<string,unknown>).parentContentHash,request.parentContentHash);
 assert.equal(result.artifact.resourceRef,'socialfile:file-1');
 const replay=await f.service.reevaluate({...request,requestId:'different-user-request'});
 assert.equal(replay.replayed,true);assert.equal(f.technicalEvaluations(),1);assert.equal(f.counters().creations,1);
});
test('current technical policy short circuits after byte verification and wrong run cannot reevaluate',async()=>{
 const f=fixture(true),parent=f.repository.records[0]!,content=parent.content as Record<string,unknown>;
 (content.technicalQualityReport as Record<string,unknown>).policyVersion=SOCIAL_TECHNICAL_REVIEW_POLICY;
 parent.content_hash=socialRequestHash({resourceRef:parent.resource_ref,content});
 const request={...f.request,parentContentHash:String(parent.content_hash),mode:'technical' as const,expectedRunId:'run-a'};
 const result=await f.service.reevaluate(request);assert.equal(result.replayed,true);assert.equal(result.artifact.artifactId,'parent-artifact');
 assert.equal(f.technicalEvaluations(),0);assert.equal(f.counters().creations,0);
 await assert.rejects(f.service.reevaluate({...request,expectedRunId:'other-run'}),/run_changed/);
});

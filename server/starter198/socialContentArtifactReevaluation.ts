import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  SocialContentAgentWorkflow,
  SocialContentArtifact,
  SocialReplicationEvaluation,
} from '../../shared/contracts/socialContentWorkflow.js';
import { evaluateSocialReplicationResult } from './replicationEvaluationAdapter.js';
import type { IdentityReplacementEvidence } from '../lib/replicationEvaluation.js';
import { createSocialContentArtifact } from './socialContentOutputs.js';
import { readSocialTaskDetail, socialArtifact } from './socialContentRecords.js';
import { openSocialArtifactPreviewMedia } from './socialArtifactMedia.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import type { SocialContentBackendFilePort } from './socialContentFiles.js';

export interface SocialArtifactReevaluationRequest {
  tenantId: string;
  userId: string;
  taskId: string;
  parentArtifactId: string;
  parentArtifactVersion: string;
  parentContentHash: string;
  expectedMediaSha256: string;
  requestId: string;
}

type EvaluationInput = Parameters<typeof evaluateSocialReplicationResult>[0];
type EvaluationOutput = Awaited<ReturnType<typeof evaluateSocialReplicationResult>>;

export interface SocialArtifactReevaluationPorts {
  evaluate(input: EvaluationInput): Promise<EvaluationOutput>;
  createArtifact(input: Parameters<typeof createSocialContentArtifact>[0]): ReturnType<typeof createSocialContentArtifact>;
  openMedia(input: Parameters<typeof openSocialArtifactPreviewMedia>[0]): ReturnType<typeof openSocialArtifactPreviewMedia>;
  readDetail(input: Parameters<typeof readSocialTaskDetail>[0]): ReturnType<typeof readSocialTaskDetail>;
  resolveReferenceVideoPath?(input: {
    repository: Starter198Repository;
    tenantId: string;
    taskId: string;
    parentContent: Record<string, unknown>;
    workflow: SocialContentAgentWorkflow;
  }): Promise<string | null>;
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(code: string, status = 409): never {
  throw new SocialContentWorkflowError(code, status);
}

function artifactContent(record: StarterRecord): Record<string, unknown> {
  const content = socialObject(socialJson(record.content));
  if (!content) return fail('social_artifact_reevaluation_parent_content_invalid', 503);
  const expected = socialRequestHash({ resourceRef: socialText(record.resource_ref) || null, content });
  if (socialText(record.content_hash) !== expected) return fail('social_artifact_reevaluation_parent_content_corrupt', 503);
  return content;
}

function reevaluationRequestId(content: Record<string, unknown> | null): string {
  return socialText(socialObject(content?.reevaluation)?.requestId);
}

function evaluationFrom(content: Record<string, unknown> | null): SocialReplicationEvaluation | null {
  const evaluation = socialObject(content?.replicationEvaluation);
  return evaluation && socialText(evaluation.evaluationId)
    ? structuredClone(evaluation) as unknown as SocialReplicationEvaluation : null;
}

async function spoolAndHash(body: AsyncIterable<Uint8Array>, outputPath: string): Promise<string> {
  const digest = createHash('sha256');
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.from(body), hashing, createWriteStream(outputPath, { flags: 'wx' }));
  return digest.digest('hex');
}

/** Convert only completed, frozen supply lineage into replacement evidence.
 * This proves which authorized enterprise asset was selected for a final
 * scene; it deliberately does not claim that a vision detector recognized the
 * rendered pixels. */
export function identityEvidenceFromAssetSupply(input: {
  workflow: SocialContentAgentWorkflow;
  parentContent: Record<string, unknown>;
}): IdentityReplacementEvidence[] {
  const execution = socialObject(input.parentContent.assetSupplyExecution);
  const supplyShots = Array.isArray(execution?.shots)
    ? execution.shots.map(socialObject).filter((shot): shot is Record<string, unknown> => Boolean(shot)) : [];
  const factorById = new Map(input.workflow.replicationJob?.factorSpecs.map(factor => [factor.factorId, factor]) ?? []);
  const evidence: IdentityReplacementEvidence[] = [];
  for (const scene of input.workflow.directorBrief.scenes) {
    const identityFactor = (scene.replicationFactors ?? []).find(item => {
      if (item.semanticAdaptation?.status === 'functionally_replaced') return false;
      const source = factorById.get(item.factorId);
      return source?.policy === 'replace_identity' || source?.category === 'identity';
    });
    if (!identityFactor) continue;
    const supply = supplyShots.find(shot => socialText(shot.sceneId) === scene.sceneId
      || socialText(shot.shotId) === scene.sceneId);
    if (!supply) continue;
    const sourceStrategy = socialText(supply.sourceStrategy);
    const sourceRef = socialText(supply.sourceRef);
    const attempts = Array.isArray(supply.attempts)
      ? supply.attempts.map(socialObject).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
    const completed = attempts.find(attempt => socialText(attempt.status) === 'completed'
      && socialText(attempt.sourceStrategy) === sourceStrategy);
    const provenance = socialObject(supply.provenance);
    const authorizationRef = socialText(provenance?.authorizationRef);
    const lockedProductRefs = scene.productSceneReplication?.productIdentity.groups
      .flatMap(group => group.referenceImageIds).map(socialText).filter(Boolean) ?? [];
    // A provider label alone is not authority. Require the exact completed
    // source plus either its persisted authorization or a frozen enterprise
    // product identity reference from the final director contract.
    if (!completed || !sourceRef || (!authorizationRef && !lockedProductRefs.length)) continue;
    const evidenceRefs = [
      `asset_supply_execution:${socialText(execution?.planVersion)}:${scene.sceneId}:${sourceStrategy}:${sourceRef}`,
      ...(authorizationRef ? [authorizationRef] : []),
      ...lockedProductRefs.map(ref => `enterprise_product_asset:${ref}`),
    ];
    evidence.push({
      requirementId: identityFactor.factorId,
      outcome: 'replaced',
      detectedOriginal: false,
      detectedReplacement: input.workflow.replicationJob?.target.productRef
        || input.workflow.replicationJob?.target.accountRef?.id || sourceRef,
      confidence: 1,
      evidenceRefs,
      explanation: `持久化供应执行记录确认最终镜头使用 ${sourceStrategy} 的授权来源 ${sourceRef}；该证据证明来源绑定，不声称完成像素级身份识别。`,
      provenance: {
        producer: 'deterministic_rule', detector: 'asset-supply-lineage', detectorVersion: '1.0',
        createdAt: socialText(execution?.executedAt) || undefined,
      },
    });
  }
  return evidence;
}

/**
 * Re-run only the independent replication evaluator against immutable bytes.
 * This service has no asset-supply, rendering, provider or usage-ledger port.
 */
export function createSocialArtifactReevaluationService(input: {
  repository: Starter198Repository;
  backendFilePort?: SocialContentBackendFilePort;
  ports?: Partial<SocialArtifactReevaluationPorts>;
}) {
  const ports: SocialArtifactReevaluationPorts = {
    evaluate: evaluateSocialReplicationResult,
    createArtifact: createSocialContentArtifact,
    openMedia: openSocialArtifactPreviewMedia,
    readDetail: readSocialTaskDetail,
    ...input.ports,
  };
  return {
    async reevaluate(request: SocialArtifactReevaluationRequest): Promise<{
      artifact: SocialContentArtifact;
      evaluation: SocialReplicationEvaluation | null;
      mediaSha256: string;
      replayed: boolean;
    }> {
      if (![request.tenantId, request.userId, request.taskId, request.parentArtifactId,
        request.parentArtifactVersion, request.requestId].every(value => socialText(value))) {
        return fail('social_artifact_reevaluation_request_invalid', 400);
      }
      const expectedContentHash = socialText(request.parentContentHash).toLowerCase();
      const expectedMediaSha256 = socialText(request.expectedMediaSha256).toLowerCase();
      if (!sha256Pattern.test(expectedContentHash) || !sha256Pattern.test(expectedMediaSha256)) {
        return fail('social_artifact_reevaluation_request_invalid', 400);
      }
      const parents = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, request.tenantId, {
        where: { task_id: request.taskId, artifact_id: request.parentArtifactId }, perPage: 2,
      });
      if (parents.totalItems !== 1 || parents.items.length !== 1) return fail('social_artifact_reevaluation_parent_not_found', 404);
      const parentRecord = parents.items[0]!;
      if (socialText(parentRecord.version) !== request.parentArtifactVersion) return fail('social_artifact_reevaluation_parent_version_changed');
      if (socialText(parentRecord.content_hash).toLowerCase() !== expectedContentHash) return fail('social_artifact_reevaluation_parent_content_changed');
      const parentContent = artifactContent(parentRecord);
      const parent = socialArtifact(parentRecord);

      const opened = await ports.openMedia({
        repository: input.repository, tenantId: request.tenantId, taskId: request.taskId,
        artifactId: request.parentArtifactId, backendFilePort: input.backendFilePort,
      });
      if (opened.file.sha256.toLowerCase() !== expectedMediaSha256) return fail('social_artifact_reevaluation_media_changed');
      const directory = await mkdtemp(join(tmpdir(), 'social-artifact-reevaluation-'));
      const outputVideoPath = join(directory, 'owned-output.mp4');
      try {
        const actualMediaSha256 = await spoolAndHash(opened.body, outputVideoPath);
        if (actualMediaSha256 !== expectedMediaSha256) return fail('social_artifact_reevaluation_media_changed');

        const children = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, request.tenantId, {
          where: { task_id: request.taskId, parent_artifact_id: request.parentArtifactId }, perPage: 500,
        });
        const replay = children.items.find(record => reevaluationRequestId(socialObject(socialJson(record.content))) === request.requestId);
        if (replay) {
          const replayContent = artifactContent(replay);
          return { artifact: socialArtifact(replay), evaluation: evaluationFrom(replayContent), mediaSha256: actualMediaSha256, replayed: true };
        }

        const detail = await ports.readDetail({ repository: input.repository, tenantId: request.tenantId, taskId: request.taskId });
        if (!detail) return fail('social_artifact_reevaluation_context_missing');
        const agentWorkflow = detail.agentWorkflow;
        const replicationScript = detail.replicationScript;
        if (!agentWorkflow?.replicationJob || !replicationScript) return fail('social_artifact_reevaluation_context_missing');
        const parentProductionResult = socialObject(parentContent.productionResult);
        const productionResultId = socialText(parentProductionResult?.productionResultId);
        if (!productionResultId
          || socialText(parentProductionResult?.executionPlanId) !== agentWorkflow.executionPlan.executionPlanId) {
          return fail('social_artifact_reevaluation_context_changed');
        }
        const parentEvaluation = socialObject(parentContent.replicationEvaluation);
        if (parentEvaluation && socialText(parentEvaluation.replicationJobId)
          && socialText(parentEvaluation.replicationJobId) !== agentWorkflow.replicationJob.replicationJobId) {
          return fail('social_artifact_reevaluation_context_changed');
        }
        const stableTime = new Date(socialText(parentRecord.updated_at) || socialText(parentRecord.created_at));
        if (Number.isNaN(stableTime.getTime())) return fail('social_artifact_reevaluation_parent_time_invalid', 503);
        const evaluated = await ports.evaluate({
          workflow: agentWorkflow as SocialContentAgentWorkflow,
          replicationScript,
          referenceAnalysis: detail.referenceVideoAnalysis,
          productionResultId,
          outputVideoPath,
          evidence: {
            identityEvidence: identityEvidenceFromAssetSupply({ workflow: agentWorkflow, parentContent }),
            referenceVideoPath: await ports.resolveReferenceVideoPath?.({
              repository: input.repository, tenantId: request.tenantId, taskId: request.taskId,
              parentContent, workflow: agentWorkflow,
            }) ?? null,
            referenceText: replicationScript.shots
              .map(shot => shot.spokenText || shot.captionText || shot.visualInstruction).map(socialText).filter(Boolean).join('\n') || null,
            outputText: socialText(parentContent.adaptedScript) || null,
          },
          now: stableTime,
        });
        const content = {
          ...structuredClone(parentContent),
          ...(evaluated.evaluation ? { replicationEvaluation: evaluated.evaluation } : {}),
          reevaluation: {
            schemaVersion: 'social-artifact-reevaluation.v1', requestId: request.requestId,
            parentArtifactId: request.parentArtifactId, parentArtifactVersion: request.parentArtifactVersion,
            parentContentHash: expectedContentHash, mediaSha256: actualMediaSha256,
            evaluator: 'media_evaluation_worker', evaluatedAt: stableTime.toISOString(),
          },
          review: {
            state: 'requires_user_approval', automatedChecksPassed: evaluated.evaluation?.status === 'passed',
            reviewedBy: 'director_agent', ruleVersion: 'social-artifact-reevaluation.v1', reason: 'human_review_required',
          },
        };
        const created = await ports.createArtifact({
          repository: input.repository, tenantId: request.tenantId, userId: request.userId, taskId: request.taskId,
          idempotencyKey: `social-artifact-reevaluation:${request.parentArtifactId}:${request.requestId}`,
          trustedAgentOrigin: true, requireHumanReview: true, backendFilePort: input.backendFilePort,
          value: {
            kind: parent.kind, platform: parent.platform, language: parent.language, origin: 'agent',
            parentArtifactId: request.parentArtifactId, resourceRef: parent.resourceRef, content,
          },
          now: stableTime,
        });
        return { artifact: created.artifact, evaluation: evaluated.evaluation, mediaSha256: actualMediaSha256, replayed: false };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

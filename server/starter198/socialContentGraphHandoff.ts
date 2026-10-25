import type { PhaseEvidence } from '../contentExecution/langgraphEngine.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import type { Starter198Repository, StarterRecord } from './repository.js';
import { createSocialSceneReworkService } from './socialContentSceneReworkService.js';
import { readSocialProductionHandoff } from './socialContentProductionHandoff.js';
import { socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';

/**
 * The v4 handoff node is a read-only release boundary. It proves that the
 * approved artifact still points at the immutable scene cache and production
 * handoff already written by the production pipeline. It never persists a new
 * handoff, regenerates media, or calls a provider.
 */
export async function readSocialGraphHandoffEvidence(input: {
  repository: Starter198Repository;
  job: Pick<ContentExecutionJob, 'tenantId' | 'taskId' | 'runId'>;
  artifact: StarterRecord;
  approvalReceipt: string;
  graphInputHash: string;
}): Promise<PhaseEvidence> {
  const artifactId = socialText(input.artifact.artifact_id);
  const contentHash = socialText(input.artifact.content_hash);
  const content = socialObject(socialJson(input.artifact.content));
  const source = socialObject(content?.productionWorkspaceSource);
  if (!artifactId || !contentHash || !content || source?.runId !== input.job.runId
    || contentHash !== socialRequestHash({ resourceRef: input.artifact.resource_ref, content })) {
    throw new Error('graph_handoff_artifact_lineage_invalid');
  }
  const cache = await createSocialSceneReworkService(input.repository).readCache({
    tenantId: input.job.tenantId, taskId: input.job.taskId, runId: input.job.runId, parentArtifactId: artifactId,
  });
  const handoff = await readSocialProductionHandoff({
    repository: input.repository, tenantId: input.job.tenantId, taskId: input.job.taskId, version: cache.handoffVersion,
  });
  if (!handoff || handoff.handoffId !== cache.handoffId || handoff.taskId !== input.job.taskId
    || cache.cache.parentArtifactId !== artifactId || cache.cache.parentArtifactHash !== contentHash
    || cache.cache.runId !== input.job.runId || cache.cache.taskId !== input.job.taskId
    || cache.cache.tenantId !== input.job.tenantId) {
    throw new Error('graph_handoff_persisted_lineage_invalid');
  }
  const cacheHash = socialRequestHash(cache);
  return {
    artifactRefs: [artifactId, handoff.handoffId],
    inputHash: input.graphInputHash,
    metadata: {
      artifactId, contentHash, approvalReceipt: input.approvalReceipt,
      handoffId: handoff.handoffId, handoffVersion: handoff.version, handoffHash: handoff.recordHash,
      sceneCacheHash: cacheHash, sceneCount: cache.cache.scenes.length, externalPublishPerformed: false,
    },
  };
}

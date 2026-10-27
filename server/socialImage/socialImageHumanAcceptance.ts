import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { SOCIAL_IMAGE_HARD_CHECKS, socialImageCurrentOutputs, type SocialImageCreationTask,
  type SocialImageQualityCheck } from '../../shared/contracts/socialImageCreation.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { assertSocialImageCurrentContentTask, decideSocialImageCandidate, SocialImageProductionRunError } from './socialImageProductionRun.js';
import { continueSocialImageProduction } from './socialImageProductionContinuation.js';
import { socialImageCandidatePixelChecks } from './socialImageQuality.js';

/** A signed-in user can accept visual quality, while byte integrity and basic file checks stay deterministic. */
export async function acceptSocialImageQualityByHuman(input: {
  store: DataStore; tenantId: string; userId: string; taskId: string; expectedVersion: number;
  candidateId: string; candidateVersion: number; expectedContentHash: string;
  loadBytes: (tenantId: string, output: { mediaUrl?: string; materialId?: string }) => Promise<{ bytes: Buffer } | null>;
  now?: string;
}) {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (task.schemaVersion !== 'social-image-creation.v3' || !task.productionRuntime?.binding)
    throw new SocialImageProductionRunError('social_image_content_task_binding_missing', 409);
  if (task.imageType === 'carousel' || task.imageType === 'gif_poster' || task.status === 'approved')
    throw new SocialImageProductionRunError('social_image_human_review_scope_invalid', 409);
  if (task.fieldsToConfirm.length || task.contentBrief.factuality === 'mock')
    throw new SocialImageProductionRunError('social_image_approval_inputs_incomplete', 422);
  await assertSocialImageCurrentContentTask(input.store, input.tenantId, task, 'review_original_output');
  const output = socialImageCurrentOutputs(task).find(item => item.id === input.candidateId
    && item.version === input.candidateVersion && item.role === 'single' && item.state !== 'superseded');
  if (!output || !output.contentHash || output.contentHash !== input.expectedContentHash)
    throw new SocialImageProductionRunError('social_image_approval_candidate_stale', 409);
  const media = await input.loadBytes(input.tenantId, output);
  if (!media?.bytes.length) throw new SocialImageProductionRunError('social_image_candidate_bytes_unavailable', 422);
  if (createHash('sha256').update(media.bytes).digest('hex') !== output.contentHash)
    throw new SocialImageProductionRunError('social_image_candidate_hash_conflict', 409);
  const pixelChecks = await socialImageCandidatePixelChecks({ bytes: media.bytes, aspectRatio: task.deliverySpec.aspectRatio });
  if (pixelChecks.some(check => check.verdict !== 'pass'))
    throw new SocialImageProductionRunError('social_image_deterministic_quality_failed', 422);
  const acceptedAt = input.now || new Date().toISOString();
  const evidence = [`candidate-sha256:${output.contentHash}`, `human-reviewer:${input.userId}`];
  const humanCheck = (key: SocialImageQualityCheck['key'], severity: SocialImageQualityCheck['severity'],
    prior?: SocialImageQualityCheck, extraEvidence: string[] = []): SocialImageQualityCheck => ({
    key, severity, verdict: 'pass', checker: 'human',
    note: `用户已核对当前候选图片与配文并确认可采用；原检查：${prior?.verdict || '缺失'}`,
    evidence: [...new Set([...evidence, ...extraEvidence, ...(prior?.evidence || [])])],
  });
  const protectedKeys = new Set(['file_decode', 'pixel_dimensions']);
  const checks = output.qualityChecks.map(check => protectedKeys.has(check.key) ? pixelChecks.find(pixel => pixel.key === check.key)!
    : check.severity === 'hard' || check.key === 'reference_structure_similarity' || check.key.startsWith('hook_factor:')
      ? humanCheck(check.key, check.severity, check) : check);
  for (const pixel of pixelChecks) if (!checks.some(check => check.key === pixel.key)) checks.push(pixel);
  for (const key of SOCIAL_IMAGE_HARD_CHECKS.filter(key => !protectedKeys.has(key))) {
    if (!checks.some(check => check.key === key && check.severity === 'hard')) checks.push(humanCheck(key, 'hard'));
  }
  if (task.creationPath === 'viral_replication' && !checks.some(check => check.key === 'reference_structure_similarity'))
    checks.push(humanCheck('reference_structure_similarity', 'soft'));
  for (const factor of task.hookFactorSpec?.factors || []) {
    const key = `hook_factor:${factor.factorId}` as const;
    const refs = factor.evidenceRefs.map(ref => `reference-region-sha256:${ref.contentHash}`);
    const index = checks.findIndex(check => check.key === key);
    const prior = index >= 0 ? checks[index] : undefined;
    const accepted = humanCheck(key, 'soft', prior, refs);
    if (index >= 0) checks[index] = accepted;
    else checks.push(accepted);
  }
  const updated = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    outputs: task.outputs.map(item => item.id === output.id ? { ...item, state: 'quality_checking' as const,
      qualityChecks: checks, humanQualityReview: { acceptedBy: input.userId, acceptedAt,
        contentHash: output.contentHash!, priorChecks: output.qualityChecks } } : item),
    repairInstructions: task.repairInstructions.map(item => item.outputNodeId === output.id && item.status === 'pending'
      ? { ...item, status: 'waived' as const } : item),
    status: 'review_required', step: 'review',
  });
  if (updated.kind !== 'updated') throw new SocialImageProductionRunError(updated.kind === 'conflict'
    ? 'social_image_version_conflict' : 'social_image_human_review_persist_failed', updated.kind === 'conflict' ? 409 : 422);
  const continued = await continueSocialImageProduction({ store: input.store, tenantId: input.tenantId,
    taskId: task.id, expectedVersion: updated.task.version, now: acceptedAt });
  const approved = await decideSocialImageCandidate({ store: input.store, tenantId: input.tenantId, userId: input.userId,
    taskId: task.id, expectedVersion: continued.task.version, candidateId: output.id,
    candidateVersion: output.version, expectedContentHash: output.contentHash, actualContentHash: output.contentHash,
    decision: 'approved', idempotencyKey: `social-image-human-accept:${task.id}:${output.id}:${output.version}`,
    note: '用户已确认成片视觉质量与配文', now: acceptedAt });
  const delivered = await continueSocialImageProduction({ store: input.store, tenantId: input.tenantId,
    taskId: task.id, expectedVersion: approved.task.version, now: acceptedAt });
  return { task: delivered.task, decision: approved.decision, deliveryPackage: delivered.deliveryPackage };
}

import { createHash } from 'node:crypto';
import {
  socialImageOutputHardChecksPassed,
  socialImageReviewOutputs,
  type SocialImageCreationTask,
  type SocialImageOutputNode,
} from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageDirectorReviewDecision, SocialImageVersionedRef } from '../../shared/contracts/socialImageProduction.js';

export interface SocialImageReviewSet {
  outputs: SocialImageOutputNode[];
  anchor: SocialImageOutputNode;
  refs: SocialImageVersionedRef[];
  contentHash: string;
  qualityEvidenceHash: string;
  qualityPassed: boolean;
}

/** A multi-output decision is bound to the ordered, complete plan output set.
 * GIF background plates are intentionally absent: composed frames and the
 * encoded animation are checked and accepted together. */
export function resolveSocialImageReviewSet(
  task: SocialImageCreationTask,
  candidateId: string,
  candidateVersion: number,
): SocialImageReviewSet | null {
  const outputs = socialImageReviewOutputs(task);
  if (!outputs.length) return null;
  const multi = task.imageType === 'carousel' || task.imageType === 'gif_poster';
  const anchor = multi && task.imageType === 'gif_poster' ? outputs.at(-1)! : outputs[0]!;
  if (anchor.id !== candidateId || anchor.version !== candidateVersion) return null;
  if (outputs.some(output => !/^[a-f0-9]{64}$/.test(output.contentHash || ''))) return null;
  const refs = outputs.map(output => ({ objectType: 'social-image-candidate', id: output.id,
    version: output.version, contentHash: output.contentHash! }));
  const contentHash = multi
    ? createHash('sha256').update(JSON.stringify({ productionRunId: task.id,
      planVersion: task.renderPlan?.version, candidates: refs })).digest('hex')
    : anchor.contentHash!;
  const qualityEvidenceHash = createHash('sha256').update(JSON.stringify({ refs,
    checks: outputs.map(output => output.qualityChecks),
    preflight: outputs.map(output => output.qualityPreflight || null),
    hookFactorSpec: task.hookFactorSpec || null, adaptationSpec: task.adaptationSpec || null })).digest('hex');
  return { outputs, anchor, refs, contentHash, qualityEvidenceHash, qualityPassed: outputs.every(output =>
    ['quality_checking', 'approved'].includes(output.state) && socialImageOutputHardChecksPassed(output)) };
}

export function socialImageReviewRefsMatch(
  expected: SocialImageVersionedRef[],
  actual: SocialImageVersionedRef[] | undefined,
): boolean {
  return Boolean(actual && expected.length === actual.length && expected.every((ref, index) => {
    const candidate = actual[index];
    return candidate?.objectType === ref.objectType && candidate.id === ref.id
      && candidate.version === ref.version && candidate.contentHash === ref.contentHash;
  }));
}

/** Both single images and multi-output sets require the exact reviewed bytes
 * and independent QA evidence, not just a stable candidate id/version. */
export function socialImageDirectorReviewMatchesSet(
  reviewSet: SocialImageReviewSet | null,
  decision: SocialImageDirectorReviewDecision | undefined,
): boolean {
  return Boolean(reviewSet && decision?.decision === 'accept_for_user_review'
    && decision.candidateId === reviewSet.anchor.id && decision.candidateVersion === reviewSet.anchor.version
    && decision.candidateSetHash === reviewSet.contentHash
    && decision.qualityEvidenceHash === reviewSet.qualityEvidenceHash
    && socialImageReviewRefsMatch(reviewSet.refs, decision.candidateRefs));
}

import { createHash } from 'node:crypto';
import {
  socialImageOutputHardChecksPassed,
  socialImageReviewOutputs,
  type SocialImageCreationTask,
  type SocialImageOutputNode,
} from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageVersionedRef } from '../../shared/contracts/socialImageProduction.js';

export interface SocialImageReviewSet {
  outputs: SocialImageOutputNode[];
  anchor: SocialImageOutputNode;
  refs: SocialImageVersionedRef[];
  contentHash: string;
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
  return { outputs, anchor, refs, contentHash, qualityPassed: outputs.every(output =>
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

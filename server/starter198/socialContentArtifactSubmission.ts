import { persistGraphEvidenceSnapshot, readGraphEvidenceSnapshot } from './socialContentGraphContextSnapshots.js';
import type { CreateSocialArtifactInput } from '../../shared/contracts/socialContentWorkflow.js';
import { readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { stableSocialMediaInput } from './socialMediaInputIdentity.js';
import { socialRequestHash } from './socialContentValidation.js';

type Scope = { tenantId: string; taskId: string; runId: string };
type Submission = { schema: 'social-artifact-submission.v1'; scope: Scope; outputSha256: string; revisionHash: string;
  requireHumanReview: boolean; identity: unknown; valueHash: string; value: CreateSocialArtifactInput; recordHash: string };
type CompactSubmission = { schema: 'social-artifact-submission-ref.v1'; scope: Scope; outputSha256: string; revisionHash: string; submissionHash: string };
const stage = 'social.artifact_submission';
async function reviewIdentity(value: CreateSocialArtifactInput) {
  const copy = structuredClone(value), content = copy.content as Record<string, any> | undefined;
  // These are observations of this submission, not a new film or QA decision.
  // All actual evidence, checks, media identity and review policy remain bound.
  if (content?.generatedMaterial) delete content.generatedMaterial.adoptedAt;
  if (content?.productionResult) delete content.productionResult.createdAt;
  return stableSocialMediaInput(copy);
}
/** Freeze the full strict mutation payload before artifact creation. A changed
 * QA decision creates a new auditable revision, while recovery reuses exact
 * original timestamps/payload and never weakens mutation conflict checks. */
export async function freezeSocialArtifactSubmission(input: { scope: Scope; outputSha256: string; requireHumanReview: boolean; value: CreateSocialArtifactInput }, ports: {
  read?: (key: { stage: string; version: string; inputHash: string }) => Submission | CompactSubmission | null;
  write?: (key: { stage: string; version: string; inputHash: string; payload: Submission | CompactSubmission }) => Promise<void>;
  snapshotRoot?: string;
} = {}) {
  if (!input.scope.tenantId || !input.scope.taskId || !input.scope.runId || !/^[a-f0-9]{64}$/.test(input.outputSha256)) throw Error('artifact_submission_scope_invalid');
  const identity = { scope: input.scope, outputSha256: input.outputSha256, requireHumanReview: input.requireHumanReview, value: await reviewIdentity(input.value) };
  const revisionHash = socialRequestHash(identity), key = { stage, version: '1', inputHash: revisionHash };
  const read = ports.read || readCurrentContentExecutionCheckpoint<Submission | CompactSubmission>;
  const checkpoint = read(key);
  let saved: Submission | null = checkpoint?.schema === 'social-artifact-submission-ref.v1'
    ? readGraphEvidenceSnapshot<Submission>(checkpoint.submissionHash, ports.snapshotRoot) : checkpoint;
  if (checkpoint?.schema === 'social-artifact-submission-ref.v1' && (socialRequestHash(checkpoint.scope) !== socialRequestHash(input.scope)
    || checkpoint.outputSha256 !== input.outputSha256 || checkpoint.revisionHash !== revisionHash)) throw Error('artifact_submission_snapshot_changed');
  if (saved) {
    const { recordHash, ...body } = saved;
    if (recordHash !== socialRequestHash(body) || saved.schema !== 'social-artifact-submission.v1' || socialRequestHash(saved.scope) !== socialRequestHash(input.scope)
      || saved.outputSha256 !== input.outputSha256 || saved.revisionHash !== revisionHash || saved.requireHumanReview !== input.requireHumanReview
      || saved.valueHash !== socialRequestHash(saved.value)
      || socialRequestHash(saved.identity) !== revisionHash) throw Error('artifact_submission_snapshot_changed');
  } else {
    const body: Omit<Submission, 'recordHash'> = { schema: 'social-artifact-submission.v1', scope: structuredClone(input.scope), outputSha256: input.outputSha256, revisionHash,
      requireHumanReview: input.requireHumanReview, identity: structuredClone(identity), valueHash: socialRequestHash(input.value), value: structuredClone(input.value) };
    saved = { ...body, recordHash: socialRequestHash(body) };
    const submissionHash = persistGraphEvidenceSnapshot(saved, ports.snapshotRoot);
    await (ports.write || recordCurrentContentExecutionCheckpoint)({ ...key, payload: { schema: 'social-artifact-submission-ref.v1', scope: structuredClone(input.scope), outputSha256: input.outputSha256, revisionHash, submissionHash } });
    if (!read(key)) throw Error('artifact_submission_checkpoint_unavailable');
  }
  return { idempotencyKey: `social-auto-artifact:v2:${input.scope.runId}:${input.outputSha256}:${revisionHash}`, revisionHash, value: structuredClone(saved.value) };
}

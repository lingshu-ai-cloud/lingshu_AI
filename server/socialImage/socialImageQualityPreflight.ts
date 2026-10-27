import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask, SocialImageQualityCheck } from '../../shared/contracts/socialImageCreation.js';
import { qualityCheckSocialImageWithQwen } from '../agents/qwen.js';
import { SOCIAL_IMAGE_VISUAL_KEYS } from '../agents/socialImageQwen.js';
import { exactQwenScope } from '../agents/exactQwenScope.js';
import { assertSocialImageCurrentContentTask } from './socialImageProductionRun.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

type VisualInput = Parameters<typeof qualityCheckSocialImageWithQwen>[0];

export class SocialImageQualityPreflightError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const completeVisualChecks = (checks: SocialImageQualityCheck[]) => {
  const keys = new Set(checks.map(check => check.key));
  return checks.length === SOCIAL_IMAGE_VISUAL_KEYS.length && SOCIAL_IMAGE_VISUAL_KEYS.every(key => keys.has(key));
};

/** The claim key includes every image, expected fact, and model input sent to paid visual QA. */
export function socialImageVisualPreflightHash(input: VisualInput): string {
  return createHash('sha256').update(JSON.stringify({
    candidate: digest(input.generated.bytes),
    products: input.products.map(product => ({ name: product.name, hash: digest(product.bytes) })),
    reference: input.reference ? digest(input.reference.bytes) : null,
    expected: input.expected,
    model: (exactQwenScope()?.model || process.env.QWEN_EXACT_VL_MODEL || 'qwen3-vl-plus').trim(),
  })).digest('hex');
}

/** CAS-claim before transport; a lost receipt or unknown provider outcome never starts another paid call. */
export async function runSocialImageVisualPreflight(input: {
  store: DataStore; tenantId: string; taskId: string; outputId: string; visualInput: VisualInput;
  allowPaidCall: () => Promise<boolean>;
  qualityCheck?: typeof qualityCheckSocialImageWithQwen;
}): Promise<{ task: SocialImageCreationTask; visual: SocialImageQualityCheck[] } | null> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageQualityPreflightError('social_image_task_missing', 404);
  if (task.status === 'approved') throw new SocialImageQualityPreflightError('social_image_approved_immutable');
  const output = task.outputs.find(item => item.id === input.outputId && item.state !== 'superseded');
  if (!output) throw new SocialImageQualityPreflightError('social_image_output_missing', 404);
  const inputHash = socialImageVisualPreflightHash(input.visualInput);
  const prior = output.qualityPreflight;
  await assertSocialImageCurrentContentTask(input.store, input.tenantId, task);
  if (prior?.status === 'completed' && prior.inputHash === inputHash && prior.visualChecks) {
    if (!completeVisualChecks(prior.visualChecks)) throw new SocialImageQualityPreflightError('social_image_quality_response_invalid', 503);
    return { task, visual: prior.visualChecks };
  }
  if (prior && prior.status !== 'completed') {
    throw new SocialImageQualityPreflightError('social_image_quality_outcome_unresolved');
  }
  if (!input.store.compareAndSwap || await input.store.supportsAtomicCompareAndSwapFor?.('studio_projects') !== true) {
    throw new SocialImageQualityPreflightError('social_image_atomic_store_required', 503);
  }
  if (!await input.allowPaidCall()) return null;
  const claimedAt = new Date().toISOString();
  const claim = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    outputs: task.outputs.map(item => item.id === output.id
      ? { ...item, qualityPreflight: { inputHash, status: 'claimed' as const, claimedAt } } : item),
  });
  if (claim.kind !== 'updated') throw new SocialImageQualityPreflightError('social_image_quality_claim_conflict');
  let visual: SocialImageQualityCheck[];
  try {
    visual = await (input.qualityCheck || qualityCheckSocialImageWithQwen)(input.visualInput);
    if (!completeVisualChecks(visual)) {
      throw new SocialImageQualityPreflightError('social_image_quality_response_invalid', 502);
    }
  }
  catch (error) {
    const unknown = await updateSocialImageTask(input.store, input.tenantId, task.id, claim.task.version, {
      outputs: claim.task.outputs.map(item => item.id === output.id
        ? { ...item, qualityPreflight: { inputHash, status: 'outcome_unknown' as const, claimedAt } } : item),
    }).catch(() => null);
    if (unknown?.kind !== 'updated') throw new SocialImageQualityPreflightError('social_image_quality_receipt_write_unknown', 503);
    throw new SocialImageQualityPreflightError(error instanceof SocialImageQualityPreflightError
      && error.code === 'social_image_quality_response_invalid'
      ? error.code : 'social_image_quality_provider_outcome_unknown', 503);
  }
  const completed = await updateSocialImageTask(input.store, input.tenantId, task.id, claim.task.version, {
    outputs: claim.task.outputs.map(item => item.id === output.id
      ? { ...item, qualityPreflight: { inputHash, status: 'completed' as const, claimedAt,
        completedAt: new Date().toISOString(), visualChecks: visual } } : item),
  });
  if (completed.kind !== 'updated') throw new SocialImageQualityPreflightError('social_image_quality_receipt_write_unknown', 503);
  return { task: completed.task, visual };
}

import { createHash } from 'node:crypto';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';

/** The recorded human decision applies only to the exact reference bytes. */
export function referenceProductCheckHashIssue(task: SocialImageCreationTask, sourceSha256: string): string | null {
  const check = task.referenceProductCheck;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !check || check.sourceSha256 !== sourceSha256 || !check.confirmedBy || !Number.isFinite(Date.parse(check.confirmedAt))) return 'social_image_reference_product_confirmation_required';
  return check.decision === 'present' ? null : 'social_image_reference_product_shoot_required';
}
export function referenceProductCheckIssue(task: SocialImageCreationTask, bytes: Buffer | null): string | null {
  if (!bytes?.length) return 'social_image_reference_bytes_unreadable';
  return referenceProductCheckHashIssue(task, createHash('sha256').update(bytes).digest('hex'));
}

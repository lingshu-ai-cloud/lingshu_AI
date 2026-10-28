import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { referenceProductCheckIssue } from './socialImageReferenceProductCheck.js';

test('product confirmation belongs to the exact bytes; missing and negative evidence never admit production', () => {
  const bytes = Buffer.from('one'), hash = createHash('sha256').update(bytes).digest('hex');
  const task = { referenceProductCheck: { sourceSha256: hash, decision: 'present', confirmedBy: 'user', confirmedAt: '2026-10-28T00:00:00Z' } } as SocialImageCreationTask;
  assert.equal(referenceProductCheckIssue(task, bytes), null);
  assert.equal(referenceProductCheckIssue(task, null), 'social_image_reference_bytes_unreadable');
  assert.equal(referenceProductCheckIssue(task, Buffer.from('two')), 'social_image_reference_product_confirmation_required');
  assert.equal(referenceProductCheckIssue({ ...task, referenceProductCheck: undefined }, bytes), 'social_image_reference_product_confirmation_required');
  assert.equal(referenceProductCheckIssue({ ...task, referenceProductCheck: { ...task.referenceProductCheck!, decision: 'absent' } }, bytes), 'social_image_reference_product_shoot_required');
  assert.equal(referenceProductCheckIssue({ ...task, referenceProductCheck: { ...task.referenceProductCheck!, confirmedBy: '' } }, bytes), 'social_image_reference_product_confirmation_required');
});

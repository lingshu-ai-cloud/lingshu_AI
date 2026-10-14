import assert from 'node:assert/strict';
import {
  attachStudioSocialShotIdentities,
  normalizeStudioSocialShotId,
  resolveStudioSocialShot,
} from './studioSocialShotIdentity.js';

const slots = attachStudioSocialShotIdentities([
  { id: 'slot-1', title: '第一镜' },
  { id: 'slot-2', title: '第二镜' },
], ['replication-shot-a', 'replication-shot-b']);

assert.deepEqual(slots.map(slot => slot.sourceShotId), ['shot-a', 'shot-b']);
assert.equal(normalizeStudioSocialShotId('replication-shot-a'), 'shot-a');

const reordered = [slots[1], slots[0]];
assert.equal(resolveStudioSocialShot(reordered, { shotId: 'shot-a', shotIndex: 1 })?.id, 'slot-1',
  'reordering must not move a material or presenter plan to another shot');
assert.equal(resolveStudioSocialShot(reordered, { shotId: 'missing-shot', shotIndex: 0 }), undefined,
  'a modern but mismatched ID must not fall back to array position');
assert.equal(resolveStudioSocialShot(reordered, { shotId: '', shotIndex: 0 })?.id, 'slot-2',
  'only historic records without a shot ID may use positional fallback');

assert.equal(attachStudioSocialShotIdentities(slots, ['duplicate', 'duplicate']), slots,
  'an incomplete or ambiguous handoff must not overwrite existing identities');
assert.equal(attachStudioSocialShotIdentities(slots, ['new-a', 'new-b']), slots,
  'a persisted complete identity map must not be rewritten by reference-shot order');

console.log('studio social shot identity tests passed');

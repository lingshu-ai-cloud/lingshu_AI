import test from 'node:test';
import assert from 'node:assert/strict';
import { shootingSourceBinding, shootingReferenceClip, taskReferencePreview } from './shootingReference.js';

const project = () => ({ id: 'saved-project', spec: { activeAssemblyId: 'assembly',
  shootingSlots: [{ id: 'durable-shot', slotId: 'slot-15', requirements: 'saved-requirements' }],
  storyboardTimeline: [{ id: 'slot-15', sourceShotId: 'factory' }],
  videoKickoff: { video: { referenceRecordId: 'benchmark' }, referenceAnalysis: { details: [
    { shotId: 'product', time: '0–2s' }, { shotId: 'replication-factory', time: '23.77s–25.30s', visual: '工厂灌装镜头' },
  ] } },
} });
test('saved draft produces durable task and reference bindings independently of output timing', () => {
  const saved = project();
  const binding = shootingSourceBinding(saved, 'slot-15', { assemblyId: 'assembly', requirements: 'saved-requirements' });
  assert.equal(binding.sourceShotId, 'durable-shot');
  const referenceClip = shootingReferenceClip(binding, saved)!;
  assert.equal(referenceClip.videoId, 'benchmark');
  assert.equal(referenceClip.referenceShotId, 'replication-factory');
  assert.equal(referenceClip.startSeconds, 23.77);
  assert.equal(referenceClip.endSeconds, 25.3);
  assert.equal(taskReferencePreview({ ...binding, referenceClip })?.referenceRecordId, 'benchmark');
  assert.equal('url' in referenceClip, false);
});
test('save acknowledgement cannot silently switch assembly, requirements or ambiguous shot', () => {
  for (const expected of [{ assemblyId: 'old-assembly', requirements: 'saved-requirements' }, { assemblyId: 'assembly', requirements: 'old-requirements' }]) {
    assert.throws(() => shootingSourceBinding(project(), 'slot-15', expected), /原草稿或分镜要求已变化/);
  }
  const saved = project(); saved.spec.shootingSlots.push({ ...saved.spec.shootingSlots[0] });
  assert.throws(() => shootingSourceBinding(saved, 'slot-15'), /原草稿或分镜要求已变化/);
  assert.throws(() => shootingSourceBinding(project(), 'missing'), /原草稿或分镜要求已变化/);
});
test('persisted reference refuses a snapshot from another task or an invalid interval', () => {
  const binding = shootingSourceBinding(project(), 'slot-15'), clip = shootingReferenceClip(binding, project())!;
  for (const patch of [{ projectId: 'foreign' }, { shotId: 'other' }, { storyboardSlotId: 'other' },
    { startSeconds: NaN }, { startSeconds: -1 }, { endSeconds: 0 }, { videoId: '' }]) {
    assert.equal(taskReferencePreview({ ...binding, referenceClip: { ...clip, ...patch } }), null);
  }
});

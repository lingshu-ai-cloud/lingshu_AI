import assert from 'node:assert/strict';
import test from 'node:test';
import { imageReplicationReferenceRatio } from './imageReplicationReferenceRatio';

test('selected reference dimensions drive the delivery ratio before queueing', () => {
  assert.equal(imageReplicationReferenceRatio(590, 590), '1:1');
  assert.equal(imageReplicationReferenceRatio(800, 1000), '4:5');
  assert.equal(imageReplicationReferenceRatio(720, 1280), '9:16');
  assert.equal(imageReplicationReferenceRatio(1920, 1080), '16:9');
  assert.equal(imageReplicationReferenceRatio(900, 1200), '4:5');
  assert.equal(imageReplicationReferenceRatio(800, 600), '1:1');
  assert.equal(imageReplicationReferenceRatio(0, 0), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostRecord } from './waLink.js';
import { hasPublishedTargets, publicPost } from './postPresentation.js';

const draft: PostRecord = {
  id: 'post-1', tenant_id: 'tenant-a', platform: 'facebook', track_code: 'TRACK',
  stats: { status: 'scheduled', description: '  Draft copy  ', imagePaths: [' image-a.png ', ''], publishAttempts: 2 },
};

test('post presentation keeps tenant-safe public fields and normalized values', () => {
  const presented = publicPost(draft);
  assert.equal(presented.tenantId, 'tenant-a');
  assert.equal(presented.description, 'Draft copy');
  assert.deepEqual(presented.imagePaths, ['image-a.png']);
  assert.equal(presented.publishAttempts, 2);
  assert.equal(presented.videoPreviewUrl, '');
});

test('published-target guard recognizes a provider result even before the top-level post ID is filled', () => {
  assert.equal(hasPublishedTargets(draft), false);
  assert.equal(hasPublishedTargets({ ...draft, stats: { publishResults: { facebook: { status: 'published' } } } }), true);
});

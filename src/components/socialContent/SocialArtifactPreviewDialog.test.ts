import assert from 'node:assert/strict';
import type { SocialContentArtifact } from '../../../shared/contracts/socialContentWorkflow.js';
import {
  socialArtifactHasArchivedMedia,
  socialArtifactReadableCopy,
} from './SocialArtifactPreviewDialog.js';

const artifact: SocialContentArtifact = {
  artifactId: 'socialartifact_1234567890abcdef12345678',
  taskId: 'socialtask_1234567890abcdef12345678',
  kind: 'internal-render-v2',
  platform: 'tiktok',
  language: 'zh-CN',
  version: 'framework-v1',
  status: 'approved',
  origin: 'agent',
  resourceRef: 'socialfile:socialfile_1234567890abcdef12345678',
  content: { title: '新品短视频', body: '面向户外家庭的发布文案。', internalKey: 'do-not-render' },
  parentArtifactId: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
};

assert.equal(socialArtifactHasArchivedMedia(artifact), true);
assert.equal(socialArtifactHasArchivedMedia({ ...artifact, resourceRef: 'file:///tmp/private.mp4' }), false);
assert.equal(socialArtifactHasArchivedMedia({ ...artifact, resourceRef: 'socialfile:socialfile_1234567890abcdef12345678/../other' }), false);
assert.deepEqual(socialArtifactReadableCopy(artifact), { title: '新品短视频', body: '面向户外家庭的发布文案。' });
assert.doesNotMatch(JSON.stringify(socialArtifactReadableCopy(artifact)), /internalKey|do-not-render/);

console.log('social artifact preview tests passed');

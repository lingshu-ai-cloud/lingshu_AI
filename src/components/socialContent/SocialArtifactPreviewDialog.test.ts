import assert from 'node:assert/strict';
import type { SocialContentArtifact } from '../../../shared/contracts/socialContentWorkflow.js';
import {
  socialArtifactGenerationDisclosure,
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
assert.equal(socialArtifactGenerationDisclosure(artifact).approvalAllowed, true, 'non-Studio artifacts retain the manual review path');

const verifiedStudioArtifact: SocialContentArtifact = {
  ...artifact,
  origin: 'manual',
  content: {
    ...artifact.content,
    sourceKey: 'studio_session_1',
    projectId: 'project-1',
    generationKind: 'script',
    generationProvenance: 'ai',
    qualityStatus: 'passed',
    publishable: true,
    generationRecordId: 'script-v1',
  },
};
assert.deepEqual(socialArtifactGenerationDisclosure(verifiedStudioArtifact), {
  sourceLabel: 'Studio AI 生成',
  verificationLabel: '质量验证通过 · 可确认',
  verified: true,
  approvalAllowed: true,
});
assert.deepEqual(socialArtifactGenerationDisclosure({
  ...verifiedStudioArtifact,
  content: { ...verifiedStudioArtifact.content, generationProvenance: 'manual_draft', qualityStatus: 'stale', publishable: false },
}), {
  sourceLabel: 'Studio 手动草稿',
  verificationLabel: '质量待验证 · 不可交付',
  verified: false,
  approvalAllowed: false,
});

console.log('social artifact preview tests passed');

import assert from 'node:assert/strict';
import type { SocialContentArtifact } from '../../../shared/contracts/socialContentWorkflow.js';
import {
  socialArtifactGenerationDisclosure,
  socialArtifactHasArchivedMedia,
  socialArtifactMaterialReview,
  socialArtifactReadableCopy,
  socialArtifactReleaseSummary,
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

const focused = socialArtifactMaterialReview({
  ...artifact,
  content: {
    materialLearning: {
      schemaVersion: 'material-match-review.v1',
      scenes: [{ sceneId: 'scene-1', decision: 'human_review_required', reviewPriority: 'high',
        selectedClipId: 'clip-1', reasonCodes: ['small_score_margin'],
        candidates: [{ clipId: 'clip-1', sourceStart: 1, sourceEnd: 3 }] }],
    },
  },
});
assert.equal(focused[0]?.sceneId, 'scene-1');
assert.match(focused[0]?.reasons.join('') || '', /首选与备选/);

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
  releaseState: 'ready_for_review',
});
assert.deepEqual(socialArtifactGenerationDisclosure({
  ...verifiedStudioArtifact,
  content: { ...verifiedStudioArtifact.content, generationProvenance: 'manual_draft', qualityStatus: 'stale', publishable: false },
}), {
  sourceLabel: 'Studio 手动草稿',
  verificationLabel: '质量待验证 · 不可交付',
  verified: false,
  approvalAllowed: false,
  releaseState: 'unverified',
});

const blockedGeneratedArtifact: SocialContentArtifact = {
  ...artifact,
  status: 'review_required',
  content: {
    workflowSchema: 'social-content.auto-production.v3',
    delivery: { status: 'requires_revision' },
    productionResult: { creativeReview: { approved: false } },
    replicationEvaluation: {
      status: 'failed',
      viralFactorFidelity: { status: 'failed' },
      identityReplacement: { status: 'failed' },
    },
  },
};
assert.equal(socialArtifactGenerationDisclosure(blockedGeneratedArtifact).approvalAllowed, false);
assert.equal(socialArtifactReleaseSummary(blockedGeneratedArtifact).title, '不可发布 · 需要修改');
assert.deepEqual(socialArtifactReleaseSummary(blockedGeneratedArtifact).issues, [
  '爆款结构还原不足', '产品或人物替换未验证',
]);

console.log('social artifact preview tests passed');

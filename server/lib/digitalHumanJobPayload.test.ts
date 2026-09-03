import assert from 'node:assert/strict';
import { buildDigitalHumanProviderJobPayload } from './digitalHumanJobPayload.js';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  digitalHumanAssetSupportsUsage,
  parseDigitalHumanUsagePurpose,
} from './digitalHumanUsageRights.js';

const job = {
  id: 'remote-job-1',
  provider: 'musetalk-v1.5-local',
  mode: 'quality' as const,
  scriptSnapshot: '第一段口播',
  language: 'zh',
  usagePurpose: 'internal_preview' as const,
  performancePlanVersion: 'performance-v1' as const,
  performancePlan: { version: 'performance-v1', beats: [{ startMs: 0, endMs: 3000 }] },
  motionClipIds: ['motion-material-1'],
  pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
  storyboardSlotId: 'shot-1',
  audioStartSeconds: 0,
  audioEndSeconds: 3,
  inputSignature: 'input-signature-1',
};
const payload = buildDigitalHumanProviderJobPayload(job, {
  avatarVideoUrl: 'https://app.example/avatar.mp4?signature=avatar',
  audioUrl: 'https://app.example/audio.wav?signature=voice',
  motionClips: [{ id: 'motion-1', videoUrl: 'https://app.example/motion.mp4?signature=motion', beatIds: ['beat-1'] }],
});
assert.equal(payload.externalJobId, job.id);
assert.equal(payload.script, job.scriptSnapshot);
assert.equal(payload.usagePurpose, 'internal_preview');
assert.equal(payload.audioUrl, 'https://app.example/audio.wav?signature=voice');
assert.equal(payload.inputSignature, job.inputSignature);
assert.deepEqual(payload.audioSegment, { startSeconds: 0, endSeconds: 3 });
assert.deepEqual(payload.motionClipIds, ['motion-material-1']);
assert.deepEqual(payload.motionClips[0], {
  id: 'motion-1', videoUrl: 'https://app.example/motion.mp4?signature=motion', beatIds: ['beat-1'],
});
assert.deepEqual(payload.output, { ratio: '9:16', container: 'mp4' });
assert.equal(payload.pipelineVersion, DIGITAL_HUMAN_PIPELINE_VERSION);
assert.equal(buildDigitalHumanProviderJobPayload({ ...job, pipelineVersion: undefined }, {
  avatarVideoUrl: 'https://app.example/avatar.mp4',
  audioUrl: 'https://app.example/audio.wav',
  motionClips: [{ id: 'motion-1', videoUrl: 'https://app.example/motion.mp4' }],
}).pipelineVersion, DIGITAL_HUMAN_PIPELINE_VERSION, '缺省任务必须提升到P1');
assert.throws(() => buildDigitalHumanProviderJobPayload({ ...job, pipelineVersion: 'digital-human-v2-p0' }, {
  avatarVideoUrl: 'https://app.example/avatar.mp4',
  audioUrl: 'https://app.example/audio.wav',
  motionClips: [{ id: 'motion-1', videoUrl: 'https://app.example/motion.mp4' }],
}), /expected digital-human-v2-p1/, 'P0任务不得使用P1渲染链产生错误缓存身份');
assert.throws(() => buildDigitalHumanProviderJobPayload(job, {
  avatarVideoUrl: 'https://app.example/avatar.mp4', audioUrl: 'https://app.example/audio.wav', motionClips: [],
}), /do not match requested IDs/);

const internalPreviewAsset = {
  productionReady: true,
  rightsStatus: 'commercial_cleared',
  rightsUsageScope: ['internal_preview'],
};
assert.equal(parseDigitalHumanUsagePurpose(undefined), 'internal_preview', '缺省用途只能降级为内部预览');
assert.equal(parseDigitalHumanUsagePurpose('paid_media'), 'paid_media');
assert.equal(parseDigitalHumanUsagePurpose('public_everywhere'), null, '未知用途必须拒绝');
assert.equal(digitalHumanAssetSupportsUsage(internalPreviewAsset, 'internal_preview'), true);
assert.equal(digitalHumanAssetSupportsUsage(internalPreviewAsset, 'customer_delivery'), false, '内部预览授权不得交付客户');
assert.equal(digitalHumanAssetSupportsUsage(internalPreviewAsset, 'paid_media'), false, '内部预览授权不得投放');
assert.equal(digitalHumanAssetSupportsUsage({ ...internalPreviewAsset, rightsStatus: 'internal_test' }, 'internal_preview'), false, '未完成权利清算不得进入生产链路');
assert.equal(digitalHumanAssetSupportsUsage({ ...internalPreviewAsset, rightsUsageScope: undefined }, 'internal_preview'), false, '缺少用途授权不得默认放行');
assert.equal(digitalHumanAssetSupportsUsage({ ...internalPreviewAsset, productionReady: false }, 'internal_preview'), false);
assert.equal(digitalHumanAssetSupportsUsage({ ...internalPreviewAsset, productionReady: undefined }, 'internal_preview'), false, '未显式生产就绪不得放行');

console.log('digital human provider-payload tests passed');

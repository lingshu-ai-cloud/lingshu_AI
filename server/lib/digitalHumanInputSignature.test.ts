import assert from 'node:assert/strict';
import { digitalHumanCanonicalInputSignature } from './digitalHumanInputSignature.js';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';

const base = {
  tenantId: 'tenant-a',
  projectId: 'project-1',
  storyboardSlotId: 'shot-1',
  audioStartSeconds: 0,
  audioEndSeconds: 3.2004,
  voiceoverUrl: '/tts/tenants/tenant-a/voice.wav',
  script: '你好，欢迎看房。',
  language: 'zh_CN',
  avatar: {
    materialId: 'avatar-material-1',
    avatarId: 'avatar-1',
    version: 3,
    sourceHash: 'A'.repeat(64),
    sourceRevision: 'avatar.mp4|2026-09-03T00:00:00.000Z',
  },
  performancePlanVersion: 'performance-v1',
  performancePlan: {
    scene: { composition: 'medium', camera: 'push_in' },
    beats: [{ id: 'beat-1', startMs: 0, endMs: 3200, expression: 'smile' }],
  },
  motionAssets: [{ materialId: 'motion-1', avatarId: 'avatar-1', version: 3, sourceHash: 'b'.repeat(64) }],
  pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
  mode: 'quality',
  usagePurpose: 'internal_preview',
};

const signature = digitalHumanCanonicalInputSignature(base);
assert.match(signature, /^digital-human-input-v2:[0-9a-f]{64}$/);

assert.equal(digitalHumanCanonicalInputSignature({
  ...base,
  language: 'ZH-cn',
  script: `\r\n${base.script}\r\n`,
  audioEndSeconds: 3.2,
  performancePlan: {
    beats: [{ expression: 'smile', endMs: 3200, id: 'beat-1', startMs: 0 }],
    scene: { camera: 'push_in', composition: 'medium' },
  },
}), signature, 'equivalent normalized inputs and object key order must produce one signature');

for (const [name, patch] of Object.entries({
  script: { script: '你好，换一套房。' },
  audioRange: { audioEndSeconds: 3.4 },
  voiceover: { voiceoverUrl: '/tts/tenants/tenant-a/new.wav' },
  language: { language: 'en' },
  avatarVersion: { avatar: { ...base.avatar, version: 4 } },
  avatarSource: { avatar: { ...base.avatar, sourceHash: 'c'.repeat(64) } },
  performancePlan: { performancePlan: { ...base.performancePlan, scene: { composition: 'close', camera: 'static' } } },
  motionOrder: { motionAssets: [
    { materialId: 'motion-2', avatarId: 'avatar-1', version: 3, sourceHash: 'd'.repeat(64) },
    ...base.motionAssets,
  ] },
  tenant: { tenantId: 'tenant-b' },
  mode: { mode: 'fast' },
  pipelineVersion: { pipelineVersion: 'digital-human-v2-p0' },
})) {
  assert.notEqual(digitalHumanCanonicalInputSignature({ ...base, ...patch }), signature, `${name} must invalidate reuse`);
}

assert.throws(() => digitalHumanCanonicalInputSignature({ ...base, audioEndSeconds: Number.NaN }), /finite/);

console.log('digital human canonical input signature tests passed');

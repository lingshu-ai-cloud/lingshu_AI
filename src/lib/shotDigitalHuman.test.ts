import assert from 'node:assert/strict';
import {
  isShotDigitalHumanActive,
  isShotDigitalHumanCurrent,
  isShotDigitalHumanSourceCurrent,
  legacyShotDigitalHumanSignature,
  localizedDigitalHumanShotText,
  resolveShotDigitalHumanResult,
  resolveShotDigitalHumanSpeechSegment,
  shotDigitalHumanSignature,
  shotDigitalHumanSourceFingerprint,
} from './shotDigitalHuman.js';
import {
  DIGITAL_HUMAN_PIPELINE_VERSION,
  parseDigitalHumanPipelineVersion,
} from './digitalHumanPipeline.js';

const base = { slotId: 'shot-1', script: '你好', language: 'zh', voiceoverUrl: '/tts/a.mp3', start: 0, end: 3, avatarMaterialId: 'avatar-1' };
const signature = shotDigitalHumanSignature(base);
const sourceFingerprint = shotDigitalHumanSourceFingerprint(base);
assert.equal(signature, shotDigitalHumanSignature({ ...base }));
assert.ok(sourceFingerprint.includes(DIGITAL_HUMAN_PIPELINE_VERSION), '分镜源指纹必须使用P1');
assert.ok(signature.startsWith(JSON.stringify(sourceFingerprint)), '完整表演签名必须嵌入源指纹');
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, pipelineVersion: 'digital-human-v2-p0' }),
  'P0成片不得被P1分镜缓存复用');
assert.notEqual(sourceFingerprint, shotDigitalHumanSourceFingerprint({ ...base, pipelineVersion: 'digital-human-v2-p0' }));
assert.equal(parseDigitalHumanPipelineVersion(undefined), DIGITAL_HUMAN_PIPELINE_VERSION);
assert.equal(parseDigitalHumanPipelineVersion('digital-human-v2-p0'), undefined);
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, script: '文案已修改' }));
assert.notEqual(sourceFingerprint, shotDigitalHumanSourceFingerprint({ ...base, script: '文案已修改' }));
assert.notEqual(sourceFingerprint, shotDigitalHumanSourceFingerprint({ ...base, voiceoverUrl: '/tts/b.mp3' }));
assert.notEqual(sourceFingerprint, shotDigitalHumanSourceFingerprint({ ...base, avatarVersion: 2 }));
assert.notEqual(sourceFingerprint, shotDigitalHumanSourceFingerprint({ ...base, language: 'en' }));
assert.equal(
  shotDigitalHumanSourceFingerprint({ ...base, voiceoverUrl: '/tts/a.mp3?token=new#play' }),
  sourceFingerprint,
  '签名播放 URL 换 token 不应误伤同一音频',
);
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, motionClipIds: ['gesture-b'] }));
assert.notEqual(
  shotDigitalHumanSignature({ ...base, motionClipIds: ['gesture-a', 'gesture-b'] }),
  shotDigitalHumanSignature({ ...base, motionClipIds: ['gesture-b', 'gesture-a'] }),
  'swapping beat-ordered actions must change the render signature',
);
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, scenePlanFingerprint: 'scene-b' }));
assert.equal(isShotDigitalHumanActive('quality_check'), true);
assert.equal(isShotDigitalHumanActive('completed'), false);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'completed', inputSignature: signature }, signature), true);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'stale', inputSignature: signature }, signature), false);

const profiledBinding = {
  jobId: 'profile-job', avatarMaterialId: 'avatar-1', status: 'completed' as const,
  inputSignature: 'digital-human-input-v2:server-canonical', sourceFingerprint,
  performanceSignature: 'explicit-profile-performance-signature',
};
assert.equal(isShotDigitalHumanSourceCurrent(profiledBinding, sourceFingerprint), true, '刷新不得用默认 planner 删除显式 profile binding');
assert.equal(isShotDigitalHumanSourceCurrent(profiledBinding, shotDigitalHumanSourceFingerprint({ ...base, script: '改过的口播' })), false);
assert.equal(isShotDigitalHumanSourceCurrent(profiledBinding, shotDigitalHumanSourceFingerprint({ ...base, voiceoverUrl: '/tts/new.mp3' })), false);
assert.equal(isShotDigitalHumanSourceCurrent(profiledBinding, shotDigitalHumanSourceFingerprint({ ...base, avatarMaterialId: 'avatar-2' })), false);

const legacySignature = legacyShotDigitalHumanSignature(base);
const legacyBinding = { jobId: 'legacy-binding', avatarMaterialId: 'avatar-1', status: 'completed' as const, inputSignature: legacySignature };
assert.equal(isShotDigitalHumanSourceCurrent(legacyBinding, sourceFingerprint, legacySignature), true, '可严格复现的无源指纹旧 binding 应兼容');
assert.equal(isShotDigitalHumanSourceCurrent(legacyBinding, sourceFingerprint), false, '无法证明旧签名时必须 fail closed');
const legacyP0Binding = {
  ...legacyBinding,
  jobId: 'legacy-p0',
  inputSignature: legacyShotDigitalHumanSignature({ ...base, pipelineVersion: 'digital-human-v2-p0' }),
};
assert.equal(isShotDigitalHumanSourceCurrent(legacyP0Binding, sourceFingerprint, legacySignature), false, 'P0 旧成片必须安全失效，不得跨 pipeline 复用');

// 模拟用户为一个分镜选择数字人：后台完成后只返回该分镜应绑定的素材。
const binding = { jobId: 'job-1', avatarMaterialId: 'avatar-1', status: 'processing' as const, inputSignature: signature };
const completed = resolveShotDigitalHumanResult({ binding, currentSignature: signature, jobStatus: 'completed', outputMaterialId: 'digital-shot-1' });
assert.equal(completed.assignmentMaterialId, 'digital-shot-1');
assert.equal(completed.binding.status, 'completed');
const changed = resolveShotDigitalHumanResult({ binding, currentSignature: `${signature}|changed`, jobStatus: 'completed', outputMaterialId: 'must-not-bind' });
assert.equal(changed.assignmentMaterialId, undefined);
assert.equal(changed.binding.status, 'stale');
const profiledCompleted = resolveShotDigitalHumanResult({
  binding: profiledBinding,
  currentSourceFingerprint: sourceFingerprint,
  jobInputSignature: profiledBinding.inputSignature,
  jobSourceFingerprint: sourceFingerprint,
  jobStatus: 'completed',
  outputMaterialId: 'profile-output',
});
assert.equal(profiledCompleted.assignmentMaterialId, 'profile-output');
const missingServerSource = resolveShotDigitalHumanResult({
  binding: profiledBinding,
  currentSourceFingerprint: sourceFingerprint,
  jobInputSignature: profiledBinding.inputSignature,
  jobStatus: 'completed',
  outputMaterialId: 'unverified-profile-output',
});
assert.equal(missingServerSource.assignmentMaterialId, undefined, '新 binding 缺服务端源指纹时必须 fail closed');
const crossedLanguage = resolveShotDigitalHumanResult({
  binding: profiledBinding,
  currentSourceFingerprint: shotDigitalHumanSourceFingerprint({ ...base, language: 'en' }),
  jobInputSignature: profiledBinding.inputSignature,
  jobSourceFingerprint: sourceFingerprint,
  jobStatus: 'completed',
  outputMaterialId: 'wrong-language-output',
});
assert.equal(crossedLanguage.assignmentMaterialId, undefined, '跨语言输出不得串 binding');

const english = [
  "Upgrading homes? Don't compare price alone.",
  'Put access, living space, and total cost side by side.',
  'Verify every property detail before deciding.',
  'Message us for the layout and budget checklist.',
].join('\n');
assert.equal(localizedDigitalHumanShotText(english, 0, 4), "Upgrading homes? Don't compare price alone.");
assert.equal(localizedDigitalHumanShotText(english, 3, 4), 'Message us for the layout and budget checklist.');

const aligned = resolveShotDigitalHumanSpeechSegment({
  fullScript: english,
  slotIndex: 0,
  slotCount: 4,
  fallbackStart: 0,
  fallbackEnd: 3,
  cues: [
    { text: 'Upgrading homes?', start: 0, end: 1.38 },
    { text: "Don't compare price alone.", start: 1.38, end: 3.5 },
    { text: 'Put access, living space, and total cost side by side.', start: 3.5, end: 7.64 },
    { text: 'Verify every property detail before deciding.', start: 7.64, end: 11.33 },
    { text: 'Message us for the layout and budget checklist.', start: 11.33, end: 15.01 },
  ],
});
assert.deepEqual(aligned, {
  text: "Upgrading homes? Don't compare price alone.",
  start: 0,
  end: 3.5,
  alignmentSource: 'tts_cues',
});
const finalAligned = resolveShotDigitalHumanSpeechSegment({
  fullScript: english,
  slotIndex: 3,
  slotCount: 4,
  fallbackStart: 10.6,
  fallbackEnd: 15,
  cues: [
    { text: 'Upgrading homes?', start: 0, end: 1.38 },
    { text: "Don't compare price alone.", start: 1.38, end: 3.5 },
    { text: 'Put access,', start: 3.5, end: 4.42 },
    { text: ' living space, and total cost side by side.', start: 4.42, end: 7.64 },
    { text: 'Verify every property detail before decidi', start: 7.64, end: 11.05 },
    { text: 'ng.', start: 11.05, end: 11.33 },
    { text: 'Message us for the layout and budget check', start: 11.33, end: 14.55 },
    { text: 'list.', start: 14.55, end: 15.01 },
  ],
});
assert.equal(finalAligned.start, 11.33);
assert.equal(finalAligned.end, 15.01);
assert.equal(finalAligned.alignmentSource, 'tts_cues');

const mismatched = resolveShotDigitalHumanSpeechSegment({
  fullScript: english,
  slotIndex: 1,
  slotCount: 4,
  fallbackStart: 3,
  fallbackEnd: 6.7,
  cues: [{ text: 'unrelated audio', start: 0, end: 3 }],
});
assert.equal(mismatched.start, 3);
assert.equal(mismatched.end, 6.7);
assert.equal(mismatched.alignmentSource, 'storyboard_timeline');

console.log('shot digital human state tests passed');

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { planDigitalHumanPerformance } from '../../src/lib/digitalHumanPerformance.js';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  DIGITAL_HUMAN_MOUTH_LOCAL_IDENTITY_FILTER,
  DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
} from './digitalHumanRenderTreatment.js';
import {
  DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT,
  DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_VERSION,
  DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH,
  DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION,
  buildDigitalHumanMultiBeatIntermediateFilter,
  buildPerformanceExecutionReceipt,
  buildPerformanceExecutionRecipe,
  digitalHumanPerformanceShotGate,
  parseExecutablePerformancePlan,
} from './digitalHumanPerformanceExecution.js';

const sourcePlan = planDigitalHumanPerformance({
  script: '买房别只看总价。地铁和配套才是关键。现在私信领取房源对比。',
  durationMs: 15_000,
  preset: 'commerce',
  sceneIndex: 1,
});
const plan = parseExecutablePerformancePlan(sourcePlan);
const clipIds = plan.beats.map((_, index) => `motion-${index + 1}`);
const recipe = buildPerformanceExecutionRecipe({ plan, motionClipIds: clipIds, fps: 25 });
const temporalRecipe = buildPerformanceExecutionRecipe({
  plan, motionClipIds: clipIds, fps: 25, finalTreatmentId: 'mouth_jump_tmix2_equal_unsharp',
});
const mouthLocalRecipe = buildPerformanceExecutionRecipe({
  plan, motionClipIds: clipIds, fps: 25, finalTreatmentId: 'mouth_jump_mouth_local_v1',
});

assert.equal(recipe.version, DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION);
assert.equal(recipe.pipelineVersion, DIGITAL_HUMAN_PIPELINE_VERSION);
assert.equal(recipe.finalSharpenFilter, DIGITAL_HUMAN_FINAL_SHARPEN_FILTER);
assert.equal(recipe.finalTreatmentId, 'baseline_unsharp');
assert.equal(temporalRecipe.temporalStabilityFilter, DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER);
assert.equal(temporalRecipe.finalSharpenFilter, DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER);
assert.equal(temporalRecipe.filterComplex.split(DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER).length - 1, 1);
assert.equal(temporalRecipe.filterComplex.split(DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER).length - 1, 1);
assert.equal(temporalRecipe.filterComplex.split(DIGITAL_HUMAN_FINAL_SHARPEN_FILTER).length - 1, 0,
  '时序兜底不得在基线0.35锐化后再叠加0.50');
assert.equal(mouthLocalRecipe.temporalStabilityFilter, null);
assert.equal(mouthLocalRecipe.finalSharpenFilter, null);
assert.equal(mouthLocalRecipe.finalVideoFilter, DIGITAL_HUMAN_MOUTH_LOCAL_IDENTITY_FILTER);
assert.match(mouthLocalRecipe.filterComplex, /,null\[v\]$/,
  'mouth-local performance recipe 必须用明确 identity suffix');
assert.doesNotMatch(mouthLocalRecipe.filterComplex, /\btmix\s*=|\bunsharp\s*=/,
  'mouth-local performance recipe 不得伪装全帧 tmix 或 unsharp');
assert.equal(temporalRecipe.baseRenderFingerprint, recipe.baseRenderFingerprint,
  '两个处理档必须从同一未锐化基础渲染链分叉');
assert.equal(mouthLocalRecipe.baseRenderFingerprint, recipe.baseRenderFingerprint,
  '三档必须共享同一未锐化基础渲染链指纹');
assert.notEqual(temporalRecipe.filterSha256, recipe.filterSha256);
assert.notEqual(temporalRecipe.renderFingerprint, recipe.renderFingerprint);
assert.equal(new Set([
  recipe.filterSha256,
  temporalRecipe.filterSha256,
  mouthLocalRecipe.filterSha256,
]).size, 3, '三档 filter fingerprint 必须互不相同');
assert.equal(new Set([
  recipe.renderFingerprint,
  temporalRecipe.renderFingerprint,
  mouthLocalRecipe.renderFingerprint,
]).size, 3, '三档 render fingerprint 必须互不相同');
assert.equal(mouthLocalRecipe.filterSha256,
  createHash('sha256').update(mouthLocalRecipe.filterComplex).digest('hex'),
  'mouth-local filter fingerprint 必须可由 identity recipe 重建');
assert.match(mouthLocalRecipe.metadataComment, /treatment=mouth_jump_mouth_local_v1/);
assert.match(mouthLocalRecipe.metadataComment, /finalFilter=null/,
  'metadata 必须显式记录 mouth-local identity filter');
assert.equal('processorEvidence' in mouthLocalRecipe, false,
  'output-specific Python audit 必须只由 render-treatment receipt 承载');
assert.deepEqual(recipe.multiBeatIntermediateVideo, {
  applied: true,
  version: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_VERSION,
  width: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH,
  height: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT,
  fps: 25,
  filter: buildDigitalHumanMultiBeatIntermediateFilter(25),
  filterSha256: createHash('sha256').update(buildDigitalHumanMultiBeatIntermediateFilter(25)).digest('hex'),
});
assert.match(recipe.multiBeatIntermediateVideo.filter, /scale=1080:1920/);
assert.doesNotMatch(recipe.multiBeatIntermediateVideo.filter, /720:1280/,
  '多 beat 中间链不得先降样到720p');
assert.match(recipe.renderFingerprint, /^[a-f0-9]{64}$/);
assert.equal(recipe.scene.camera, 'push_in');
assert.equal(recipe.scene.composition, 'presenter_card_left');
assert.equal(recipe.beats.length, plan.beats.length);
assert.deepEqual(recipe.beats.map(beat => beat.motionClipId), clipIds);
assert.match(recipe.motionClipFingerprint, /^[a-f0-9]{64}$/);
assert.deepEqual(recipe.beats.map(beat => beat.keywordPeakMs), plan.beats.map(beat => beat.actionPeakMs),
  'Worker 回执必须把 actionPeakMs 映射为整片观测器需要的 keywordPeakMs');
assert.match(recipe.filterComplex, /zoompan=/, 'camera 必须落到逐帧渲染表达式');
assert.match(recipe.filterComplex, /overlay=x=/, 'composition/head/gaze 必须落到合成表达式');
assert.match(recipe.filterComplex, /eq=contrast=/, 'expression 必须落到逐帧可观测处理');
assert.equal(recipe.filterComplex.split(DIGITAL_HUMAN_FINAL_SHARPEN_FILTER).length - 1, 1,
  '数字人最终 performance 合成只能应用一次温和清晰度处理');
assert.ok(recipe.beats.every(beat => beat.controls.actionPeak === 'peak_centered_camera_impulse'));

assert.ok(ffmpegStatic, 'ffmpeg-static 必须可用');
const intermediateSmoke = spawnSync(ffmpegStatic!, [
  '-hide_banner', '-loglevel', 'info',
  '-f', 'lavfi', '-i', 'color=c=0x405060:s=540x960:r=25:d=0.08',
  '-vf', `${recipe.multiBeatIntermediateVideo.filter},showinfo`,
  '-frames:v', '1', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(intermediateSmoke.status, 0, `FFmpeg 不接受多 beat 1080p 中间配方: ${intermediateSmoke.stderr}`);
assert.match(intermediateSmoke.stderr, /s:1080x1920/,
  '多 beat 中间视频必须保持1080x1920');
for (const testedRecipe of [recipe, temporalRecipe, mouthLocalRecipe]) {
  const filterSmoke: ReturnType<typeof spawnSync> = spawnSync(ffmpegStatic!, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x405060:s=720x1280:r=25:d=0.24',
    '-filter_complex', testedRecipe.filterComplex,
    '-map', '[v]', '-frames:v', '3', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(filterSmoke.status, 0, `FFmpeg 不接受 ${testedRecipe.finalTreatmentId} 渲染配方: ${filterSmoke.stderr}`);
}

const metadataWorkDir = mkdtempSync(path.join(tmpdir(), 'digital-human-performance-'));
try {
  const metadataOutput = path.join(metadataWorkDir, 'metadata.mp4');
  const encode = spawnSync(ffmpegStatic!, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=25:d=0.24',
    '-filter_complex', recipe.filterComplex, '-map', '[v]', '-frames:v', '3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-metadata', `comment=${recipe.metadataComment}`,
    metadataOutput,
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(encode.status, 0, `FFmpeg 无法写入执行元数据: ${encode.stderr}`);
  const metadata = spawnSync(ffmpegStatic!, [
    '-hide_banner', '-loglevel', 'error', '-i', metadataOutput, '-f', 'ffmetadata', '-',
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(metadata.status, 0, `FFmpeg 无法回读执行元数据: ${metadata.stderr}`);
  assert.match(metadata.stdout, new RegExp(DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION));
  assert.match(metadata.stdout, new RegExp(recipe.planFingerprint));
} finally {
  rmSync(metadataWorkDir, { recursive: true, force: true });
}

const singleBeatSource = {
  version: 'performance-v1' as const,
  beats: [{
    id: 'beat-1', startMs: 0, endMs: 1_000, gesture: 'emphasis', expression: 'neutral',
    head: 'hold', gaze: 'camera', actionPeakMs: 550,
  }],
  scene: { mode: 'source' as const, camera: 'locked' as const, composition: 'full_frame' as const },
};
const singleBeatRecipe = buildPerformanceExecutionRecipe({
  plan: parseExecutablePerformancePlan(singleBeatSource), motionClipIds: ['motion-1'], fps: 25,
});
assert.equal(singleBeatRecipe.multiBeatIntermediateVideo.applied, false,
  '单 beat 不得伪造已执行多 beat 中间链的回执');
function renderedVideoHash(rawPlan: unknown): string {
  const executable = parseExecutablePerformancePlan(rawPlan);
  const treatment = buildPerformanceExecutionRecipe({ plan: executable, motionClipIds: ['motion-1'], fps: 25 });
  const result = spawnSync(ffmpegStatic!, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=25:d=1',
    '-filter_complex', treatment.filterComplex,
    '-map', '[v]', '-frames:v', '20', '-f', 'hash', '-hash', 'sha256', '-',
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, `FFmpeg 无法验证可观测处理: ${result.stderr}`);
  assert.match(result.stdout, /^SHA256=[a-f0-9]{64}\s*$/i);
  return result.stdout.trim();
}

const baselineVisualHash = renderedVideoHash(singleBeatSource);
const visualVariants = [
  { ...singleBeatSource, scene: { ...singleBeatSource.scene, camera: 'push_in' } },
  { ...singleBeatSource, scene: { ...singleBeatSource.scene, composition: 'presenter_card_left' } },
  { ...singleBeatSource, beats: singleBeatSource.beats.map(beat => ({ ...beat, expression: 'firm' })) },
  { ...singleBeatSource, beats: singleBeatSource.beats.map(beat => ({ ...beat, head: 'turn' })) },
  { ...singleBeatSource, beats: singleBeatSource.beats.map(beat => ({ ...beat, gaze: 'right' })) },
  { ...singleBeatSource, beats: singleBeatSource.beats.map(beat => ({ ...beat, actionPeakMs: 700 })) },
];
for (const variant of visualVariants) {
  assert.notEqual(renderedVideoHash(variant), baselineVisualHash,
    'camera/composition/expression/head/gaze/actionPeak 的变化都必须改变实际视频像素');
}

const lockedPlan = parseExecutablePerformancePlan({
  ...sourcePlan,
  scene: { mode: 'source', camera: 'locked', composition: 'full_frame' },
});
const lockedRecipe = buildPerformanceExecutionRecipe({ plan: lockedPlan, motionClipIds: clipIds, fps: 25 });
assert.notEqual(recipe.filterComplex, lockedRecipe.filterComplex, 'camera/composition 不得落到同一渲染配方');
assert.notEqual(recipe.planFingerprint, lockedRecipe.planFingerprint);

const receipt = buildPerformanceExecutionReceipt(recipe, true, '2026-09-03T00:00:00.000Z');
const temporalReceipt = buildPerformanceExecutionReceipt(temporalRecipe, true, '2026-09-03T00:00:01.000Z');
const mouthLocalReceipt = buildPerformanceExecutionReceipt(mouthLocalRecipe, true, '2026-09-03T00:00:02.000Z');
assert.match(receipt.filterSha256, /^[a-f0-9]{64}$/);
assert.equal(receipt.filterSha256, createHash('sha256').update(recipe.filterComplex).digest('hex'));
assert.equal(receipt.renderFingerprint, recipe.renderFingerprint);
assert.equal(mouthLocalReceipt.renderFingerprint, mouthLocalRecipe.renderFingerprint,
  'mouth-local render fingerprint 必须能从确定性 recipe 重建');
assert.equal(mouthLocalReceipt.filterSha256, mouthLocalRecipe.filterSha256);
assert.equal(mouthLocalReceipt.finalVideoFilter, DIGITAL_HUMAN_MOUTH_LOCAL_IDENTITY_FILTER);
assert.equal(mouthLocalReceipt.finalSharpenFilter, null);
assert.equal('processorEvidence' in mouthLocalReceipt, false,
  'performance receipt 不得复制 Python output-specific audit');
assert.deepEqual(receipt.multiBeatIntermediateVideo, recipe.multiBeatIntermediateVideo);
const legacyIntermediateFilter = recipe.multiBeatIntermediateVideo.filter
  .replace(/1080:1920/g, '720:1280');
const legacyIntermediateReceipt = buildPerformanceExecutionReceipt({
  ...recipe,
  multiBeatIntermediateVideo: {
    ...recipe.multiBeatIntermediateVideo,
    filter: legacyIntermediateFilter,
    filterSha256: createHash('sha256').update(legacyIntermediateFilter).digest('hex'),
  },
}, true, '2026-09-03T00:00:00.000Z');
assert.notEqual(legacyIntermediateReceipt.renderFingerprint, receipt.renderFingerprint,
  '720p中间链与P1 1080p中间链必须产生不同渲染指纹');
assert.match(receipt.metadataComment, new RegExp(`filter=${receipt.filterSha256}`),
  '清晰度处理必须进入输出元数据和执行回执指纹');
assert.match(receipt.metadataComment, new RegExp(`render=${receipt.renderFingerprint}`),
  '1080p中间链和最终配方必须共同进入渲染指纹');
assert.match(receipt.metadataComment, new RegExp(`pipeline=${DIGITAL_HUMAN_PIPELINE_VERSION}`));
assert.equal(receipt.finalSharpenFilter, DIGITAL_HUMAN_FINAL_SHARPEN_FILTER);
assert.equal(receipt.outputMetadataVerified, true);
assert.equal(digitalHumanPerformanceShotGate({ plan, motionClipIds: clipIds, receipt, baseQualityPassed: true }).passed, true);
assert.equal(digitalHumanPerformanceShotGate({ plan, motionClipIds: clipIds, receipt: temporalReceipt, baseQualityPassed: true }).passed, true,
  '表现回执门禁必须重建并验真时序兜底配方');
assert.equal(digitalHumanPerformanceShotGate({ plan, motionClipIds: clipIds, receipt: mouthLocalReceipt, baseQualityPassed: true }).passed, true,
  '表现回执门禁必须重建并验真 mouth-local identity 配方');
assert.equal(digitalHumanPerformanceShotGate({
  plan,
  motionClipIds: clipIds,
  receipt: { ...receipt, version: 'performance-execution-v2' } as unknown as typeof receipt,
  baseQualityPassed: true,
}).passed, false, '旧 v2 表现回执不得被 v3 配方门禁接受');
assert.equal(digitalHumanPerformanceShotGate({
  plan,
  motionClipIds: clipIds,
  receipt: {
    ...mouthLocalReceipt,
    finalVideoFilter: DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  },
  baseQualityPassed: true,
}).passed, false, 'mouth-local receipt 不得把 identity suffix 篡改为 unsharp');
assert.equal(digitalHumanPerformanceShotGate({
  plan,
  motionClipIds: clipIds,
  receipt: {
    ...mouthLocalReceipt,
    finalSharpenFilter: DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  },
  baseQualityPassed: true,
}).passed, false, 'mouth-local receipt 不得伪造 finalSharpenFilter');
assert.equal(digitalHumanPerformanceShotGate({
  plan,
  motionClipIds: clipIds,
  receipt: {
    ...mouthLocalReceipt,
    finalTreatmentId: 'mouth_jump_tmix2_equal_unsharp',
  },
  baseQualityPassed: true,
}).passed, false, 'mouth-local receipt 的 treatment ID 被篡改必须拒绝');

assert.equal(digitalHumanPerformanceShotGate({ plan, motionClipIds: clipIds, receipt: undefined, baseQualityPassed: true }).passed, false);
assert.equal(digitalHumanPerformanceShotGate({ plan, motionClipIds: clipIds, receipt, baseQualityPassed: false }).passed, false);
assert.equal(digitalHumanPerformanceShotGate({
  plan: lockedPlan, motionClipIds: clipIds,
  receipt,
  baseQualityPassed: true,
}).passed, false, '计划指纹或场景不一致必须 fail closed');
assert.equal(digitalHumanPerformanceShotGate({
  plan, motionClipIds: clipIds,
  receipt: { ...receipt, outputMetadataVerified: false },
  baseQualityPassed: true,
}).passed, false, '未验证输出执行标记必须 fail closed');
assert.equal(digitalHumanPerformanceShotGate({
  plan, motionClipIds: clipIds,
  receipt: { ...receipt, filterSha256: '0'.repeat(64) },
  baseQualityPassed: true,
}).passed, false, '回执中的渲染配方哈希不匹配必须 fail closed');
assert.equal(digitalHumanPerformanceShotGate({
  plan, motionClipIds: clipIds,
  receipt: {
    ...receipt,
    multiBeatIntermediateVideo: { ...receipt.multiBeatIntermediateVideo, applied: false },
  },
  baseQualityPassed: true,
}).passed, false, '回执不得隐藏或篡改多 beat 1080p 中间链');

assert.throws(() => parseExecutablePerformancePlan({
  ...sourcePlan,
  beats: sourcePlan.beats.map((beat, index) => index === 0 ? { ...beat, expression: undefined } : beat),
}), /表情无效/);
assert.throws(() => parseExecutablePerformancePlan({
  ...sourcePlan,
  beats: sourcePlan.beats.map((beat, index) => index === 0 ? { ...beat, actionPeakMs: beat.endMs + 1 } : beat),
}), /动作峰值越界/);
assert.throws(() => parseExecutablePerformancePlan({
  ...sourcePlan,
  scene: { ...sourcePlan.scene, camera: 'orbit' },
}), /镜头运动无效/);
assert.throws(() => parseExecutablePerformancePlan({
  ...sourcePlan,
  scene: { ...sourcePlan.scene, mode: 'chroma' },
}), /source 场景模式/);
assert.throws(() => buildPerformanceExecutionRecipe({ plan, motionClipIds: clipIds.slice(1) }), /每个节拍/);

console.log('digitalHumanPerformanceExecution tests passed');

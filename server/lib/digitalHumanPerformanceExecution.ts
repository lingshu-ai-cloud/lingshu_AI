import { createHash } from 'node:crypto';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
  buildDigitalHumanFinalFilterComplex,
  digitalHumanFinalVideoFilter,
  isDigitalHumanRenderTreatmentId,
  type DigitalHumanRenderTreatmentId,
  type DigitalHumanFinalSharpenFilter,
} from './digitalHumanRenderTreatment.js';

export { DIGITAL_HUMAN_FINAL_SHARPEN_FILTER } from './digitalHumanRenderTreatment.js';

export const DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION = 'performance-execution-v3' as const;
export const DIGITAL_HUMAN_PERFORMANCE_SHOT_GATE_VERSION = 'performance-shot-gate-v1' as const;
export const DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_VERSION = 'multi-beat-intermediate-1080p-v1' as const;
export const DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH = 1080 as const;
export const DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT = 1920 as const;

const CAMERAS = ['locked', 'push_in', 'pull_out', 'pan_left', 'pan_right'] as const;
const COMPOSITIONS = ['full_frame', 'presenter_card_left', 'presenter_card_right'] as const;
const EXPRESSIONS = ['neutral', 'slight_smile', 'brow_raise', 'concern', 'firm'] as const;
const HEADS = ['hold', 'nod_once', 'tilt', 'turn'] as const;
const GAZES = ['camera', 'left', 'right', 'product'] as const;
const GESTURES = ['none', 'open_palm', 'emphasis', 'point_left', 'point_right', 'count_one', 'count_two', 'count_three', 'product_hold', 'cta'] as const;

type Camera = typeof CAMERAS[number];
type Composition = typeof COMPOSITIONS[number];
type Expression = typeof EXPRESSIONS[number];
type Head = typeof HEADS[number];
type Gaze = typeof GAZES[number];

export interface ExecutablePerformanceBeat {
  id: string;
  startMs: number;
  endMs: number;
  gesture: string;
  expression: Expression;
  head: Head;
  gaze: Gaze;
  actionPeakMs: number;
}

export interface ExecutablePerformancePlan {
  version: 'performance-v1';
  beats: ExecutablePerformanceBeat[];
  scene: {
    mode: 'source';
    camera: Camera;
    composition: Composition;
  };
}

export interface PerformanceExecutionRecipe {
  version: typeof DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION;
  pipelineVersion: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
  finalTreatmentId: DigitalHumanRenderTreatmentId;
  temporalStabilityFilter: typeof DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER | null;
  finalSharpenFilter: DigitalHumanFinalSharpenFilter | null;
  finalVideoFilter: string;
  baseRenderFingerprint: string;
  planFingerprint: string;
  motionClipFingerprint: string;
  filterComplex: string;
  filterSha256: string;
  renderFingerprint: string;
  metadataComment: string;
  fps: number;
  durationSeconds: number;
  multiBeatIntermediateVideo: {
    applied: boolean;
    version: typeof DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_VERSION;
    width: typeof DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH;
    height: typeof DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT;
    fps: number;
    filter: string;
    filterSha256: string;
  };
  scene: {
    camera: Camera;
    composition: Composition;
    foregroundWidth: number;
    foregroundHeight: number;
  };
  beats: Array<ExecutablePerformanceBeat & {
    motionClipId: string;
    /** Relative semantic anchor consumed by the final-film observer. */
    keywordPeakMs: number;
    controls: {
      gesture: 'source_motion_clip';
      expression: 'frame_tone_profile';
      head: 'peak_centered_micro_motion';
      gaze: 'composition_bias';
      actionPeak: 'peak_centered_camera_impulse';
    };
  }>;
}

export interface PerformanceExecutionReceipt extends Omit<PerformanceExecutionRecipe, 'filterComplex'> {
  appliedAt: string;
  outputMetadataVerified: boolean;
  filterSha256: string;
}

export interface PerformanceShotGateResult {
  passed: boolean;
  gateVersion: typeof DIGITAL_HUMAN_PERFORMANCE_SHOT_GATE_VERSION;
  failures: string[];
  notes: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`数字人表演计划${label}无效`);
  return value as T[number];
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`数字人表演计划${label}无效`);
  return value;
}

export function parseExecutablePerformancePlan(value: unknown): ExecutablePerformancePlan {
  const input = record(value);
  if (input.version !== 'performance-v1') throw new Error('不支持的数字人表演计划版本');
  if (!Array.isArray(input.beats) || input.beats.length < 1 || input.beats.length > 12) throw new Error('数字人表演计划节拍无效');

  let previousEnd = 0;
  const beatIds = new Set<string>();
  const beats = input.beats.map((rawBeat, index): ExecutablePerformanceBeat => {
    const beat = record(rawBeat);
    const startMs = finite(beat.startMs, `节拍${index + 1}开始时间`);
    const endMs = finite(beat.endMs, `节拍${index + 1}结束时间`);
    const actionPeakMs = finite(beat.actionPeakMs, `节拍${index + 1}动作峰值`);
    if (startMs < 0 || endMs <= startMs || (index === 0 && startMs !== 0) || (index > 0 && Math.abs(startMs - previousEnd) > 2)) {
      throw new Error('数字人表演计划时间轴必须从0开始且节拍连续');
    }
    const peakMarginMs = Math.min(80, (endMs - startMs) * 0.1);
    if (actionPeakMs <= startMs + peakMarginMs || actionPeakMs >= endMs - peakMarginMs) {
      throw new Error(`数字人表演计划节拍${index + 1}动作峰值越界或过于贴边`);
    }
    previousEnd = endMs;
    const id = String(beat.id || `beat-${index + 1}`).trim() || `beat-${index + 1}`;
    if (beatIds.has(id)) throw new Error('数字人表演计划节拍 ID 重复');
    beatIds.add(id);
    return {
      id,
      startMs,
      endMs,
      gesture: enumValue(beat.gesture, GESTURES, `节拍${index + 1}手势`),
      expression: enumValue(beat.expression, EXPRESSIONS, `节拍${index + 1}表情`),
      head: enumValue(beat.head, HEADS, `节拍${index + 1}头部动作`),
      gaze: enumValue(beat.gaze, GAZES, `节拍${index + 1}视线`),
      actionPeakMs,
    };
  });

  const scene = record(input.scene);
  if (scene.mode !== 'source') throw new Error('当前本地 Worker 仅支持 source 场景模式');
  return {
    version: 'performance-v1',
    beats,
    scene: {
      mode: 'source',
      camera: enumValue(scene.camera, CAMERAS, '镜头运动'),
      composition: enumValue(scene.composition, COMPOSITIONS, '构图'),
    },
  };
}

export function performanceExecutionPlanFingerprint(plan: ExecutablePerformancePlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function windowExpression(variable: 't' | 'on', start: number, end: number): string {
  return `between(${variable},${start.toFixed(4)},${end.toFixed(4)})`;
}

function peakWindow(peak: number, halfWidth: number): { start: number; end: number; phase: string } {
  const start = Math.max(0, peak - halfWidth);
  const end = Math.max(start + 0.04, peak + halfWidth);
  return { start, end, phase: `(t-${start.toFixed(4)})/${(end - start).toFixed(4)}` };
}

function sumTerms(terms: string[], base: number): string {
  return terms.length ? `${base}${terms.map(term => `+${term}`).join('')}` : String(base);
}

function normalizeFps(value: number | undefined): number {
  return Math.max(1, Math.min(60, Math.round(value || 25)));
}

/**
 * P1 keeps every MuseTalk beat at the final 9:16 raster before concat. This
 * filter is part of the deterministic performance receipt: changing it must
 * invalidate the render fingerprint instead of silently reusing a softer
 * 720p intermediate.
 */
export function buildDigitalHumanMultiBeatIntermediateFilter(fps = 25): string {
  const normalizedFps = normalizeFps(fps);
  return [
    `scale=${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH}:${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH}:${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    'setsar=1',
    `fps=${normalizedFps}`,
  ].join(',');
}

function performanceRenderFingerprint(input: {
  filterComplex: string;
  multiBeatIntermediateVideo: PerformanceExecutionRecipe['multiBeatIntermediateVideo'];
}): string {
  return createHash('sha256').update(JSON.stringify({
    executionVersion: DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    filterComplex: input.filterComplex,
    multiBeatIntermediateVideo: input.multiBeatIntermediateVideo,
  })).digest('hex');
}

/**
 * Build a deterministic, GPU-free FFmpeg treatment applied after MuseTalk.
 * Organic gesture and facial/body motion still originate from the selected
 * real motion clip. Expression tone, head micro-motion and gaze-aware framing
 * are conservative visual proxies: they make controls observable without
 * warping identity, but they are not proof of semantic facial/eye performance.
 */
export function buildPerformanceExecutionRecipe(input: {
  plan: ExecutablePerformancePlan;
  motionClipIds: string[];
  fps?: number;
  finalTreatmentId?: DigitalHumanRenderTreatmentId;
}): PerformanceExecutionRecipe {
  const { plan } = input;
  const fps = normalizeFps(input.fps);
  const finalTreatmentId = input.finalTreatmentId || 'baseline_unsharp';
  if (!isDigitalHumanRenderTreatmentId(finalTreatmentId)) throw new Error('数字人最终时序处理档位无效');
  if (input.motionClipIds.length !== plan.beats.length || input.motionClipIds.some(id => !String(id || '').trim())) {
    throw new Error('表演计划必须为每个节拍提供已授权动作素材');
  }
  const durationSeconds = Math.max(0.2, plan.beats[plan.beats.length - 1]!.endMs / 1000);
  const lastFrame = Math.max(1, Math.ceil(durationSeconds * fps) - 1);
  const compositionSize = plan.scene.composition === 'full_frame'
    // Keep a small overscan margin so peak/gaze/head offsets never reveal a
    // blurred strip at the 9:16 edge.
    ? { width: 1160, height: 2064 }
    : { width: 860, height: 1528 };

  const peakZoomTerms = plan.beats.map((beat) => {
    const peakFrame = Math.round(beat.actionPeakMs / 1000 * fps);
    const widthFrames = Math.max(4, Math.round(Math.min(0.36, (beat.endMs - beat.startMs) / 4000) * fps));
    return `0.012*exp(-pow((on-${peakFrame})/${widthFrames},2))`;
  });
  const cameraZoom = plan.scene.camera === 'push_in'
    ? `1+0.05*on/${lastFrame}`
    : plan.scene.camera === 'pull_out'
      ? `1.05-0.05*on/${lastFrame}`
      : plan.scene.camera === 'pan_left' || plan.scene.camera === 'pan_right' ? '1.04' : '1';
  const zoom = `min(1.085,${cameraZoom}+${peakZoomTerms.join('+')})`;
  const zoomX = plan.scene.camera === 'pan_left'
    ? `(iw-iw/zoom)*(1-on/${lastFrame})`
    : plan.scene.camera === 'pan_right'
      ? `(iw-iw/zoom)*on/${lastFrame}`
      : '(iw-iw/zoom)/2';

  const contrast: string[] = [];
  const brightness: string[] = [];
  const saturation: string[] = [];
  const gamma: string[] = [];
  const gazeX: string[] = [];
  const headX: string[] = [];
  const headY: string[] = [];
  const peakY: string[] = [];
  const rotate: string[] = [];
  for (const beat of plan.beats) {
    const start = beat.startMs / 1000;
    const end = beat.endMs / 1000;
    const active = windowExpression('t', start, end);
    const profile = beat.expression === 'slight_smile'
      ? { c: 0.01, b: 0.004, s: 0.05, g: 0.01 }
      : beat.expression === 'brow_raise'
        ? { c: 0.03, b: 0.012, s: 0.02, g: 0.01 }
        : beat.expression === 'concern'
          ? { c: 0.01, b: -0.006, s: -0.08, g: -0.02 }
          : beat.expression === 'firm'
            ? { c: 0.05, b: -0.002, s: -0.02, g: 0 }
            : { c: 0, b: 0, s: 0, g: 0 };
    if (profile.c) contrast.push(`${profile.c}*${active}`);
    if (profile.b) brightness.push(`${profile.b}*${active}`);
    if (profile.s) saturation.push(`${profile.s}*${active}`);
    if (profile.g) gamma.push(`${profile.g}*${active}`);

    const gazeBias = beat.gaze === 'left' ? 18 : beat.gaze === 'right' ? -18 : beat.gaze === 'product' ? 10 : 0;
    if (gazeBias) gazeX.push(`${gazeBias}*${active}`);
    const peak = beat.actionPeakMs / 1000;
    const window = peakWindow(peak, Math.min(0.38, Math.max(0.2, (end - start) / 5)));
    const peakActive = windowExpression('t', window.start, window.end);
    peakY.push(`-5*sin(PI*${window.phase})*${peakActive}`);
    if (beat.head === 'nod_once') headY.push(`8*sin(PI*${window.phase})*${peakActive}`);
    if (beat.head === 'turn') headX.push(`14*sin(PI*${window.phase})*${peakActive}`);
    if (beat.head === 'tilt') rotate.push(`0.014*sin(PI*${window.phase})*${peakActive}`);
  }

  const xBase = plan.scene.composition === 'presenter_card_left'
    ? '56'
    : plan.scene.composition === 'presenter_card_right' ? 'W-w-56' : '(W-w)/2';
  const xExpression = [xBase, ...gazeX, ...headX].join('+');
  const yExpression = ['(H-h)/2', ...headY, ...peakY].join('+');
  const tone = `eq=contrast='${sumTerms(contrast, 1)}':brightness='${sumTerms(brightness, 0)}':saturation='${sumTerms(saturation, 1)}':gamma='${sumTerms(gamma, 1)}':eval=frame`;
  const foreground = [
    `[fgsrc]scale=${compositionSize.width}:${compositionSize.height}:force_original_aspect_ratio=increase`,
    `crop=${compositionSize.width}:${compositionSize.height}`,
    tone,
    `zoompan=z='${zoom}':x='${zoomX}':y='(ih-ih/zoom)/2':d=1:s=${compositionSize.width}x${compositionSize.height}:fps=${fps}`,
    ...(rotate.length ? ['format=rgba', `rotate='${rotate.join('+')}':ow=iw+48:oh=ih+48:c=none`] : []),
  ].join(',');
  const baseFilterComplex = [
    '[0:v]split=2[bgsrc][fgsrc]',
    '[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=60,eq=brightness=-0.28:saturation=0.55[bg]',
    `${foreground}[fg]`,
    `[bg][fg]overlay=x='${xExpression}':y='${yExpression}':eval=frame,setsar=1,fps=${fps}`,
  ].join(';');
  const filterComplex = buildDigitalHumanFinalFilterComplex(baseFilterComplex, finalTreatmentId);
  const finalVideoFilter = digitalHumanFinalVideoFilter(finalTreatmentId);
  const planFingerprint = performanceExecutionPlanFingerprint(plan);
  const motionClipFingerprint = createHash('sha256').update(JSON.stringify(input.motionClipIds)).digest('hex');
  const filterSha256 = createHash('sha256').update(filterComplex).digest('hex');
  const multiBeatFilter = buildDigitalHumanMultiBeatIntermediateFilter(fps);
  const multiBeatIntermediateVideo: PerformanceExecutionRecipe['multiBeatIntermediateVideo'] = {
    applied: plan.beats.length >= 2,
    version: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_VERSION,
    width: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH,
    height: DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT,
    fps,
    filter: multiBeatFilter,
    filterSha256: createHash('sha256').update(multiBeatFilter).digest('hex'),
  };
  const baseRenderFingerprint = createHash('sha256').update(JSON.stringify({
    executionVersion: DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    baseFilterComplex,
    multiBeatIntermediateVideo,
  })).digest('hex');
  const renderFingerprint = performanceRenderFingerprint({ filterComplex, multiBeatIntermediateVideo });
  const metadataComment = [
    DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION,
    `pipeline=${DIGITAL_HUMAN_PIPELINE_VERSION}`,
    `plan=${planFingerprint}`,
    `motions=${motionClipFingerprint}`,
    `filter=${filterSha256}`,
    `base=${baseRenderFingerprint}`,
    `render=${renderFingerprint}`,
    `treatment=${finalTreatmentId}`,
    `finalFilter=${finalVideoFilter}`,
    `intermediate=${multiBeatIntermediateVideo.applied ? `${multiBeatIntermediateVideo.width}x${multiBeatIntermediateVideo.height}@${multiBeatIntermediateVideo.fps}` : 'not-applied'}`,
    `camera=${plan.scene.camera}`,
    `composition=${plan.scene.composition}`,
    `beats=${plan.beats.length}`,
  ].join(';');

  return {
    version: DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    finalTreatmentId,
    temporalStabilityFilter: finalTreatmentId === 'mouth_jump_tmix2_equal_unsharp' ? DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER : null,
    finalSharpenFilter: finalTreatmentId === 'mouth_jump_mouth_local_v1'
      ? null
      : finalTreatmentId === 'mouth_jump_tmix2_equal_unsharp'
        ? DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER
        : DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
    finalVideoFilter,
    baseRenderFingerprint,
    planFingerprint,
    motionClipFingerprint,
    filterComplex,
    filterSha256,
    renderFingerprint,
    metadataComment,
    fps,
    durationSeconds,
    multiBeatIntermediateVideo,
    scene: { camera: plan.scene.camera, composition: plan.scene.composition, foregroundWidth: compositionSize.width, foregroundHeight: compositionSize.height },
    beats: plan.beats.map((beat, index) => ({
      ...beat,
      motionClipId: input.motionClipIds[index]!,
      keywordPeakMs: beat.actionPeakMs,
      controls: {
        gesture: 'source_motion_clip',
        expression: 'frame_tone_profile',
        head: 'peak_centered_micro_motion',
        gaze: 'composition_bias',
        actionPeak: 'peak_centered_camera_impulse',
      },
    })),
  };
}

export function buildPerformanceExecutionReceipt(
  recipe: PerformanceExecutionRecipe,
  outputMetadataVerified: boolean,
  appliedAt = new Date().toISOString(),
): PerformanceExecutionReceipt {
  const { filterComplex, ...serializable } = recipe;
  const filterSha256 = createHash('sha256').update(filterComplex).digest('hex');
  const renderFingerprint = performanceRenderFingerprint({
    filterComplex,
    multiBeatIntermediateVideo: recipe.multiBeatIntermediateVideo,
  });
  return {
    ...serializable,
    appliedAt,
    outputMetadataVerified,
    filterSha256,
    renderFingerprint,
  };
}

/**
 * Per-shot fail-closed gate. It complements (and deliberately does not pretend
 * to replace) the 15-second `digitalHumanPerformanceGate`, which must run after
 * the final multi-shot film is assembled.
 */
export function digitalHumanPerformanceShotGate(input: {
  plan: ExecutablePerformancePlan;
  motionClipIds: string[];
  receipt: PerformanceExecutionReceipt | undefined;
  baseQualityPassed: boolean;
}): PerformanceShotGateResult {
  const failures: string[] = [];
  const receipt = input.receipt;
  const fingerprint = performanceExecutionPlanFingerprint(input.plan);
  if (!input.baseQualityPassed) failures.push('分镜基础音画质量门禁未通过');
  if (!receipt || receipt.version !== DIGITAL_HUMAN_PERFORMANCE_EXECUTION_VERSION) failures.push('表演计划执行回执缺失或版本无效');
  if (receipt && receipt.pipelineVersion !== DIGITAL_HUMAN_PIPELINE_VERSION) failures.push('表演计划执行回执 pipeline 版本无效');
  if (receipt && receipt.planFingerprint !== fingerprint) failures.push('表演计划与执行回执不匹配');
  if (receipt && receipt.outputMetadataVerified !== true) failures.push('成片未携带已验证的表演执行标记');
  if (receipt) {
    try {
      if (!isDigitalHumanRenderTreatmentId(receipt.finalTreatmentId)) throw new Error('表演执行回执缺少P1最终时序处理档位');
      const expectedRecipe = buildPerformanceExecutionRecipe({
        plan: input.plan,
        motionClipIds: input.motionClipIds,
        fps: receipt.fps,
        finalTreatmentId: receipt.finalTreatmentId,
      });
      if (receipt.filterSha256 !== expectedRecipe.filterSha256
        || receipt.renderFingerprint !== expectedRecipe.renderFingerprint
        || receipt.baseRenderFingerprint !== expectedRecipe.baseRenderFingerprint
        || receipt.finalTreatmentId !== expectedRecipe.finalTreatmentId
        || receipt.finalSharpenFilter !== expectedRecipe.finalSharpenFilter
        || receipt.finalVideoFilter !== expectedRecipe.finalVideoFilter
        || receipt.temporalStabilityFilter !== expectedRecipe.temporalStabilityFilter
        || JSON.stringify(receipt.multiBeatIntermediateVideo) !== JSON.stringify(expectedRecipe.multiBeatIntermediateVideo)
        || receipt.metadataComment !== expectedRecipe.metadataComment) {
        failures.push('表演执行回执与确定性渲染配方不匹配');
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : '表演执行配方无法复核');
    }
    if (!Number.isFinite(Date.parse(receipt.appliedAt))) failures.push('表演执行回执时间无效');
  }
  if (receipt && (receipt.scene.camera !== input.plan.scene.camera || receipt.scene.composition !== input.plan.scene.composition)) {
    failures.push('镜头或构图未按表演计划执行');
  }
  if (receipt && receipt.beats.length !== input.plan.beats.length) failures.push('执行回执节拍数与表演计划不一致');
  receipt?.beats.forEach((beat, index) => {
    const expected = input.plan.beats[index];
    if (!expected || !beat.motionClipId || beat.motionClipId !== input.motionClipIds[index]) failures.push(`节拍${index + 1}缺少动作素材执行记录或素材不匹配`);
    else if (beat.expression !== expected.expression || beat.head !== expected.head || beat.gaze !== expected.gaze || beat.actionPeakMs !== expected.actionPeakMs) {
      failures.push(`节拍${index + 1}表情、头部、视线或动作峰值执行不一致`);
    } else if (beat.keywordPeakMs !== expected.actionPeakMs
      || beat.controls.gesture !== 'source_motion_clip'
      || beat.controls.expression !== 'frame_tone_profile'
      || beat.controls.head !== 'peak_centered_micro_motion'
      || beat.controls.gaze !== 'composition_bias'
      || beat.controls.actionPeak !== 'peak_centered_camera_impulse') {
      failures.push(`节拍${index + 1}执行控制或语义时间锚点回执不完整`);
    }
  });
  return {
    passed: failures.length === 0,
    gateVersion: DIGITAL_HUMAN_PERFORMANCE_SHOT_GATE_VERSION,
    failures,
    notes: [
      '分镜门禁已验证动作源、场景处理、峰值时序回执与基础音画质量。',
      '双嘴、复杂手指、真实表情语义与声线匹配仍必须在15秒整片门禁与人工复核中确认。',
    ],
  };
}

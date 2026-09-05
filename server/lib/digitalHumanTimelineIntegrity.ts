import { createHash } from 'node:crypto';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  verifyDigitalHumanRenderTreatmentAudit,
  type DigitalHumanRenderTreatmentAudit,
  type DigitalHumanRenderTreatmentId,
} from './digitalHumanRenderTreatment.js';
import { DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256 } from './digitalHumanMouthStabilization.js';

export const DIGITAL_HUMAN_SEGMENT_PROVENANCE_VERSION = 'digital-human-segment-provenance-v1' as const;
export const DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION = 'digital-human-frozen-timeline-v1' as const;
export const DIGITAL_HUMAN_RENDER_DURATION_SECONDS = 15 as const;
export const DIGITAL_HUMAN_TTS_MIN_SECONDS = 14.5 as const;
export const DIGITAL_HUMAN_TTS_MAX_SECONDS = 15.5 as const;
export const DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS = 0.12 as const;

const TIME_EPSILON_SECONDS = 0.002;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

export interface DigitalHumanSegmentProvenance {
  schemaVersion: typeof DIGITAL_HUMAN_SEGMENT_PROVENANCE_VERSION;
  language: string;
  jobId: string;
  projectId: string;
  storyboardSlotId: string;
  batchId?: string;
  outputMaterialId: string;
  provider: string;
  inputSignature: string;
  baseSourceSignature: string;
  pipelineVersion: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
  avatarMaterialId: string;
  performanceSignature: string;
  performanceProfileId?: string;
  performanceProfileFingerprint?: string;
  motionProfileId?: string;
  motionClipIds?: string[];
  configuredGesture?: string;
  beatStrategy?: string;
  originalBeatCount?: number;
  orchestrationAuditFingerprint?: string;
  treatmentId?: DigitalHumanRenderTreatmentId;
  treatmentAttempt?: number;
  treatmentAuditVersion?: string;
  treatmentRenderFingerprint?: string;
  treatmentFilterSha256?: string;
  treatmentBaseRenderFingerprint?: string;
  workerOutputSha256: string;
  audioStartSeconds: number;
  audioEndSeconds: number;
  outputDurationSeconds: number;
  qualityGateVersion: string;
  workerValidatorVersion: string;
}

export interface DigitalHumanProvenanceJobRecord {
  id?: unknown;
  batchId?: unknown;
  tenantId?: unknown;
  projectId?: unknown;
  storyboardSlotId?: unknown;
  status?: unknown;
  language?: unknown;
  outputMaterialId?: unknown;
  provider?: unknown;
  inputSignature?: unknown;
  sourceFingerprint?: unknown;
  pipelineVersion?: unknown;
  avatarMaterialId?: unknown;
  performanceSignature?: unknown;
  performancePlan?: unknown;
  motionClipIds?: unknown;
  resultSha256?: unknown;
  audioStartSeconds?: unknown;
  audioEndSeconds?: unknown;
  outputDurationSeconds?: unknown;
  qualityReport?: unknown;
}

export interface DigitalHumanTimelineItemLike {
  index?: number;
  clipId?: string;
  type?: string;
  digitalHumanGenerated?: boolean;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  targetStart?: number;
  targetEnd?: number;
  targetDuration?: number;
  digitalHumanSegment?: DigitalHumanSegmentProvenance;
}

export interface FrozenDigitalHumanSegment {
  timelineIndex: number;
  clipId: string;
  trimStart: 0;
  trimEnd: number;
  speed: 1;
  targetStart: number;
  targetEnd: number;
  targetDuration: number;
  provenance: DigitalHumanSegmentProvenance;
}

export interface FrozenDigitalHumanSegments {
  schemaVersion: typeof DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION;
  renderDurationSeconds: typeof DIGITAL_HUMAN_RENDER_DURATION_SECONDS;
  language: string;
  segments: FrozenDigitalHumanSegment[];
  fingerprint: string;
}

export interface DigitalHumanTimelineIntegrityReport {
  schemaVersion: typeof DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION;
  passed: boolean;
  fingerprint?: string;
  segmentCount: number;
  failures: string[];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function requiredString(value: unknown, field: string): string {
  const result = String(value || '').trim();
  if (!result) throw new Error(`数字人片段证明缺少 ${field}`);
  return result;
}

function requiredSha256(value: unknown, field: string): string {
  const result = String(value || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(result)) throw new Error(`数字人片段证明 ${field} 无效`);
  return result;
}

function finiteSeconds(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`数字人片段证明 ${field} 不是有限时间`);
  return Number(result.toFixed(3));
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`数字人片段证明缺少 ${field}`);
  const result = value.map(item => String(item || '').trim());
  if (result.some(item => !item)) throw new Error(`数字人片段证明 ${field} 包含空值`);
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  const source = value as JsonRecord;
  return `{${Object.keys(source).sort().filter(key => source[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sameTime(left: unknown, right: unknown, tolerance = TIME_EPSILON_SECONDS): boolean {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function selectedTreatment(qualityReport: JsonRecord, expectedOutputSha256: string): JsonRecord {
  const auditValue = qualityReport.renderTreatmentAudit;
  const failures = verifyDigitalHumanRenderTreatmentAudit(auditValue, {
    expectedOutputSha256,
    expectedMouthStabilizationScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
    requireSelected: true,
  });
  if (failures.length) throw new Error(`数字人 Worker 处理回执无效：${failures.join('；')}`);
  const audit = record(auditValue) as unknown as DigitalHumanRenderTreatmentAudit;
  const selectedAttempt = Number(audit.selectedAttempt);
  const selected = (Array.isArray(audit.attempts) ? audit.attempts : []).find(item => item.attempt === selectedAttempt);
  if (!selected) throw new Error('数字人 Worker 处理回执缺少已选尝试');
  return { audit, selected };
}

/**
 * Produce the sole allow-listed segment proof from a server job record. Both
 * the orchestrator and buildManifest use this function; the latter must always
 * compare client proof with a fresh proof derived from tenant-owned records.
 */
export function buildDigitalHumanSegmentProvenance(job: DigitalHumanProvenanceJobRecord): DigitalHumanSegmentProvenance {
  if (job.status !== 'completed') throw new Error('数字人任务尚未完成，不得进入最终时间轴');
  const quality = record(job.qualityReport);
  if (quality.passed !== true) throw new Error('数字人任务未通过完整 Worker/服务端质量门禁');
  if (quality.validationStatus !== 'passed' || quality.reviewRequired === true) {
    throw new Error('数字人 Worker 完整质量回执未通过或仍需人工复核');
  }
  if (record(quality.serverValidation).passed !== true) {
    throw new Error('数字人片段缺少服务端媒体复验通过证明');
  }
  if (job.pipelineVersion !== DIGITAL_HUMAN_PIPELINE_VERSION) throw new Error('数字人任务 pipeline 版本与当前生产链不一致');

  const audioStartSeconds = finiteSeconds(job.audioStartSeconds, 'audioStartSeconds');
  const audioEndSeconds = finiteSeconds(job.audioEndSeconds, 'audioEndSeconds');
  if (audioStartSeconds < 0 || audioEndSeconds <= audioStartSeconds) throw new Error('数字人任务音频区间无效');
  const outputSha256 = requiredSha256(job.resultSha256 || quality.outputSha256, 'workerOutputSha256');
  if (quality.outputSha256 && requiredSha256(quality.outputSha256, 'qualityReport.outputSha256') !== outputSha256) {
    throw new Error('数字人 Worker 输出 SHA256 与服务端完成记录不一致');
  }
  // Records created before provider provenance was introduced are local-worker
  // outputs and retain the stricter render-treatment receipt requirements.
  const provider = String(job.provider || 'local').trim();
  const isHeygen = provider === 'heygen';
  const treatment = isHeygen ? undefined : selectedTreatment(quality, outputSha256) as {
    audit: DigitalHumanRenderTreatmentAudit;
    selected: DigitalHumanRenderTreatmentAudit['attempts'][number];
  };
  const plan = record(job.performancePlan);
  const profile = record(plan.orchestrationProfile);
  const originalBeatCount = Number(profile.originalBeatCount);
  if (!isHeygen && (!Number.isInteger(originalBeatCount) || originalBeatCount < 1)) throw new Error('数字人片段证明 originalBeatCount 无效');
  const outputDurationSeconds = finiteSeconds(
    job.outputDurationSeconds
      ?? record(quality.serverValidation).durationSeconds
      ?? (audioEndSeconds - audioStartSeconds),
    'outputDurationSeconds',
  );
  if (outputDurationSeconds <= 0) throw new Error('数字人任务实测输出时长无效');

  return {
    schemaVersion: DIGITAL_HUMAN_SEGMENT_PROVENANCE_VERSION,
    language: requiredString(job.language, 'language').replace(/_/g, '-').toLowerCase(),
    jobId: requiredString(job.id, 'jobId'),
    projectId: requiredString(job.projectId, 'projectId'),
    storyboardSlotId: requiredString(job.storyboardSlotId, 'storyboardSlotId'),
    ...(String(job.batchId || '').trim() ? { batchId: String(job.batchId).trim() } : {}),
    outputMaterialId: requiredString(job.outputMaterialId, 'outputMaterialId'),
    provider,
    inputSignature: requiredString(job.inputSignature, 'inputSignature'),
    baseSourceSignature: requiredString(job.sourceFingerprint, 'baseSourceSignature'),
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    avatarMaterialId: requiredString(job.avatarMaterialId, 'avatarMaterialId'),
    performanceSignature: requiredString(job.performanceSignature, 'performanceSignature'),
    ...(!isHeygen ? {
      performanceProfileId: requiredString(profile.profileId, 'performanceProfileId'),
      performanceProfileFingerprint: requiredSha256(profile.fingerprint, 'performanceProfileFingerprint'),
      motionProfileId: requiredString(profile.motionProfileId, 'motionProfileId'),
      motionClipIds: stringArray(job.motionClipIds, 'motionClipIds'),
      configuredGesture: requiredString(profile.gesture, 'configuredGesture'),
      beatStrategy: requiredString(profile.beatStrategy, 'beatStrategy'),
      originalBeatCount,
      orchestrationAuditFingerprint: sha256(profile),
      treatmentId: treatment!.selected.treatmentId,
      treatmentAttempt: treatment!.selected.attempt,
      treatmentAuditVersion: treatment!.audit.version,
      treatmentRenderFingerprint: requiredSha256(treatment!.selected.renderFingerprint, 'treatmentRenderFingerprint'),
      treatmentFilterSha256: requiredSha256(treatment!.selected.filterSha256, 'treatmentFilterSha256'),
      treatmentBaseRenderFingerprint: requiredSha256(treatment!.selected.baseRenderFingerprint, 'treatmentBaseRenderFingerprint'),
    } : {}),
    workerOutputSha256: outputSha256,
    audioStartSeconds,
    audioEndSeconds,
    outputDurationSeconds,
    qualityGateVersion: requiredString(quality.gateVersion, 'qualityGateVersion'),
    workerValidatorVersion: requiredString(quality.validatorVersion, 'workerValidatorVersion'),
  };
}

export function assertRequestedDigitalHumanProvenance(
  requested: unknown,
  expected: DigitalHumanSegmentProvenance,
): asserts requested is DigitalHumanSegmentProvenance {
  if (canonicalJson(requested) !== canonicalJson(expected)) {
    throw new Error(`数字人片段证明与租户任务记录不一致（${expected.jobId}/${expected.language}）`);
  }
}

export function assertDigitalHumanTtsDuration(durationSeconds: unknown): number {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration)
    || duration < DIGITAL_HUMAN_TTS_MIN_SECONDS
    || duration > DIGITAL_HUMAN_TTS_MAX_SECONDS) {
    throw new Error(`数字人 TTS 总时长必须为 ${DIGITAL_HUMAN_TTS_MIN_SECONDS}-${DIGITAL_HUMAN_TTS_MAX_SECONDS} 秒`);
  }
  return Number(duration.toFixed(3));
}

function buildFrozenSegments(
  timeline: DigitalHumanTimelineItemLike[],
  renderDurationSeconds: number,
  language: string,
): Omit<FrozenDigitalHumanSegments, 'fingerprint'> {
  if (!sameTime(renderDurationSeconds, DIGITAL_HUMAN_RENDER_DURATION_SECONDS, 0.000_001)) {
    throw new Error(`数字人最终成片时长必须精确为 ${DIGITAL_HUMAN_RENDER_DURATION_SECONDS} 秒`);
  }
  if (!Array.isArray(timeline) || !timeline.length) throw new Error('数字人最终时间轴为空');
  const normalizedLanguage = requiredString(language, 'render language').replace(/_/g, '-').toLowerCase();
  let cursor = 0;
  const segments: FrozenDigitalHumanSegment[] = [];
  timeline.forEach((item, timelineIndex) => {
    const targetStart = finiteSeconds(item.targetStart, `timeline[${timelineIndex}].targetStart`);
    const targetEnd = finiteSeconds(item.targetEnd, `timeline[${timelineIndex}].targetEnd`);
    const targetDuration = finiteSeconds(item.targetDuration, `timeline[${timelineIndex}].targetDuration`);
    if (!sameTime(targetStart, cursor) || targetEnd <= targetStart || targetDuration < 0.5
      || !sameTime(targetDuration, targetEnd - targetStart)) {
      throw new Error(`时间轴 ${timelineIndex} 未精确连续填满或时长不一致`);
    }
    cursor = targetEnd;
    if (!item.digitalHumanGenerated) return;

    const provenance = item.digitalHumanSegment;
    if (!provenance) throw new Error(`数字人时间轴 ${timelineIndex} 缺少 Worker 片段证明`);
    if (provenance.schemaVersion !== DIGITAL_HUMAN_SEGMENT_PROVENANCE_VERSION) throw new Error(`数字人时间轴 ${timelineIndex} 片段证明版本无效`);
    if (provenance.language !== normalizedLanguage) throw new Error(`数字人时间轴 ${timelineIndex} 语言与成片不一致`);
    if (provenance.outputMaterialId !== item.clipId) throw new Error(`数字人时间轴 ${timelineIndex} 素材与 Worker 输出不一致`);
    if (item.type !== 'video') throw new Error(`数字人时间轴 ${timelineIndex} 必须使用 Worker 视频产物`);
    if (!sameTime(item.speed, 1, 0.000_001)) throw new Error(`数字人时间轴 ${timelineIndex} 禁止二次变速`);
    if (!sameTime(item.trimStart, 0, 0.000_001)) throw new Error(`数字人时间轴 ${timelineIndex} 禁止二次起始裁切`);
    const outputDuration = provenance.outputDurationSeconds;
    const terminal = sameTime(targetEnd, DIGITAL_HUMAN_RENDER_DURATION_SECONDS);
    const endTolerance = terminal ? DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS : TIME_EPSILON_SECONDS;
    if (!sameTime(item.trimEnd, outputDuration, endTolerance)
      || !sameTime(targetDuration, outputDuration, endTolerance)) {
      throw new Error(`数字人时间轴 ${timelineIndex} 尝试对 Worker 片段二次裁切或拉伸`);
    }
    segments.push({
      timelineIndex,
      clipId: requiredString(item.clipId, `timeline[${timelineIndex}].clipId`),
      trimStart: 0,
      trimEnd: finiteSeconds(item.trimEnd, `timeline[${timelineIndex}].trimEnd`),
      speed: 1,
      targetStart,
      targetEnd,
      targetDuration,
      provenance,
    });
  });
  if (!sameTime(cursor, DIGITAL_HUMAN_RENDER_DURATION_SECONDS)) {
    throw new Error(`数字人最终时间轴必须连续且精确结束于 ${DIGITAL_HUMAN_RENDER_DURATION_SECONDS} 秒`);
  }
  if (!segments.length) throw new Error('时间轴未包含数字人片段');
  return {
    schemaVersion: DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION,
    renderDurationSeconds: DIGITAL_HUMAN_RENDER_DURATION_SECONDS,
    language: normalizedLanguage,
    segments,
  };
}

export function freezeDigitalHumanSegments(
  timeline: DigitalHumanTimelineItemLike[],
  renderDurationSeconds: number,
  language: string,
): FrozenDigitalHumanSegments {
  const snapshot = buildFrozenSegments(timeline, renderDurationSeconds, language);
  return { ...snapshot, fingerprint: sha256(snapshot) };
}

/**
 * Rebuild the frozen proof from the exact manifest passed to the compositor.
 * This is deliberately a timeline-integrity check, not pretend whole-film
 * SyncNet. Lip-sync quality remains the responsibility of each immutable,
 * worker-gated source segment.
 */
export function verifyFrozenDigitalHumanSegments(input: {
  timeline: DigitalHumanTimelineItemLike[];
  frozen: FrozenDigitalHumanSegments | undefined;
  renderDurationSeconds: number;
  language: string;
}): DigitalHumanTimelineIntegrityReport {
  const failures: string[] = [];
  let rebuilt: FrozenDigitalHumanSegments | undefined;
  try {
    rebuilt = freezeDigitalHumanSegments(input.timeline, input.renderDurationSeconds, input.language);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (!input.frozen) failures.push('数字人最终渲染缺少冻结片段证明');
  else if (input.frozen.schemaVersion !== DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION
    || !rebuilt
    || canonicalJson(input.frozen) !== canonicalJson(rebuilt)) {
    failures.push('数字人冻结片段证明与实际合成时间轴不一致');
  }
  return {
    schemaVersion: DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION,
    passed: failures.length === 0,
    fingerprint: rebuilt?.fingerprint,
    segmentCount: rebuilt?.segments.length || 0,
    failures: [...new Set(failures)],
  };
}

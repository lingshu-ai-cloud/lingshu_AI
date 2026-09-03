import { createHash } from 'node:crypto';

export const DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION = 'digital-human-mouth-stabilization-audit-v2' as const;
export const DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION = 'mouth-roi-temporal-stabilizer-v1' as const;
export const DIGITAL_HUMAN_MOUTH_STABILIZATION_EVIDENCE_VERSION = 'digital-human-mouth-stabilization-evidence-v1' as const;
export const DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256 = 'b23978dd7b474a0a304a6bbff155cb56beebe810ab8ec7d2fe73316cb1775a6e' as const;

const COMMON_PARAMETERS = {
  mode: 'centered',
  canonicalWidth: 192,
  canonicalHeight: 108,
  roiWidthScale: 1.85,
  roiHeightScale: 1.05,
  featherFraction: 0.28,
  minimumMouthWidthPixels: 12,
  minimumDetectionConfidence: 0.5,
  minimumTrackingConfidence: 0.5,
  boundaryMarginPixels: 1,
  maximumMaskFraction: 0.08,
  durationToleranceMilliseconds: 45,
  encoder: {
    codec: 'libx264',
    preset: 'medium',
    crf: 18,
    pixelFormat: 'yuv420p',
  },
  audio: {
    codec: 'copy',
    requiredInputCodec: 'aac',
  },
} as const;

/**
 * Two fixed, evidence-backed recipes are permitted. Balanced is selected when
 * the preceding full-frame temporal attempt also lost mouth sharpness. Strong
 * is selected only when excessive mouth jump remains while sharpness has ample
 * headroom. The Worker never accepts user-provided processor parameters.
 */
export const DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES = {
  balanced: {
    ...COMMON_PARAMETERS,
    windowSize: 3,
    weights: [0.45, 0.10, 0.45],
    localSharpenAmount: 4,
    localSharpenKernel: 5,
  },
  strong: {
    ...COMMON_PARAMETERS,
    windowSize: 5,
    weights: [0.30, 0.20, 0, 0.20, 0.30],
    localSharpenAmount: 5,
    localSharpenKernel: 5,
  },
} as const;

export type DigitalHumanMouthStabilizationProfileId = keyof typeof DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES;
export type DigitalHumanMouthStabilizationParameters =
  typeof DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES[DigitalHumanMouthStabilizationProfileId];

/** Backward-compatible alias for fixtures and the normal production profile. */
export const DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS =
  DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES.balanced;

type JsonRecord = Record<string, unknown>;

export interface DigitalHumanMouthStabilizationMediaEvidence {
  sha256: string;
  durationSeconds: number;
  videoDurationSeconds: number | null;
  audioDurationSeconds: number | null;
  videoCodec: 'h264';
  audioCodec: 'aac';
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  audioPacketSha256: string;
}

export interface DigitalHumanMouthStabilizationTrackingEvidence {
  totalFrames: number;
  detectedFrames: number;
  missingFrames: 0;
  detectionRate: 1;
  maximumConsecutiveMissingFrames: 0;
  multipleFaceFrames: 0;
  boundaryFailureFrames: 0;
  minimumMouthWidthPixels: number;
  maximumMouthWidthPixels: number;
}

export interface DigitalHumanMouthStabilizationLocalityEvidence {
  meanMaskCoverageFraction: number;
  maximumMaskCoverageFraction: number;
  maximumAllowedMaskCoverageFraction: 0.08;
  maximumOutsideMaskPixelDeltaBeforeEncoding: 0;
  fullFrameTemporalFilterApplied: false;
  localSharpenPasses: 1;
  fullResolutionFramesBuffered: 0;
}

export interface DigitalHumanMouthStabilizationIntegrityEvidence {
  passed: true;
  failures: [];
  decodedFrameCount: number;
  inputFrameCount: number;
  outputFrameCount: number;
  inputDurationSeconds: number;
  outputDurationSeconds: number;
  durationDeltaSeconds: number;
  durationToleranceSeconds: 0.045;
  fpsPreserved: true;
  resolutionPreserved: true;
  inputAudioPacketSha256: string;
  outputAudioPacketSha256: string;
  audioPacketHashMatch: true;
}

export interface DigitalHumanMouthStabilizationEvidenceBody {
  evidenceVersion: typeof DIGITAL_HUMAN_MOUTH_STABILIZATION_EVIDENCE_VERSION;
  auditSchemaVersion: typeof DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION;
  algorithmVersion: typeof DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION;
  profileId: DigitalHumanMouthStabilizationProfileId;
  parameters: DigitalHumanMouthStabilizationParameters;
  parametersSha256: string;
  rawInputSha256: string;
  processorOutputSha256: string;
  scriptSha256: string;
  auditFileSha256: string;
  media: {
    input: DigitalHumanMouthStabilizationMediaEvidence;
    output: DigitalHumanMouthStabilizationMediaEvidence;
  };
  tracking: DigitalHumanMouthStabilizationTrackingEvidence;
  locality: DigitalHumanMouthStabilizationLocalityEvidence;
  integrity: DigitalHumanMouthStabilizationIntegrityEvidence;
}

export interface DigitalHumanMouthStabilizationEvidence extends DigitalHumanMouthStabilizationEvidenceBody {
  fingerprint: string;
}

export interface ParseDigitalHumanMouthStabilizationAuditInput {
  /** Exact bytes (or their UTF-8 string) read from the atomic Python audit file. */
  auditFile: string | Uint8Array;
  /** SHA256 values independently measured by the caller from the actual files. */
  rawInputSha256: string;
  processorOutputSha256: string;
  scriptSha256: string;
  /** Release allow-list value. It is deliberately supplied by the caller. */
  expectedScriptSha256: string;
}

export interface DigitalHumanMouthStabilizationEvidenceExpectations {
  expectedRawInputSha256: string;
  expectedProcessorOutputSha256: string;
  expectedScriptSha256: string;
  expectedAuditFileSha256: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FLOAT_EPSILON = 0.000_001;
const FPS_TOLERANCE = 0.001;
const DURATION_TOLERANCE_SECONDS = 0.045;

const AUDIT_KEYS = [
  'schemaVersion', 'algorithmVersion', 'passed', 'parameters', 'input', 'output',
  'tracking', 'locality', 'integrity', 'failures',
] as const;
const AUDIT_MEDIA_KEYS = [
  'path', 'sha256', 'durationSeconds', 'videoDurationSeconds', 'audioDurationSeconds',
  'videoCodec', 'audioCodec', 'width', 'height', 'fps', 'frameCount', 'audioPacketSha256',
] as const;
const EVIDENCE_MEDIA_KEYS = AUDIT_MEDIA_KEYS.filter(key => key !== 'path');
const TRACKING_KEYS = [
  'totalFrames', 'detectedFrames', 'missingFrames', 'detectionRate',
  'maximumConsecutiveMissingFrames', 'multipleFaceFrames', 'boundaryFailureFrames',
  'minimumMouthWidthPixels', 'maximumMouthWidthPixels',
] as const;
const LOCALITY_KEYS = [
  'meanMaskCoverageFraction', 'maximumMaskCoverageFraction', 'maximumAllowedMaskCoverageFraction',
  'maximumOutsideMaskPixelDeltaBeforeEncoding', 'fullFrameTemporalFilterApplied',
  'localSharpenPasses', 'fullResolutionFramesBuffered',
] as const;
const INTEGRITY_KEYS = [
  'passed', 'failures', 'decodedFrameCount', 'inputFrameCount', 'outputFrameCount',
  'inputDurationSeconds', 'outputDurationSeconds', 'durationDeltaSeconds',
  'durationToleranceSeconds', 'fpsPreserved', 'resolutionPreserved',
  'inputAudioPacketSha256', 'outputAudioPacketSha256', 'audioPacketHashMatch',
] as const;
const EVIDENCE_KEYS = [
  'evidenceVersion', 'auditSchemaVersion', 'algorithmVersion', 'profileId', 'parameters',
  'parametersSha256', 'rawInputSha256', 'processorOutputSha256', 'scriptSha256',
  'auditFileSha256', 'media', 'tracking', 'locality', 'integrity', 'fingerprint',
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  const source = value as JsonRecord;
  return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function strictRecord(value: unknown, expectedKeys: readonly string[], label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}结构无效`);
  const record = value as JsonRecord;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}字段集合无效`);
  }
  return record;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}无效`);
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} SHA256无效`);
  return normalized;
}

function requiredBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) throw new Error(`${label}必须为${expected}`);
  return expected;
}

function requiredFinite(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${label}无效`);
  return value;
}

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  const parsed = requiredFinite(value, label, minimum);
  if (!Number.isInteger(parsed)) throw new Error(`${label}必须为整数`);
  return parsed;
}

function finiteOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  return requiredFinite(value, label);
}

function requireEmptyArray(value: unknown, label: string): [] {
  if (!Array.isArray(value) || value.length !== 0) throw new Error(`${label}必须为空`);
  return [];
}

function equalNumber(actual: number, expected: number, tolerance = FLOAT_EPSILON): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function cloneFixedParameters(profileId: DigitalHumanMouthStabilizationProfileId): DigitalHumanMouthStabilizationParameters {
  return JSON.parse(JSON.stringify(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES[profileId])) as DigitalHumanMouthStabilizationParameters;
}

function parseFixedParameters(value: unknown): {
  profileId: DigitalHumanMouthStabilizationProfileId;
  parameters: DigitalHumanMouthStabilizationParameters;
} {
  for (const profileId of Object.keys(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES) as DigitalHumanMouthStabilizationProfileId[]) {
    if (canonicalJson(value) === canonicalJson(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES[profileId])) {
      return { profileId, parameters: cloneFixedParameters(profileId) };
    }
  }
  throw new Error('嘴部局部稳定器参数不是固定生产配方');
}

function parseMedia(value: unknown, label: string, includesPath: boolean): DigitalHumanMouthStabilizationMediaEvidence {
  const record = strictRecord(value, includesPath ? AUDIT_MEDIA_KEYS : EVIDENCE_MEDIA_KEYS, label);
  if (includesPath) requiredString(record.path, `${label}.path`); // Deliberately discarded from portable evidence.
  const videoCodec = requiredString(record.videoCodec, `${label}.videoCodec`);
  const audioCodec = requiredString(record.audioCodec, `${label}.audioCodec`);
  if (videoCodec !== 'h264' || audioCodec !== 'aac') throw new Error(`${label}必须为H.264/AAC`);
  return {
    sha256: requiredSha256(record.sha256, `${label}.sha256`),
    durationSeconds: requiredFinite(record.durationSeconds, `${label}.durationSeconds`, Number.EPSILON),
    videoDurationSeconds: finiteOrNull(record.videoDurationSeconds, `${label}.videoDurationSeconds`),
    audioDurationSeconds: finiteOrNull(record.audioDurationSeconds, `${label}.audioDurationSeconds`),
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: requiredInteger(record.width, `${label}.width`, 1),
    height: requiredInteger(record.height, `${label}.height`, 1),
    fps: requiredFinite(record.fps, `${label}.fps`, Number.EPSILON),
    frameCount: requiredInteger(record.frameCount, `${label}.frameCount`, 1),
    audioPacketSha256: requiredSha256(record.audioPacketSha256, `${label}.audioPacketSha256`),
  };
}

function parseTracking(value: unknown): DigitalHumanMouthStabilizationTrackingEvidence {
  const record = strictRecord(value, TRACKING_KEYS, '嘴部局部稳定器tracking');
  const result = {
    totalFrames: requiredInteger(record.totalFrames, 'tracking.totalFrames', 1),
    detectedFrames: requiredInteger(record.detectedFrames, 'tracking.detectedFrames', 1),
    missingFrames: requiredInteger(record.missingFrames, 'tracking.missingFrames'),
    detectionRate: requiredFinite(record.detectionRate, 'tracking.detectionRate'),
    maximumConsecutiveMissingFrames: requiredInteger(record.maximumConsecutiveMissingFrames, 'tracking.maximumConsecutiveMissingFrames'),
    multipleFaceFrames: requiredInteger(record.multipleFaceFrames, 'tracking.multipleFaceFrames'),
    boundaryFailureFrames: requiredInteger(record.boundaryFailureFrames, 'tracking.boundaryFailureFrames'),
    minimumMouthWidthPixels: requiredFinite(record.minimumMouthWidthPixels, 'tracking.minimumMouthWidthPixels', Number.EPSILON),
    maximumMouthWidthPixels: requiredFinite(record.maximumMouthWidthPixels, 'tracking.maximumMouthWidthPixels', Number.EPSILON),
  };
  if (result.detectedFrames !== result.totalFrames || result.missingFrames !== 0 || result.detectionRate !== 1
    || result.maximumConsecutiveMissingFrames !== 0 || result.multipleFaceFrames !== 0 || result.boundaryFailureFrames !== 0) {
    throw new Error('嘴部局部稳定器没有逐帧保持唯一人脸与连续嘴部跟踪');
  }
  if (result.minimumMouthWidthPixels < DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS.minimumMouthWidthPixels
    || result.maximumMouthWidthPixels < result.minimumMouthWidthPixels) {
    throw new Error('嘴部局部稳定器嘴部跟踪尺寸无效');
  }
  return result as DigitalHumanMouthStabilizationTrackingEvidence;
}

function parseLocality(value: unknown): DigitalHumanMouthStabilizationLocalityEvidence {
  const record = strictRecord(value, LOCALITY_KEYS, '嘴部局部稳定器locality');
  const mean = requiredFinite(record.meanMaskCoverageFraction, 'locality.meanMaskCoverageFraction');
  const maximum = requiredFinite(record.maximumMaskCoverageFraction, 'locality.maximumMaskCoverageFraction');
  const allowed = requiredFinite(record.maximumAllowedMaskCoverageFraction, 'locality.maximumAllowedMaskCoverageFraction');
  if (!equalNumber(allowed, DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS.maximumMaskFraction)
    || maximum > DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS.maximumMaskFraction + FLOAT_EPSILON
    || mean > maximum + FLOAT_EPSILON) {
    throw new Error('嘴部局部稳定器遮罩范围超过固定局部处理上限');
  }
  requiredBoolean(record.fullFrameTemporalFilterApplied, false, 'locality.fullFrameTemporalFilterApplied');
  if (requiredInteger(record.maximumOutsideMaskPixelDeltaBeforeEncoding, 'locality.maximumOutsideMaskPixelDeltaBeforeEncoding') !== 0) {
    throw new Error('嘴部局部稳定器修改了遮罩外像素');
  }
  if (requiredInteger(record.localSharpenPasses, 'locality.localSharpenPasses') !== 1) {
    throw new Error('嘴部局部稳定器必须且只能执行一次局部锐化');
  }
  if (requiredInteger(record.fullResolutionFramesBuffered, 'locality.fullResolutionFramesBuffered') !== 0) {
    throw new Error('嘴部局部稳定器不得缓存完整分辨率帧');
  }
  return {
    meanMaskCoverageFraction: mean,
    maximumMaskCoverageFraction: maximum,
    maximumAllowedMaskCoverageFraction: 0.08,
    maximumOutsideMaskPixelDeltaBeforeEncoding: 0,
    fullFrameTemporalFilterApplied: false,
    localSharpenPasses: 1,
    fullResolutionFramesBuffered: 0,
  };
}

function parseIntegrity(value: unknown): DigitalHumanMouthStabilizationIntegrityEvidence {
  const record = strictRecord(value, INTEGRITY_KEYS, '嘴部局部稳定器integrity');
  requiredBoolean(record.passed, true, 'integrity.passed');
  const failures = requireEmptyArray(record.failures, 'integrity.failures');
  const durationTolerance = requiredFinite(record.durationToleranceSeconds, 'integrity.durationToleranceSeconds');
  if (!equalNumber(durationTolerance, DURATION_TOLERANCE_SECONDS)) throw new Error('嘴部局部稳定器时长容差被篡改');
  requiredBoolean(record.fpsPreserved, true, 'integrity.fpsPreserved');
  requiredBoolean(record.resolutionPreserved, true, 'integrity.resolutionPreserved');
  requiredBoolean(record.audioPacketHashMatch, true, 'integrity.audioPacketHashMatch');
  return {
    passed: true,
    failures,
    decodedFrameCount: requiredInteger(record.decodedFrameCount, 'integrity.decodedFrameCount', 1),
    inputFrameCount: requiredInteger(record.inputFrameCount, 'integrity.inputFrameCount', 1),
    outputFrameCount: requiredInteger(record.outputFrameCount, 'integrity.outputFrameCount', 1),
    inputDurationSeconds: requiredFinite(record.inputDurationSeconds, 'integrity.inputDurationSeconds', Number.EPSILON),
    outputDurationSeconds: requiredFinite(record.outputDurationSeconds, 'integrity.outputDurationSeconds', Number.EPSILON),
    durationDeltaSeconds: requiredFinite(record.durationDeltaSeconds, 'integrity.durationDeltaSeconds'),
    durationToleranceSeconds: 0.045,
    fpsPreserved: true,
    resolutionPreserved: true,
    inputAudioPacketSha256: requiredSha256(record.inputAudioPacketSha256, 'integrity.inputAudioPacketSha256'),
    outputAudioPacketSha256: requiredSha256(record.outputAudioPacketSha256, 'integrity.outputAudioPacketSha256'),
    audioPacketHashMatch: true,
  };
}

function validateCrossFieldIntegrity(body: DigitalHumanMouthStabilizationEvidenceBody): void {
  const { input, output } = body.media;
  const { tracking, integrity } = body;
  if (body.rawInputSha256 !== input.sha256 || body.processorOutputSha256 !== output.sha256) {
    throw new Error('嘴部局部稳定器输入或输出SHA与调用方实测不一致');
  }
  if (input.frameCount !== output.frameCount || input.frameCount !== tracking.totalFrames
    || input.frameCount !== integrity.decodedFrameCount || input.frameCount !== integrity.inputFrameCount
    || input.frameCount !== integrity.outputFrameCount) {
    throw new Error('嘴部局部稳定器帧数未完整保持');
  }
  if (input.width !== output.width || input.height !== output.height || !equalNumber(input.fps, output.fps, FPS_TOLERANCE)) {
    throw new Error('嘴部局部稳定器分辨率或帧率未保持');
  }
  const durationDelta = Math.abs(input.durationSeconds - output.durationSeconds);
  if (durationDelta > DURATION_TOLERANCE_SECONDS + FLOAT_EPSILON
    || !equalNumber(integrity.inputDurationSeconds, input.durationSeconds)
    || !equalNumber(integrity.outputDurationSeconds, output.durationSeconds)
    || !equalNumber(integrity.durationDeltaSeconds, durationDelta, FLOAT_EPSILON)) {
    throw new Error('嘴部局部稳定器时长完整性证据不一致');
  }
  for (const field of ['videoDurationSeconds', 'audioDurationSeconds'] as const) {
    if (input[field] !== null && output[field] !== null
      && Math.abs(input[field] - output[field]) > DURATION_TOLERANCE_SECONDS + FLOAT_EPSILON) {
      throw new Error(`嘴部局部稳定器${field}未保持`);
    }
  }
  if (input.audioPacketSha256 !== output.audioPacketSha256
    || input.audioPacketSha256 !== integrity.inputAudioPacketSha256
    || output.audioPacketSha256 !== integrity.outputAudioPacketSha256) {
    throw new Error('嘴部局部稳定器AAC音频包哈希未保持');
  }
}

function evidenceBody(value: DigitalHumanMouthStabilizationEvidence): DigitalHumanMouthStabilizationEvidenceBody {
  const { fingerprint: _fingerprint, ...body } = value;
  return body;
}

export function buildDigitalHumanMouthStabilizationFingerprint(
  evidence: DigitalHumanMouthStabilizationEvidenceBody | DigitalHumanMouthStabilizationEvidence,
): string {
  const source = evidence as DigitalHumanMouthStabilizationEvidence;
  const body = 'fingerprint' in source ? evidenceBody(source) : evidence;
  return sha256(canonicalJson(body));
}

/**
 * Parse the exact audit bytes, discard machine-local paths, and bind the
 * Python report to independently measured input/output/script hashes.
 */
export function parseDigitalHumanMouthStabilizationAudit(
  input: ParseDigitalHumanMouthStabilizationAuditInput,
): DigitalHumanMouthStabilizationEvidence {
  const auditBytes = typeof input.auditFile === 'string' ? Buffer.from(input.auditFile, 'utf8') : Buffer.from(input.auditFile);
  const auditFileSha256 = sha256(auditBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(auditBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('嘴部局部稳定器audit不是合法JSON');
  }
  const audit = strictRecord(parsed, AUDIT_KEYS, '嘴部局部稳定器audit');
  if (audit.schemaVersion !== DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION) throw new Error('嘴部局部稳定器audit版本无效');
  if (audit.algorithmVersion !== DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION) throw new Error('嘴部局部稳定器算法版本无效');
  requiredBoolean(audit.passed, true, '嘴部局部稳定器audit.passed');
  requireEmptyArray(audit.failures, '嘴部局部稳定器audit.failures');

  const fixed = parseFixedParameters(audit.parameters);
  const rawInputSha256 = requiredSha256(input.rawInputSha256, '调用方实测raw input');
  const processorOutputSha256 = requiredSha256(input.processorOutputSha256, '调用方实测processor output');
  const scriptSha256 = requiredSha256(input.scriptSha256, '调用方实测script');
  const expectedScriptSha256 = requiredSha256(input.expectedScriptSha256, '调用方预期script');
  if (scriptSha256 !== expectedScriptSha256) throw new Error('嘴部局部稳定器script SHA不在发布白名单');

  const body: DigitalHumanMouthStabilizationEvidenceBody = {
    evidenceVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_EVIDENCE_VERSION,
    auditSchemaVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
    algorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    profileId: fixed.profileId,
    parameters: fixed.parameters,
    parametersSha256: sha256(canonicalJson(fixed.parameters)),
    rawInputSha256,
    processorOutputSha256,
    scriptSha256,
    auditFileSha256,
    media: {
      input: parseMedia(audit.input, '嘴部局部稳定器audit.input', true),
      output: parseMedia(audit.output, '嘴部局部稳定器audit.output', true),
    },
    tracking: parseTracking(audit.tracking),
    locality: parseLocality(audit.locality),
    integrity: parseIntegrity(audit.integrity),
  };
  validateCrossFieldIntegrity(body);
  return { ...body, fingerprint: buildDigitalHumanMouthStabilizationFingerprint(body) };
}

function parseEvidence(value: unknown): DigitalHumanMouthStabilizationEvidence {
  const record = strictRecord(value, EVIDENCE_KEYS, '嘴部局部稳定器净化证据');
  if (record.evidenceVersion !== DIGITAL_HUMAN_MOUTH_STABILIZATION_EVIDENCE_VERSION) throw new Error('嘴部局部稳定器净化证据版本无效');
  if (record.auditSchemaVersion !== DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION) throw new Error('嘴部局部稳定器净化证据audit版本无效');
  if (record.algorithmVersion !== DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION) throw new Error('嘴部局部稳定器净化证据算法版本无效');
  const media = strictRecord(record.media, ['input', 'output'], '嘴部局部稳定器净化证据media');
  const fixed = parseFixedParameters(record.parameters);
  if (record.profileId !== fixed.profileId) throw new Error('嘴部局部稳定器净化证据档位与参数不匹配');
  const body: DigitalHumanMouthStabilizationEvidenceBody = {
    evidenceVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_EVIDENCE_VERSION,
    auditSchemaVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
    algorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    profileId: fixed.profileId,
    parameters: fixed.parameters,
    parametersSha256: requiredSha256(record.parametersSha256, '净化证据parameters'),
    rawInputSha256: requiredSha256(record.rawInputSha256, '净化证据raw input'),
    processorOutputSha256: requiredSha256(record.processorOutputSha256, '净化证据processor output'),
    scriptSha256: requiredSha256(record.scriptSha256, '净化证据script'),
    auditFileSha256: requiredSha256(record.auditFileSha256, '净化证据audit file'),
    media: {
      input: parseMedia(media.input, '净化证据media.input', false),
      output: parseMedia(media.output, '净化证据media.output', false),
    },
    tracking: parseTracking(record.tracking),
    locality: parseLocality(record.locality),
    integrity: parseIntegrity(record.integrity),
  };
  if (body.parametersSha256 !== sha256(canonicalJson(body.parameters))) throw new Error('嘴部局部稳定器参数指纹无效');
  validateCrossFieldIntegrity(body);
  const evidence = { ...body, fingerprint: requiredSha256(record.fingerprint, '净化证据fingerprint') };
  if (evidence.fingerprint !== buildDigitalHumanMouthStabilizationFingerprint(body)) throw new Error('嘴部局部稳定器净化证据指纹无效');
  return evidence;
}

/** Return machine-readable failures instead of trusting receipt booleans. */
export function verifyDigitalHumanMouthStabilizationEvidence(
  value: unknown,
  expectations: DigitalHumanMouthStabilizationEvidenceExpectations,
): string[] {
  try {
    const evidence = parseEvidence(value);
    const expectedRaw = requiredSha256(expectations.expectedRawInputSha256, '预期raw input');
    const expectedOutput = requiredSha256(expectations.expectedProcessorOutputSha256, '预期processor output');
    const expectedScript = requiredSha256(expectations.expectedScriptSha256, '预期script');
    const expectedAudit = requiredSha256(expectations.expectedAuditFileSha256, '预期audit file');
    const failures: string[] = [];
    if (evidence.rawInputSha256 !== expectedRaw) failures.push('嘴部局部稳定器净化证据raw input SHA不匹配');
    if (evidence.processorOutputSha256 !== expectedOutput) failures.push('嘴部局部稳定器净化证据processor output SHA不匹配');
    if (evidence.scriptSha256 !== expectedScript) failures.push('嘴部局部稳定器净化证据script SHA不匹配');
    if (evidence.auditFileSha256 !== expectedAudit) failures.push('嘴部局部稳定器净化证据audit file SHA不匹配');
    return failures;
  } catch (error) {
    return [error instanceof Error ? error.message : '嘴部局部稳定器净化证据无效'];
  }
}

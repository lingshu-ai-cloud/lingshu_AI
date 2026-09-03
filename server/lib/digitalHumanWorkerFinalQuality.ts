import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE } from './digitalHumanRenderTreatment.js';

export const DIGITAL_HUMAN_FINAL_VALIDATOR_VERSION = 'final-quality-v2.4.0';
export const DIGITAL_HUMAN_SHORT_SEGMENT_MAX_SECONDS = 5.5;
export const DIGITAL_HUMAN_MOUTH_SHARPNESS_MINIMUM = 25;
export const DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE = 'mouth_sharpness_below_minimum' as const;

export type DigitalHumanQualityValidationScope = 'full_video' | 'segment';
export type DigitalHumanQualityFailureCode =
  | typeof DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE
  | typeof DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE;

export interface DigitalHumanFinalQualityReport {
  passed: boolean;
  validationStatus: 'passed' | 'review';
  reviewRequired: boolean;
  outputSha256?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  durationSeconds?: number;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  freezeSegments?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
  mouthOpennessStd?: number;
  mouthSharpnessMedian?: number;
  validationScope: DigitalHumanQualityValidationScope;
  thresholds: {
    lipSyncScoreMinimum: number;
    absoluteAvOffsetFramesMaximum: number;
  };
  validatorVersion: string;
  failureCodes: DigitalHumanQualityFailureCode[];
  failures: string[];
  notes: string[];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredFinite(report: UnknownRecord, key: string, label: string, failures: string[]): number | undefined {
  const value = finiteNumber(report[key]);
  if (value === undefined) failures.push(`${label}缺失或非有限数`);
  return value;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const parts = normalized.split('.').map(Number);
  return parts.length === 4
    && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 127;
}

const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data.ec2.internal',
]);

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

export function isBlockedDigitalHumanNetworkAddress(address: string): boolean {
  const normalized = normalizedHostname(address).split('%')[0]!;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedDigitalHumanNetworkAddress(mapped[1]!);
  if (isIP(normalized) === 4) {
    const parts = ipv4Parts(normalized)!;
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a! >= 224;
  }
  if (isIP(normalized) === 6) {
    return normalized === '::'
      || normalized === '::1'
      || /^f[cd]/.test(normalized)
      || /^fe[89ab]/.test(normalized)
      || /^ff/.test(normalized)
      || /^2001:db8(?::|$)/.test(normalized)
      || normalized === 'fd00:ec2::254';
  }
  return true;
}

export function validateDigitalHumanHubUrl(value: unknown, environment = ''): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error('DIGITAL_HUMAN_HUB_URL is invalid'); }
  const hostname = normalizedHostname(parsed.hostname);
  if (parsed.username || parsed.password) throw new Error('DIGITAL_HUMAN_HUB_URL credentials are not allowed');
  if (parsed.search || parsed.hash) throw new Error('DIGITAL_HUMAN_HUB_URL query and fragment are not allowed');
  const development = String(environment || '').trim().toLowerCase() !== 'production';
  if (parsed.protocol === 'http:' && isLoopbackHostname(hostname) && development) return raw.replace(/\/+$/, '');
  if (parsed.protocol !== 'https:') throw new Error('DIGITAL_HUMAN_HUB_URL must use HTTPS outside loopback development');
  if (parsed.port && parsed.port !== '443') throw new Error('DIGITAL_HUMAN_HUB_URL remote port must be 443');
  return raw.replace(/\/+$/, '');
}

/**
 * Validate every initial and redirected Worker input URL. HTTP is accepted only
 * for loopback development endpoints; all remote traffic must be HTTPS and the
 * hostname must be explicitly allowlisted.
 */
export function validateDigitalHumanWorkerInputUrl(
  value: unknown,
  allowedHosts: ReadonlySet<string>,
  options: { allowedRemotePorts?: ReadonlySet<number>; allowedLoopbackPorts?: ReadonlySet<number> } = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('input URL is invalid');
  }
  const hostname = normalizedHostname(parsed.hostname);
  const normalizedAllowedHosts = new Set([...allowedHosts].map(normalizedHostname).filter(Boolean));
  if (!normalizedAllowedHosts.has(hostname)) throw new Error(`input host is not allowed: ${hostname}`);
  if (METADATA_HOSTNAMES.has(hostname) || hostname.endsWith('.metadata.google.internal')) throw new Error('metadata input host is forbidden');
  if (parsed.username || parsed.password) throw new Error('input URL credentials are not allowed');
  const loopback = isLoopbackHostname(hostname);
  if (!(parsed.protocol === 'http:' && loopback) && parsed.protocol !== 'https:') throw new Error('remote input URL must use HTTPS');
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const remotePorts = options.allowedRemotePorts || new Set([443]);
  const loopbackPorts = options.allowedLoopbackPorts || new Set([80, 443, 8788, 8792]);
  if (loopback && !loopbackPorts.has(port)) throw new Error(`loopback input port is not allowed: ${port}`);
  if (!loopback && !remotePorts.has(port)) throw new Error(`remote input port is not allowed: ${port}`);
  if (parsed.protocol === 'http:' && loopback) return parsed;
  return parsed;
}

export async function validateResolvedDigitalHumanInputUrl(
  url: URL,
  resolver: (hostname: string) => Promise<string[]> = async hostname => (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address),
): Promise<string[]> {
  const hostname = normalizedHostname(url.hostname);
  if (METADATA_HOSTNAMES.has(hostname) || hostname.endsWith('.metadata.google.internal')) throw new Error('metadata input host is forbidden');
  const addresses = isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!addresses.length) throw new Error(`input DNS returned no addresses: ${hostname}`);
  if (isLoopbackHostname(hostname)) {
    if (addresses.some(address => !isLoopbackHostname(address))) throw new Error('loopback input DNS resolved outside loopback');
    return addresses;
  }
  const blocked = addresses.find(isBlockedDigitalHumanNetworkAddress);
  if (blocked) throw new Error(`input DNS resolved to a private, reserved, or metadata address: ${blocked}`);
  return addresses;
}

export function countFreezeSegments(log: string): number {
  return (String(log || '').match(/freeze_start\s*:/g) || []).length;
}

export function buildDigitalHumanFinalQualityReport(input: {
  probe: unknown;
  visual: unknown;
  syncnet: unknown;
  freezeLog: string;
  freezeValidated: boolean;
  outputSha256: string;
  minLipSyncScore?: number;
  validationScope?: DigitalHumanQualityValidationScope;
}): DigitalHumanFinalQualityReport {
  const failures: string[] = [];
  const failureCodes: DigitalHumanQualityFailureCode[] = [];
  const probe = asRecord(input.probe);
  const visual = asRecord(input.visual);
  const syncnet = asRecord(input.syncnet);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(asRecord) : [];
  const videoStream = streams.find(stream => stream.codec_type === 'video') || {};
  const audioStream = streams.find(stream => stream.codec_type === 'audio') || {};
  const format = asRecord(probe.format);

  const width = requiredFinite(videoStream, 'width', '输出宽度', failures);
  const height = requiredFinite(videoStream, 'height', '输出高度', failures);
  const durationSeconds = requiredFinite(format, 'duration', '输出时长', failures);
  const visualDuration = requiredFinite(visual, 'duration_seconds', '视觉检测时长', failures);
  const faceDetectionRate = requiredFinite(visual, 'face_detection_rate', '人脸跟踪率', failures);
  const mouthJumpP95 = requiredFinite(visual, 'mouth_jump_p95', '嘴部跳变P95', failures);
  const mouthOpennessStd = requiredFinite(visual, 'mouth_openness_std', '嘴部开合标准差', failures);
  const mouthSharpnessMedian = requiredFinite(visual, 'mouth_sharpness_median', '嘴部清晰度中位数', failures);
  const lipSyncScore = requiredFinite(syncnet, 'syncnet_confidence', 'SyncNet置信度', failures);
  const avOffsetFrames = requiredFinite(syncnet, 'av_offset_frames', '音画偏移帧数', failures);
  const videoCodec = typeof videoStream.codec_name === 'string' ? videoStream.codec_name : undefined;
  const audioCodec = typeof audioStream.codec_name === 'string' ? audioStream.codec_name : undefined;
  const outputSha256 = String(input.outputSha256 || '').toLowerCase();
  const freezeSegments = input.freezeValidated ? countFreezeSegments(input.freezeLog) : undefined;
  const requestedLipSyncMinimum = input.minLipSyncScore === undefined ? 3 : finiteNumber(input.minLipSyncScore);
  const invalidLipSyncMinimum = requestedLipSyncMinimum === undefined
    || requestedLipSyncMinimum < 3
    || requestedLipSyncMinimum > 20;
  const validationScope: DigitalHumanQualityValidationScope = input.validationScope === 'segment' ? 'segment' : 'full_video';
  const minLipSyncScore = invalidLipSyncMinimum ? 3 : requestedLipSyncMinimum;

  if (invalidLipSyncMinimum) failures.push('SyncNet置信度门槛无效或低于V2最低3.0，已按3.0执行');
  if (!/^[0-9a-f]{64}$/.test(outputSha256)) failures.push('输出SHA256缺失或无效');
  if (width !== undefined && width !== 1080) failures.push('最终成片宽度必须为1080');
  if (height !== undefined && height !== 1920) failures.push('最终成片高度必须为1920');
  if (videoCodec !== 'h264') failures.push('最终成片视频编码必须为H.264');
  if (audioCodec !== 'aac') failures.push('最终成片音频编码必须为AAC');
  if (durationSeconds !== undefined && durationSeconds < 0.5) failures.push('最终成片时长异常');
  if (durationSeconds !== undefined && visualDuration !== undefined && Math.abs(durationSeconds - visualDuration) > 0.2) {
    failures.push('容器与视觉检测时长差超过200ms');
  }
  const visualFailures = Array.isArray(visual.failures) ? visual.failures.map(String) : [];
  const visualFailureCodes = Array.isArray(visual.failure_codes) ? visual.failure_codes.map(String) : [];
  if (visual.passed !== true) failures.push(...(visualFailures.length ? visualFailures : ['最终成片视觉门禁未通过']));
  if (syncnet.passed !== true) failures.push(...(Array.isArray(syncnet.failures) ? syncnet.failures.map(String) : ['最终成片SyncNet门禁未通过']));
  if (!input.freezeValidated) failures.push('卡帧检测未成功执行');
  else if (Number(freezeSegments) > 0) failures.push(`检测到${freezeSegments}个冻结片段`);
  if (faceDetectionRate !== undefined && (faceDetectionRate < 0 || faceDetectionRate > 1)) failures.push('人脸跟踪率超出合法范围');
  if (faceDetectionRate !== undefined && faceDetectionRate < 0.98) failures.push('人脸跟踪率低于98%');
  if (mouthJumpP95 !== undefined && mouthJumpP95 < 0) failures.push('嘴部跳变P95超出合法范围');
  const mouthJumpFailed = (mouthJumpP95 !== undefined && mouthJumpP95 > 0.085)
    || visualFailureCodes.includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)
    || visualFailures.includes('mouth motion contains excessive frame-to-frame jumps');
  if (mouthJumpFailed) {
    failures.push('嘴部跳变P95超过0.085');
    failureCodes.push(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE);
  }
  if (mouthOpennessStd !== undefined && mouthOpennessStd < 0.012) failures.push('嘴部运动过于静态');
  const mouthSharpnessFailed = (mouthSharpnessMedian !== undefined
    && mouthSharpnessMedian < DIGITAL_HUMAN_MOUTH_SHARPNESS_MINIMUM)
    || visualFailureCodes.includes(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE)
    || visualFailures.includes('mouth region is excessively blurred');
  if (mouthSharpnessFailed) {
    failures.push('嘴部区域过度模糊');
    failureCodes.push(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE);
  }
  if (lipSyncScore !== undefined && lipSyncScore < minLipSyncScore) failures.push(`SyncNet置信度低于${minLipSyncScore.toFixed(1)}`);
  if (avOffsetFrames !== undefined && Math.abs(avOffsetFrames) > 3) failures.push('音画偏移超过3帧');

  const uniqueFailures = [...new Set(failures.filter(Boolean))];
  const passed = uniqueFailures.length === 0;
  return {
    passed,
    validationStatus: passed ? 'passed' : 'review',
    reviewRequired: !passed,
    outputSha256: /^[0-9a-f]{64}$/.test(outputSha256) ? outputSha256 : undefined,
    width, height, videoCodec, audioCodec, durationSeconds,
    lipSyncScore, avOffsetFrames, freezeSegments, faceDetectionRate, mouthJumpP95,
    mouthOpennessStd, mouthSharpnessMedian,
    validationScope,
    thresholds: {
      lipSyncScoreMinimum: minLipSyncScore,
      absoluteAvOffsetFramesMaximum: 3,
    },
    validatorVersion: DIGITAL_HUMAN_FINAL_VALIDATOR_VERSION,
    failureCodes: [...new Set(failureCodes)],
    failures: uniqueFailures,
    notes: passed
      ? [`${validationScope === 'segment' ? '分镜片段' : '最终整片'}已通过ffprobe、MediaPipe、SyncNet和ffmpeg freezedetect；SyncNet置信度门槛${minLipSyncScore.toFixed(1)}，偏移不超过3帧。`]
      : [`${validationScope === 'segment' ? '分镜片段' : '最终整片'}未通过全部自动门禁；本次SyncNet置信度门槛${minLipSyncScore.toFixed(1)}，偏移不超过3帧。`],
  };
}

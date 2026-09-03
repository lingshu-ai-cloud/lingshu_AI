import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  verifyDigitalHumanRenderTreatmentAudit,
  type DigitalHumanRenderContext,
} from './digitalHumanRenderTreatment.js';
import { DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256 } from './digitalHumanMouthStabilization.js';

export interface DigitalHumanMediaProbe {
  decodePassed: boolean;
  probeEngine: 'ffprobe' | 'ffmpeg_fallback' | 'unavailable';
  durationSeconds?: number;
  width?: number;
  height?: number;
  formatName?: string;
  videoCodec?: string;
  audioCodec?: string;
}

export interface DigitalHumanProviderQualityLike {
  passed?: boolean;
  validationStatus?: string;
  reviewRequired?: boolean;
  outputSha256?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  freezeSegments?: number;
  durationSeconds?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
  validatorVersion?: string;
  pipelineVersion?: string;
  failureCodes?: unknown[];
  renderTreatmentAudit?: unknown;
  failures?: unknown[];
  gateFailures?: unknown[];
}

export interface DigitalHumanServerValidationReport extends DigitalHumanMediaProbe {
  validatorVersion: 'server-media-v1';
  passed: boolean;
  sha256: string;
  sizeBytes: number;
  expectedDurationSeconds?: number;
  failures: string[];
}

interface ProbeProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runProbeProcess(file: string, args: string[], timeoutMs: number): Promise<ProbeProcessResult> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function parseFfprobeJson(raw: string): Omit<DigitalHumanMediaProbe, 'decodePassed' | 'probeEngine'> {
  const parsed = JSON.parse(raw) as {
    format?: { duration?: string | number; format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string | number }>;
  };
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find(item => item.codec_type === 'video');
  const audio = streams.find(item => item.codec_type === 'audio');
  const duration = Number(parsed.format?.duration ?? video?.duration);
  return {
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    width: Number.isFinite(Number(video?.width)) ? Number(video?.width) : undefined,
    height: Number.isFinite(Number(video?.height)) ? Number(video?.height) : undefined,
    formatName: String(parsed.format?.format_name || '').toLowerCase() || undefined,
    videoCodec: String(video?.codec_name || '').toLowerCase() || undefined,
    audioCodec: String(audio?.codec_name || '').toLowerCase() || undefined,
  };
}

export function parseFfmpegProbeText(raw: string): Omit<DigitalHumanMediaProbe, 'decodePassed' | 'probeEngine'> {
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(raw);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : Number.NaN;
  const videoLine = raw.split(/\r?\n/).find(line => /Stream #.*Video:/i.test(line)) || '';
  const audioLine = raw.split(/\r?\n/).find(line => /Stream #.*Audio:/i.test(line)) || '';
  const inputLine = raw.split(/\r?\n/).find(line => /^Input #\d+,/i.test(line.trim())) || '';
  const videoMatch = /Video:\s*([^,\s]+)[\s\S]*?\b(\d{2,5})x(\d{2,5})\b/i.exec(videoLine);
  const audioMatch = /Audio:\s*([^,\s]+)/i.exec(audioLine);
  return {
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    width: videoMatch ? Number(videoMatch[2]) : undefined,
    height: videoMatch ? Number(videoMatch[3]) : undefined,
    formatName: /^Input #\d+,\s*([^,]+(?:,[^,]+)*)\s*,\s*from\s/i.exec(inputLine.trim())?.[1]?.toLowerCase(),
    videoCodec: videoMatch?.[1]?.toLowerCase(),
    audioCodec: audioMatch?.[1]?.toLowerCase(),
  };
}

export function digitalHumanProviderQualityFailures(
  report: DigitalHumanProviderQualityLike | null | undefined,
  measured?: Pick<DigitalHumanServerValidationReport, 'sha256' | 'durationSeconds' | 'width' | 'height' | 'videoCodec' | 'audioCodec'>,
  options: {
    requireP1RenderTreatmentAudit?: boolean;
    expectedRenderContext?: DigitalHumanRenderContext;
    expectedBaseRenderFingerprint?: string;
  } = {},
): string[] {
  if (!report || typeof report !== 'object') return ['Worker 未提交质量检测报告'];
  const failures: string[] = [];
  if (report.passed !== true) failures.push('Worker 未确认质量通过');
  if (report.reviewRequired === true || (report.validationStatus && report.validationStatus !== 'passed')) failures.push('Worker 要求人工复核');
  const requiredNumbers: Array<[keyof DigitalHumanProviderQualityLike, string]> = [
    ['lipSyncScore', 'SyncNet 置信度'],
    ['avOffsetFrames', '音画偏移帧'],
    ['freezeSegments', '冻结片段数'],
    ['durationSeconds', '成片时长'],
    ['faceDetectionRate', '人脸跟踪率'],
    ['mouthJumpP95', '嘴部跳变 P95'],
    ['width', '成片宽度'],
    ['height', '成片高度'],
  ];
  for (const [key, label] of requiredNumbers) {
    if (!Number.isFinite(Number(report[key]))) failures.push(`Worker 质量报告缺少${label}`);
  }
  if (Number.isFinite(Number(report.freezeSegments)) && (!Number.isInteger(Number(report.freezeSegments)) || Number(report.freezeSegments) < 0)) {
    failures.push('Worker 冻结片段数不合法');
  }
  if (Number.isFinite(Number(report.durationSeconds)) && Number(report.durationSeconds) <= 0) failures.push('Worker 成片时长不合法');
  if (Number.isFinite(Number(report.faceDetectionRate)) && (Number(report.faceDetectionRate) < 0 || Number(report.faceDetectionRate) > 1)) {
    failures.push('Worker 人脸跟踪率不合法');
  }
  if (Number.isFinite(Number(report.mouthJumpP95)) && Number(report.mouthJumpP95) < 0) failures.push('Worker 嘴部跳变 P95 不合法');
  if (Array.isArray(report.gateFailures) && report.gateFailures.length > 0) failures.push('Worker 质量报告包含未通过项');
  if (Array.isArray(report.failures) && report.failures.length > 0) failures.push('Worker 最终门禁包含未通过项');
  if (!String(report.validatorVersion || '').trim()) failures.push('Worker 质量报告缺少校验器版本');
  if (!/^[0-9a-f]{64}$/i.test(String(report.outputSha256 || ''))) failures.push('Worker 质量报告缺少成片 SHA256');
  if (!String(report.videoCodec || '').trim()) failures.push('Worker 质量报告缺少视频编码');
  if (!String(report.audioCodec || '').trim()) failures.push('Worker 质量报告缺少音频编码');
  if (measured && /^[0-9a-f]{64}$/i.test(String(report.outputSha256 || '')) && String(report.outputSha256).toLowerCase() !== measured.sha256) {
    failures.push('Worker 报告 SHA256 与服务端实测不一致');
  }
  if (measured && Number.isFinite(measured.durationSeconds) && Number.isFinite(Number(report.durationSeconds))) {
    const allowed = Math.max(0.2, Number(measured.durationSeconds) * 0.03);
    if (Math.abs(Number(report.durationSeconds) - Number(measured.durationSeconds)) > allowed) {
      failures.push('Worker 报告时长与服务端实测不一致');
    }
  }
  if (measured && Number.isFinite(measured.width) && Number(report.width) !== Number(measured.width)) failures.push('Worker 报告宽度与服务端实测不一致');
  if (measured && Number.isFinite(measured.height) && Number(report.height) !== Number(measured.height)) failures.push('Worker 报告高度与服务端实测不一致');
  if (measured?.videoCodec && String(report.videoCodec || '').toLowerCase() !== measured.videoCodec.toLowerCase()) failures.push('Worker 报告视频编码与服务端实测不一致');
  if (measured?.audioCodec && String(report.audioCodec || '').toLowerCase() !== measured.audioCodec.toLowerCase()) failures.push('Worker 报告音频编码与服务端实测不一致');
  if (options.requireP1RenderTreatmentAudit) {
    failures.push(...verifyDigitalHumanRenderTreatmentAudit(report.renderTreatmentAudit, {
      expectedOutputSha256: measured?.sha256 || report.outputSha256,
      expectedRenderContext: options.expectedRenderContext,
      expectedBaseRenderFingerprint: options.expectedBaseRenderFingerprint,
      expectedMouthStabilizationScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
      requireSelected: true,
    }).map(failure => `Worker P1渲染回执验真失败：${failure}`));
  }
  return failures;
}

export function assessDigitalHumanMediaProbe(
  probe: DigitalHumanMediaProbe,
  options: { expectedDurationSeconds?: number } = {},
): string[] {
  const failures: string[] = [];
  if (!probe.decodePassed) failures.push('服务端无法完整解码数字人成片');
  if (!Number.isFinite(probe.width) || !Number.isFinite(probe.height) || Number(probe.width) <= 0 || Number(probe.height) <= 0) {
    failures.push('成片缺少有效视频画面');
  } else {
    const ratioError = Math.abs(Number(probe.width) / Number(probe.height) - 9 / 16);
    if (ratioError > 0.01) failures.push('成片画幅不是 9:16');
    if (Number(probe.width) < 540 || Number(probe.height) < 960) failures.push('成片分辨率低于 540x960');
  }
  if (!['h264', 'avc1'].includes(String(probe.videoCodec || '').toLowerCase())) failures.push('成片视频编码必须为 H.264');
  if (String(probe.audioCodec || '').toLowerCase() !== 'aac') failures.push('成片音频编码必须为 AAC');
  if (!/(?:^|,)mov(?:,|$)|(?:^|,)mp4(?:,|$)/i.test(String(probe.formatName || ''))) failures.push('成片容器必须为 MP4');
  if (!Number.isFinite(probe.durationSeconds) || Number(probe.durationSeconds) <= 0) {
    failures.push('成片缺少有效时长');
  } else if (Number.isFinite(options.expectedDurationSeconds) && Number(options.expectedDurationSeconds) > 0) {
    const expected = Number(options.expectedDurationSeconds);
    const allowed = Math.max(0.35, expected * 0.06);
    if (Math.abs(Number(probe.durationSeconds) - expected) > allowed) failures.push('成片时长偏离目标口播区间');
  }
  return failures;
}

function configuredFfprobePath(): string | undefined {
  const configured = String(process.env.DIGITAL_HUMAN_FFPROBE_PATH || process.env.FFPROBE_PATH || '').trim();
  if (configured) return configured;
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const adjacent = ffmpegStatic ? path.join(path.dirname(String(ffmpegStatic)), executable) : '';
  return adjacent && fs.existsSync(adjacent) ? adjacent : executable;
}

export async function validateDigitalHumanMediaFile(
  sourcePath: string,
  options: { expectedSha256?: string; expectedSizeBytes?: number; expectedDurationSeconds?: number; timeoutMs?: number } = {},
): Promise<DigitalHumanServerValidationReport> {
  const sizeBytes = fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 0;
  const sha256 = sizeBytes ? await sha256File(sourcePath) : '';
  const failures: string[] = [];
  if (!sizeBytes) failures.push('数字人成片文件为空');
  if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) failures.push('服务端 SHA256 与 Worker 声明不一致');
  if (Number.isFinite(options.expectedSizeBytes) && sizeBytes !== Number(options.expectedSizeBytes)) failures.push('服务端成片大小与上传记录不一致');

  const timeoutMs = Math.max(10_000, Math.min(10 * 60_000, Number(options.timeoutMs || process.env.DIGITAL_HUMAN_SERVER_PROBE_TIMEOUT_MS || 180_000)));
  let probe: DigitalHumanMediaProbe = { decodePassed: false, probeEngine: 'unavailable' };
  if (sizeBytes) {
    const ffprobe = configuredFfprobePath();
    const probed = ffprobe
      ? await runProbeProcess(ffprobe, ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration', '-of', 'json', sourcePath], timeoutMs)
      : { ok: false, stdout: '', stderr: '' };
    if (probed.ok) {
      try { probe = { ...parseFfprobeJson(probed.stdout), decodePassed: false, probeEngine: 'ffprobe' }; }
      catch { failures.push('ffprobe 返回了无效媒体信息'); }
    }

    if (probe.probeEngine !== 'ffprobe' && ffmpegStatic) {
      const metadata = await runProbeProcess(String(ffmpegStatic), [
        '-hide_banner', '-nostdin', '-nostats', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a:0', '-t', '0.05', '-f', 'null', '-',
      ], timeoutMs);
      probe = { ...parseFfmpegProbeText(`${metadata.stdout}\n${metadata.stderr}`), decodePassed: false, probeEngine: 'ffmpeg_fallback' };
    }

    if (ffmpegStatic) {
      const decoded = await runProbeProcess(String(ffmpegStatic), [
        '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-xerror', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
      ], timeoutMs);
      probe.decodePassed = decoded.ok;
    } else {
      failures.push('服务端未配置 ffmpeg，无法执行完整解码检查');
    }
  }

  failures.push(...assessDigitalHumanMediaProbe(probe, { expectedDurationSeconds: options.expectedDurationSeconds }));
  return {
    validatorVersion: 'server-media-v1',
    passed: failures.length === 0,
    sha256,
    sizeBytes,
    expectedDurationSeconds: options.expectedDurationSeconds,
    ...probe,
    failures: [...new Set(failures)],
  };
}

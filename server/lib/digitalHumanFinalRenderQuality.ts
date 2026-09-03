import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  validateDigitalHumanMediaFile,
  type DigitalHumanServerValidationReport,
} from './digitalHumanServerValidation.js';
import {
  DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION,
  type DigitalHumanTimelineIntegrityReport,
} from './digitalHumanTimelineIntegrity.js';

export const DIGITAL_HUMAN_FINAL_RENDER_QUALITY_VERSION = 'digital-human-final-render-quality-v1' as const;

export interface DigitalHumanFinalRenderFrameSample {
  atSeconds: number;
  measured: boolean;
  nonEmpty: boolean;
  yMin?: number;
  yMax?: number;
  yAverage?: number;
  dynamicRange?: number;
}

export interface DigitalHumanFinalRenderQualityReport {
  schemaVersion: typeof DIGITAL_HUMAN_FINAL_RENDER_QUALITY_VERSION;
  applicable: true;
  passed: boolean;
  checkedAt: string;
  syncNetApplied: false;
  expected: {
    durationSeconds: number;
    width: 1080;
    height: 1920;
    ratio: '9:16';
    videoTrack: true;
    audioTrack: true;
  };
  media: DigitalHumanServerValidationReport;
  nonEmptyFrames: {
    passed: boolean;
    minimumPassingSamples: number;
    passingSamples: number;
    samples: DigitalHumanFinalRenderFrameSample[];
  };
  timelineIntegrity: DigitalHumanTimelineIntegrityReport;
  failures: string[];
}

interface FrameProbeProcessResult {
  ok: boolean;
  stdout: string;
}

function runFrameProbe(file: string, args: string[], timeoutMs: number): Promise<FrameProbeProcessResult> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') });
    });
  });
}

function signalMetric(raw: string, name: 'YMIN' | 'YMAX' | 'YAVG'): number | undefined {
  const match = new RegExp(`lavfi\\.signalstats\\.${name}=(-?\\d+(?:\\.\\d+)?)`).exec(raw);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function assessDigitalHumanFinalRenderFrameSample(
  atSeconds: number,
  raw: string,
  measured = true,
): DigitalHumanFinalRenderFrameSample {
  const yMin = signalMetric(raw, 'YMIN');
  const yMax = signalMetric(raw, 'YMAX');
  const yAverage = signalMetric(raw, 'YAVG');
  const dynamicRange = Number.isFinite(yMin) && Number.isFinite(yMax) ? Number(yMax) - Number(yMin) : undefined;
  const hasUsefulImage = measured
    && Number.isFinite(yAverage)
    && Number(yAverage) > 4
    && Number(yAverage) < 251
    && Number.isFinite(dynamicRange)
    && Number(dynamicRange) >= 6;
  return {
    atSeconds,
    measured: measured && Number.isFinite(yMin) && Number.isFinite(yMax) && Number.isFinite(yAverage),
    nonEmpty: hasUsefulImage,
    yMin,
    yMax,
    yAverage,
    dynamicRange,
  };
}

function frameSampleTimes(durationSeconds: number): number[] {
  const duration = Math.max(0.12, Number(durationSeconds) || 0.12);
  const maximum = Math.max(0.04, duration - 0.04);
  return [...new Set([0.2, 0.5, 0.8]
    .map(fraction => Number(Math.min(maximum, Math.max(0.04, duration * fraction)).toFixed(3))))];
}

async function probeNonEmptyFrames(
  sourcePath: string,
  durationSeconds: number,
  timeoutMs: number,
): Promise<DigitalHumanFinalRenderQualityReport['nonEmptyFrames']> {
  const samples: DigitalHumanFinalRenderFrameSample[] = [];
  const executable = ffmpegStatic ? String(ffmpegStatic) : '';
  for (const atSeconds of frameSampleTimes(durationSeconds)) {
    if (!executable) {
      samples.push(assessDigitalHumanFinalRenderFrameSample(atSeconds, '', false));
      continue;
    }
    // Inspect the central 70% so a disclosure badge or bottom subtitle cannot
    // turn an otherwise blank digital-human render into a false pass.
    const result = await runFrameProbe(executable, [
      '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
      '-ss', String(atSeconds), '-i', sourcePath,
      '-map', '0:v:0',
      '-vf', 'crop=trunc(iw*0.7/2)*2:trunc(ih*0.7/2)*2:trunc(iw*0.15/2)*2:trunc(ih*0.15/2)*2,signalstats,metadata=print:file=-',
      '-frames:v', '1', '-f', 'null', '-',
    ], timeoutMs);
    samples.push(assessDigitalHumanFinalRenderFrameSample(atSeconds, result.stdout, result.ok));
  }
  const passingSamples = samples.filter(sample => sample.nonEmpty).length;
  const minimumPassingSamples = Math.max(1, Math.ceil(samples.length * 2 / 3));
  return {
    passed: samples.length > 0 && passingSamples >= minimumPassingSamples,
    minimumPassingSamples,
    passingSamples,
    samples,
  };
}

export function digitalHumanFinalRenderFailures(input: {
  media: DigitalHumanServerValidationReport;
  nonEmptyFrames: DigitalHumanFinalRenderQualityReport['nonEmptyFrames'];
  timelineIntegrity: DigitalHumanTimelineIntegrityReport;
  expectedDurationSeconds: number;
}): string[] {
  const failures = [...input.media.failures];
  if (input.media.width !== 1080 || input.media.height !== 1920) {
    failures.push('数字人最终成片分辨率必须为 1080x1920');
  }
  if (!input.media.videoCodec) failures.push('数字人最终成片缺少视频轨');
  if (!input.media.audioCodec) failures.push('数字人最终成片缺少音频轨');
  if (!input.nonEmptyFrames.passed) failures.push('数字人最终成片的中心画面为空或无有效像素变化');
  if (!input.timelineIntegrity.passed) {
    failures.push(...input.timelineIntegrity.failures);
    failures.push('数字人最终合成时间轴改变了已验 Worker 口型片段');
  }
  if (!Number.isFinite(input.expectedDurationSeconds) || input.expectedDurationSeconds <= 0) {
    failures.push('数字人最终成片缺少有效的目标时长');
  }
  return [...new Set(failures)];
}

/**
 * Final composition gate for a manifest already proven to contain at least
 * one digital-human timeline item. It intentionally performs no whole-film
 * SyncNet scoring because B-roll intervals do not contain a speaking face.
 */
export async function validateDigitalHumanFinalRenderFile(
  sourcePath: string,
  expectedDurationSeconds: number,
  options: { timeoutMs?: number; timelineIntegrity?: DigitalHumanTimelineIntegrityReport } = {},
): Promise<DigitalHumanFinalRenderQualityReport> {
  const timeoutMs = Math.max(10_000, Math.min(10 * 60_000, Number(options.timeoutMs || 180_000)));
  const media = await validateDigitalHumanMediaFile(sourcePath, { expectedDurationSeconds, timeoutMs });
  const nonEmptyFrames = await probeNonEmptyFrames(sourcePath, media.durationSeconds || expectedDurationSeconds, timeoutMs);
  const timelineIntegrity = options.timelineIntegrity || {
    schemaVersion: DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION,
    passed: false,
    segmentCount: 0,
    failures: ['数字人最终质检缺少冻结片段一致性回执'],
  };
  const failures = digitalHumanFinalRenderFailures({ media, nonEmptyFrames, timelineIntegrity, expectedDurationSeconds });
  return {
    schemaVersion: DIGITAL_HUMAN_FINAL_RENDER_QUALITY_VERSION,
    applicable: true,
    passed: failures.length === 0,
    checkedAt: new Date().toISOString(),
    syncNetApplied: false,
    expected: {
      durationSeconds: expectedDurationSeconds,
      width: 1080,
      height: 1920,
      ratio: '9:16',
      videoTrack: true,
      audioTrack: true,
    },
    media,
    nonEmptyFrames,
    timelineIntegrity,
    failures,
  };
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { readVideoFrameEvidence } from './socialVideoFrameEvidence.js';

export type SubtitleStyleTarget = { fonts: string[]; fontSize: number; colors: string[] };
export type SubtitleStyleObservation = {
  subtitlePresent: boolean | null;
  font: boolean | null; fontSize: boolean | null; color: boolean | null;
  reason: string;
};
/** A pixel inspector receives actual decoded PNG bytes. Metadata/ASS receipts
 * alone are not observations. Unconfigured adapters must return unknown. */
export type SubtitleStyleFrameInspector = (input: {
  png: Buffer; frameSha256: string; atSeconds: number; expected: SubtitleStyleTarget;
}) => Promise<SubtitleStyleObservation>;
export type SubtitleStyleSample = SubtitleStyleObservation & {
  atSeconds: number; frameSha256: string; framePath: string;
};
export interface SubtitleStyleSamplingReport {
  schemaVersion: 'subtitle-style-sampling.v1'; mediaSha256: string;
  status: 'passed' | 'blocked' | 'unknown'; reason: string;
  samples: SubtitleStyleSample[]; skippedNoSubtitleFrames: number;
}

export function subtitleStyleSampleDecision(samples: SubtitleStyleObservation[]): 'passed' | 'blocked' | 'unknown' | 'sample_more' {
  const valid = samples.filter(item => item.subtitlePresent === true);
  const passed = (item: SubtitleStyleObservation) => item.font === true && item.fontSize === true && item.color === true;
  const known = (item: SubtitleStyleObservation) => [item.font, item.fontSize, item.color].every(value => typeof value === 'boolean');
  if (valid.slice(0, 2).some(item => !known(item))) return 'unknown';
  if (valid.length < 2) return 'sample_more';
  if (valid.slice(0, 2).every(passed)) return 'passed';
  if (valid.length < 3) return 'sample_more';
  return !known(valid[2]) ? 'unknown' : passed(valid[2]) ? 'passed' : 'blocked';
}

/** An evenly spread, byte-seeded order, independent of subtitle cue content.
 * Visiting every frame permits an absence finding; an incomplete scan does not. */
function frameOrder(count: number, sha256: string): number[] {
  const frames = Array.from({ length: count }, (_, index) => index);
  let seed = Number.parseInt(sha256.slice(0, 8), 16) || 1;
  for (let index = count - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [frames[index], frames[other]] = [frames[other], frames[index]];
  }
  return frames;
}

export async function inspectVideoSubtitleStyle(input: {
  outputPath: string; duration: number; fps?: number; expected: SubtitleStyleTarget;
  inspectFrame?: SubtitleStyleFrameInspector;
  runFfmpeg?: typeof runVisualFfmpeg;
  evidenceRoot?: string;
}): Promise<SubtitleStyleSamplingReport> {
  const mediaSha256 = createHash('sha256').update(await readFile(input.outputPath)).digest('hex');
  const report: SubtitleStyleSamplingReport = { schemaVersion: 'subtitle-style-sampling.v1', mediaSha256,
    status: 'unknown', reason: '字幕样式像素检测器尚未配置，需要用户介入或确认', samples: [], skippedNoSubtitleFrames: 0 };
  if (!input.inspectFrame) return report;
  if (!(input.duration > 0 && input.duration <= 30) || !(input.expected.fontSize > 0) || !Number.isFinite(input.expected.fontSize)
    || !input.expected.fonts.length || input.expected.fonts.some(font => !font.trim())
    || !input.expected.colors.length || input.expected.colors.some(color => !/^#[0-9a-f]{6}$/i.test(color))) {
    report.reason = '实际时长或字幕渲染样式不可用'; return report;
  }
  try {
    let frames: Awaited<ReturnType<typeof readVideoFrameEvidence>>['frames'];
    try {
      const evidence = await readVideoFrameEvidence({ outputPath: input.outputPath, runFfmpeg: input.runFfmpeg });
      if (evidence.mediaSha256 !== mediaSha256) { report.reason = '成片在检查期间发生变化'; return report; }
      frames = evidence.frames;
    } catch { report.reason = '无法完整读取实际视频帧时间戳'; return report; }
    const directory = path.resolve(input.evidenceRoot ?? 'data/content-execution-quality', mediaSha256);
    await mkdir(directory, { recursive: true });
    const count = frames.length;
    for (const frameIndex of frameOrder(count, mediaSha256)) {
      const atSeconds = frames[frameIndex].atSeconds;
      const decoded = await (input.runFfmpeg ?? runVisualFfmpeg)(['-i', input.outputPath,
        '-map', '0:v:0', '-vf', `select=eq(n\\,${frameIndex})`, '-fps_mode', 'passthrough',
        '-frames:v', '1', '-an', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], true);
      if (!decoded.ok || !decoded.stdout.length) { report.reason = '实际成片抽帧不可读'; return report; }
      const frameSha256 = createHash('sha256').update(decoded.stdout).digest('hex');
      let observation: SubtitleStyleObservation;
      try { const inspected = await input.inspectFrame({ png: decoded.stdout, frameSha256, atSeconds, expected: structuredClone(input.expected) });
        if (!inspected || typeof inspected.reason !== 'string'
          || !['subtitlePresent', 'font', 'fontSize', 'color'].every(key => {
            const value = inspected[key as keyof SubtitleStyleObservation];
            return value === null || typeof value === 'boolean';
          })) { report.reason = '字幕样式像素检测器返回无效证据'; return report; }
        observation = { subtitlePresent: inspected.subtitlePresent, font: inspected.font,
          fontSize: inspected.fontSize, color: inspected.color, reason: inspected.reason }; }
      catch { report.reason = '字幕样式像素检测器不可用'; return report; }
      if (observation.subtitlePresent === false) { report.skippedNoSubtitleFrames++; continue; }
      const framePath = path.join(directory, `${frameIndex}-${frameSha256}.png`);
      await writeFile(framePath, decoded.stdout);
      report.samples.push({ ...observation, atSeconds, frameSha256, framePath });
      if (observation.subtitlePresent !== true) { report.reason = '无法确定抽样帧是否含字幕'; return report; }
      const decision = subtitleStyleSampleDecision(report.samples);
      if (decision !== 'sample_more') {
        report.status = decision;
        report.reason = decision === 'passed' ? '字幕字体、字号、颜色按两帧/第三帧规则通过'
          : decision === 'blocked' ? '第三个有效字幕帧样式未通过，需要用户介入或确认' : '字幕样式证据不足，需要用户介入或确认';
        return report;
      }
    }
    report.status = report.skippedNoSubtitleFrames === count ? 'blocked' : 'unknown';
    report.reason = report.status === 'blocked' ? '逐帧扫描未发现字幕，需要用户介入或确认' : '有效字幕帧不足两帧，不能判定抽检通过';
    return report;
  } catch {
    report.status = 'unknown'; report.reason = '字幕样式抽帧或证据保存失败，需要用户介入或确认'; return report;
  } finally {
    let currentSha256 = '';
    try { currentSha256 = createHash('sha256').update(await readFile(input.outputPath)).digest('hex'); } catch { /* Removed media is changed evidence. */ }
    if (currentSha256 !== mediaSha256) {
      report.status = 'unknown'; report.reason = '成片在字幕样式检查期间发生变化，需要重新检查';
    }
  }
}

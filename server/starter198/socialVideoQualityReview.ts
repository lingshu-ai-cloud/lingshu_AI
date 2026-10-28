import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectVideoSubtitleStyle, type SubtitleStyleFrameInspector, type SubtitleStyleTarget } from './socialVideoSubtitleStyleSampling.js';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';

export const VOICE_DRIVEN_VIDEO_POLICY = 'voice-driven-slots.v1';
export const VIDEO_TIMELINE_TOLERANCE_SECONDS = 0.3;
type SceneWindow = { sceneId: string; targetStart: number; targetEnd: number };
/** An adapter must measure actual final-media cuts. Repeating the manifest's
 * expected windows is not a measurement and must never approve local sync. */
export type VideoTimelineMeasurementPort = (input: {
  outputPath: string; mediaSha256: string; expectedScenes: SceneWindow[];
}) => Promise<{ mediaSha256: string; durationSeconds: number; scenes: SceneWindow[]; evidenceRef: string }>;

export function assessVideoTimeline(input: {
  mediaSha256: string; expectedDuration: number; expectedScenes: SceneWindow[];
  measurement?: Awaited<ReturnType<VideoTimelineMeasurementPort>>;
}) {
  const measured = input.measurement;
  if (!measured || measured.mediaSha256 !== input.mediaSha256 || !measured.evidenceRef
    || !Number.isFinite(measured.durationSeconds) || !input.expectedScenes.length
    || measured.scenes.length !== input.expectedScenes.length)
    return { status: 'unknown' as const, toleranceSeconds: VIDEO_TIMELINE_TOLERANCE_SECONDS,
      reason: '缺少绑定实际成片的切点测量，不能用计划时间证明音画同步' };
  const offsets = input.expectedScenes.flatMap((expected, index) => {
    const actual = measured.scenes[index];
    if (actual.sceneId !== expected.sceneId || !Number.isFinite(actual.targetStart) || !Number.isFinite(actual.targetEnd)
      || actual.targetStart < 0 || actual.targetEnd <= actual.targetStart) return [Infinity];
    return [Math.abs(actual.targetStart - expected.targetStart), Math.abs(actual.targetEnd - expected.targetEnd)];
  });
  const cumulativeOffsetSeconds = Math.abs(measured.durationSeconds - input.expectedDuration);
  const maxLocalOffsetSeconds = Math.max(...offsets);
  const passed = Math.max(cumulativeOffsetSeconds, maxLocalOffsetSeconds) <= VIDEO_TIMELINE_TOLERANCE_SECONDS + 1e-9;
  return { status: passed ? 'passed' as const : 'blocked' as const, toleranceSeconds: VIDEO_TIMELINE_TOLERANCE_SECONDS,
    maxLocalOffsetSeconds, cumulativeOffsetSeconds, evidenceRef: measured.evidenceRef,
    reason: passed ? '实际画面切点局部及累计偏移在0.3秒内' : '实际画面切点局部或累计偏移超过0.3秒，需修复剪辑或合成' };
}

/** Read the actual renderer's private ASS plus its verified hash. This is the
 * target only; it is deliberately never treated as a pixel-test result. */
export async function readRenderedSubtitleStyle(sidecar?: { path: string; sha256: string }): Promise<SubtitleStyleTarget | null> {
  if (!sidecar) return null;
  try {
    const bytes = await readFile(sidecar.path);
    if (createHash('sha256').update(bytes).digest('hex') !== sidecar.sha256) return null;
    const lines = bytes.toString('utf8').split(/\r?\n/);
    const styles = lines.filter(line => line.startsWith('Style: ')).map(line => line.slice(7).split(','));
    const defaults = styles.filter(style => style[0] === 'Default');
    if (defaults.length !== 1) return null;
    const fontSize = Number(defaults[0][2]);
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) return null;
    const fonts = new Set<string>(), colors = new Set<string>();
    const color = (value: string) => {
      const match = /^&H(?:[0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})&?$/i.exec(value);
      return match ? `#${match[3]}${match[2]}${match[1]}`.toUpperCase() : null;
    };
    const useStyle = (name: string) => {
      const matching = styles.filter(style => style[0] === name);
      if (matching.length !== 1) return false;
      const style = matching[0], primary = color(style[3] ?? '');
      // The current target supports one font size. Do not turn animated or
      // mixed-size targets into an unrelated global template allowlist.
      if (!style[1]?.trim() || Number(style[2]) !== fontSize || !primary) return false;
      fonts.add(style[1]); colors.add(primary); return true;
    };
    if (!useStyle('Default')) return null;
    for (const event of lines.filter(line => line.startsWith('Dialogue: '))) {
      const fields = event.slice(10).split(',');
      if (fields.length < 10 || !useStyle(fields[3])) return null;
      // Read only ASS override metadata, never the displayed subtitle text.
      for (const block of fields.slice(9).join(',').match(/\{[^{}]*\}/g) ?? []) {
        if (/\\(?:t\(|fsc[xy])/.test(block)) return null;
        for (const match of block.matchAll(/\\fs([\d.]+)/g)) if (Number(match[1]) !== fontSize) return null;
        for (const match of block.matchAll(/\\fn([^\\}]+)/g)) fonts.add(match[1]);
        for (const match of block.matchAll(/\\(?:1?c)(&H[0-9A-F]+&?)/gi)) {
          const primary = color(match[1]); if (!primary) return null; colors.add(primary);
        }
        for (const match of block.matchAll(/\\r([^\\}]*)/g)) if (!useStyle(match[1] || 'Default')) return null;
      }
    }
    return { fonts: [...fonts], fontSize, colors: [...colors] };
  } catch { return null; }
}

export async function reviewVoiceDrivenVideo(input: {
  outputPath: string; duration: number; scenes: SceneWindow[];
  subtitleAssSidecar?: { path: string; sha256: string };
  inspectSubtitleStyleFrame?: SubtitleStyleFrameInspector;
  measureVideoTimeline?: VideoTimelineMeasurementPort;
  runFfmpeg?: typeof runVisualFfmpeg;
}) {
  const mediaSha256 = createHash('sha256').update(await readFile(input.outputPath)).digest('hex');
  let measurement: Awaited<ReturnType<VideoTimelineMeasurementPort>> | undefined;
  try { measurement = await input.measureVideoTimeline?.({ outputPath: input.outputPath, mediaSha256, expectedScenes: input.scenes }); }
  catch { /* Retain unknown; a failed detector cannot approve the film. */ }
  const timeline = assessVideoTimeline({ mediaSha256, expectedDuration: input.duration, expectedScenes: input.scenes, measurement });
  const expected = await readRenderedSubtitleStyle(input.subtitleAssSidecar);
  const subtitleStyle = expected ? await inspectVideoSubtitleStyle({ outputPath: input.outputPath, duration: input.duration,
    expected, inspectFrame: input.inspectSubtitleStyleFrame, runFfmpeg: input.runFfmpeg })
    : { schemaVersion: 'subtitle-style-sampling.v1' as const, mediaSha256, status: 'unknown' as const,
      samples: [], skippedNoSubtitleFrames: 0, reason: '缺少当前渲染器字幕样式，不能判断字体、字号、颜色' };
  if (createHash('sha256').update(await readFile(input.outputPath)).digest('hex') !== mediaSha256)
    throw Error('user_input_required:video_quality_media_changed');
  return { schemaVersion: 'voice-driven-video-quality.v1' as const, mediaSha256, timeline, subtitleStyle };
}

/** Called by the existing quality node, with its durable checkpoint writer. */
export async function enforceVoiceDrivenVideoReview(input: Parameters<typeof reviewVoiceDrivenVideo>[0],
  persist: (report: Awaited<ReturnType<typeof reviewVoiceDrivenVideo>>) => Promise<void>,
  acceptUnknown?: (report: Awaited<ReturnType<typeof reviewVoiceDrivenVideo>>) => Promise<Record<string,unknown>|null>) {
  const report = await reviewVoiceDrivenVideo(input);
  await persist(report);
  const acceptance=(report.subtitleStyle.status!=='passed'||report.timeline.status==='unknown')
    &&report.timeline.status!=='blocked'
    ?await acceptUnknown?.(report):null;
  if(acceptance&&(report.subtitleStyle.status!=='blocked'||acceptance.decision==='accept_subtitle_style'))return{...report,userAcceptance:acceptance};
  if (report.subtitleStyle.status !== 'passed')
    throw Error(`user_input_required:subtitle_style_${report.subtitleStyle.status}:${report.subtitleStyle.reason}`);
  if (report.timeline.status !== 'passed')
    throw Error(`user_input_required:video_timeline_${report.timeline.status}:${report.timeline.reason}`);
  return report;
}

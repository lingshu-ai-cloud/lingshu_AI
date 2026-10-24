import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import type { ReferenceFrameSamplingProfile, ReferenceFrameSamplingRange } from '../lib/referenceFrameSamplingPolicy.js';

const execFileAsync = promisify(execFile);
const ffmpegBin = ffmpegStatic as unknown as string | null;
const ANALYSIS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/analysis-temp');

export function sourceFrameTimes(log: string): number[] {
  const clock = log.match(/config in time_base:\s*(\d+)\/(\d+)/);
  if (!clock || Number(clock[2]) <= 0) throw new Error('video_frame_source_clock_missing');
  // pts_time is rounded to six significant digits by FFmpeg's logger. Use
  // integer PTS/time_base so long-video labels cannot drift onto the next frame.
  return Array.from(log.matchAll(/\bn:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:/g),
    match => Number(match[1]) * Number(clock[1]) / Number(clock[2]));
}

export function strongestSceneCuts(candidates: Array<{ time: number; score: number }>): number[] {
  const groups: Array<typeof candidates> = [];
  for (const candidate of [...candidates].filter(row => row.time > 0.2 && Number.isFinite(row.score)).sort((a, b) => a.time - b.time)) {
    const group = groups.at(-1);
    if (!group || candidate.time - group.at(-1)!.time >= 0.18) groups.push([candidate]);
    else group.push(candidate);
  }
  return groups.map(group => +group.reduce((best, row) => row.score > best.score ? row : best).time.toFixed(6));
}

/** Select source frames without fps resampling; keep the decoded frame PTS with each JPEG. */
export async function extractSourceClockFrames(filePath: string, pattern: string, select: string, limit: number, width = 384) {
  if (!ffmpegBin) throw new Error('ffmpeg is not available for frame analysis');
  const result = await execFileAsync(ffmpegBin, ['-hide_banner', '-loglevel', 'info', '-i', filePath,
    '-vf', `select='${select}',showinfo,scale=${width}:-1`, '-fps_mode', 'vfr',
    '-frames:v', String(limit), '-q:v', '4', pattern], { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
  const times = sourceFrameTimes(result.stderr);
  const prefix = path.basename(pattern).split('%')[0]!;
  const files = fs.readdirSync(path.dirname(pattern)).filter(file => file.startsWith(prefix) && file.endsWith('.jpg')).sort();
  if (times.length < files.length || times.slice(0, files.length).some(time => !Number.isFinite(time) || time < 0)) {
    throw new Error('video_frame_source_clock_missing');
  }
  return files.map((file, index) => ({ file, time: times[index]! }));
}

export async function extractQwenAnalysisFrames(filePath: string, maxFrames = 30, duration = 0, analysisMode: 'strategy' | 'exact' = 'exact', physicalCuts: number[] = [], samplingProfile: ReferenceFrameSamplingProfile = 'coarse', denseRanges: ReferenceFrameSamplingRange[] = []): Promise<Array<{ base64: string; mimeType: string; timeLabel: string }>> {
  if (!ffmpegBin) throw new Error('ffmpeg is not available for Qwen frame analysis');
  if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const frameDir = path.join(ANALYSIS_DIR, `qwen-frames-${Date.now()}-${randomUUID()}`);
  fs.mkdirSync(frameDir, { recursive: true });
  try {
    // Sub-second sampling is reserved for footage already classified as a real
    // presenter shot. Factory, product and D2C footage retain the less costly
    // scene-cut/uniform evidence below.
    const denseFps = analysisMode === 'exact' && samplingProfile === 'talking_head_dense'
      ? 2
      : 0;
    const denseCount = denseFps ? denseRanges.reduce((sum, range) => sum + Math.ceil((range.endSeconds - range.startSeconds) * denseFps), 0) : 0;
    if (denseCount > 120) throw new Error('presenter_dense_sampling_budget_exceeded');
    const denseRows: Array<{ file: string; time: number; dense: boolean }> = [];
    if (denseFps) for (const [index, range] of denseRanges.entries()) {
      const count = Math.max(1, Math.ceil((range.endSeconds - range.startSeconds) * denseFps));
      const rows = await extractSourceClockFrames(filePath, path.join(frameDir, `dense-${index}-%03d.jpg`),
        `gte(t,${range.startSeconds})*lt(t,${range.endSeconds})*(isnan(prev_selected_t)+gte(t-prev_selected_t,${1 / denseFps - 1e-6}))`, count);
      denseRows.push(...rows.map(row => ({ ...row, dense: true })));
    }
    const uniformPattern = path.join(frameDir, 'uniform-%02d.jpg');
    const strategyInterval = 5;
    const uniformCount = analysisMode === 'strategy'
      ? Math.max(1, Math.min(maxFrames, Math.ceil(Math.max(duration, 1) / strategyInterval) + 1))
      : Math.max(8, Math.min(42, Math.ceil((maxFrames - denseCount) * 0.6)));
    const uniformInterval = analysisMode === 'strategy'
      ? strategyInterval
      : duration > 4 ? Math.max(1, (duration - 1) / Math.max(1, uniformCount - 1)) : 4;
    const uniformRows = await extractSourceClockFrames(filePath, uniformPattern,
      `isnan(prev_selected_t)+gte(t-prev_selected_t,${uniformInterval - 1e-6})`, uniformCount);
    let sceneRows: Array<{ file: string; time: number }> = [];
    if (analysisMode === 'exact') {
      const count = Math.max(6, maxFrames - denseCount - uniformCount);
      sceneRows = await extractSourceClockFrames(filePath, path.join(frameDir, 'scene-%03d.jpg'), 'gt(scene,0.12)', count);
    }
    // A transition frame can be blurred or show both products. Observe the
    // middle of each short physical shot so the product label and item survive
    // the handoff as one distinct visual requirement.
    const cutCandidates = physicalCuts.length ? physicalCuts : analysisMode === 'exact' ? await detectVideoSceneCuts(filePath) : [];
    const distinctCuts = cutCandidates.filter((time, index) => index === 0 || time - cutCandidates[index - 1]! >= 0.18);
    const cutBounds = [0, ...distinctCuts, duration].filter(value => Number.isFinite(value));
    const midpointRows: Array<{ file: string; time: number; dense: boolean }> = [];
    if (analysisMode === 'exact') {
      const shortIntervals = Array.from({ length: Math.max(0, cutBounds.length - 1) }, (_, index) => index)
        .filter(index => cutBounds[index + 1]! - cutBounds[index]! >= 0.35 && cutBounds[index + 1]! - cutBounds[index]! <= 2.5);
      const sampledIntervals = shortIntervals.length <= 24 ? shortIntervals : Array.from({ length: 24 }, (_, index) => shortIntervals[Math.round(index * (shortIntervals.length - 1) / 23)]!);
      for (const index of sampledIntervals) {
        const start = cutBounds[index]!, end = cutBounds[index + 1]!;
        const time = +(start + (end - start) / 2).toFixed(2);
        try {
          const observed = await extractSourceClockFrames(filePath, path.join(frameDir, `midpoint-${index}-%03d.jpg`), `gte(t,${time})*lt(t,${end})`, 1);
          midpointRows.push(...observed.map(row => ({ ...row, dense: false })));
        } catch { /* keep the other sampled frames */ }
      }
    }
    const supplementalRows = [
      ...uniformRows.map(row => ({ ...row, dense: false })),
      ...sceneRows.map(row => ({ ...row, dense: false })),
    ].sort((a, b) => a.time - b.time)
      .filter(row => !denseRows.some(dense => Math.abs(dense.time - row.time) < 0.45))
      .filter(row => !midpointRows.some(midpoint => Math.abs(midpoint.time - row.time) < 0.35))
      .filter((row, index, all) => index === 0 || Math.abs(row.time - all[index - 1].time) >= 0.45);
    const rows = [...denseRows, ...midpointRows, ...supplementalRows.slice(0, Math.max(0, maxFrames - denseRows.length - midpointRows.length))]
      .sort((a, b) => a.time - b.time)
      .slice(0, maxFrames);
    if (!rows.length) throw new Error('video_frame_extraction_empty');
    return rows.map(row => ({ base64: fs.readFileSync(path.join(frameDir, row.file)).toString('base64'), mimeType: 'image/jpeg', timeLabel: `${row.time.toFixed(6)}s` }));
  } finally {
    try {
      for (const file of fs.readdirSync(frameDir)) fs.unlinkSync(path.join(frameDir, file));
      fs.rmdirSync(frameDir);
    } catch {
      // best effort cleanup
    }
  }
}

/** Keep hook motion evidence independent of the lower-density whole-video sample.
 * Twelve real frames in the first second preserve the approach/gesture sequence. */
export async function extractOpeningHookFrames(filePath: string): Promise<Array<{ base64: string; mimeType: string; timeLabel: string }>> {
  if (!ffmpegBin) throw new Error('ffmpeg is not available for opening hook analysis');
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const frameDir = path.join(ANALYSIS_DIR, `hook-frames-${randomUUID()}`);
  fs.mkdirSync(frameDir, { recursive: true });
  try {
    const rows = await extractSourceClockFrames(filePath, path.join(frameDir, 'hook-%03d.jpg'),
      'lt(t,1)*(isnan(prev_selected_t)+gte(t-prev_selected_t,0.083332333333))', 12, 720);
    return rows.map(row => ({ base64: fs.readFileSync(path.join(frameDir, row.file)).toString('base64'),
      mimeType: 'image/jpeg', timeLabel: `${row.time.toFixed(6)}s` }));
  } finally {
    for (const file of fs.readdirSync(frameDir)) fs.unlinkSync(path.join(frameDir, file));
    fs.rmdirSync(frameDir);
  }
}

export async function detectVideoSceneCuts(filePath: string): Promise<number[]> {
  if (!ffmpegBin) return [];
  try {
    const result = await execFileAsync(ffmpegBin, [
      '-hide_banner', '-loglevel', 'info', '-i', filePath,
      // Product montages often use wipes over similar bright backgrounds.
      // A stricter threshold swallowed the individual product shots in a
      // real six-item sequence; nearby transition frames are collapsed below.
      '-vf', "select='gt(scene,0.12)',showinfo,metadata=print:key=lavfi.scene_score", '-fps_mode', 'vfr', '-f', 'null', '-',
    ], { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
    const times = sourceFrameTimes(result.stderr);
    const scores = Array.from(result.stderr.matchAll(/lavfi\.scene_score=([0-9.]+)/g), match => Number(match[1]));
    if (times.length !== scores.length) throw new Error('video_scene_score_clock_mismatch');
    return strongestSceneCuts(times.map((time, index) => ({ time, score: scores[index]! })));
  } catch (error) {
    console.warn('[videos] scene cut detection unavailable; retaining continuous observation windows:', error instanceof Error ? error.message : error);
    return [];
  }
}

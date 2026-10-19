import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';

const exec = promisify(execFile);

export interface ReferenceFrameWindow {
  shotId: string;
  startSeconds: number;
  endSeconds: number;
}

/** Pixel hashes prove decoded frame identity, not what the frame depicts. */
export interface ReferenceDenseFrameLedger {
  purpose: 'reference_structure_only';
  sourceTenantId: string;
  sourceVideoId: string;
  sourceSha256: string;
  timebase: { numerator: number; denominator: number };
  frames: Array<{ index: number; pts: number; seconds: number; decodedSha256: string }>;
  windows: Array<ReferenceFrameWindow & { frameCount: number; firstFrameSeconds: number | null;
    lastFrameSeconds: number | null; maximumObservedGapSeconds: number | null; denseAtHalfSecond: boolean }>;
  semanticStatus: 'unobserved';
}

async function sha256File(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

/** Read-only and supplier-free. The caller must already be allowed to read this tenant's reference bytes. */
export async function readReferenceDenseFrameLedger(input: {
  sourcePath: string;
  expectedSourceSha256: string;
  sourceTenantId: string;
  sourceVideoId: string;
  windows: ReferenceFrameWindow[];
}): Promise<ReferenceDenseFrameLedger> {
  if (!ffmpeg) throw new Error('reference_frame_ledger_ffmpeg_unavailable');
  if (!/^[a-f0-9]{64}$/i.test(input.expectedSourceSha256)
    || !input.sourceTenantId || !input.sourceVideoId) throw new Error('reference_frame_ledger_source_invalid');
  const before = await sha256File(input.sourcePath);
  if (before !== input.expectedSourceSha256.toLowerCase()) throw new Error('reference_frame_ledger_source_hash_mismatch');
  const { stdout } = await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input.sourcePath,
    '-map', '0:v:0', '-an', '-f', 'framehash', '-hash', 'SHA256', '-'], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const after = await sha256File(input.sourcePath);
  if (after !== before) throw new Error('reference_frame_ledger_source_changed');
  const match = stdout.match(/^#tb 0:\s*(\d+)\/(\d+)\s*$/m);
  if (!match) throw new Error('reference_frame_ledger_timebase_missing');
  const numerator = Number(match[1]), denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || numerator <= 0 || denominator <= 0) throw new Error('reference_frame_ledger_timebase_invalid');
  const frames = stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map((line, index) => {
    const parts = line.split(',').map(part => part.trim());
    const pts = Number(parts[2]);
    if (parts.length !== 6 || parts[0] !== '0' || !Number.isSafeInteger(pts)
      || !/^[a-f0-9]{64}$/i.test(parts[5] ?? '')) throw new Error('reference_frame_ledger_frame_invalid');
    return { index, pts, seconds: pts * numerator / denominator, decodedSha256: parts[5]!.toLowerCase() };
  });
  if (!frames.length || frames.some((frame, index) => index > 0 && frame.pts <= frames[index - 1]!.pts))
    throw new Error('reference_frame_ledger_pts_invalid');
  if (!input.windows.length || input.windows.some((window, index) => index > 0
    && Math.abs(window.startSeconds - input.windows[index - 1]!.endSeconds) > .001))
    throw new Error('reference_frame_ledger_windows_noncontiguous');
  const framePeriod = frames.length > 1 ? frames[1]!.seconds - frames[0]!.seconds : 0;
  if (input.windows[0]!.startSeconds > frames[0]!.seconds + .001
    || input.windows.at(-1)!.endSeconds < frames.at(-1)!.seconds
    || input.windows.at(-1)!.endSeconds > frames.at(-1)!.seconds + Math.max(framePeriod, .05) + .001)
    throw new Error('reference_frame_ledger_windows_incomplete');
  const windows = input.windows.map(window => {
    if (!window.shotId || !Number.isFinite(window.startSeconds) || !Number.isFinite(window.endSeconds)
      || window.startSeconds < 0 || window.endSeconds <= window.startSeconds) throw new Error('reference_frame_ledger_window_invalid');
    const observed = frames.filter(frame => frame.seconds >= window.startSeconds - 0.0001
      && frame.seconds < window.endSeconds - 0.0001);
    const first = observed[0], last = observed.at(-1);
    const gaps = observed.slice(1).map((frame, index) => frame.seconds - observed[index]!.seconds);
    const maxGap = gaps.length ? Math.max(...gaps) : null;
    return { ...window, frameCount: observed.length, firstFrameSeconds: first?.seconds ?? null,
      lastFrameSeconds: last?.seconds ?? null, maximumObservedGapSeconds: maxGap,
      denseAtHalfSecond: Boolean(first && last && maxGap !== null && maxGap <= .5
        && first.seconds - window.startSeconds <= .5 && window.endSeconds - last.seconds <= .5) };
  });
  return { purpose: 'reference_structure_only', sourceTenantId: input.sourceTenantId,
    sourceVideoId: input.sourceVideoId, sourceSha256: before, timebase: { numerator, denominator },
    frames, windows, semanticStatus: 'unobserved' };
}

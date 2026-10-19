import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import type { ReferenceDenseFrameLedger } from './referenceDenseFrameLedger.js';

const exec = promisify(execFile);
const side = 16;
const frameBytes = side * side;

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2 : 0;
}

/**
 * An observed change in downscaled pixels is only a possible edit boundary.
 * It is not evidence of a shot's action, speaker, product, audio or rights.
 */
export async function observeReferenceCutBoundaries(input: {
  sourcePath: string;
  ledger: ReferenceDenseFrameLedger;
}): Promise<{
  purpose: 'reference_structure_only';
  sourceTenantId: string;
  sourceVideoId: string;
  sourceSha256: string;
  method: 'adjacent_16x16_gray_mean_absolute_difference_v1';
  boundaries: Array<{
    beforeShotId: string;
    afterShotId: string;
    proposedSeconds: number;
    observedSeconds: number | null;
    distanceSeconds: number | null;
    pixelDifference: number | null;
    localMedianDifference: number | null;
    localPeakRatio: number | null;
    observation: 'visual_discontinuity_candidate' | 'weak_visual_change' | 'unresolved';
    audioStatus: 'unexamined';
    subtitleStatus: 'unexamined';
    semanticStatus: 'unobserved';
  }>;
}> {
  if (!ffmpeg) throw new Error('reference_cut_ffmpeg_unavailable');
  if (input.ledger.purpose !== 'reference_structure_only' || input.ledger.semanticStatus !== 'unobserved'
    || !/^[a-f0-9]{64}$/i.test(input.ledger.sourceSha256)) throw new Error('reference_cut_ledger_invalid');
  if (await fileHash(input.sourcePath) !== input.ledger.sourceSha256) throw new Error('reference_cut_source_hash_mismatch');
  const { stdout } = await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input.sourcePath,
    '-map', '0:v:0', '-an', '-vf', `scale=${side}:${side}:flags=area,format=gray`, '-vsync', '0',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', timeout: 120000,
    maxBuffer: Math.max(1024 * 1024, (input.ledger.frames.length + 1) * frameBytes) });
  if (await fileHash(input.sourcePath) !== input.ledger.sourceSha256) throw new Error('reference_cut_source_changed');
  if (!Buffer.isBuffer(stdout) || stdout.length !== input.ledger.frames.length * frameBytes)
    throw new Error('reference_cut_frame_count_mismatch');
  const differences = input.ledger.frames.map((_, index) => {
    if (!index) return 0;
    let total = 0;
    const before = (index - 1) * frameBytes, after = index * frameBytes;
    for (let pixel = 0; pixel < frameBytes; pixel++)
      total += Math.abs(stdout[before + pixel]! - stdout[after + pixel]!);
    return total / frameBytes / 255;
  });
  const boundaries = input.ledger.windows.slice(0, -1).map((window, index) => {
    const next = input.ledger.windows[index + 1]!;
    const time = window.endSeconds;
    const nearestIndex = input.ledger.frames.reduce((best, frame, frameIndex) =>
      Math.abs(frame.seconds - time) < Math.abs(input.ledger.frames[best]!.seconds - time) ? frameIndex : best, 0);
    const frame = input.ledger.frames[nearestIndex];
    const distance = frame ? Math.abs(frame.seconds - time) : null;
    const nearby = differences.slice(Math.max(1, nearestIndex - 9), Math.min(differences.length, nearestIndex + 10))
      .filter((_, offset) => Math.abs(Math.max(1, nearestIndex - 9) + offset - nearestIndex) > 1);
    const baseline = median(nearby);
    const difference = nearestIndex > 0 ? differences[nearestIndex]! : null;
    const ratio = difference === null ? null : difference / Math.max(baseline, 0.005);
    const close = distance !== null && distance <= 0.05;
    // A large abrupt pixel change is a candidate only. A dissolve or rapid movement can also trigger it.
    const observation = !close || difference === null || !nearby.length ? 'unresolved'
      : difference >= 0.18 && ratio !== null && ratio >= 3 ? 'visual_discontinuity_candidate'
      : 'weak_visual_change';
    return { beforeShotId: window.shotId, afterShotId: next.shotId, proposedSeconds: time,
      observedSeconds: frame?.seconds ?? null, distanceSeconds: distance, pixelDifference: difference,
      localMedianDifference: nearby.length ? baseline : null, localPeakRatio: ratio,
      observation, audioStatus: 'unexamined', subtitleStatus: 'unexamined', semanticStatus: 'unobserved' } as const;
  });
  return { purpose: 'reference_structure_only', sourceTenantId: input.ledger.sourceTenantId,
    sourceVideoId: input.ledger.sourceVideoId, sourceSha256: input.ledger.sourceSha256,
    method: 'adjacent_16x16_gray_mean_absolute_difference_v1', boundaries };
}

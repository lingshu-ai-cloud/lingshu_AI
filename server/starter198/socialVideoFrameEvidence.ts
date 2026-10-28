import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';

/** scdet reports pixel change, not a verified correspondence to a shot. In
 * particular, a motion peak can be inside a shot, and a real cut can be too
 * similar to produce a peak. Never use these candidates as approval alone. */
export async function readVideoFrameEvidence(input: {
  outputPath: string; runFfmpeg?: typeof runVisualFfmpeg;
}) {
  const mediaSha256 = createHash('sha256').update(await readFile(input.outputPath)).digest('hex');
  const decoded = await (input.runFfmpeg ?? runVisualFfmpeg)(['-i', input.outputPath,
    '-map', '0:v:0', '-vf', 'setpts=PTS-STARTPTS,scdet,metadata=mode=print:key=lavfi.scd.score:file=/dev/stdout',
    '-an', '-f', 'null', '-'], true);
  if (!decoded.ok) throw Error('video_frame_evidence_decode_failed');
  const lines = decoded.stdout.toString('utf8').trim().split(/\r?\n/);
  const frames: Array<{ index: number; atSeconds: number; sceneScore: number }> = [];
  for (let index = 0; index < lines.length; index += 2) {
    const time = /^frame:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:\s*([\d.]+)$/.exec(lines[index]);
    const score = /^lavfi\.scd\.score=([\d.]+)$/.exec(lines[index + 1] ?? '');
    if (!time || !score) throw Error('video_frame_evidence_incomplete');
    const frame = { index: Number(time[1]), atSeconds: Number(time[2]), sceneScore: Number(score[1]) };
    if (frame.index !== frames.length || !Number.isFinite(frame.atSeconds) || !Number.isFinite(frame.sceneScore)
      || frame.atSeconds < 0 || (frames.length && frame.atSeconds <= frames[frames.length - 1].atSeconds))
      throw Error('video_frame_evidence_invalid_timestamps');
    frames.push(frame);
    if (frames.length > 1800) throw Error('video_frame_evidence_frame_limit');
  }
  if (!frames.length || createHash('sha256').update(await readFile(input.outputPath)).digest('hex') !== mediaSha256)
    throw Error('video_frame_evidence_missing_or_changed');
  return { mediaSha256, frames, cutCandidates: frames.filter(frame => frame.index > 0 && frame.sceneScore >= 10) };
}

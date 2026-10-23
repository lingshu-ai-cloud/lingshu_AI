import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';

export const REFERENCE_CLIP_VERSION = 'source-clock-trim-v2';
/** Half-open source interval. Timeline labels retain six decimals; allow half
 * a microsecond for that rounding, so the boundary frame belongs to the next shot. */
export async function writeReferenceShotClip(source: string, output: string, start: number, end: number) {
  if (!ffmpeg || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw Error('reference_shot_timecode_invalid');
  const from = Math.max(0, start - 0.0000005), until = end - 0.0000005;
  await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source,
    '-map', '0:v:0', '-map', '0:a?', '-vf', `trim=start=${from}:end=${until},setpts=PTS-STARTPTS`,
    '-af', `atrim=start=${from}:end=${until},asetpts=PTS-STARTPTS`, '-fps_mode', 'vfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'aac', '-movflags', '+faststart', '-y', output], {timeout: 90_000});
}

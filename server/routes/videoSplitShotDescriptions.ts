import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import type { VideoAiAnalysis } from '../types/index.js';
import { parseAnalysisTimeRange } from '../lib/videoAnalysisCodec.js';

type Shot = NonNullable<VideoAiAnalysis['scriptDetails15s']>[number];
type SplitShot = Shot & { analysisGranularity?: string };
/** Never reuse the parent montage's semantics after a physical split. Each
 * provider request sees only one independently decoded, bounded source clip. */
export async function reinspectSplitShotDescriptions(
  source: string, analysis: VideoAiAnalysis,
  describe: (clip: Buffer) => Promise<VideoAiAnalysis>,
): Promise<VideoAiAnalysis> {
  const details: Shot[] = [];
  for (const shot of analysis.scriptDetails15s || []) {
    if ((shot as SplitShot).analysisGranularity !== 'physical_scene_cut') { details.push(shot); continue; }
    const range = parseAnalysisTimeRange(shot.time || '');
    if (!range || !ffmpeg) throw new Error('reference_split_shot_source_unavailable');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-split-shot-'));
    const clip = path.join(dir, 'shot.mp4');
    try {
      await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source,
        '-ss', String(range.start), '-t', String(range.end - range.start), '-map', '0:v:0', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', '-y', clip], { timeout: 90_000 });
      const result = await describe(await fs.readFile(clip));
      const observed = result.scriptDetails15s || [];
      if (observed.length !== 1 || !observed[0]?.visual?.trim() || observed[0].needsReview !== false) {
        throw new Error('reference_split_shot_description_unverified');
      }
      const fresh = observed[0];
      // Audio was intentionally excluded. Keep the source-clock transcript
      // authority; do not invent dialogue from an isolated visual inspection.
      details.push({ ...fresh, time: shot.time, timestamp: undefined, dialogue: '',
        beats: fresh.beats?.map(beat => {
          const local = parseAnalysisTimeRange(beat.time || '');
          if (!local || local.start < 0 || local.end > range.end - range.start + 0.04) throw new Error('reference_split_beat_outside_clip');
          return { ...beat, dialogue: '', time: `${local.start + range.start}s–${local.end + range.start}s` };
        }), analysisGranularity: 'physical_scene_cut' } as Shot);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  return { ...analysis, scriptDetails15s: details };
}

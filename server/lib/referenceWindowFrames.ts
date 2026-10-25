import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractSourceClockFrames } from '../routes/videoFrameExtraction.js';

type Frame = { base64: string; mimeType: string; timeLabel: string };
/** Fill only missing observation windows with decoded source frames, never a neighboring shot. */
export async function completeReferenceWindowFrames(input: {
  filePath?: string; frames: Frame[]; offset: number;
  windows: Array<{ id: string; start: number; end: number }>;
}): Promise<Frame[]> {
  const result = [...input.frames];
  const missing = input.windows.filter(window => !result.some(frame => {
    const time = Number.parseFloat(frame.timeLabel);
    return time >= window.start && time < window.end;
  }));
  if (!missing.length) return result;
  if (!input.filePath) throw new Error(`reference_shot_frames_missing_${missing[0]!.id}`);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-window-'));
  try {
    for (const [index, window] of missing.entries()) {
      const start = input.offset + window.start, end = input.offset + window.end;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw Error('reference_window_invalid');
      const rows = await extractSourceClockFrames(input.filePath, path.join(directory, `window-${index}-%03d.jpg`),
        `gte(t,${start})*lt(t,${end})`, 1);
      const row = rows.find(item => item.time >= start && item.time < end);
      if (!row) throw Error(`reference_shot_frames_missing_${window.id}`);
      result.push({ base64: (await fs.readFile(path.join(directory, row.file))).toString('base64'),
        mimeType: 'image/jpeg', timeLabel: `${(row.time - input.offset).toFixed(6)}s` });
    }
    return result.sort((a, b) => Number.parseFloat(a.timeLabel) - Number.parseFloat(b.timeLabel));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

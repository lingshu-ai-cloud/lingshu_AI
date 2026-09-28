/** Audio-derived boundaries that may replace the reference video's coarse ASR
 * estimates when matching generated narration to production shots. */
export function isMeasuredVoiceAlignment(source: string | null | undefined): boolean {
  return source === 'minimax_native'
    || source === 'audio_ai'
    || source === 'synthesized_sentence_audio';
}

export interface TimedVoiceCue {
  start: number;
  end: number;
  text: string;
}

/** Preserve generated subtitle estimates for preview, but give production only
 * measured cues tied to the finished audio. */
export function productionVoiceCues<T extends TimedVoiceCue>(
  cues: T[] | undefined,
  alignmentSource: string | null | undefined,
  audioDuration: number,
): T[] {
  if (!isMeasuredVoiceAlignment(alignmentSource) || !(audioDuration > 0) || !cues?.length) return [];
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const cue of sorted) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < 0 || cue.end <= cue.start || cue.start < previousEnd - 0.1
      || cue.end > audioDuration + 0.5 || !cue.text.trim()) return [];
    previousEnd = cue.end;
  }
  return sorted;
}

export interface VisualShotWindow { start: number; end: number }

/** The physical shot list stays authoritative. If there is one spoken line
 * per shot, use measured speech boundaries; otherwise preserve visual cuts
 * and map their relative positions onto the new narration duration. */
export function matchVoiceCuesToShots<T extends TimedVoiceCue>(
  shots: VisualShotWindow[], cues: T[], audioDuration: number,
): Array<{ start: number; end: number; cues: T[] }> {
  if (!shots.length || !(audioDuration > 0)) return [];
  const oneLinePerShot = cues.length === shots.length && cues.length > 0;
  const sourceEnd = Math.max(...shots.map(shot => shot.end), 0);
  const boundaries = oneLinePerShot
    ? [0, ...cues.slice(1).map(cue => cue.start), audioDuration]
    : shots.map(shot => sourceEnd > 0 ? shot.start / sourceEnd * audioDuration : 0).concat(audioDuration);
  return shots.map((_, index) => {
    const start = Math.max(0, boundaries[index] || 0);
    const end = Math.min(audioDuration, Math.max(start, boundaries[index + 1] || audioDuration));
    const matched = cues.filter(cue => cue.end > start && cue.start < end);
    return { start, end, cues: matched };
  });
}

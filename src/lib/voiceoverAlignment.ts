/** Audio-derived boundaries that may replace the reference video's coarse ASR
 * estimates when matching generated narration to production shots. */
export function isMeasuredVoiceAlignment(source: string | null | undefined): boolean {
  return source === 'minimax_native'
    || source === 'audio_ai'
    || source === 'qwen_asr'
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

/** Transfer reference visual cuts onto measured narration timing. Source and
 * generated sentence boundaries are paired in order; cuts inside a sentence
 * keep their relative position. Source clip length never sets shot duration. */
export function retimeVisualShotsToVoiceover(
  shots: VisualShotWindow[], sourceLines: TimedVoiceCue[], measuredLines: TimedVoiceCue[], audioDuration: number,
): VisualShotWindow[] | null {
  if (!shots.length || !sourceLines.length || sourceLines.length !== measuredLines.length || !(audioDuration > 0)) return null;
  const sourceEnd = Math.max(...shots.map(shot => shot.end));
  if (!(sourceEnd > 0)) return null;
  const anchors = [{ source: 0, target: 0 }, ...sourceLines.flatMap((line, index) => [
    { source: line.start, target: measuredLines[index].start },
    { source: line.end, target: measuredLines[index].end },
  ]), { source: sourceEnd, target: audioDuration }].sort((a, b) => a.source - b.source || a.target - b.target);
  if (anchors.some((anchor, index) => !Number.isFinite(anchor.source) || !Number.isFinite(anchor.target)
    || anchor.source < 0 || anchor.target < 0 || anchor.target > audioDuration + 0.5
    || (index > 0 && anchor.target < anchors[index - 1].target - 0.01))) return null;
  const at = (time: number) => {
    const right = anchors.findIndex(anchor => anchor.source >= time);
    if (right <= 0) return anchors[0].target;
    if (right < 0) return audioDuration;
    const before = anchors[right - 1], after = anchors[right];
    const fraction = after.source > before.source ? (time - before.source) / (after.source - before.source) : 0;
    return before.target + (after.target - before.target) * fraction;
  };
  let cursor = 0;
  const result = shots.map((shot, index) => {
    const start = cursor;
    const end = index === shots.length - 1 ? audioDuration : +at(shot.end).toFixed(3);
    cursor = end;
    return { start, end };
  });
  return result.every(shot => shot.end > shot.start) ? result : null;
}

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

export interface TimedSpeechCue { start: number; end: number; text: string }

export interface ShotKeyframeCue extends TimedSpeechCue {
  frames: Array<{ position: '开头' | '中间' | '结尾'; time: number }>;
}

export function shotKeyframeCues(input: {
  shotStart: number;
  shotEnd: number;
  cues: TimedSpeechCue[];
  fallbackText: string;
}): ShotKeyframeCue[] {
  const duration = Math.max(0, input.shotEnd - input.shotStart);
  if (!Number.isFinite(input.shotStart) || !Number.isFinite(input.shotEnd) || duration <= 0) return [];
  const overlapping = input.cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start
    && cue.start < input.shotEnd && cue.end > input.shotStart && cue.text.trim()).map(cue => ({
      start: Math.max(0, Math.max(cue.start, input.shotStart) - input.shotStart),
      end: Math.min(duration, Math.min(cue.end, input.shotEnd) - input.shotStart),
      text: cue.text.trim(),
    }));
  const rows = overlapping.length ? overlapping : [{ start: 0, end: duration, text: input.fallbackText.trim() || '本镜头口播' }];
  return rows.map(cue => {
    const span = Math.max(0.001, cue.end - cue.start);
    const inset = Math.min(0.08, span * 0.08);
    return {
      ...cue,
      frames: [
        { position: '开头' as const, time: cue.start + inset },
        { position: '中间' as const, time: cue.start + span / 2 },
        { position: '结尾' as const, time: Math.max(cue.start + inset, cue.end - inset) },
      ].map(frame => ({ ...frame, time: +Math.min(duration, frame.time).toFixed(3) })),
    };
  });
}

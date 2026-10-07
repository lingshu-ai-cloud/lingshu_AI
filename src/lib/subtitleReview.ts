import type { SpeechCue } from './narrationAlignment';
import type { NarrationTimelineShot } from './narrationTimeline';

/** Bind text corrections to the exact source and measured cue; replacement clips never inherit them. */
export function sourceCaptionEditKey(materialId: string, contentHash: string | undefined, cue: SpeechCue): string {
  return JSON.stringify([materialId, contentHash || '', cue.start, cue.end, cue.text]);
}

/** Corrections change display text only; measured cue and word timing remain authoritative. */
export function applyCaptionTextEdits<T extends SpeechCue>(
  cues: T[], ownerId: string, contentHash: string | undefined, edits: Record<string, string>,
): T[] {
  return cues.map(cue => ({ ...cue, text: edits[sourceCaptionEditKey(ownerId, contentHash, cue)] ?? cue.text }));
}

export interface SubtitleReviewCue extends SpeechCue {
  source: 'source' | 'ai';
  shotIndex?: number;
  cueIndex: number;
}

/** Use the same arranged positions as rendering, while retaining each editable cue's owner. */
export function subtitleReviewCues(shots: NarrationTimelineShot[], aiCues: SpeechCue[]): SubtitleReviewCue[] {
  let cursor = 0;
  const rows: SubtitleReviewCue[] = [];
  const usedAi = new Set<number>();
  const measuredPosition = (value: number) => +value.toFixed(3);
  for (const [shotIndex, shot] of shots.entries()) {
    const start = shot.targetStart ?? cursor;
    cursor = start + shot.targetDuration;
    if (shot.lockedSourceVoice) {
      (shot.sourceCues || []).forEach((cue, cueIndex) => {
        if (cue.start < shot.targetDuration) rows.push({ ...cue, start: measuredPosition(start + cue.start),
          end: measuredPosition(start + Math.min(cue.end, shot.targetDuration)), source: 'source', shotIndex, cueIndex });
      });
    } else if (shot.voiceAligned && Number(shot.voiceEnd) > Number(shot.voiceStart)) {
      aiCues.forEach((cue, cueIndex) => {
        if (usedAi.has(cueIndex) || cue.start >= shot.voiceEnd! || cue.end <= shot.voiceStart!) return;
        usedAi.add(cueIndex);
        rows.push({ ...cue, start: measuredPosition(start + cue.start - shot.voiceStart!),
          end: measuredPosition(start + cue.end - shot.voiceStart!), source: 'ai', cueIndex });
      });
    }
  }
  return rows.sort((a, b) => a.start - b.start);
}

export type ReferenceSpeechShot = {
  time: string;
  dialogue?: string;
  subtitle?: string;
  visual?: string;
  firstFrameRef?: string;
  firstFrameSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
  draft?: string;
  precision?: string;
};

export type ReferenceSpeechLine = ReferenceSpeechShot & {
  text: string;
  visuals: string[];
  visualShotCount: number;
  shots: ReferenceSpeechShot[];
};

function splitSpeech(value: string): string[] {
  return String(value || '').split(/(?<=[。！？!?])\s*|\n+/).map(line => line.trim()).filter(Boolean);
}

function normalizedTime(time: string): string {
  const values = String(time || '').match(/\d+(?:\.\d+)?/g);
  return values?.length === 2 ? values.map(value => Number(value).toFixed(2)).join('-') : String(time || '').trim();
}

export function referenceSpeechLines(shots: ReferenceSpeechShot[]): ReferenceSpeechLine[] {
  const lines: ReferenceSpeechLine[] = [];
  const byCue = new Map<string, ReferenceSpeechLine>();
  for (const shot of shots) {
    for (const text of splitSpeech(shot.dialogue || shot.subtitle || '')) {
      // One ASR cue can span several visual cuts. Its timestamp and text
      // identify the utterance; each cut remains available as visual evidence.
      const key = `${normalizedTime(shot.time)}\u0000${text.replace(/\s+/g, ' ').toLocaleLowerCase()}`;
      const existing = byCue.get(key);
      if (existing) {
        existing.visualShotCount += 1;
        existing.shots.push(shot);
        if (shot.visual && !existing.visuals.includes(shot.visual)) existing.visuals.push(shot.visual);
      } else {
        const line = { ...shot, text, visuals: shot.visual ? [shot.visual] : [], visualShotCount: 1, shots: [shot] };
        byCue.set(key, line);
        lines.push(line);
      }
    }
  }
  return lines;
}

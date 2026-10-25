const normalizedNativeText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Exact supplier phrase boundaries. No sentence-count heuristic, fuzzy
 * transcript match, inferred word timings or redistribution of timestamps. */
export function verifiedNativePhraseCues(result: { transcripts?: Array<{ text?: unknown; sentences?: Array<{ text?: unknown; begin_time?: unknown; end_time?: unknown }> }> }, text: string, duration: number) {
  const transcript = result?.transcripts?.[0];
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(transcript?.sentences) || !transcript.sentences.length) throw Error('native_subtitle_range_invalid');
  let previousEnd = 0;
  const cues = transcript.sentences.map(row => {
    if (typeof row.text !== 'string' || !row.text.trim()) throw Error('native_subtitle_text_invalid');
    if (typeof row.begin_time !== 'number' || typeof row.end_time !== 'number') throw Error('native_subtitle_range_invalid');
    const start = row.begin_time / 1000, end = row.end_time / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start < previousEnd - 1e-9 || end <= start || end > duration + .02) throw Error('native_subtitle_range_invalid');
    previousEnd = end;
    return { start, end, text: row.text };
  });
  const expected = normalizedNativeText(text), actual = normalizedNativeText(cues.map(cue => cue.text).join(' '));
  if (!expected || actual !== expected || typeof transcript.text !== 'string' || normalizedNativeText(transcript.text) !== actual) throw Error('native_subtitle_transcript_mismatch:实际音频与口播文本不一致');
  return cues;
}


export function nativeAudioTimingTransform(sourceDuration: number, speed: number, targetDuration: number, duration: number) {
  const natural = sourceDuration / speed + .15;
  const fit = natural > targetDuration + .02 ? natural / targetDuration : 1;
  if (!(sourceDuration > 0) || !(speed > 0) || !(targetDuration > .15) || !Number.isFinite(natural)
    || Math.abs(Math.min(natural, targetDuration) - duration) > .12) throw Error('native_voice_timing_transform_changed');
  return { fit, scale: speed * fit };
}

/** Supplier SRT has phrase timestamps, never measured word timestamps. The
 * full transcript and monotonic timeline are verified without sentence heuristics. */
export function verifiedHeyGenNativeSubtitleTiming(input: {
  srt: string; text: string; sourceDuration: number; speed: number; targetDuration: number; duration: number;
}) {
  if (Buffer.byteLength(input.srt, 'utf8') > 2 * 1024 * 1024) throw Error('native_subtitle_size_invalid');
  const { fit, scale } = nativeAudioTimingTransform(input.sourceDuration, input.speed, input.targetDuration, input.duration);
  const time = (value: string) => {
    const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw Error('native_subtitle_time_invalid');
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  };
  const blocks = input.srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n/);
  const sentences = blocks.map((block, index) => {
    const lines = block.split('\n');
    if (!/^\d+$/.test(lines[0]?.trim() || '') || Number(lines[0]) !== index + 1) throw Error('native_subtitle_sequence_invalid');
    const timing = /^\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*$/.exec(lines[1] || '');
    if (!timing) throw Error('native_subtitle_time_invalid');
    const start = time(timing[1]!), end = time(timing[2]!);
    if (start < 0 || end <= start || end > input.sourceDuration + .02) throw Error('native_subtitle_range_invalid');
    const text = lines.slice(2).join(' ').replace(/<\/?(?:b|i|u)>/gi, '').trim();
    if (!text || /<[^>]*>/.test(text)) throw Error('native_subtitle_text_invalid');
    return { text, begin_time: start / scale * 1000, end_time: end / scale * 1000 };
  });
  const result = { transcripts: [{ text: sentences.map(row => row.text).join(' '), sentences }] };
  return { fit, result, cues: verifiedNativePhraseCues(result, input.text, input.duration), precision: 'phrase' as const };
}

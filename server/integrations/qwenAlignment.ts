import fs from 'node:fs';
import { dashscopeApiKey } from '../agents/qwen.js';

export type TimedCue = { start: number; end: number; text: string };

type RawSentence = {
  begin_time?: unknown;
  end_time?: unknown;
  text?: unknown;
  punctuation?: unknown;
  words?: Array<{ begin_time?: unknown; end_time?: unknown; text?: unknown; punctuation?: unknown }>;
};

const normalizedSpeech = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/you['’]re/g, 'you are')
  .replace(/\b(\d{1,3})(?:,(\d{3}))+\b/g, match => match.replace(/,/g, ''))
  .replace(/[^\p{L}\p{N}]/gu, '');

function editSimilarity(left: string, right: string): number {
  const a = normalizedSpeech(left);
  const b = normalizedSpeech(right);
  if (a === b) return 1;
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

function splitSentences(value: string): string[] {
  return String(value || '')
    .match(/[^。！？!?.]+[。！？!?.]?/gu)
    ?.map(item => item.trim())
    .filter(Boolean) || [];
}

function rawText(value: { text?: unknown; punctuation?: unknown }): string {
  const text = String(value.text || '');
  const punctuation = String(value.punctuation || '');
  return punctuation && !text.trimEnd().endsWith(punctuation) ? text + punctuation : text;
}

function assertTimeline(cues: TimedCue[], duration: number): void {
  let end = 0;
  for (const cue of cues) {
    if (!cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < end - 0.03 || cue.end <= cue.start || cue.end > duration + 0.3) {
      throw new Error('音频对齐时间轴无效');
    }
    end = cue.end;
  }
}

function sentenceCues(sentences: RawSentence[]): TimedCue[] {
  return sentences.map(sentence => ({
    start: Number(sentence.begin_time) / 1000,
    end: Number(sentence.end_time) / 1000,
    text: rawText(sentence),
  }));
}

/**
 * DashScope occasionally emits zero-length timestamps for unstressed English
 * words (for example "a", "in" and "us"). Keep their measured boundary by
 * merging them into the following timed token instead of rejecting the whole
 * audio track or inventing a duration.
 */
function mergedWordCues(sentences: RawSentence[]): TimedCue[] {
  const cues: TimedCue[] = [];
  for (const sentence of sentences) {
    const words = Array.isArray(sentence.words) ? sentence.words : [];
    let pendingText = '';
    let pendingStart: number | null = null;
    for (const word of words) {
      const start = Number(word.begin_time) / 1000;
      const end = Number(word.end_time) / 1000;
      const text = rawText(word);
      if (!(Number.isFinite(start) && Number.isFinite(end))) {
        cues.push({ start, end, text });
        continue;
      }
      if (end <= start) {
        pendingText += text;
        pendingStart ??= start;
        continue;
      }
      cues.push({ start: pendingStart ?? start, end, text: pendingText + text });
      pendingText = '';
      pendingStart = null;
    }
    if (pendingText && cues.length) cues[cues.length - 1]!.text += pendingText;
  }
  return cues;
}

export function verifiedAudioCues(raw: any, transcript: string, duration: number): TimedCue[] {
  const transcriptRecord = raw?.transcripts?.[0];
  const sentences = Array.isArray(transcriptRecord?.sentences) ? transcriptRecord.sentences as RawSentence[] : [];
  const expectedSentences = splitSentences(transcript);
  const recognizedText = String(transcriptRecord?.text || sentences.map(rawText).join(' ')).trim();

  // Sentence boundaries come directly from the finished audio. ASR spelling
  // can legitimately differ for acronyms and spoken numbers, so require a
  // strong whole-track match and one-to-one sentence structure, then retain
  // the user's authoritative copy on those measured boundaries.
  const measuredSentences = sentenceCues(sentences);
  const similarity = editSimilarity(recognizedText, transcript);
  if (measuredSentences.length && measuredSentences.length === expectedSentences.length && similarity >= 0.82) {
    assertTimeline(measuredSentences, duration);
    return measuredSentences.map((cue, index) => ({ ...cue, text: expectedSentences[index]! }));
  }

  const words = mergedWordCues(sentences);
  assertTimeline(words, duration);
  if (!words.length || normalizedSpeech(words.map(cue => cue.text).join('')) !== normalizedSpeech(transcript)) {
    throw new Error('实际音频与口播文本不一致，请复核文本');
  }
  return words;
}

export async function alignQwenFile(url: string, transcript: string, duration: number, cacheFile: string) {
  const base = (process.env.DASHSCOPE_ASR_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${dashscopeApiKey()}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  };
  let cache: any = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* no cached task yet */ }
  if (cache.result) return verifiedAudioCues(cache.result, transcript, duration);

  const call = async (route: string, body?: any) => {
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const json: any = await response.json();
    if (!response.ok || json.code) throw new Error('千问音频对齐服务暂不可用');
    return json;
  };

  if (!cache.taskId) {
    const task = await call('/services/audio/asr/transcription', {
      model: 'qwen3-asr-flash-filetrans',
      input: { file_url: url },
      parameters: { channel_id: [0], enable_itn: false, enable_words: true },
    });
    if (!task.output?.task_id) throw new Error('音频对齐未返回任务ID');
    cache = { taskId: task.output.task_id };
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await call(`/tasks/${encodeURIComponent(cache.taskId)}`);
    if (state.output?.task_status === 'FAILED') throw new Error(`音频对齐失败：${String(state.output.code || '请重新生成音频')}`);
    if (state.output?.task_status === 'SUCCEEDED') {
      const target = new URL(state.output.result.transcription_url);
      if (!/(^|\.)oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(target.hostname)) throw new Error('音频字幕下载地址不可信');
      target.protocol = 'https:';
      const response = await fetch(target, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error('音频字幕下载失败');
      const result = await response.json();
      fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, result }));
      return verifiedAudioCues(result, transcript, duration);
    }
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  throw new Error('音频对齐仍在处理，请稍后重试；不会重复提交任务');
}

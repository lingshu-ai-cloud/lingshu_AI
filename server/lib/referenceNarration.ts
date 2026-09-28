import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { transcribeAudioWithQwen, proofreadReferenceNarrationWithQwen } from '../agents/qwen.js';
import { proofreadReferenceNarrationWithGemini } from '../agents/gemini.js';
import { objectStorageEnabled, objectStorageUpload, objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { alignQwenFile, type TimedCue } from '../integrations/qwenAlignment.js';
const execute = promisify(execFile);

/** Use measured words to anchor complete sentences; never divide duration by word count. */
export function alignNarrationSentences(sentences: Array<{text: string; needsReview?: boolean}>, words: TimedCue[]) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (normalize(sentences.map(s => s.text).join('')) !== normalize(words.map(w => w.text).join(''))) throw new Error('原音频与校对口播不一致，需复核');
  let cursor = 0;
  return sentences.map(sentence => {
    const wanted = normalize(sentence.text); let actual = ''; const matched: TimedCue[] = [];
    while (cursor < words.length && actual.length < wanted.length) { const word = words[cursor++]; matched.push(word); actual += normalize(word.text); }
    if (actual !== wanted || !matched.length) throw new Error('口播句界无法精确对齐');
    return {...sentence, start: matched[0].start, end: matched[matched.length - 1].end, words: matched, timingPrecision: 'phrase', provenance: 'qwen_filetrans:verified_words'};
  });
}
export function parseProofreadNarration(raw: string) {
  const value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!Array.isArray(value.sentences) || !value.sentences.length || value.sentences.some((s: any) => !s || typeof s.text !== 'string' || !s.text.trim())) throw new Error('校对未返回有效逐句口播');
  const sentences = value.sentences.map((s: any) => ({ text: s.text.trim(), needsReview: s.needsReview === true }));
  const strings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim()))] : [];
  const products = strings(value.products).filter(p => sentences.some((s: any) => s.text.toLowerCase().includes(p.toLowerCase())));
  const brands = strings(value.brands).filter(p => sentences.some((s: any) => s.text.includes(p)));
  return { sentences, products, brands, uncertainties: strings(value.uncertainties), removedFragments: strings(value.removedFragments) };
}
/** One full audio request + one text correction, cached by source bytes and prompt version. */
export async function prepareReferenceNarration(filePath: string, duration: number) {
  if (!(duration > 0 && duration <= 180)) throw new Error('整段轻量转写支持 180 秒以内视频');
  const hash = createHash('sha256').update(fs.readFileSync(filePath)).update('reference-proofread-v1').digest('hex');
  const dir = path.resolve('data/analysis-output/narration-cache'); fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, hash + '.json');
  const saved = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
  const tenant = filePath.match(/[/\\]tenants[/\\]([^/\\]+)/)?.[1];
  const canAlign = Boolean(tenant && objectStorageEnabled() && process.env.DASHSCOPE_API_KEY);
  if (saved && (saved.alignmentStatus === 'aligned' || !canAlign)) return saved;
  const audioPath = path.join(dir, hash + '.mp3');
  try {
    await execute(ffmpeg || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',filePath,'-vn','-ac','1','-ar','16000','-b:a','64k',audioPath], { timeout: 90000 });
    const rawCache = path.join(dir, hash + '.asr.json');
    const asr = fs.existsSync(rawCache) ? JSON.parse(fs.readFileSync(rawCache, 'utf8')) : await transcribeAudioWithQwen({ audio: fs.readFileSync(audioPath), fileName: 'complete-reference.mp3' });
    if (!fs.existsSync(rawCache) && asr.text?.trim()) fs.writeFileSync(rawCache, JSON.stringify(asr));
    if (!asr.text.trim()) throw new Error('完整音轨转写为空');
    const provider = process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'qwen';
    const proofread = saved || parseProofreadNarration(await (provider === 'gemini' ? proofreadReferenceNarrationWithGemini(asr.text) : proofreadReferenceNarrationWithQwen(asr.text)));
    let alignedSegments: ReturnType<typeof alignNarrationSentences> | undefined;
    let alignmentError = '';
    if (canAlign) try {
      const key = `tenants/${tenant}/reference-alignment/${hash}.mp3`;
      await objectStorageUpload({key, body: fs.readFileSync(audioPath), contentType: 'audio/mpeg'});
      const words = await alignQwenFile(await objectStorageSignedGetUrl(key, 900), proofread.sentences.map((s: any) => s.text).join(' '), duration, path.join(dir, hash + '.alignment.json'));
      alignedSegments = alignNarrationSentences(proofread.sentences, words);
    } catch (error) { alignmentError = error instanceof Error ? error.message : '原音频对齐失败'; }
    const result = { version: 1, sourceHash: hash, rawText: asr.text, ...proofread, provider,
      text: proofread.sentences.map((s: any) => s.text).join(' '),
      // Coarse ranges are only placeholders until source audio alignment/review.
      alignmentStatus: alignedSegments ? 'aligned' : 'pending', alignmentError: alignmentError || (!canAlign ? '未配置原音频词级对齐服务' : ''),
      segments: alignedSegments || proofread.sentences.map((s: any, i: number) => ({ ...s, start: duration * i / proofread.sentences.length, end: duration * (i+1) / proofread.sentences.length, timingPrecision: 'coarse', provenance: 'full_audio_asr:proofread:v1' })), createdAt: new Date().toISOString() };
    fs.writeFileSync(cache, JSON.stringify(result, null, 2)); return result;
  } finally { try { fs.unlinkSync(audioPath); } catch {} }
}

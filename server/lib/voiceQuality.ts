import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { transcribeAudioWithQwen } from '../agents/qwen.js';

export interface VoiceQualityReport {
  passed: boolean;
  durationSeconds: number;
  peakDb: number;
  rmsDb: number;
  clippingRatio: number;
  silenceRatio: number;
  longestSilenceSeconds: number;
  asrChecked: boolean;
  transcriptAccuracy: number | null;
  failures: string[];
}

const db = (ratio: number) => 20 * Math.log10(Math.max(1e-9, ratio));

export function evaluateVoicePcm(pcm: Buffer, sampleRate = 16_000): Omit<VoiceQualityReport, 'asrChecked' | 'transcriptAccuracy'> {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return { passed: false, durationSeconds: 0, peakDb: -180, rmsDb: -180, clippingRatio: 0, silenceRatio: 1, longestSilenceSeconds: 0, failures: ['口播音频无法解码'] };
  let peak = 0;
  let energy = 0;
  let clipped = 0;
  const windowSamples = Math.max(1, Math.floor(sampleRate * .02));
  let silentWindows = 0;
  let consecutiveSilentWindows = 0;
  let longestSilentWindows = 0;
  let windows = 0;
  for (let start = 0; start < samples; start += windowSamples) {
    let windowEnergy = 0;
    const end = Math.min(samples, start + windowSamples);
    for (let index = start; index < end; index += 1) {
      const value = pcm.readInt16LE(index * 2);
      const absolute = Math.abs(value);
      peak = Math.max(peak, absolute);
      if (absolute >= 32700) clipped += 1;
      const normalized = value / 32768;
      energy += normalized * normalized;
      windowEnergy += normalized * normalized;
    }
    const windowRms = Math.sqrt(windowEnergy / Math.max(1, end - start));
    if (db(windowRms) < -48) {
      silentWindows += 1;
      consecutiveSilentWindows += 1;
      longestSilentWindows = Math.max(longestSilentWindows, consecutiveSilentWindows);
    } else consecutiveSilentWindows = 0;
    windows += 1;
  }
  const durationSeconds = samples / sampleRate;
  const peakDb = db(peak / 32768);
  const rmsDb = db(Math.sqrt(energy / samples));
  const clippingRatio = clipped / samples;
  const silenceRatio = silentWindows / Math.max(1, windows);
  const longestSilenceSeconds = longestSilentWindows * windowSamples / sampleRate;
  const failures: string[] = [];
  if (durationSeconds < .2) failures.push('口播时长异常');
  if (peakDb < -18) failures.push('口播峰值过低');
  if (peakDb > -.05 || clippingRatio > .002) failures.push('口播存在削波风险');
  if (rmsDb < -32 || rmsDb > -8) failures.push('口播平均响度超出可交付范围');
  if (silenceRatio > .55) failures.push('口播静音比例过高');
  if (durationSeconds > 2 && longestSilenceSeconds > Math.max(1.5, durationSeconds * .3)) failures.push('口播存在异常长停顿');
  return {
    passed: failures.length === 0,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    peakDb: Number(peakDb.toFixed(2)),
    rmsDb: Number(rmsDb.toFixed(2)),
    clippingRatio: Number(clippingRatio.toFixed(6)),
    silenceRatio: Number(silenceRatio.toFixed(4)),
    longestSilenceSeconds: Number(longestSilenceSeconds.toFixed(3)),
    failures,
  };
}

export function dashscopeCredentialConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.DASHSCOPE_API_KEY || '').trim()) return true;
  const keyFile = String(env.DASHSCOPE_API_KEY_FILE || path.join(os.homedir(), '.config/lingshu/dashscope.key')).trim();
  try { return Boolean(keyFile && fs.readFileSync(keyFile, 'utf8').trim()); } catch { return false; }
}

function normalizeTranscript(value: string, language: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  if (/^(?:zh|ja|ko)/i.test(language) || /[\u3400-\u9fff]/.test(normalized)) {
    return [...normalized].filter(char => /[\p{L}\p{N}]/u.test(char));
  }
  return normalized.match(/[\p{L}\p{N}]+/gu) || [];
}

export function transcriptAccuracy(expected: string, actual: string, language: string): number {
  const left = normalizeTranscript(expected, language);
  const right = normalizeTranscript(actual, language);
  if (!left.length) return right.length ? 0 : 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous.splice(0, previous.length, ...current);
  }
  return Number(Math.max(0, 1 - previous[right.length]! / Math.max(left.length, right.length, 1)).toFixed(4));
}

async function decodePcm(filePath: string): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error('ffmpeg unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('口播质检解码超时')); }, 60_000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { child.kill('SIGKILL'); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-1_000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || bytes > 16 * 1024 * 1024) reject(new Error(`口播质检无法解码：${stderr || '输出过大'}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

export async function inspectGeneratedVoice(input: {
  filePath: string;
  expectedText: string;
  language: string;
  asrRequired?: boolean;
}): Promise<VoiceQualityReport> {
  if (!fs.existsSync(input.filePath)) throw new Error('口播质检文件不存在');
  const pcm = await decodePcm(input.filePath);
  const acoustic = evaluateVoicePcm(pcm);
  const failures = [...acoustic.failures];
  const asrConfigured = dashscopeCredentialConfigured();
  const asrEnabled = process.env.TTS_ASR_QA_ENABLED !== 'false' && asrConfigured;
  const asrRequired = input.asrRequired ?? (process.env.TTS_ASR_QA_REQUIRED === 'true' || process.env.NODE_ENV === 'production');
  let accuracy: number | null = null;
  if (asrEnabled) {
    try {
      const result = await transcribeAudioWithQwen({ audio: fs.readFileSync(input.filePath), fileName: `voice${path.extname(input.filePath) || '.wav'}`, signal: AbortSignal.timeout(Math.max(10000, Number(process.env.TTS_ASR_QA_TIMEOUT_MS || 30000))) });
      accuracy = transcriptAccuracy(input.expectedText, result.text, input.language);
      if (accuracy < .9) failures.push(`口播ASR回听一致度仅${Math.round(accuracy * 100)}%`);
    } catch (error) {
      if (asrRequired) failures.push(`口播ASR回听失败：${String(error instanceof Error ? error.message : error).slice(0, 160)}`);
    }
  } else if (asrRequired) {
    failures.push('正式口播缺少ASR回听能力');
  }
  return { ...acoustic, passed: failures.length === 0, asrChecked: accuracy !== null, transcriptAccuracy: accuracy, failures };
}

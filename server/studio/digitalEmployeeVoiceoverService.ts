import { createHash, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { safeAssetTenantId, tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { isPrivateOrReservedAddress } from './renderAssetPolicy.js';

type VoiceoverProvider = 'qwen_tts' | 'minimax';
type VoiceoverMode = 'auto' | 'required' | 'silent_test';

export interface DigitalEmployeeVoiceoverResult {
  status: 'generated' | 'silent_fallback' | 'not_available';
  provider?: VoiceoverProvider;
  voice?: string;
  audioPath?: string;
  audioUrl?: string;
  audioBytes?: Buffer;
  audioSha256?: string;
  audioSizeBytes?: number;
  durationSeconds?: number;
  mimeType?: 'audio/wav';
  sourceTextSha256: string;
  cached?: boolean;
  reason?: string;
}

interface RawProviderAudio {
  provider: VoiceoverProvider;
  bytes: Buffer;
  extension: string;
}

interface CommittedVoiceoverCache {
  provider: VoiceoverProvider;
  bytes: Buffer;
  sha256: string;
  durationSeconds: number;
}

interface VoiceoverCacheLease {
  lockPath: string;
  token: string;
  handle: FileHandle;
  acquiredAt: string;
  heartbeat: NodeJS.Timeout;
  heartbeatInFlight: Promise<void> | null;
  lost: boolean;
}

export interface DigitalEmployeeVoiceoverDependencies {
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
  ffmpegPath?: string | null;
}

export class DigitalEmployeeVoiceoverError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message = code, retryable = false) {
    super(message);
    this.name = 'DigitalEmployeeVoiceoverError';
    this.code = code;
    this.retryable = retryable;
  }
}

const QWEN_VOICE_MAP: Record<string, string> = { v1: 'Cherry', v2: 'Ethan', v3: 'Serena' };
const MINIMAX_VOICE_MAP: Record<string, Record<string, string>> = {
  zh: { v1: 'Chinese (Mandarin)_Warm_Bestie', v2: 'Chinese (Mandarin)_Reliable_Executive', v3: 'Chinese (Mandarin)_Warm_Bestie' },
  en: { v1: 'English_FriendlyPerson', v2: 'English_Trustworth_Man', v3: 'English_Graceful_Lady' },
};

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number(process.env[name]);
  const value = Number.isFinite(candidate) ? candidate : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}

function normalizedLanguage(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'en';
  if (raw.startsWith('zh') || raw.includes('chinese') || raw.includes('中文')) return 'zh';
  if (raw.startsWith('en') || raw.includes('english')) return 'en';
  return raw.split(/[-_]/, 1)[0].replace(/[^a-z]/g, '').slice(0, 12) || 'en';
}

function qwenLanguageType(language: string): string {
  const map: Record<string, string> = {
    zh: 'Chinese', en: 'English', es: 'Spanish', ar: 'Arabic', pt: 'Portuguese',
    id: 'Indonesian', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean',
    ru: 'Russian', it: 'Italian',
  };
  return map[normalizedLanguage(language)] || 'English';
}

function minimaxLanguageBoost(language: string): string {
  const map: Record<string, string> = {
    zh: 'Chinese', en: 'English', es: 'Spanish', ar: 'Arabic', pt: 'Portuguese',
    id: 'Indonesian', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean',
  };
  return map[normalizedLanguage(language)] || 'auto';
}

function voiceCode(): string {
  return String(process.env.DIGITAL_EMPLOYEE_TTS_VOICE || 'v1').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80) || 'v1';
}

function qwenVoice(voice: string): string {
  const envCode = voice.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return String(process.env[`QWEN_TTS_VOICE_${envCode}`] || QWEN_VOICE_MAP[voice] || 'Cherry').slice(0, 120);
}

function minimaxVoice(voice: string, language: string): string {
  const lang = normalizedLanguage(language);
  const langCode = lang.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const voiceEnvCode = voice.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return String(
    process.env[`MINIMAX_VOICE_${langCode}_${voiceEnvCode}`]
      || process.env[`MINIMAX_VOICE_${voiceEnvCode}`]
      || MINIMAX_VOICE_MAP[lang]?.[voice]
      || MINIMAX_VOICE_MAP.en[voice]
      || 'English_FriendlyPerson',
  ).slice(0, 160);
}

function voiceoverMode(): VoiceoverMode {
  const value = String(process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE || 'auto').trim().toLowerCase();
  return value === 'required' || value === 'silent_test' ? value : 'auto';
}

function sourceText(text: string): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function providerOrder(): VoiceoverProvider[] {
  const qwen = Boolean(String(process.env.DASHSCOPE_API_KEY || '').trim());
  const minimax = Boolean(String(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
  const selected = String(process.env.DIGITAL_EMPLOYEE_TTS_PROVIDER || 'auto').trim().toLowerCase();
  if (selected === 'qwen') return qwen ? ['qwen_tts'] : [];
  if (selected === 'minimax') return minimax ? ['minimax'] : [];
  return [...(qwen ? ['qwen_tts' as const] : []), ...(minimax ? ['minimax' as const] : [])];
}

function providerExplicitlyMissing(): boolean {
  const selected = String(process.env.DIGITAL_EMPLOYEE_TTS_PROVIDER || 'auto').trim().toLowerCase();
  return (selected === 'qwen' && !String(process.env.DASHSCOPE_API_KEY || '').trim())
    || (selected === 'minimax' && !String(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
}

function linkedDeadline(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const detail = signal.reason instanceof Error ? signal.reason.message : String(signal.reason || 'aborted');
  const timedOut = signal.reason && typeof signal.reason === 'object'
    && String((signal.reason as { name?: unknown }).name || '').toLowerCase() === 'timeouterror';
  throw new DigitalEmployeeVoiceoverError(
    timedOut ? 'digital_employee_voiceover_timeout' : 'digital_employee_voiceover_aborted',
    detail,
    true,
  );
}

function safeProviderMessage(value: unknown, apiKey = ''): string {
  let message = String(value instanceof Error ? value.message : value || 'provider request failed')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
  if (apiKey) message = message.split(apiKey).join('[redacted]');
  return message;
}

async function responseBytes(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_response_too_large');
  }
  if (!response.body) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_empty_response');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      received += chunk.length;
      if (received > maximumBytes) {
        await reader.cancel('response too large').catch(() => undefined);
        throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_response_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!received) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_empty_response');
  return Buffer.concat(chunks, received);
}

async function responseJson(response: Response, maximumBytes: number): Promise<Record<string, any>> {
  const bytes = await responseBytes(response, maximumBytes);
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid shape');
    return parsed as Record<string, any>;
  } catch {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_provider_invalid_json');
  }
}

async function publicHost(hostname: string, resolveHostname?: (hostname: string) => Promise<string[]>): Promise<void> {
  const addresses = resolveHostname
    ? await resolveHostname(hostname).catch(() => [])
    : (await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [])).map(item => item.address);
  if (!addresses.length || addresses.some(isPrivateOrReservedAddress)) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_private_network_forbidden');
  }
}

function secureProviderEndpoint(value: string, expectedHostname: string, customEndpoint: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_endpoint_invalid'); }
  const allowInsecure = process.env.NODE_ENV !== 'production' && process.env.DIGITAL_EMPLOYEE_TTS_ALLOW_INSECURE_ENDPOINTS === 'true';
  if ((url.protocol !== 'https:' && !allowInsecure) || url.username || url.password || !url.hostname) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_endpoint_forbidden');
  }
  if (!customEndpoint && expectedHostname && url.hostname !== expectedHostname) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_endpoint_forbidden');
  }
  return url;
}

function allowedQwenAudioHostname(hostname: string): boolean {
  const suffixes = String(process.env.DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES || 'aliyuncs.com')
    .split(',').map(item => item.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return suffixes.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

async function qwenAudio(input: {
  text: string;
  language: string;
  voice: string;
  signal: AbortSignal;
  maximumAudioBytes: number;
  fetchImpl: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}): Promise<RawProviderAudio> {
  const apiKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_qwen_not_configured');
  const endpoint = secureProviderEndpoint(
    process.env.DASHSCOPE_TTS_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    'dashscope.aliyuncs.com',
    Boolean(process.env.DASHSCOPE_TTS_ENDPOINT),
  );
  await publicHost(endpoint.hostname, input.resolveHostname);
  const response = await input.fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash',
      input: { text: input.text, voice: qwenVoice(input.voice), language_type: qwenLanguageType(input.language) },
    }),
    signal: input.signal,
    redirect: 'error',
  });
  const json = await responseJson(response, 1024 * 1024).catch(error => {
    if (!response.ok) throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_qwen_request_failed',
      `DashScope HTTP ${response.status}`,
      response.status >= 429 || response.status >= 500,
    );
    throw error;
  });
  if (!response.ok || json.code) {
    throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_qwen_request_failed',
      safeProviderMessage(`${json.code || `HTTP ${response.status}`}: ${json.message || 'request failed'}`, apiKey),
      response.status === 429 || response.status >= 500,
    );
  }
  const remote = String(json?.output?.audio?.url || '').trim();
  let audioUrl: URL;
  try { audioUrl = new URL(remote); } catch { throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_qwen_audio_url_invalid'); }
  if (audioUrl.protocol !== 'https:' || audioUrl.username || audioUrl.password || audioUrl.port && audioUrl.port !== '443' || !allowedQwenAudioHostname(audioUrl.hostname)) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_qwen_audio_url_forbidden');
  }
  await publicHost(audioUrl.hostname, input.resolveHostname);
  const audioResponse = await input.fetchImpl(audioUrl, { signal: input.signal, redirect: 'error' });
  if (!audioResponse.ok) {
    throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_qwen_download_failed',
      `DashScope audio HTTP ${audioResponse.status}`,
      audioResponse.status === 429 || audioResponse.status >= 500,
    );
  }
  const bytes = await responseBytes(audioResponse, input.maximumAudioBytes);
  const detected = sniffAudioFormat(bytes);
  if (!detected) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_audio_magic_invalid');
  return { provider: 'qwen_tts', bytes, extension: detected.extension };
}

function minimaxEndpoint(): URL {
  const base = String(process.env.MINIMAX_BASE_URL || 'https://api.minimax.io').replace(/\/+$/, '');
  const endpoint = secureProviderEndpoint(`${base}/v1/t2a_v2`, 'api.minimax.io', Boolean(process.env.MINIMAX_BASE_URL));
  const groupId = String(process.env.MINIMAX_GROUP_ID || process.env.MINIMAX_GROUPID || '').trim();
  if (groupId) endpoint.searchParams.set(process.env.MINIMAX_GROUP_ID_PARAM || 'GroupId', groupId);
  return endpoint;
}

function decodeMinimaxAudio(value: unknown, maximumBytes: number): Buffer {
  const raw = String(value || '').trim();
  if (!raw) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_minimax_audio_missing');
  let bytes: Buffer;
  if (/^[a-f0-9]+$/i.test(raw) && raw.length % 2 === 0) bytes = Buffer.from(raw, 'hex');
  else {
    const encoded = raw.replace(/^data:audio\/[^;]+;base64,/i, '');
    if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 === 1) {
      throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_minimax_audio_invalid');
    }
    bytes = Buffer.from(encoded, 'base64');
  }
  if (!bytes.length || bytes.length > maximumBytes) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_response_too_large');
  }
  return bytes;
}

async function minimaxAudio(input: {
  text: string;
  language: string;
  voice: string;
  signal: AbortSignal;
  maximumAudioBytes: number;
  fetchImpl: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}): Promise<RawProviderAudio> {
  const apiKey = String(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim();
  if (!apiKey) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_minimax_not_configured');
  const format = String(process.env.MINIMAX_TTS_FORMAT || 'mp3').trim().toLowerCase();
  const endpoint = minimaxEndpoint();
  await publicHost(endpoint.hostname, input.resolveHostname);
  const response = await input.fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      text: input.text,
      stream: false,
      language_boost: minimaxLanguageBoost(input.language),
      output_format: 'hex',
      voice_setting: {
        voice_id: minimaxVoice(input.voice, input.language),
        speed: Math.max(0.5, Math.min(2, Number(process.env.MINIMAX_TTS_SPEED || 1) || 1)),
        vol: Math.max(0.1, Math.min(10, Number(process.env.MINIMAX_TTS_VOLUME || 1) || 1)),
        pitch: Math.max(-12, Math.min(12, Number(process.env.MINIMAX_TTS_PITCH || 0) || 0)),
      },
      audio_setting: {
        sample_rate: Math.max(16_000, Math.min(44_100, Number(process.env.MINIMAX_TTS_SAMPLE_RATE || 32_000) || 32_000)),
        bitrate: Math.max(32_000, Math.min(256_000, Number(process.env.MINIMAX_TTS_BITRATE || 128_000) || 128_000)),
        format: /^(mp3|wav|flac|aac)$/.test(format) ? format : 'mp3',
        channel: 1,
      },
    }),
    signal: input.signal,
    redirect: 'error',
  });
  const json = await responseJson(response, input.maximumAudioBytes * 2 + 1024 * 1024).catch(error => {
    if (!response.ok) throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_minimax_request_failed',
      `MiniMax HTTP ${response.status}`,
      response.status >= 429 || response.status >= 500,
    );
    throw error;
  });
  const statusCode = Number(json?.base_resp?.status_code ?? 0);
  if (!response.ok || statusCode !== 0) {
    throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_minimax_request_failed',
      safeProviderMessage(`${statusCode || `HTTP ${response.status}`}: ${json?.base_resp?.status_msg || 'request failed'}`, apiKey),
      response.status === 429 || response.status >= 500,
    );
  }
  const bytes = decodeMinimaxAudio(json?.data?.audio, input.maximumAudioBytes);
  const detected = sniffAudioFormat(bytes);
  if (!detected) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_audio_magic_invalid');
  return { provider: 'minimax', bytes, extension: detected.extension };
}

export function sniffAudioFormat(bytes: Buffer): { extension: string; mimeType: string } | null {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return { extension: 'mp3', mimeType: 'audio/mpeg' };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    const aac = (bytes[1] & 0xf6) === 0xf0;
    return { extension: aac ? 'aac' : 'mp3', mimeType: aac ? 'audio/aac' : 'audio/mpeg' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return { extension: 'ogg', mimeType: 'audio/ogg' };
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return { extension: 'flac', mimeType: 'audio/flac' };
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { extension: 'webm', mimeType: 'audio/webm' };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return { extension: 'm4a', mimeType: 'audio/mp4' };
  return null;
}

function wavInfo(bytes: Buffer): { durationSeconds: number } | null {
  if (!sniffAudioFormat(bytes) || bytes.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
  let cursor = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.subarray(cursor, cursor + 4).toString('ascii');
    const size = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    if (size < 0 || start + size > bytes.length) return null;
    if (id === 'fmt ' && size >= 16) byteRate = bytes.readUInt32LE(start + 8);
    if (id === 'data') { dataBytes = size; break; }
    cursor = start + size + (size % 2);
  }
  if (!byteRate || !dataBytes) return null;
  const durationSeconds = dataBytes / byteRate;
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? { durationSeconds } : null;
}

async function tenantVoiceoverDirectory(tenantId: string): Promise<string> {
  const safeTenant = safeAssetTenantId(tenantId);
  const root = path.resolve(process.cwd(), 'data', 'tts');
  const tenants = path.join(root, 'tenants');
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await fs.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
  }
  await fs.promises.mkdir(tenants, { recursive: true, mode: 0o700 });
  const tenantsStat = await fs.promises.lstat(tenants);
  if (!tenantsStat.isDirectory() || tenantsStat.isSymbolicLink()) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
  }
  const directory = tenantAssetDir(root, safeTenant);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await fs.promises.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
  }
  const realTenants = await fs.promises.realpath(tenants);
  const realDirectory = await fs.promises.realpath(directory);
  if (path.dirname(realDirectory) !== realTenants) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
  }
  await fs.promises.chmod(realDirectory, 0o700).catch(() => undefined);
  return realDirectory;
}

async function runFfmpegNormalize(input: {
  ffmpegPath: string;
  sourcePath: string;
  destinationPath: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  throwIfAborted(input.signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input.sourcePath,
      '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', input.destinationPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, input.timeoutMs);
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4_000); });
    child.once('error', error => finish(new DigitalEmployeeVoiceoverError('digital_employee_voiceover_ffmpeg_failed', safeProviderMessage(error), true)));
    child.once('close', code => {
      if (input.signal.aborted) {
        try { throwIfAborted(input.signal); }
        catch (error) { finish(error as Error); }
      }
      else if (timedOut) finish(new DigitalEmployeeVoiceoverError('digital_employee_voiceover_normalization_timeout', 'voiceover normalization timed out', true));
      else if (code !== 0) finish(new DigitalEmployeeVoiceoverError('digital_employee_voiceover_audio_decode_failed', safeProviderMessage(stderr || `ffmpeg exited ${code}`)));
      else finish();
    });
  });
}

async function inspectPrivateWav(directory: string, filePath: string, maximumBytes: number, maximumDuration: number): Promise<{
  bytes: Buffer; sha256: string; durationSeconds: number;
} | null> {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== directory || path.extname(resolved).toLowerCase() !== '.wav') return null;
  const stat = await fs.promises.lstat(resolved).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 44 || stat.size > maximumBytes) return null;
  const bytes = await fs.promises.readFile(resolved).catch(() => null);
  if (!bytes) return null;
  const info = wavInfo(bytes);
  if (!info || info.durationSeconds < 0.25 || info.durationSeconds > maximumDuration) return null;
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    durationSeconds: Number(info.durationSeconds.toFixed(3)),
  };
}

function cacheFingerprint(input: { tenantId: string; text: string; language: string; voice: string; providers: VoiceoverProvider[] }): string {
  const qwenEndpoint = process.env.DASHSCOPE_TTS_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const minimaxBase = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    cacheVersion: String(process.env.DIGITAL_EMPLOYEE_TTS_CACHE_VERSION || '1'),
    tenantId: input.tenantId,
    text: input.text,
    language: input.language,
    voice: input.voice,
    providers: input.providers,
    qwen: { endpoint: qwenEndpoint, model: process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash', voice: qwenVoice(input.voice) },
    minimax: {
      base: minimaxBase, model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      voice: minimaxVoice(input.voice, input.language), speed: process.env.MINIMAX_TTS_SPEED || '1',
      volume: process.env.MINIMAX_TTS_VOLUME || '1', pitch: process.env.MINIMAX_TTS_PITCH || '0',
      sampleRate: process.env.MINIMAX_TTS_SAMPLE_RATE || '32000', bitrate: process.env.MINIMAX_TTS_BITRATE || '128000',
      format: process.env.MINIMAX_TTS_FORMAT || 'mp3', groupId: process.env.MINIMAX_GROUP_ID || process.env.MINIMAX_GROUPID || '',
    },
  })).digest('hex');
}

async function inspectCommittedVoiceoverCache(input: {
  directory: string;
  audioPath: string;
  metadataPath: string;
  fingerprint: string;
  sourceTextSha256: string;
  maximumBytes: number;
  maximumDuration: number;
}): Promise<CommittedVoiceoverCache | null> {
  const metadataStat = await fs.promises.lstat(input.metadataPath).catch(() => null);
  if (!metadataStat || metadataStat.isSymbolicLink() || !metadataStat.isFile()
    || metadataStat.size < 2 || metadataStat.size > 8_192 || (metadataStat.mode & 0o077) !== 0) return null;
  let parsed: {
    version?: unknown;
    fingerprint?: unknown;
    provider?: unknown;
    audioSha256?: unknown;
    audioSizeBytes?: unknown;
    durationSeconds?: unknown;
    sourceTextSha256?: unknown;
  };
  try {
    parsed = JSON.parse(await fs.promises.readFile(input.metadataPath, 'utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.version !== 2 || parsed.fingerprint !== input.fingerprint
    || (parsed.provider !== 'qwen_tts' && parsed.provider !== 'minimax')
    || !/^[a-f0-9]{64}$/.test(String(parsed.audioSha256 || ''))
    || parsed.sourceTextSha256 !== input.sourceTextSha256
    || !Number.isSafeInteger(parsed.audioSizeBytes) || Number(parsed.audioSizeBytes) < 44
    || !Number.isFinite(parsed.durationSeconds) || Number(parsed.durationSeconds) <= 0) return null;

  const audioStat = await fs.promises.lstat(input.audioPath).catch(() => null);
  if (!audioStat || (audioStat.mode & 0o077) !== 0) return null;
  const audio = await inspectPrivateWav(input.directory, input.audioPath, input.maximumBytes, input.maximumDuration);
  if (!audio || audio.sha256 !== parsed.audioSha256 || audio.bytes.length !== parsed.audioSizeBytes
    || Math.abs(audio.durationSeconds - Number(parsed.durationSeconds)) > 0.001) return null;
  return { provider: parsed.provider, ...audio };
}

function delayWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      try { throwIfAborted(signal); }
      catch (error) { reject(error); }
    };
    timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function writeLeaseHeartbeat(lease: Pick<VoiceoverCacheLease, 'handle' | 'token' | 'acquiredAt'>, staleMs: number): Promise<void> {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    token: lease.token,
    pid: process.pid,
    acquiredAt: lease.acquiredAt,
    renewedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + staleMs).toISOString(),
  }));
  await lease.handle.write(payload, 0, payload.length, 0);
  await lease.handle.truncate(payload.length);
  await lease.handle.sync();
}

async function leaseOwnsLock(lease: VoiceoverCacheLease): Promise<boolean> {
  if (lease.lost) return false;
  const [held, current] = await Promise.all([
    lease.handle.stat().catch(() => null),
    fs.promises.lstat(lease.lockPath).catch(() => null),
  ]);
  return Boolean(held && current && current.isFile() && !current.isSymbolicLink()
    && held.dev === current.dev && held.ino === current.ino);
}

async function assertLeaseOwnership(lease: VoiceoverCacheLease): Promise<void> {
  if (!await leaseOwnsLock(lease)) {
    lease.lost = true;
    throw new DigitalEmployeeVoiceoverError(
      'digital_employee_voiceover_cache_lock_lost',
      'voiceover cache lease was lost before commit',
      true,
    );
  }
}

async function acquireVoiceoverCacheLease(input: {
  lockPath: string;
  signal: AbortSignal;
  waitMs: number;
  staleMs: number;
}): Promise<VoiceoverCacheLease> {
  const deadline = Date.now() + input.waitMs;
  while (true) {
    throwIfAborted(input.signal);
    const token = randomUUID();
    try {
      const handle = await fs.promises.open(input.lockPath, 'wx', 0o600);
      const acquiredAt = new Date().toISOString();
      const lease: VoiceoverCacheLease = {
        lockPath: input.lockPath,
        token,
        handle,
        acquiredAt,
        heartbeat: undefined as unknown as NodeJS.Timeout,
        heartbeatInFlight: null,
        lost: false,
      };
      try {
        await writeLeaseHeartbeat(lease, input.staleMs);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.promises.rm(input.lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      const heartbeatEveryMs = Math.max(1_000, Math.min(5_000, Math.floor(input.staleMs / 3)));
      lease.heartbeat = setInterval(() => {
        if (lease.heartbeatInFlight) return;
        const refresh = (async () => {
          if (!await leaseOwnsLock(lease)) { lease.lost = true; return; }
          await writeLeaseHeartbeat(lease, input.staleMs).catch(() => { lease.lost = true; });
        })();
        lease.heartbeatInFlight = refresh;
        void refresh.finally(() => {
          if (lease.heartbeatInFlight === refresh) lease.heartbeatInFlight = null;
        });
      }, heartbeatEveryMs);
      lease.heartbeat.unref?.();
      return lease;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const observed = await fs.promises.lstat(input.lockPath).catch(() => null);
    if (observed) {
      if (observed.isSymbolicLink() || !observed.isFile()) {
        throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
      }
      if (Date.now() - observed.mtimeMs > input.staleMs) {
        const stalePath = `${input.lockPath}.stale-${randomUUID()}`;
        await fs.promises.rename(input.lockPath, stalePath).then(async () => {
          await fs.promises.rm(stalePath, { force: true });
        }).catch(error => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'EEXIST') throw error;
        });
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new DigitalEmployeeVoiceoverError(
        'digital_employee_voiceover_cache_lock_timeout',
        'timed out waiting for the voiceover cache lease',
        true,
      );
    }
    await delayWithSignal(Math.min(100, Math.max(20, deadline - Date.now())), input.signal);
  }
}

async function releaseVoiceoverCacheLease(lease: VoiceoverCacheLease): Promise<void> {
  clearInterval(lease.heartbeat);
  await lease.heartbeatInFlight?.catch(() => undefined);
  const ownsLock = await leaseOwnsLock(lease);
  await lease.handle.close().catch(() => undefined);
  if (!ownsLock) return;
  // Ownership is checked by inode immediately before removal. A lease that was
  // fenced out by stale recovery must never remove its successor's lock.
  const current = await fs.promises.lstat(lease.lockPath).catch(() => null);
  const tokenMatches = current && current.isFile() && !current.isSymbolicLink()
    ? await fs.promises.readFile(lease.lockPath, 'utf8').then(value => {
      try { return (JSON.parse(value) as { token?: unknown }).token === lease.token; }
      catch { return false; }
    }).catch(() => false)
    : false;
  if (tokenMatches) await fs.promises.rm(lease.lockPath, { force: true }).catch(() => undefined);
}

async function quarantineInvalidCachePair(audioPath: string, metadataPath: string): Promise<void> {
  const token = randomUUID();
  for (const candidate of [audioPath, metadataPath]) {
    const stat = await fs.promises.lstat(candidate).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_storage_boundary_violation');
    }
    const quarantinePath = `${candidate}.invalid-${token}`;
    await fs.promises.rename(candidate, quarantinePath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    await fs.promises.rm(quarantinePath, { force: true }).catch(() => undefined);
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.promises.open(filePath, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.promises.open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code || ''))) throw error;
  } finally {
    await handle.close();
  }
}

async function writePrivateFileDurably(filePath: string, bytes: Buffer): Promise<void> {
  const handle = await fs.promises.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function synthesizeDigitalEmployeeVoiceover(input: {
  tenantId: string;
  text: string;
  language: string;
  signal?: AbortSignal;
}, dependencies: DigitalEmployeeVoiceoverDependencies = {}): Promise<DigitalEmployeeVoiceoverResult> {
  throwIfAborted(input.signal);
  const tenantId = safeAssetTenantId(input.tenantId);
  const spoken = sourceText(input.text);
  const sourceTextSha256 = createHash('sha256').update(spoken).digest('hex');
  if (!spoken) return { status: 'not_available', sourceTextSha256, reason: 'voiceover_text_missing' };
  const maximumTextCharacters = configuredNumber('DIGITAL_EMPLOYEE_TTS_MAX_TEXT_CHARS', 5_000, 200, 5_000);
  if (spoken.length > maximumTextCharacters) {
    throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_text_too_long', `voiceover exceeds ${maximumTextCharacters} characters`);
  }

  const providers = providerOrder();
  const mode = voiceoverMode();
  const realPublish = process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED === 'true';
  const production = process.env.NODE_ENV === 'production';
  if (!providers.length) {
    if (providerExplicitlyMissing()) {
      throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_selected_provider_not_configured');
    }
    if (mode === 'silent_test' && !production && !realPublish) {
      return { status: 'silent_fallback', sourceTextSha256, reason: 'tts_provider_not_configured_test_fallback' };
    }
    return {
      status: 'not_available', sourceTextSha256,
      reason: mode === 'required' ? 'voiceover_provider_required' : 'voiceover_provider_not_configured',
    };
  }

  const timeoutMs = configuredNumber('DIGITAL_EMPLOYEE_TTS_TIMEOUT_MS', 90_000, 5_000, 180_000);
  const maximumAudioBytes = configuredNumber('DIGITAL_EMPLOYEE_TTS_MAX_AUDIO_BYTES', 15 * 1024 * 1024, 1_024, 50 * 1024 * 1024);
  const maximumDuration = configuredNumber('DIGITAL_EMPLOYEE_TTS_MAX_DURATION_SECONDS', 60, 3, 60);
  const signal = linkedDeadline(input.signal, timeoutMs);
  const voice = voiceCode();
  const language = normalizedLanguage(input.language);
  const fingerprint = cacheFingerprint({ tenantId, text: spoken, language, voice, providers });
  const directory = await tenantVoiceoverDirectory(tenantId);
  const finalPath = path.join(directory, `digital-employee-${fingerprint.slice(0, 48)}.wav`);
  const audioUrl = `/tts/${tenantAssetRelativePath(tenantId, path.basename(finalPath))}`;
  const metadataPath = `${finalPath}.json`;
  const inspectCache = () => inspectCommittedVoiceoverCache({
    directory,
    audioPath: finalPath,
    metadataPath,
    fingerprint,
    sourceTextSha256,
    maximumBytes: maximumAudioBytes,
    maximumDuration,
  });
  const cached = await inspectCache();
  if (cached) {
    return {
      status: 'generated', provider: cached.provider,
      voice,
      audioPath: finalPath, audioUrl, audioBytes: cached.bytes, audioSha256: cached.sha256, audioSizeBytes: cached.bytes.length,
      durationSeconds: cached.durationSeconds, mimeType: 'audio/wav', sourceTextSha256, cached: true,
    };
  }

  const lockWaitMs = configuredNumber('DIGITAL_EMPLOYEE_TTS_LOCK_WAIT_MS', timeoutMs, 1_000, 180_000);
  const lockStaleMs = configuredNumber(
    'DIGITAL_EMPLOYEE_TTS_LOCK_STALE_MS',
    Math.min(600_000, timeoutMs + 30_000),
    10_000,
    600_000,
  );
  const lease = await acquireVoiceoverCacheLease({
    lockPath: `${finalPath}.lock`, signal, waitMs: lockWaitMs, staleMs: lockStaleMs,
  });
  let sourcePath = '';
  let candidatePath = '';
  let sidecarPath = '';
  try {
    // Every waiter rechecks after taking the lease. Only the first process that
    // sees a miss is allowed to call a billable provider.
    const committedByWinner = await inspectCache();
    if (committedByWinner) {
      return {
        status: 'generated', provider: committedByWinner.provider,
        voice,
        audioPath: finalPath, audioUrl, audioBytes: committedByWinner.bytes,
        audioSha256: committedByWinner.sha256, audioSizeBytes: committedByWinner.bytes.length,
        durationSeconds: committedByWinner.durationSeconds, mimeType: 'audio/wav', sourceTextSha256, cached: true,
      };
    }
    await quarantineInvalidCachePair(finalPath, metadataPath);
    await syncDirectory(directory);

    const fetchImpl = dependencies.fetchImpl || fetch;
    const errors: string[] = [];
    let raw: RawProviderAudio | null = null;
    for (const provider of providers) {
      throwIfAborted(signal);
      try {
        raw = provider === 'qwen_tts'
          ? await qwenAudio({ text: spoken, language, voice, signal, maximumAudioBytes, fetchImpl, resolveHostname: dependencies.resolveHostname })
          : await minimaxAudio({ text: spoken, language, voice, signal, maximumAudioBytes, fetchImpl, resolveHostname: dependencies.resolveHostname });
        break;
      } catch (error) {
        if (signal.aborted) throwIfAborted(signal);
        const typed = error as Partial<DigitalEmployeeVoiceoverError>;
        errors.push(`${provider}:${typed.code || safeProviderMessage(error)}`);
      }
    }
    if (!raw) {
      throw new DigitalEmployeeVoiceoverError(
        'digital_employee_voiceover_synthesis_failed',
        errors.join('; ').slice(0, 500) || 'configured voiceover providers failed',
        true,
      );
    }
    const detected = sniffAudioFormat(raw.bytes);
    if (!detected) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_audio_magic_invalid');
    const ffmpegPath = dependencies.ffmpegPath === undefined ? ffmpegStatic : dependencies.ffmpegPath;
    if (!ffmpegPath) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_ffmpeg_unavailable');
    const temporaryBase = `.${path.basename(finalPath)}.${process.pid}-${randomUUID()}`;
    sourcePath = path.join(directory, `${temporaryBase}.source.${detected.extension}`);
    candidatePath = path.join(directory, `${temporaryBase}.normalized.wav`);
    sidecarPath = `${metadataPath}.${process.pid}-${randomUUID()}.tmp`;
    await writePrivateFileDurably(sourcePath, raw.bytes);
    await runFfmpegNormalize({ ffmpegPath, sourcePath, destinationPath: candidatePath, signal, timeoutMs: Math.min(60_000, timeoutMs) });
    await fs.promises.chmod(candidatePath, 0o600);
    const candidate = await inspectPrivateWav(directory, candidatePath, maximumAudioBytes, maximumDuration);
    if (!candidate) throw new DigitalEmployeeVoiceoverError('digital_employee_voiceover_normalized_audio_invalid');
    await syncFile(candidatePath);
    await writePrivateFileDurably(sidecarPath, Buffer.from(JSON.stringify({
      version: 2,
      fingerprint,
      provider: raw.provider,
      audioSha256: candidate.sha256,
      audioSizeBytes: candidate.bytes.length,
      sourceTextSha256,
      durationSeconds: candidate.durationSeconds,
      createdAt: new Date().toISOString(),
    })));

    await assertLeaseOwnership(lease);
    // The audio rename is atomic; the metadata rename is the commit marker.
    // A crash between them leaves an uncommitted WAV that all readers reject.
    await fs.promises.rename(candidatePath, finalPath);
    candidatePath = '';
    await syncDirectory(directory);
    await assertLeaseOwnership(lease);
    await fs.promises.rename(sidecarPath, metadataPath);
    sidecarPath = '';
    await syncDirectory(directory);

    const committed = await inspectCache();
    if (!committed || committed.provider !== raw.provider) {
      throw new DigitalEmployeeVoiceoverError(
        'digital_employee_voiceover_promotion_failed',
        'voiceover cache commit could not be verified',
        true,
      );
    }
    return {
      status: 'generated',
      provider: committed.provider,
      voice,
      audioPath: finalPath, audioUrl, audioBytes: committed.bytes, audioSha256: committed.sha256, audioSizeBytes: committed.bytes.length,
      durationSeconds: committed.durationSeconds, mimeType: 'audio/wav', sourceTextSha256, cached: false,
    };
  } finally {
    if (sourcePath) await fs.promises.rm(sourcePath, { force: true }).catch(() => undefined);
    if (candidatePath) await fs.promises.rm(candidatePath, { force: true }).catch(() => undefined);
    if (sidecarPath) await fs.promises.rm(sidecarPath, { force: true }).catch(() => undefined);
    await releaseVoiceoverCacheLease(lease);
  }
}

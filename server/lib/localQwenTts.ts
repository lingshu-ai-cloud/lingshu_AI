import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const LOCAL_QWEN3_TTS_MODEL = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
export const LOCAL_QWEN3_TTS_LICENSE = 'Apache-2.0';
export const LOCAL_QWEN3_TTS_LANGUAGES = ['zh', 'en', 'es'] as const;

type Environment = NodeJS.ProcessEnv;

export interface LocalQwenTtsCapability {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  failClosed: true;
  model: string;
  license: string;
  supportedLanguages: readonly string[];
  speaker: string;
  device: string;
  runtimeIsolation: 'fully-isolated-venv' | 'isolated-venv-readonly-shared-torch';
  loudnessNormalization: {
    standard: 'EBU R128 two-pass';
    targetIntegratedLufs: number;
    targetTruePeakDb: number;
    targetLra: number;
  };
  pitchAdjustmentsSemitones: Record<(typeof LOCAL_QWEN3_TTS_LANGUAGES)[number], number>;
  reason?: string;
}

export interface LocalQwenTtsRequest {
  text: string;
  voice: string;
  language: string;
  outputPath: string;
  speed?: number;
  targetDuration?: number;
}

export interface LocalQwenTtsResult {
  ok: true;
  source: 'qwen3_tts_local';
  output: string;
  duration: number;
  sampleRate: number;
  channels: number;
  frames: number;
  peak: number;
  rms: number;
  finite: boolean;
  speaker: string;
  language: string;
  device: string;
  dtype: string;
  model: string;
  license: string;
  requestedTargetDuration?: number | null;
  targetDurationSatisfied?: boolean;
  appliedTempo?: number;
  loadSeconds?: number;
  generationSeconds?: number;
  totalSeconds?: number;
  peakGpuMemoryMb?: number;
  fallbackReason?: string;
  loudnessNormalization: LocalQwenTtsCapability['loudnessNormalization'] & {
    inputIntegratedLufs: number;
    inputTruePeakDb: number;
    outputIntegratedLufs: number;
    outputTruePeakDb: number;
  };
  pitchAdjustmentSemitones: number;
  pitchProcessing: 'none' | 'rubberband_formant_preserved';
}

interface LocalQwenTtsConfig {
  enabled: boolean;
  python: string;
  script: string;
  modelDir: string;
  sharedSitePackages: string;
  distro: string;
  device: string;
  dtype: string;
  attention: string;
  ffmpeg: string;
  timeoutMs: number;
  minFreeVramMb: number;
  lockFile: string;
  lockTimeoutSeconds: number;
  allowCpuFallback: boolean;
  maxTextChars: number;
  loudnessLufs: number;
  truePeakDb: number;
  loudnessRange: number;
  pitchAdjustmentsSemitones: Record<(typeof LOCAL_QWEN3_TTS_LANGUAGES)[number], number>;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function enabled(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function windowsPathToWsl(value: string): string {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return normalized.replace(/\\/g, '/');
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g, '/')}`;
}

export function wslPathToWindows(value: string): string {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return normalized;
  return `${match[1]!.toUpperCase()}:\\${match[2]!.replace(/\//g, '\\')}`;
}

function pathVisibleToHost(value: string, platform = process.platform): string {
  if (platform === 'win32' && /^\/mnt\/[a-zA-Z]\//.test(value)) return wslPathToWindows(value);
  return value;
}

function pathVisibleToRuntime(value: string, platform = process.platform): string {
  if (platform === 'win32') return windowsPathToWsl(value);
  return value;
}

function runtimePythonVisibleToHost(
  python: string,
  platform: NodeJS.Platform,
  exists: (candidate: string) => boolean,
): boolean {
  const hostPath = pathVisibleToHost(python, platform);
  if (exists(hostPath)) return true;
  // A WSL venv Python is normally a Linux symlink. DrvFS exposes that link as
  // a reparse point which Node on Windows can return EACCES for, even though
  // WSL can execute it. The venv marker is a stable host-visible check; the
  // health endpoint performs the authoritative executable/import/CUDA probe.
  if (platform === 'win32' && /^\/mnt\/[a-zA-Z]\//.test(python) && /\/bin\/python(?:\d+(?:\.\d+)?)?$/.test(python)) {
    const venvRoot = python.replace(/\/bin\/python(?:\d+(?:\.\d+)?)?$/, '');
    return exists(pathVisibleToHost(`${venvRoot}/pyvenv.cfg`, platform));
  }
  return false;
}

function localQwenTtsConfig(env: Environment = process.env): LocalQwenTtsConfig {
  const defaultScript = path.resolve(process.cwd(), 'scripts', 'qwen3-tts-local.py');
  return {
    enabled: enabled(env.LOCAL_QWEN3_TTS_ENABLED),
    python: String(env.LOCAL_QWEN3_TTS_PYTHON || '').trim(),
    script: String(env.LOCAL_QWEN3_TTS_SCRIPT || defaultScript).trim(),
    modelDir: String(env.LOCAL_QWEN3_TTS_MODEL_DIR || '').trim(),
    sharedSitePackages: String(env.LOCAL_QWEN3_TTS_SHARED_SITE_PACKAGES || '').trim(),
    distro: String(env.LOCAL_QWEN3_TTS_WSL_DISTRO || 'Ubuntu-22.04').trim(),
    device: String(env.LOCAL_QWEN3_TTS_DEVICE || 'cuda:0').trim(),
    dtype: String(env.LOCAL_QWEN3_TTS_DTYPE || 'bfloat16').trim(),
    attention: String(env.LOCAL_QWEN3_TTS_ATTENTION || 'sdpa').trim(),
    ffmpeg: String(env.LOCAL_QWEN3_TTS_FFMPEG || '/usr/bin/ffmpeg').trim(),
    timeoutMs: boundedNumber(env.LOCAL_QWEN3_TTS_TIMEOUT_MS, 180_000, 10_000, 900_000),
    minFreeVramMb: boundedNumber(env.LOCAL_QWEN3_TTS_MIN_FREE_VRAM_MB, 4_300, 0, 32_000),
    lockFile: String(env.LOCAL_QWEN3_TTS_LOCK_FILE || '/mnt/d/LINGSHU_models/qwen3-tts/inference.lock').trim(),
    lockTimeoutSeconds: boundedNumber(env.LOCAL_QWEN3_TTS_LOCK_TIMEOUT_SECONDS, 3, 0.1, 120),
    allowCpuFallback: enabled(env.LOCAL_QWEN3_TTS_ALLOW_CPU_FALLBACK),
    maxTextChars: boundedNumber(env.LOCAL_QWEN3_TTS_MAX_TEXT_CHARS, 1_500, 20, 5_000),
    loudnessLufs: boundedNumber(env.LOCAL_QWEN3_TTS_LOUDNESS_LUFS, -18, -30, -12),
    truePeakDb: boundedNumber(env.LOCAL_QWEN3_TTS_TRUE_PEAK_DB, -1.5, -6, -0.5),
    loudnessRange: boundedNumber(env.LOCAL_QWEN3_TTS_LOUDNESS_RANGE, 7, 1, 20),
    pitchAdjustmentsSemitones: {
      zh: boundedNumber(env.LOCAL_QWEN3_TTS_PITCH_SEMITONES_ZH, 0, -4, 4),
      en: boundedNumber(env.LOCAL_QWEN3_TTS_PITCH_SEMITONES_EN, 0, -4, 4),
      es: boundedNumber(env.LOCAL_QWEN3_TTS_PITCH_SEMITONES_ES, 0, -4, 4),
    },
  };
}

function requiredLocalModelFiles(modelDir: string): string[] {
  return [
    path.join(modelDir, 'config.json'),
    path.join(modelDir, 'model.safetensors'),
    path.join(modelDir, 'tokenizer_config.json'),
    path.join(modelDir, 'vocab.json'),
    path.join(modelDir, 'speech_tokenizer', 'config.json'),
    path.join(modelDir, 'speech_tokenizer', 'model.safetensors'),
    path.join(modelDir, 'speech_tokenizer', 'preprocessor_config.json'),
  ];
}

export function localQwenSpeakerForVoice(voice: string, env: Environment = process.env): string {
  const code = String(voice || 'v2').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return String(env[`LOCAL_QWEN3_TTS_SPEAKER_${code}`] || env.LOCAL_QWEN3_TTS_SPEAKER || 'Ryan').trim() || 'Ryan';
}

export function normalizeLocalQwenLanguage(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const primary = raw.split('-', 1)[0] || 'zh';
  return ({ chinese: 'zh', mandarin: 'zh', english: 'en', spanish: 'es' } as Record<string, string>)[primary] || primary;
}

/**
 * Keep authored copy out of the Windows -> WSL argv boundary.  Passing CJK
 * text directly through wsl.exe is locale/code-page dependent on Windows and
 * can arrive as an empty argument.  Base64 is ASCII-only while preserving the
 * exact UTF-8 byte sequence; the Python runner decodes it before inference.
 */
export function localQwenTextTransportArgs(value: string): [string, string] {
  return ['--text-base64', Buffer.from(String(value || ''), 'utf8').toString('base64')];
}

export function localQwenTtsCapability(
  env: Environment = process.env,
  platform = process.platform,
  exists: (candidate: string) => boolean = fs.existsSync,
): LocalQwenTtsCapability {
  const config = localQwenTtsConfig(env);
  const speaker = localQwenSpeakerForVoice('v2', env);
  const base = {
    enabled: config.enabled,
    failClosed: true as const,
    model: LOCAL_QWEN3_TTS_MODEL,
    license: LOCAL_QWEN3_TTS_LICENSE,
    supportedLanguages: LOCAL_QWEN3_TTS_LANGUAGES,
    speaker,
    device: config.device,
    runtimeIsolation: config.sharedSitePackages
      ? 'isolated-venv-readonly-shared-torch' as const
      : 'fully-isolated-venv' as const,
    loudnessNormalization: {
      standard: 'EBU R128 two-pass' as const,
      targetIntegratedLufs: config.loudnessLufs,
      targetTruePeakDb: config.truePeakDb,
      targetLra: config.loudnessRange,
    },
    pitchAdjustmentsSemitones: config.pitchAdjustmentsSemitones,
  };
  if (!config.enabled) return { ...base, configured: false, available: false, reason: 'disabled' };
  if (!config.python || !config.modelDir || !config.script) {
    return { ...base, configured: false, available: false, reason: 'python, model directory and runner script are required' };
  }

  const python = pathVisibleToHost(config.python, platform);
  const script = pathVisibleToHost(config.script, platform);
  const modelDir = pathVisibleToHost(config.modelDir, platform);
  const missing = [
    ...(runtimePythonVisibleToHost(config.python, platform, exists) ? [] : [python]),
    ...[script, ...requiredLocalModelFiles(modelDir)].filter(candidate => !exists(candidate)),
  ];
  if (missing.length) {
    return {
      ...base,
      configured: true,
      available: false,
      reason: `missing local runtime files: ${missing.slice(0, 3).join(', ')}`,
    };
  }
  return { ...base, configured: true, available: true };
}

function parseLastJson(stdout: string): Record<string, unknown> {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try { return JSON.parse(line) as Record<string, unknown>; }
    catch { /* keep scanning bounded log output */ }
  }
  throw new Error('local Qwen3-TTS returned no JSON result');
}

function runProcess(file: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`.slice(-128_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('error', error => {
      stderr = append(stderr, Buffer.from(String(error.message || error)));
      finish(null);
    });
    child.on('close', code => finish(code));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => finish(null), 2_000).unref();
    }, timeoutMs);
  });
}

function runtimeCommand(config: LocalQwenTtsConfig, scriptArgs: string[], platform = process.platform) {
  if (platform !== 'win32') {
    return { file: config.python, args: [config.script, ...scriptArgs] };
  }
  const runtimeArgs = [
    '-d', config.distro,
    '--', 'env',
    'HF_HUB_OFFLINE=1',
    'TRANSFORMERS_OFFLINE=1',
    config.python,
    pathVisibleToRuntime(config.script, platform),
    ...scriptArgs,
  ];
  return { file: 'wsl.exe', args: runtimeArgs };
}

function commonRunnerArgs(config: LocalQwenTtsConfig, speaker: string, platform = process.platform): string[] {
  const args = [
    '--model', pathVisibleToRuntime(config.modelDir, platform),
    '--speaker', speaker,
    '--device', config.device,
    '--dtype', config.dtype,
    '--attention', config.attention,
    '--ffmpeg', pathVisibleToRuntime(config.ffmpeg, platform),
    '--min-free-vram-mb', String(config.minFreeVramMb),
    '--lock-file', pathVisibleToRuntime(config.lockFile, platform),
    '--lock-timeout', String(config.lockTimeoutSeconds),
    '--loudness-lufs', String(config.loudnessLufs),
    '--true-peak-db', String(config.truePeakDb),
    '--loudness-range', String(config.loudnessRange),
  ];
  if (config.sharedSitePackages) args.push('--shared-site-packages', pathVisibleToRuntime(config.sharedSitePackages, platform));
  if (config.allowCpuFallback) args.push('--allow-cpu-fallback');
  return args;
}

export async function runLocalQwenTtsHealth(env: Environment = process.env): Promise<Record<string, unknown>> {
  const config = localQwenTtsConfig(env);
  const capability = localQwenTtsCapability(env);
  if (!capability.enabled || !capability.configured || !capability.available) {
    return { ok: false, ...capability };
  }
  const command = runtimeCommand(config, ['--health', ...commonRunnerArgs(config, capability.speaker)]);
  const processResult = await runProcess(command.file, command.args, Math.min(config.timeoutMs, 90_000));
  let payload: Record<string, unknown>;
  try { payload = parseLastJson(processResult.stdout); }
  catch (error) {
    return {
      ok: false,
      ...capability,
      error: processResult.timedOut
        ? 'local Qwen3-TTS health check timed out'
        : String(error instanceof Error ? error.message : error),
      detail: processResult.stderr.slice(-500),
    };
  }
  return {
    ...payload,
    configured: capability.configured,
    available: payload.ok === true,
    failClosed: true,
  };
}

export async function generateLocalQwenTts(
  request: LocalQwenTtsRequest,
  env: Environment = process.env,
): Promise<LocalQwenTtsResult | null> {
  const config = localQwenTtsConfig(env);
  if (!config.enabled) return null;
  const capability = localQwenTtsCapability(env);
  if (!capability.available) throw new Error(`Local Qwen3-TTS unavailable: ${capability.reason || 'invalid configuration'}`);
  const language = normalizeLocalQwenLanguage(request.language);
  if (!LOCAL_QWEN3_TTS_LANGUAGES.includes(language as typeof LOCAL_QWEN3_TTS_LANGUAGES[number])) {
    throw new Error(`Local Qwen3-TTS does not support language: ${request.language}`);
  }
  const text = String(request.text || '').trim().slice(0, config.maxTextChars);
  if (!text) throw new Error('Local Qwen3-TTS requires non-empty text');
  const outputPath = path.resolve(request.outputPath);
  if (path.extname(outputPath).toLowerCase() !== '.wav') throw new Error('Local Qwen3-TTS output must be WAV');
  const speaker = localQwenSpeakerForVoice(request.voice, env);
  const args = [
    ...commonRunnerArgs(config, speaker),
    ...localQwenTextTransportArgs(text),
    '--language', language,
    '--output', pathVisibleToRuntime(outputPath),
    '--speed', String(boundedNumber(request.speed, 1, 0.75, 1.35)),
    '--target-duration', String(boundedNumber(request.targetDuration, 0, 0, 180)),
    '--pitch-semitones', String(config.pitchAdjustmentsSemitones[language as keyof typeof config.pitchAdjustmentsSemitones]),
  ];
  const command = runtimeCommand(config, args);
  const processResult = await runProcess(command.file, command.args, config.timeoutMs);
  let payload: Record<string, unknown>;
  try { payload = parseLastJson(processResult.stdout); }
  catch (error) {
    throw new Error(processResult.timedOut
      ? 'Local Qwen3-TTS timed out'
      : `${String(error instanceof Error ? error.message : error)}: ${processResult.stderr.slice(-400)}`);
  }
  if (processResult.code !== 0 || payload.ok !== true) {
    throw new Error(String(payload.error || processResult.stderr || `Local Qwen3-TTS exited ${processResult.code}`).slice(0, 1_000));
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 4_000) {
    throw new Error('Local Qwen3-TTS reported success without a valid output file');
  }
  const duration = Number(payload.duration);
  if (!Number.isFinite(duration) || duration < 0.2) throw new Error('Local Qwen3-TTS reported an invalid duration');
  return payload as unknown as LocalQwenTtsResult;
}

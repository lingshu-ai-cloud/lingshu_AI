import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  LOCAL_QWEN3_TTS_LANGUAGES,
  LOCAL_QWEN3_TTS_LICENSE,
  generateLocalQwenTts,
  localQwenSpeakerForVoice,
  localQwenTextTransportArgs,
  localQwenTtsCapability,
  normalizeLocalQwenLanguage,
  windowsPathToWsl,
  wslPathToWindows,
} from './localQwenTts.js';

assert.equal(windowsPathToWsl('D:\\LINGSHU_models\\qwen3-tts\\.venv\\bin\\python'), '/mnt/d/LINGSHU_models/qwen3-tts/.venv/bin/python');
assert.equal(wslPathToWindows('/mnt/d/LINGSHU_models/model'), 'D:\\LINGSHU_models\\model');
assert.deepEqual(LOCAL_QWEN3_TTS_LANGUAGES, ['zh', 'en', 'es']);
assert.equal(LOCAL_QWEN3_TTS_LICENSE, 'Apache-2.0');
assert.equal(normalizeLocalQwenLanguage('Chinese'), 'zh');
assert.equal(normalizeLocalQwenLanguage('en-US'), 'en');
assert.equal(normalizeLocalQwenLanguage('Spanish'), 'es');

const chineseContractText = '改善置业，别只看总价。把通勤、空间和成本放在一起比较。';
const encodedTextArgs = localQwenTextTransportArgs(chineseContractText);
assert.equal(encodedTextArgs[0], '--text-base64');
assert.notEqual(encodedTextArgs[1], chineseContractText, 'transport argv must not contain authored plaintext');
assert.equal(Buffer.from(encodedTextArgs[1], 'base64').toString('utf8'), chineseContractText);

const runnerPath = path.resolve(process.cwd(), 'scripts', 'qwen3-tts-local.py');
const runTextTransportContract = (textArgs: string[]) => {
  const runnerArgs = [
    process.platform === 'win32' ? windowsPathToWsl(runnerPath) : runnerPath,
    '--model', process.platform === 'win32' ? windowsPathToWsl(process.cwd()) : process.cwd(),
    ...textArgs,
    '--text-transport-contract',
  ];
  return process.platform === 'win32'
    ? spawnSync('wsl.exe', [
        '-d', process.env.LOCAL_QWEN3_TTS_WSL_DISTRO || 'Ubuntu-22.04',
        '--', 'python3', ...runnerArgs,
      ], { encoding: 'utf8', windowsHide: true })
    : spawnSync('python3', runnerArgs, { encoding: 'utf8' });
};

const chineseContract = runTextTransportContract(encodedTextArgs);
assert.equal(chineseContract.error, undefined, `Python contract runner unavailable: ${String(chineseContract.error || '')}`);
assert.equal(chineseContract.status, 0, chineseContract.stderr || chineseContract.stdout);
const chineseContractPayload = JSON.parse(chineseContract.stdout.trim()) as Record<string, unknown>;
assert.equal(chineseContractPayload.ok, true);
assert.equal(chineseContractPayload.characters, [...chineseContractText].length);
assert.equal(chineseContractPayload.utf8Bytes, Buffer.byteLength(chineseContractText, 'utf8'));
assert.equal(chineseContractPayload.sha256, crypto.createHash('sha256').update(chineseContractText, 'utf8').digest('hex'));

const legacyTextContract = runTextTransportContract(['--text', 'legacy ASCII text']);
assert.equal(legacyTextContract.status, 0, legacyTextContract.stderr || legacyTextContract.stdout);
assert.equal((JSON.parse(legacyTextContract.stdout.trim()) as Record<string, unknown>).ok, true);

const disabled = localQwenTtsCapability({}, 'win32', () => true);
assert.equal(disabled.enabled, false);
assert.equal(disabled.available, false);
assert.equal(disabled.failClosed, true);

const configuredEnvironment = {
  LOCAL_QWEN3_TTS_ENABLED: 'true',
  LOCAL_QWEN3_TTS_PYTHON: '/mnt/d/LINGSHU_models/qwen3-tts/.venv/bin/python',
  LOCAL_QWEN3_TTS_SCRIPT: 'D:\\repo\\scripts\\qwen3-tts-local.py',
  LOCAL_QWEN3_TTS_MODEL_DIR: '/mnt/d/LINGSHU_models/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  LOCAL_QWEN3_TTS_SHARED_SITE_PACKAGES: '/root/musetalk/.venv/lib/python3.10/site-packages',
  LOCAL_QWEN3_TTS_DEVICE: 'cuda:0',
  LOCAL_QWEN3_TTS_SPEAKER: 'Ryan',
  LOCAL_QWEN3_TTS_SPEAKER_V2: 'Aiden',
  LOCAL_QWEN3_TTS_PITCH_SEMITONES_ES: '-3',
} satisfies NodeJS.ProcessEnv;

const configured = localQwenTtsCapability(configuredEnvironment, 'win32', () => true);
assert.equal(configured.enabled, true);
assert.equal(configured.configured, true);
assert.equal(configured.available, true);
assert.equal(configured.device, 'cuda:0');
assert.equal(configured.runtimeIsolation, 'isolated-venv-readonly-shared-torch');
assert.deepEqual(configured.loudnessNormalization, {
  standard: 'EBU R128 two-pass',
  targetIntegratedLufs: -18,
  targetTruePeakDb: -1.5,
  targetLra: 7,
});
assert.deepEqual(configured.pitchAdjustmentsSemitones, { zh: 0, en: 0, es: -3 });
assert.equal(localQwenSpeakerForVoice('v1', configuredEnvironment), 'Ryan');
assert.equal(localQwenSpeakerForVoice('v2', configuredEnvironment), 'Aiden');

const wslSymlinkUnavailableToWindows = localQwenTtsCapability(configuredEnvironment, 'win32', candidate => (
  candidate.endsWith('pyvenv.cfg') || !candidate.endsWith('\\bin\\python')
));
assert.equal(wslSymlinkUnavailableToWindows.available, true, 'WSL venv marker must cover a Linux Python symlink hidden from Win32');

const missing = localQwenTtsCapability(configuredEnvironment, 'win32', candidate => !candidate.endsWith('model.safetensors'));
assert.equal(missing.configured, true);
assert.equal(missing.available, false);
assert.match(missing.reason || '', /missing local runtime files/i);

assert.equal(await generateLocalQwenTts({
  text: 'must not run',
  voice: 'v2',
  language: 'en',
  outputPath: 'D:\\tmp\\disabled.wav',
}, {}), null);

console.log('localQwenTts tests passed');

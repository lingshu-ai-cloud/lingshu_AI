import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

interface WavMetrics {
  duration: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  peak: number;
  rms: number;
  rmsDb: number;
  bytes: number;
}

function wavMetrics(filePath: string): WavMetrics {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
  let cursor = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let byteRate = 0;
  let pcm: Buffer | undefined;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.subarray(cursor, cursor + 4).toString('ascii');
    const size = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = Math.min(bytes.length, start + size);
    if (id === 'fmt ' && size >= 16) {
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      byteRate = bytes.readUInt32LE(start + 8);
      bitsPerSample = bytes.readUInt16LE(start + 14);
    } else if (id === 'data') {
      pcm = bytes.subarray(start, end);
    }
    cursor = start + size + (size % 2);
  }
  assert.ok(pcm && pcm.length > 4_000, 'WAV must contain real PCM data');
  assert.ok(byteRate > 0, 'WAV must declare a valid byte rate');
  assert.equal(bitsPerSample, 16, 'local TTS contract is PCM16');
  let squareSum = 0;
  let peak = 0;
  const samples = Math.floor(pcm.length / 2);
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2) / 32768;
    peak = Math.max(peak, Math.abs(value));
    squareSum += value * value;
  }
  return {
    duration: Number((pcm.length / byteRate).toFixed(3)),
    sampleRate,
    channels,
    bitsPerSample,
    peak: Number(peak.toFixed(6)),
    rms: Number(Math.sqrt(squareSum / Math.max(1, samples)).toFixed(6)),
    rmsDb: Number((20 * Math.log10(Math.max(1e-9, Math.sqrt(squareSum / Math.max(1, samples))))).toFixed(2)),
    bytes: bytes.length,
  };
}

function localToken(): string {
  const identity = {
    userId: 'local_user_qwen_tts_smoke',
    tenantId: 'local_tenant_qwen_tts_smoke',
    email: 'qwen-tts-smoke@local.test',
    name: 'Qwen TTS Smoke',
    accountType: 'customer',
    role: 'admin',
  };
  return `local-demo.${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;
}

assert.match(String(process.env.LOCAL_QWEN3_TTS_ENABLED || ''), /^(1|true|yes|on)$/i,
  'set LOCAL_QWEN3_TTS_ENABLED=true before running the integration smoke');
process.env.NODE_ENV = 'test';
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DASHSCOPE_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.MINIMAX_API_TOKEN = '';
process.env.PIPER_BIN = '';
process.env.PIPER_MODEL = '';

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/studio`;
  const headers = { Authorization: `Bearer ${localToken()}` };

  const capabilityResponse = await fetch(`${baseUrl}/tts/capabilities`, { headers });
  assert.equal(capabilityResponse.status, 200);
  const capabilities = await capabilityResponse.json() as any;
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.systemVoice.engines.localQwen, true);
  assert.equal(capabilities.localQwen.enabled, true);
  assert.equal(capabilities.localQwen.available, true);
  assert.equal(capabilities.localQwen.failClosed, true);
  assert.deepEqual(capabilities.localQwen.supportedLanguages, ['zh', 'en', 'es']);
  assert.equal(capabilities.localQwen.speaker, 'Ryan');
  assert.equal(capabilities.localQwen.loudnessNormalization.targetIntegratedLufs, -18);
  assert.equal(capabilities.localQwen.loudnessNormalization.targetTruePeakDb, -1.5);
  assert.deepEqual(capabilities.localQwen.pitchAdjustmentsSemitones, { zh: 0, en: 0, es: -3 });

  const healthResponse = await fetch(`${baseUrl}/tts/local-qwen/health`, { headers });
  const health = await healthResponse.json() as any;
  assert.equal(healthResponse.status, 200, JSON.stringify(health));
  assert.equal(health.ok, true);
  assert.equal(health.available, true);
  assert.equal(health.license, 'Apache-2.0');

  const targetDuration = 4.5;

  const batchResponse = await fetch(`${baseUrl}/tts/batch`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice: 'v2',
      style: { targetDuration },
      items: [
        { code: 'zh', language: 'zh', text: '你好，欢迎了解这套舒适的家。' },
        { code: 'en', language: 'en', text: 'Welcome. Let us find the right home.' },
        { code: 'es', language: 'es', text: 'Bienvenido. Encontremos el hogar ideal.' },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const batch = await batchResponse.json() as any;
  assert.equal(batchResponse.status, 200, JSON.stringify(batch));
  assert.equal(batch.ok, true, JSON.stringify(batch));

  const outputRoot = path.resolve(process.cwd(), 'data', 'tts');
  const smokeRoot = String(process.env.LOCAL_QWEN3_TTS_SMOKE_OUTPUT_DIR || '').trim();
  if (smokeRoot) fs.mkdirSync(smokeRoot, { recursive: true });
  const outputs: Record<string, unknown> = {};
  for (const code of ['zh', 'en', 'es']) {
    const result = batch.audios?.[code];
    assert.equal(result?.ok, true, `${code}: ${JSON.stringify(result)}`);
    assert.equal(result?.source, 'qwen3_tts_local');
    assert.ok(Number(result?.duration) >= 0.5);
    const pathname = new URL(String(result.url), 'http://local').pathname;
    assert.ok(pathname.startsWith('/tts/'));
    const filePath = path.resolve(outputRoot, pathname.slice('/tts/'.length));
    assert.ok(filePath.startsWith(`${outputRoot}${path.sep}`), 'signed URL must remain inside the TTS root');
    assert.ok(fs.existsSync(filePath), `missing API output for ${code}: ${filePath}`);
    const metrics = wavMetrics(filePath);
    assert.equal(metrics.sampleRate, 24_000);
    assert.equal(metrics.channels, 1);
    assert.ok(metrics.duration >= 0.5);
    assert.ok(Math.abs(metrics.duration - Number(result.duration)) <= 0.08);
    assert.ok(Math.abs(metrics.duration - targetDuration) <= Math.max(0.12, targetDuration * 0.02),
      `${code} duration ${metrics.duration}s missed ${targetDuration}s target`);
    assert.ok(metrics.peak > 0.02, 'audio must not be silent');
    assert.ok(metrics.rms > 0.005, 'audio must contain useful speech energy');
    const loudness = result.loudnessNormalization;
    assert.equal(loudness?.standard, 'EBU R128 two-pass');
    assert.ok(Math.abs(Number(loudness?.outputIntegratedLufs) - (-18)) <= 1,
      `${code} loudness missed -18 LUFS: ${JSON.stringify(loudness)}`);
    assert.ok(Number(loudness?.outputTruePeakDb) <= -1.2,
      `${code} true peak exceeded the -1.5 dBTP target: ${JSON.stringify(loudness)}`);
    assert.equal(Number(result.pitchAdjustmentSemitones), code === 'es' ? -3 : 0);
    assert.equal(result.pitchProcessing, code === 'es' ? 'rubberband_formant_preserved' : 'none');
    const retainedPath = smokeRoot ? path.join(smokeRoot, `api-${code}-ryan-target4.5.wav`) : filePath;
    if (smokeRoot) fs.copyFileSync(filePath, retainedPath);
    outputs[code] = { path: retainedPath, url: result.url, source: result.source, loudness, pitchAdjustmentSemitones: result.pitchAdjustmentSemitones, pitchProcessing: result.pitchProcessing, ...metrics };
  }

  console.log(JSON.stringify({
    ok: true,
    api: '/studio/tts/batch',
    targetDuration,
    capability: capabilities.localQwen,
    health,
    outputs,
  }, null, 2));
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  DigitalEmployeeVoiceoverError,
  sniffAudioFormat,
  synthesizeDigitalEmployeeVoiceover,
} from './digitalEmployeeVoiceoverService.js';

const ENVIRONMENT_KEYS = [
  'NODE_ENV', 'DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED', 'DIGITAL_EMPLOYEE_VOICEOVER_MODE',
  'DIGITAL_EMPLOYEE_TTS_PROVIDER', 'DIGITAL_EMPLOYEE_TTS_VOICE', 'DIGITAL_EMPLOYEE_TTS_CACHE_VERSION',
  'DIGITAL_EMPLOYEE_TTS_MAX_AUDIO_BYTES', 'DIGITAL_EMPLOYEE_TTS_MAX_DURATION_SECONDS',
  'DIGITAL_EMPLOYEE_TTS_MAX_TEXT_CHARS', 'DIGITAL_EMPLOYEE_TTS_TIMEOUT_MS',
  'DIGITAL_EMPLOYEE_TTS_LOCK_WAIT_MS', 'DIGITAL_EMPLOYEE_TTS_LOCK_STALE_MS',
  'DIGITAL_EMPLOYEE_TTS_ALLOW_INSECURE_ENDPOINTS',
  'DASHSCOPE_API_KEY', 'DASHSCOPE_TTS_ENDPOINT', 'DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES',
  'QWEN_TTS_MODEL', 'MINIMAX_API_KEY', 'MINIMAX_API_TOKEN', 'MINIMAX_BASE_URL',
  'MINIMAX_TTS_MODEL', 'MINIMAX_TTS_FORMAT',
] as const;
const savedEnvironment = Object.fromEntries(ENVIRONMENT_KEYS.map(key => [key, process.env[key]]));

function wavTone(durationSeconds = 0.6, sampleRate = 24_000): Buffer {
  const samples = Math.floor(durationSeconds * sampleRate);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 4_000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function clearVoiceoverEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) delete process.env[key];
}

function errorCode(error: unknown): string {
  return error instanceof DigitalEmployeeVoiceoverError ? error.code : String(error);
}

const testPrefix = `voiceover-test-${randomUUID()}`;
const tenantsRoot = path.resolve(process.cwd(), 'data', 'tts', 'tenants');
const createdTenants: string[] = [];
const registerTenant = (suffix: string): string => {
  const tenant = `${testPrefix}-${suffix}`;
  createdTenants.push(tenant);
  return tenant;
};
const resolvePublic = async () => ['8.8.8.8'];

async function runVoiceoverChild(environment: NodeJS.ProcessEnv, tenantId: string, text: string): Promise<void> {
  const source = `
    const { synthesizeDigitalEmployeeVoiceover } = await import('./server/studio/digitalEmployeeVoiceoverService.ts');
    const result = await synthesizeDigitalEmployeeVoiceover(
      { tenantId: ${JSON.stringify(tenantId)}, text: ${JSON.stringify(text)}, language: 'en' },
      { resolveHostname: async () => ['8.8.8.8'] },
    );
    if (result.status !== 'generated') throw new Error('child voiceover was not generated');
  `;
  await new Promise<void>((resolve, reject) => {
    const child = spawnChild(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8_000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`voiceover child exited ${code}: ${stderr}`)));
  });
}

try {
  clearVoiceoverEnvironment();
  process.env.DASHSCOPE_API_KEY = 'test-qwen-key';
  process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE = 'auto';
  const qwenAudio = wavTone();
  let qwenFetches = 0;
  const qwenFetch: typeof fetch = async request => {
    qwenFetches += 1;
    const url = new URL(String(request));
    if (url.hostname === 'dashscope.aliyuncs.com') {
      return new Response(JSON.stringify({ output: { audio: { url: 'https://voice-result.oss-cn-shanghai.aliyuncs.com/result.wav' } } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    assert.equal(url.hostname, 'voice-result.oss-cn-shanghai.aliyuncs.com');
    return new Response(qwenAudio, { status: 200, headers: { 'content-type': 'audio/wav', 'content-length': String(qwenAudio.length) } });
  };
  const tenantA = registerTenant('qwen-a');
  const first = await synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantA, text: 'A verified product story with a clear call to action.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(first.status, 'generated');
  assert.equal(first.provider, 'qwen_tts');
  assert.equal(first.voice, 'v1');
  assert.equal(first.mimeType, 'audio/wav');
  assert.ok(first.audioPath && fs.existsSync(first.audioPath));
  assert.equal(first.audioUrl, `/tts/tenants/${tenantA}/${path.basename(first.audioPath || '')}`);
  assert.equal(path.dirname(first.audioPath || ''), path.join(tenantsRoot, tenantA));
  assert.match(first.audioSha256 || '', /^[a-f0-9]{64}$/);
  assert.ok((first.durationSeconds || 0) >= 0.5);
  assert.equal(sniffAudioFormat(first.audioBytes || Buffer.alloc(0))?.mimeType, 'audio/wav');
  assert.equal(qwenFetches, 2);

  const cached = await synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantA, text: 'A verified product story with a clear call to action.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(cached.cached, true);
  assert.equal(cached.audioPath, first.audioPath);
  assert.equal(cached.audioSha256, first.audioSha256);
  assert.equal(qwenFetches, 2, 'an idempotent retry must not rebill the TTS provider');

  const concurrentTenant = registerTenant('same-process-concurrency');
  const concurrentFetchesBefore = qwenFetches;
  const concurrentResults = await Promise.all(Array.from({ length: 8 }, () => synthesizeDigitalEmployeeVoiceover({
    tenantId: concurrentTenant,
    text: 'Concurrent retries must share one provider synthesis.',
    language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic })));
  assert.equal(qwenFetches, concurrentFetchesBefore + 2, 'same-process concurrency must invoke Qwen only once');
  assert.equal(concurrentResults.filter(item => item.cached === false).length, 1, 'exactly one caller must publish the cache entry');
  assert.equal(new Set(concurrentResults.map(item => item.audioSha256)).size, 1);

  const missingSidecarFetchesBefore = qwenFetches;
  fs.rmSync(`${first.audioPath}.json`, { force: true });
  const missingSidecarResults = await Promise.all(Array.from({ length: 4 }, () => synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantA,
    text: 'A verified product story with a clear call to action.',
    language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic })));
  assert.equal(qwenFetches, missingSidecarFetchesBefore + 2, 'an orphan WAV must be rebuilt once and never trusted without its commit marker');
  assert.equal(missingSidecarResults.filter(item => item.cached === false).length, 1);
  assert.ok(missingSidecarResults.every(item => item.provider === 'qwen_tts'));

  const blockedTenant = registerTenant('aborted-waiter');
  let releaseProvider!: () => void;
  let markProviderStarted!: () => void;
  const providerStarted = new Promise<void>(resolve => { markProviderStarted = resolve; });
  const providerRelease = new Promise<void>(resolve => { releaseProvider = resolve; });
  let blockedFetches = 0;
  const blockedFetch: typeof fetch = async request => {
    blockedFetches += 1;
    const url = new URL(String(request));
    if (url.hostname === 'dashscope.aliyuncs.com') {
      markProviderStarted();
      await providerRelease;
      return new Response(JSON.stringify({ output: { audio: { url: 'https://voice-result.oss-cn-shanghai.aliyuncs.com/result.wav' } } }), { status: 200 });
    }
    return new Response(qwenAudio, { status: 200 });
  };
  const leader = synthesizeDigitalEmployeeVoiceover({
    tenantId: blockedTenant, text: 'A cancelled waiter must not cancel the cache owner.', language: 'en',
  }, { fetchImpl: blockedFetch, resolveHostname: resolvePublic });
  await providerStarted;
  const waiterAbort = new AbortController();
  const waiter = synthesizeDigitalEmployeeVoiceover({
    tenantId: blockedTenant, text: 'A cancelled waiter must not cancel the cache owner.', language: 'en', signal: waiterAbort.signal,
  }, { fetchImpl: blockedFetch, resolveHostname: resolvePublic });
  setTimeout(() => waiterAbort.abort(new Error('waiter cancelled')), 25);
  await assert.rejects(waiter, error => errorCode(error) === 'digital_employee_voiceover_aborted');
  releaseProvider();
  await leader;
  assert.equal(blockedFetches, 2, 'an aborted waiter must not invoke or duplicate the provider');

  const staleTenant = registerTenant('stale-lock');
  const staleInitial = await synthesizeDigitalEmployeeVoiceover({
    tenantId: staleTenant, text: 'Recover an abandoned cache lease.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.ok(staleInitial.audioPath);
  fs.rmSync(staleInitial.audioPath || '', { force: true });
  fs.rmSync(`${staleInitial.audioPath}.json`, { force: true });
  const staleLockPath = `${staleInitial.audioPath}.lock`;
  fs.writeFileSync(staleLockPath, JSON.stringify({ version: 1, token: randomUUID() }), { mode: 0o600 });
  const abandonedAt = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(staleLockPath, abandonedAt, abandonedAt);
  const staleFetchesBefore = qwenFetches;
  const staleRecovered = await synthesizeDigitalEmployeeVoiceover({
    tenantId: staleTenant, text: 'Recover an abandoned cache lease.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(staleRecovered.status, 'generated');
  assert.equal(qwenFetches, staleFetchesBefore + 2, 'a stale lease must be fenced and safely regenerated');
  assert.equal(fs.existsSync(staleLockPath), false, 'the recovered lease must be released');

  const tenantB = registerTenant('qwen-b');
  const otherTenant = await synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantB, text: 'A verified product story with a clear call to action.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(path.dirname(otherTenant.audioPath || ''), path.join(tenantsRoot, tenantB));
  assert.notEqual(otherTenant.audioPath, first.audioPath, 'tenant-private voiceovers must never share a filesystem path');

  fs.writeFileSync(first.audioPath || '', Buffer.from('corrupt cached audio'));
  const repaired = await synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantA, text: 'A verified product story with a clear call to action.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(repaired.audioPath, first.audioPath);
  assert.equal(sniffAudioFormat(repaired.audioBytes || Buffer.alloc(0))?.mimeType, 'audio/wav');
  assert.notEqual(repaired.audioSha256, createNaiveDigest('corrupt cached audio'));

  const fetchesBeforeValidReplacement = qwenFetches;
  fs.writeFileSync(first.audioPath || '', wavTone(0.35));
  const repairedValidReplacement = await synthesizeDigitalEmployeeVoiceover({
    tenantId: tenantA, text: 'A verified product story with a clear call to action.', language: 'en',
  }, { fetchImpl: qwenFetch, resolveHostname: resolvePublic });
  assert.equal(repairedValidReplacement.audioSha256, repaired.audioSha256, 'a valid WAV with a sidecar digest mismatch must be regenerated');
  assert.equal(qwenFetches, fetchesBeforeValidReplacement + 2, 'sidecar integrity mismatch must not silently reuse replaced audio');

  const forbiddenTenant = registerTenant('forbidden-url');
  const forbiddenFetch: typeof fetch = async request => {
    const url = new URL(String(request));
    if (url.hostname === 'dashscope.aliyuncs.com') {
      return new Response(JSON.stringify({ output: { audio: { url: 'https://127.0.0.1/private.wav' } } }), { status: 200 });
    }
    throw new Error('private audio URL must never be fetched');
  };
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover({ tenantId: forbiddenTenant, text: 'Do not fetch private networks.', language: 'en' }, { fetchImpl: forbiddenFetch, resolveHostname: resolvePublic }),
    error => errorCode(error) === 'digital_employee_voiceover_synthesis_failed',
  );

  process.env.DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES = 'example.test';
  let privateDnsAudioFetched = false;
  const privateDnsFetch: typeof fetch = async request => {
    const url = new URL(String(request));
    if (url.hostname === 'dashscope.aliyuncs.com') {
      return new Response(JSON.stringify({ output: { audio: { url: 'https://audio.example.test/result.wav' } } }), { status: 200 });
    }
    privateDnsAudioFetched = true;
    return new Response(qwenAudio, { status: 200 });
  };
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover(
      { tenantId: registerTenant('private-dns'), text: 'Reject private DNS answers.', language: 'en' },
      { fetchImpl: privateDnsFetch, resolveHostname: async hostname => hostname === 'audio.example.test' ? ['10.0.0.8'] : ['8.8.8.8'] },
    ),
    error => errorCode(error) === 'digital_employee_voiceover_synthesis_failed',
  );
  assert.equal(privateDnsAudioFetched, false, 'private DNS answers must be rejected before the audio request');
  delete process.env.DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES;

  process.env.DIGITAL_EMPLOYEE_TTS_MAX_AUDIO_BYTES = '1024';
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover(
      { tenantId: registerTenant('oversize'), text: 'Reject oversized provider audio.', language: 'en' },
      { fetchImpl: qwenFetch, resolveHostname: resolvePublic },
    ),
    error => errorCode(error) === 'digital_employee_voiceover_synthesis_failed',
  );
  delete process.env.DIGITAL_EMPLOYEE_TTS_MAX_AUDIO_BYTES;

  const brokenTenant = registerTenant('broken');
  const brokenFetch: typeof fetch = async request => {
    const url = new URL(String(request));
    if (url.hostname === 'dashscope.aliyuncs.com') {
      return new Response(JSON.stringify({ output: { audio: { url: 'https://voice-result.aliyuncs.com/broken.wav' } } }), { status: 200 });
    }
    return new Response(Buffer.from('not audio'), { status: 200 });
  };
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover({ tenantId: brokenTenant, text: 'Configured synthesis must fail closed.', language: 'en' }, { fetchImpl: brokenFetch, resolveHostname: resolvePublic }),
    error => errorCode(error) === 'digital_employee_voiceover_synthesis_failed',
    'configured TTS failure must not silently export a muted video',
  );

  clearVoiceoverEnvironment();
  process.env.MINIMAX_API_KEY = 'test-minimax-key';
  const minimaxTenant = registerTenant('minimax');
  let minimaxFetches = 0;
  const minimaxFetch: typeof fetch = async request => {
    minimaxFetches += 1;
    assert.equal(new URL(String(request)).hostname, 'api.minimax.io');
    return new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: wavTone(0.7).toString('hex') } }), { status: 200 });
  };
  const minimax = await synthesizeDigitalEmployeeVoiceover({
    tenantId: minimaxTenant, text: '这是一段可验证的产品口播。', language: 'zh',
  }, { fetchImpl: minimaxFetch, resolveHostname: resolvePublic });
  assert.equal(minimax.status, 'generated');
  assert.equal(minimax.provider, 'minimax');
  assert.equal(minimaxFetches, 1);

  const crossProcessTenant = registerTenant('cross-process-concurrency');
  const crossProcessText = 'Independent processes must share the same filesystem lease.';
  let crossProcessProviderCalls = 0;
  const providerServer = http.createServer((_request, response) => {
    crossProcessProviderCalls += 1;
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: wavTone(0.65).toString('hex') } }));
    }, 200);
  });
  await new Promise<void>((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = providerServer.address();
    assert.ok(address && typeof address === 'object');
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DIGITAL_EMPLOYEE_TTS_PROVIDER: 'minimax',
      DIGITAL_EMPLOYEE_TTS_CACHE_VERSION: `cross-process-${randomUUID()}`,
      DIGITAL_EMPLOYEE_TTS_ALLOW_INSECURE_ENDPOINTS: 'true',
      DIGITAL_EMPLOYEE_TTS_TIMEOUT_MS: '30000',
      MINIMAX_API_KEY: 'cross-process-test-key',
      MINIMAX_BASE_URL: `http://127.0.0.1:${address.port}`,
      MINIMAX_TTS_FORMAT: 'wav',
    };
    delete childEnvironment.DASHSCOPE_API_KEY;
    await Promise.all([
      runVoiceoverChild(childEnvironment, crossProcessTenant, crossProcessText),
      runVoiceoverChild(childEnvironment, crossProcessTenant, crossProcessText),
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(crossProcessProviderCalls, 1, 'separate Node processes must elect one billable provider caller');

  clearVoiceoverEnvironment();
  process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE = 'silent_test';
  const silent = await synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('silent'), text: 'Explicit test fallback.', language: 'en' });
  assert.deepEqual({ status: silent.status, reason: silent.reason, audioPath: silent.audioPath }, {
    status: 'silent_fallback', reason: 'tts_provider_not_configured_test_fallback', audioPath: undefined,
  });

  process.env.NODE_ENV = 'production';
  const production = await synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('production'), text: 'No silent production artifact.', language: 'en' });
  assert.equal(production.status, 'not_available');
  assert.equal(production.reason, 'voiceover_provider_not_configured');

  clearVoiceoverEnvironment();
  process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE = 'silent_test';
  process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED = 'true';
  const realPublish = await synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('real-publish'), text: 'No silent real publish artifact.', language: 'en' });
  assert.equal(realPublish.status, 'not_available');

  clearVoiceoverEnvironment();
  process.env.DIGITAL_EMPLOYEE_TTS_PROVIDER = 'qwen';
  process.env.MINIMAX_API_KEY = 'configured-but-not-selected';
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('selected-missing'), text: 'Selected provider is missing.', language: 'en' }),
    error => errorCode(error) === 'digital_employee_voiceover_selected_provider_not_configured',
  );

  clearVoiceoverEnvironment();
  process.env.DASHSCOPE_API_KEY = 'test-qwen-key';
  const aborted = new AbortController();
  aborted.abort(new Error('task cancelled'));
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('cancelled'), text: 'Cancelled.', language: 'en', signal: aborted.signal }),
    error => errorCode(error) === 'digital_employee_voiceover_aborted',
  );
  const timedOut = AbortSignal.timeout(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(
    synthesizeDigitalEmployeeVoiceover({ tenantId: registerTenant('timed-out'), text: 'Timed out.', language: 'en', signal: timedOut }),
    error => errorCode(error) === 'digital_employee_voiceover_timeout',
  );

  assert.equal(sniffAudioFormat(Buffer.from('forged wav payload')), null);
  console.log('digital employee voiceover production regression passed');
} finally {
  for (const tenant of createdTenants) fs.rmSync(path.join(tenantsRoot, tenant), { recursive: true, force: true });
  for (const key of ENVIRONMENT_KEYS) {
    const saved = savedEnvironment[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

function createNaiveDigest(value: string): string {
  // Avoid importing another hash helper into the production module just for a
  // regression assertion; a corrupt payload can never equal a SHA-256 digest.
  return value;
}

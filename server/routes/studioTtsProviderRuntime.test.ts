import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioTtsProviderRuntime } from './studioTtsProviderRuntime.js';
import { withStudioVoicePaidContext, type StudioVoicePaidContext } from '../lib/studioVoicePaidOperation.js';

const runtime = createStudioTtsProviderRuntime({
  voiceSamplesRoot: '/unused/voice-samples',
  ttsRoot: '/unused/tts',
  scopedStudioAssetDir: root => root,
  scopedStudioAssetUrl: (_prefix, file) => `/tts/${file}`,
  runFfmpeg: async () => { throw new Error('ffmpeg must not run'); },
});

test('extracted provider runtime preserves pure speech parsing and language mapping', () => {
  assert.equal(runtime.spokenText('[0-2s] 镜头：产品特写\n[2-4s] 口播：这款产品很好\n音效：咚咚'), '这款产品很好');
  assert.equal(runtime.qwenTtsLanguageType('en'), 'English');
  assert.equal(runtime.qwenTtsLanguageType('unsupported'), '');
  assert.match(runtime.minimaxEndpoint('/v1/get_voice', { MINIMAX_BASE_URL: 'https://api.minimax.io' }), /^https:\/\/api\.minimax\.io\/v1\/get_voice/);
});

test('paid Qwen provider cannot submit without the existing frozen permit context', async () => {
  const priorKey = process.env.DASHSCOPE_API_KEY;
  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  process.env.DASHSCOPE_API_KEY = 'offline-test-key';
  globalThis.fetch = (async () => { networkCalls++; throw new Error('network forbidden'); }) as typeof fetch;
  const context: StudioVoicePaidContext = {
    primaryProvider: 'qwen',
    forRequest: async () => { throw new Error('frozen_voice_paid_permit_missing'); },
  };
  try {
    await assert.rejects(
      withStudioVoicePaidContext(context, () => runtime.generateQwenTts('Approved text', 'v1', 'en')),
      /frozen_voice_paid_permit_missing/,
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = priorKey;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioVoiceAutomation } from './studioVoiceAutomation.js';
import type { createStudioTtsProviderRuntime } from './studioTtsProviderRuntime.js';
import type { createStudioTtsGeneration } from './studioTtsGeneration.js';

test('automation voice plan freezes physical provider before any synthesis', async () => {
  let providerCalls = 0;
  const automation = createStudioVoiceAutomation({
    runTenant: (_tenantId, run) => run(),
    tenantTtsDir: () => { throw new Error('tenant files must not be touched'); },
    ttsUrl: file => `/tts/${file}`,
    persistPrivateTtsAsset: async () => { throw new Error('storage must not be touched'); },
    execFileAsync: async () => { throw new Error('ffmpeg must not run'); },
    ffmpegBin: 'unused',
    providers: {
      minimaxEndpoint: () => 'https://api.minimax.io/v1/t2a_v2',
      qwenTtsLanguageType: () => 'English',
      voiceSamplePathFromId: () => null,
      minimaxVoiceCacheKey: () => '',
      readMinimaxVoiceCache: () => ({}),
    } as unknown as ReturnType<typeof createStudioTtsProviderRuntime>,
    generation: {
      readStudioNativeTtsCache: () => null,
      generateTtsAudio: async () => { providerCalls++; throw new Error('provider must not run'); },
      proportionalCues: () => [],
    } as unknown as ReturnType<typeof createStudioTtsGeneration>,
  });
  const plan = automation.resolveStudioVoiceExecutionPlan({
    tenantId: 'tenant-a', text: 'Exact English speech.', voice: 'v1', language: 'en', nativeProvider: 'qwen',
    env: { DASHSCOPE_API_KEY: 'offline-test-key', QWEN_TTS_MODEL: 'qwen3-tts-flash' },
  });
  assert.equal(plan.primary?.provider, 'qwen');
  assert.deepEqual(plan.primary?.texts, ['Exact English speech.']);
  assert.equal(plan.fallback, null);
  assert.equal(providerCalls, 0);
  assert.equal((await automation.synthesizeStudioVoiceForAutomation({ tenantId: 'tenant-a', text: '' })).ok, false);
  assert.equal(providerCalls, 0);
});

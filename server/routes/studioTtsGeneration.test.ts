import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioTtsGeneration } from './studioTtsGeneration.js';
import type { createStudioTtsProviderRuntime } from './studioTtsProviderRuntime.js';

test('generation boundary preserves unsupported-language stop and proportional subtitle order offline', async () => {
  let providerCalls = 0;
  const providers = {
    minimaxCredentialUsable: () => false,
    qwenTtsLanguageType: () => '',
    generateQwenTts: async () => { providerCalls++; return null; },
    generateMinimaxTts: async () => { providerCalls++; return null; },
  } as unknown as ReturnType<typeof createStudioTtsProviderRuntime>;
  const generation = createStudioTtsGeneration({
    currentTenantId: () => undefined,
    tenantTtsDir: () => { throw new Error('tenant files must not be read'); },
    scopedTtsDir: () => { throw new Error('tenant files must not be read'); },
    ttsUrl: file => `/tts/${file}`,
    localTtsPorts: {
      ttsDir: () => { throw new Error('local TTS must not run'); },
      ttsUrl: file => `/tts/${file}`,
      voiceSamplePath: () => null,
      runFfmpeg: async () => { throw new Error('ffmpeg must not run'); },
    },
    providers,
  });
  const result = await generation.generateTtsAudio('Hello', 'v1', 'unsupported');
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unsupported_language');
  assert.equal(providerCalls, 0);
  assert.equal(generation.localTtsFile('https://example.com/audio.wav'), null);
  const cues = generation.proportionalCues('First sentence. Second sentence.', 4);
  assert.equal(cues.length, 2);
  assert.ok(cues[0]!.start < cues[0]!.end && cues[0]!.end <= cues[1]!.start);
  assert.equal(cues[1]!.end, 4);
});

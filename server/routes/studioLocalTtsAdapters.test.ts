import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLocalSayTts, generatePiperTts, generateXttsCloneTts, type LocalTtsPorts } from './studioLocalTtsAdapters.js';

test('unconfigured local voice engines do not touch tenant files or invoke media conversion', async () => {
  const accessed: string[] = [];
  const ports: LocalTtsPorts = {
    ttsDir: () => { accessed.push('ttsDir'); throw Error('unexpected_tenant_access'); },
    ttsUrl: () => { accessed.push('ttsUrl'); throw Error('unexpected_asset_access'); },
    voiceSamplePath: () => { accessed.push('voiceSamplePath'); throw Error('unexpected_sample_access'); },
    runFfmpeg: async () => { accessed.push('ffmpeg'); throw Error('unexpected_media_conversion'); },
  };
  assert.equal(await generatePiperTts('hello', 'en', ports, {}), null);
  assert.equal(await generateXttsCloneTts('hello', 'custom:v1', 'en', ports, {}), null);
  assert.equal(await generateLocalSayTts('hello', 'v1', 'en', ports, 'linux'), null);
  assert.deepEqual(accessed, []);
});

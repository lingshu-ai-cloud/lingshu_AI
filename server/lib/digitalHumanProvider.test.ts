import assert from 'node:assert/strict';
import { HeyGenV3Provider, DigitalHumanProviderConfigurationError, selectDigitalHumanProvider } from './digitalHumanProvider.js';

assert.throws(() => selectDigitalHumanProvider({ mode: 'quality', binding: {}, localPullWorkerReady: true, localDirectConfigured: true }), (error: any) => {
  assert.equal(error.code, 'HEYGEN_NOT_CONFIGURED');
  assert.match(error.message, /未降级到本地/);
  return true;
});
assert.deepEqual(selectDigitalHumanProvider({
  mode: 'quality', heygenApiKey: 'secret', localPullWorkerReady: true, localDirectConfigured: true, durationSeconds: 15,
  binding: { heygen: { avatarId: 'avatar-1', voiceId: 'voice-1', supportedEngines: ['avatar_v', 'avatar_iv'] } },
}), {
  provider: 'heygen', engine: 'avatar_v', externalAvatarId: 'avatar-1', externalVoiceId: 'voice-1',
  estimatedCostCredits: 1.5, routingReason: 'quality_mode_avatar_v_supported',
});
assert.equal(selectDigitalHumanProvider({
  mode: 'quality', heygenApiKey: 'secret', localPullWorkerReady: false, localDirectConfigured: false,
  binding: { heygen: { avatarId: 'avatar-1', voiceId: 'voice-1', supportedEngines: ['avatar_iv'] } },
}).engine, 'avatar_iv');
assert.equal(selectDigitalHumanProvider({ mode: 'fast', localPullWorkerReady: true, localDirectConfigured: false }).provider, 'local-worker');

const requests: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), init });
  if (String(url).includes('/v3/avatars/looks/')) return new Response(JSON.stringify({ data: { supported_api_engines: ['avatar_v', 'avatar_iv'] } }), { status: 200 });
  if (String(url).endsWith('/v3/videos') && init?.method === 'POST') return new Response(JSON.stringify({ data: { video_id: 'video-1' } }), { status: 200 });
  return new Response(JSON.stringify({ data: { status: 'completed', video_url: 'https://files.heygen.com/output.mp4' } }), { status: 200 });
};
const provider = new HeyGenV3Provider({ apiKey: 'test-key' }, fakeFetch as typeof fetch);
const submitted = await provider.submit({
  externalJobId: 'job-1', script: 'Hello', language: 'en',
  selection: { provider: 'heygen', engine: 'avatar_v', externalAvatarId: 'avatar-1', externalVoiceId: 'voice-1', routingReason: 'test' },
});
assert.equal(submitted.id, 'video-1');
const createRequest = requests.find(item => item.url.endsWith('/v3/videos') && item.init?.method === 'POST')!;
const createBody = JSON.parse(String(createRequest.init?.body));
assert.equal(createBody.engine.type, 'avatar_v');
assert.equal(createBody.aspect_ratio, '9:16');
assert.equal((createRequest.init?.headers as Record<string, string>)['x-api-key'], 'test-key');
assert.equal((await provider.get('video-1')).outputUrl, 'https://files.heygen.com/output.mp4');
assert.throws(() => new HeyGenV3Provider({ apiKey: '' }), DigitalHumanProviderConfigurationError);

console.log('digital human provider tests passed');

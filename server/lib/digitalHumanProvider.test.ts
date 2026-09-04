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
for (const mode of ['fast', 'quality'] as const) {
  assert.equal(selectDigitalHumanProvider({mode, computeTarget: 'local-pull', heygenApiKey: 'mock', localPullWorkerReady: true, localDirectConfigured: true}).provider, 'local-worker');
  assert.throws(() => selectDigitalHumanProvider({mode, computeTarget: 'local-pull', heygenApiKey: 'mock', localPullWorkerReady: false, localDirectConfigured: true}), (error: any) => error.code === 'LOCAL_WORKER_UNAVAILABLE');
}
assert.throws(() => selectDigitalHumanProvider({mode: 'quality', computeTarget: 'typo', localPullWorkerReady: true, localDirectConfigured: true}), (error: any) => error.code === 'INVALID_COMPUTE_TARGET');
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

let consentApproved = false;
let creationBody: any;
const lifecycle = new HeyGenV3Provider({ apiKey: 'mock-only' }, (async (url, init) => {
  const route = String(url);
  let data: any;
  if (route.endsWith('/v3/avatars')) {
    creationBody = JSON.parse(String(init?.body));
    assert.equal((init?.headers as any)['Idempotency-Key'], 'stable-request');
    data = {avatar_group: {id: 'group'}, avatar_item: {id: 'look'}};
  } else if (route.endsWith('/v3/assets')) {
    assert.ok(init?.body instanceof FormData);
    assert.equal((init?.headers as any)['content-type'], undefined, 'multipart boundary must be set by fetch');
    assert.ok(init.body.get('file') instanceof Blob);
    data = {asset_id: 'consent-asset'};
  } else if (route.endsWith('/consent')) {
    assert.deepEqual(JSON.parse(String(init?.body)), {consent_video: {type: 'asset_id', asset_id: 'consent-asset'}});
    data = {avatar_group: {id: 'group', consent_status: 'pending'}};
  }
  else if (route.includes('/looks/')) data = {id: 'look', status: 'completed', default_voice_id: 'voice', supported_api_engines: ['avatar_v']};
  else data = {status: 'completed', consent_status: consentApproved ? 'approved' : 'pending'};
  return new Response(JSON.stringify({data}), {status: 200});
}) as typeof fetch);
assert.deepEqual(await lifecycle.createPerson('Person', 'mock-video', 'video/mp4', 'stable-request'), {groupId: 'group', lookId: 'look'});
assert.equal(creationBody.type, 'digital_twin');
assert.equal(creationBody.file.type, 'base64');
assert.equal((await lifecycle.personStatus('group', 'look')).ready, false);
assert.equal(await lifecycle.uploadPersonConsent(new Uint8Array([1, 2]), 'video/webm', 'consent-request'), 'consent-asset');
assert.equal(await lifecycle.submitPersonConsent('group', 'consent-asset', 'consent-request'), 'pending');
const unsupported = new HeyGenV3Provider({apiKey: 'mock-only'}, (async () => new Response(JSON.stringify({data: {url: 'https://heygen.com/consent/mock', avatar_group: {id: 'group'}}}))) as typeof fetch);
await assert.rejects(unsupported.submitPersonConsent('group', 'consent-asset', 'test'), (error: any) => error.code === 'IN_APP_CONSENT_UNAVAILABLE');
consentApproved = true;
assert.equal((await lifecycle.personStatus('group', 'look')).ready, true);
console.log('person lifecycle mock integration passed');

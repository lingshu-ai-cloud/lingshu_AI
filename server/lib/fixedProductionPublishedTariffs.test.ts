import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFixedProductionPublishedTariff, verifyFixedProductionPublishedTariff } from './fixedProductionPublishedTariffs.js';
import { createSocialContentTaskBudgetAuthority } from './socialContentTaskBudgetAuthority.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const credentialSha256 = 'a'.repeat(64);
const now = new Date('2026-10-30T12:00:00.000Z');
const account = (provider: string, baseUrl: string) => `${provider}:${sha(JSON.stringify({ baseUrl, credentialSha256 }))}`;

test('fixed Wan and Seedream tariffs require exact account binding and include the estimate buffer', () => {
  const wanBase = 'https://dashscope.aliyuncs.com/api/v1';
  const wanIntent = { operationId: 'wan-video', provider: 'wan', model: 'wan2.6-i2v-flash', accountRef: account('wan', wanBase),
    stage: 'video', shotId: 'S01', inputContractHash: 'b'.repeat(64), maximumUnits: { providerSeconds: 5 } };
  const wan = readFixedProductionPublishedTariff(wanIntent, { baseUrl: wanBase, credentialSha256 }, now);
  assert.ok(wan); assert.equal(wan.meters.providerSeconds?.priceCny, 0.1875); assert.equal(verifyFixedProductionPublishedTariff(wan), true);
  assert.equal(readFixedProductionPublishedTariff({ ...wanIntent, accountRef: 'foreign' }, { baseUrl: wanBase, credentialSha256 }, now), null);

  const seedreamBase = 'https://ark.cn-beijing.volces.com/api/v3';
  const seedream = readFixedProductionPublishedTariff({ operationId: 'image', provider: 'seedream', model: 'doubao-seedream-5-0-pro-260628',
    accountRef: account('seedream', seedreamBase), stage: 'first_frame', shotId: 'S01', inputContractHash: 'c'.repeat(64),
    maximumUnits: { inputImages: 2, outputImages: 1 } }, { baseUrl: seedreamBase, credentialSha256 }, now);
  assert.ok(seedream); assert.equal(seedream.meters.outputImages?.priceCny, 0.75); assert.equal(seedream.meters.inputImages?.priceCny, 0.025);

  const seedance = readFixedProductionPublishedTariff({ operationId: 'seedance', provider: 'seedance', model: 'doubao-seedance-2-0-fast-260128',
    accountRef: account('seedance', seedreamBase), stage: 'video', shotId: 'S01', inputContractHash: '9'.repeat(64),
    maximumUnits: { outputTokens: 100_000 } }, { baseUrl: seedreamBase, credentialSha256 }, now);
  assert.ok(seedance); assert.equal(seedance.meters.outputTokens?.priceCny, 46.25);
});
test('fixed Qwen voice prices use characters or audio seconds without a network lookup', () => {
  const ttsBase = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const tts = readFixedProductionPublishedTariff({ operationId: 'tts', provider: 'qwen', model: 'qwen3-tts-flash',
    accountRef: account('qwen', ttsBase), stage: 'tts', shotId: null, inputContractHash: '7'.repeat(64),
    maximumUnits: { characters: 300 } }, { baseUrl: ttsBase, credentialSha256 }, now);
  assert.ok(tts); assert.equal(tts.meters.characters?.priceCny, 1);
  const asrBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const asr = readFixedProductionPublishedTariff({ operationId: 'asr', provider: 'qwen', model: 'qwen3-asr-flash',
    accountRef: account('qwen', asrBase), stage: 'voice_asr', shotId: null, inputContractHash: '8'.repeat(64),
    maximumUnits: { audioSeconds: 12 } }, { baseUrl: asrBase, credentialSha256 }, now);
  assert.ok(asr); assert.equal(asr.meters.audioSeconds?.priceCny, 0.000275);
});

test('fixed HeyGen supports published Avatar IV and Starfish prices but refuses Orca', () => {
  const baseUrl = 'https://api.heygen.com/v3/videos', accountRef = account('heygen', baseUrl);
  const avatar = readFixedProductionPublishedTariff({ operationId: 'avatar', provider: 'heygen', model: 'avatar_iv', accountRef,
    stage: 'presenter_video', shotId: 'S01', inputContractHash: 'd'.repeat(64), maximumUnits: { providerSeconds: 12 } },
  { baseUrl, credentialSha256, accountRef, avatarType: 'photo_avatar' }, now);
  assert.ok(avatar); assert.equal(avatar.meters.providerSeconds?.priceCny, 2.31 * 6.6 * 1.25);
  const voiceBase = 'https://api.heygen.com/v3/voices/speech', voiceAccount = account('heygen', voiceBase);
  assert.equal(readFixedProductionPublishedTariff({ operationId: 'orca', provider: 'heygen', model: 'orca', accountRef: voiceAccount,
    stage: 'tts', shotId: null, inputContractHash: 'e'.repeat(64), maximumUnits: { audioSeconds: 10 } },
  { baseUrl: voiceBase, credentialSha256, accountRef: voiceAccount }, now), null);
});

test('formal paid authority accepts the fixed account-bound catalogue ceiling', async () => {
  const baseUrl = 'https://dashscope.aliyuncs.com/api/v1';
  const intent = { operationId: 'wan-video', provider: 'wan', model: 'wan2.6-i2v-flash', accountRef: account('wan', baseUrl),
    stage: 'video', shotId: 'S01', inputContractHash: 'f'.repeat(64), maximumUnits: { providerSeconds: 5 } };
  const tariff = readFixedProductionPublishedTariff(intent, { baseUrl, credentialSha256 }, now); assert.ok(tariff);
  const scope = { tenantId: 'tenant', taskId: 'task', runId: 'run', planHash: '1'.repeat(64) };
  const authority = createSocialContentTaskBudgetAuthority({ ports: { assertCurrent: async () => {}, verifyRejection: async () => false,
    readApprovedPlan: async () => ({ scope, authorizationRef: 'fixed-price-catalog', maximumCny: 10, paidOperations: [intent] }),
    readVerifiedTariff: async () => tariff } });
  assert.equal((await authority.prepare(scope)).quotes.get(intent.operationId)?.upperBoundCny, 0.9375);
});

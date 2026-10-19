import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneVolcengineVoice } from './volcengineVoiceClone.js';

test('Doubao voice clone registers one reusable speaker from the retained recording', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const result = await cloneVolcengineVoice({
    apiKey: 'controlled-test-key', speakerId: 'lingshu_presenter_12345678', audio: Buffer.from('ID3-valid-audio'), language: 'zh-CN', requestId: 'request-1',
    transport: (async (url, init) => { request = { url: String(url), init }; return Response.json({ code: 20000000, message: 'OK' }); }) as typeof fetch,
  });
  assert.deepEqual(result, { speakerId: 'lingshu_presenter_12345678', status: 'processing' });
  assert.equal(request?.url, 'https://openspeech.bytedance.com/api/v3/tts/voice_clone');
  const headers = new Headers(request?.init?.headers); assert.equal(headers.get('X-Api-Key'), 'controlled-test-key');
  const body = JSON.parse(String(request?.init?.body));
  assert.equal(body.speaker_id, 'custom_speaker_id'); assert.equal(body.custom_speaker_id, 'lingshu_presenter_12345678'); assert.equal(body.language, 0); assert.equal(body.audio.format, 'mp3');
});

test('Doubao voice clone is never called without its separate voice entitlement', async () => {
  let calls = 0;
  await assert.rejects(cloneVolcengineVoice({ apiKey: '', speakerId: 'lingshu_presenter_12345678', audio: Buffer.from('audio'), language: 'zh-CN', transport: (async () => { calls += 1; return Response.json({}); }) as typeof fetch }), /API Key 未配置/);
  assert.equal(calls, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePosterImage, ImageProviderRejectedError } from './imageGen.js';

test('Qwen Image rebuilds a poster from ordered reference images and downloads the returned result', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.DASHSCOPE_IMAGE_BASE_URL = 'https://dashscope.example/compatible-mode/v1';
    process.env.QWEN_IMAGE_MODEL = 'qwen-image-3.0';
    delete process.env.SEEDREAM_IMAGE_ENABLED;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ url: 'https://image.example/result.png' }] });
      return new Response(Buffer.from('image-output'), { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const result = await generatePosterImage({ prompt: '保持构图，替换人物', ratio: '9:16', references: [
      { mimeType: 'image/jpeg', base64: 'c291cmNl' }, { mimeType: 'image/jpeg', base64: 'cHJlc2VudGVy' },
    ] });
    assert.equal(result.source, 'qwen');
    assert.equal(result.model, 'qwen-image-3.0');
    assert.equal(result.bytes.toString(), 'image-output');
    const request = JSON.parse(String(calls[0]!.init?.body));
    assert.deepEqual(request.image, ['data:image/jpeg;base64,c291cmNl', 'data:image/jpeg;base64,cHJlc2VudGVy']);
    assert.equal(request.size, '1024*1792');
    assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('Qwen Image caps ordered references at the provider limit of three', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.DASHSCOPE_IMAGE_BASE_URL = 'https://dashscope.example/compatible-mode/v1';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ url: 'https://image.example/result.png' }] });
      return new Response(Buffer.from('image-output'), { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    await generatePosterImage({ prompt: 'test', ratio: '9:16', references: [
      { mimeType: 'image/jpeg', base64: 'MQ==' }, { mimeType: 'image/jpeg', base64: 'Mg==' },
      { mimeType: 'image/jpeg', base64: 'Mw==' }, { mimeType: 'image/jpeg', base64: 'NA==' },
    ] });
    const request = JSON.parse(String(calls[0]!.init?.body));
    assert.deepEqual(request.image, ['data:image/jpeg;base64,MQ==', 'data:image/jpeg;base64,Mg==', 'data:image/jpeg;base64,Mw==']);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('poster generation never falls back to another supplier after a Qwen failure', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.DASHSCOPE_IMAGE_BASE_URL = 'https://dashscope.example/compatible-mode/v1';
    process.env.SEEDREAM_IMAGE_ENABLED = 'true';
    globalThis.fetch = (async () => { calls++; return Response.json({ message: 'rejected' }, { status: 400 }); }) as typeof fetch;
    await assert.rejects(() => generatePosterImage({ prompt: 'test', ratio: '1:1' }),
      error => error instanceof ImageProviderRejectedError && error.statusCode === 400 && /Qwen Image 400: rejected/.test(error.message));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

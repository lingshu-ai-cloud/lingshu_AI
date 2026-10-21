import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePosterImage, ImageProviderRejectedError, openAiImageOutput, openAiImageStreamOutput } from './imageGen.js';

test('OpenAI image output parser accepts legacy, completion-event, and URL response shapes', () => {
  assert.deepEqual(openAiImageOutput({ data: [{ b64_json: 'legacy' }] }), { base64: 'legacy' });
  assert.deepEqual(openAiImageOutput({ type: 'image_generation.completed', b64_json: 'completed' }), { base64: 'completed' });
  assert.deepEqual(openAiImageOutput({ output: [{ type: 'image_generation.completed', b64_json: 'output' }] }), { base64: 'output' });
  assert.deepEqual(openAiImageOutput({ data: [{ url: 'https://image.example/result.png' }] }), { url: 'https://image.example/result.png' });
  assert.deepEqual(openAiImageOutput({ url: 'data:image/png;base64,ZGF0YQ==' }), { base64: 'ZGF0YQ==' });
  assert.deepEqual(openAiImageOutput({ message: 'no image' }), {});
});

test('OpenAI image stream parser keeps the final completed image', () => {
  const partial = Buffer.from('partial').toString('base64');
  const completed = Buffer.from('completed').toString('base64');
  const stream = [
    `event: image_generation.partial_image\ndata: ${JSON.stringify({ type: 'image_generation.partial_image', b64_json: partial })}`,
    `event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', b64_json: completed })}`,
    'data: [DONE]',
  ].join('\n\n');
  assert.deepEqual(openAiImageStreamOutput(stream), { base64: completed });
});

test('GPT Image 2 downloads HTTPS URL output when the provider does not return base64', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.OPENAI_BASE_URL = 'https://openai.example/v1';
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ url: 'https://image.example/result.png' }] });
      return new Response(Buffer.from('url-image-output'), { headers: { 'content-type': 'image/webp' } });
    }) as typeof fetch;
    const result = await generatePosterImage({ prompt: 'product poster', ratio: '1:1', provider: 'openai' });
    assert.deepEqual(calls, ['https://openai.example/v1/images/generations', 'https://image.example/result.png']);
    assert.equal(result.bytes.toString(), 'url-image-output');
    assert.equal(result.mimeType, 'image/webp');
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

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
    assert.equal(request.size, '1024x1792');
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

test('GPT Image 2 defaults to low quality and returns base64 image output', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.OPENAI_BASE_URL = 'https://openai.example/v1';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const payload = JSON.stringify({ type: 'image_generation.completed', b64_json: Buffer.from('openai-image-output').toString('base64') });
      return new Response(`event: image_generation.completed\ndata: ${payload}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const result = await generatePosterImage({ prompt: 'product poster', ratio: '4:5', provider: 'openai' });
    assert.equal(result.source, 'openai');
    assert.equal(result.model, 'gpt-image-2');
    assert.equal(result.bytes.toString(), 'openai-image-output');
    assert.equal(calls[0]?.url, 'https://openai.example/v1/images/generations');
    const request = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(request.model, 'gpt-image-2');
    assert.equal(request.quality, 'low');
    assert.equal(request.size, '1024x1536');
    assert.equal(request.output_format, 'png');
    assert.equal(request.stream, true);
    assert.equal(request.partial_images, 0);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('GPT Image 2 uses the requested quality and edit endpoint for references', async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.OPENAI_BASE_URL = 'https://openai.example/v1';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ data: [{ b64_json: Buffer.from('edited-image').toString('base64') }] });
    }) as typeof fetch;
    await generatePosterImage({
      prompt: 'edit product poster', ratio: '16:9', provider: 'openai', quality: 'high',
      references: [{ mimeType: 'image/jpeg', base64: 'MQ==' }, { mimeType: 'image/png', base64: 'Mg==' }],
    });
    assert.equal(calls[0]?.url, 'https://openai.example/v1/images/edits');
    const request = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(request.quality, 'high');
    assert.equal(request.size, '1536x1024');
    assert.deepEqual(request.images, [
      { image_url: 'data:image/jpeg;base64,MQ==' },
      { image_url: 'data:image/png;base64,Mg==' },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

import assert from 'node:assert/strict';
import { studioApi, type RenderSpec } from './studioApi.js';
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const spec = { materials: [], script: '', voice: '', bgm: '', bgmVol: 0, voiceVol: 100, coverId: '', coverTitle: '', ratio: '9:16', duration: 1, platform: 'tiktok', language: 'en' } as RenderSpec;
try {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/retry')) return new Response(JSON.stringify({ ok: true, job: { id: 'j', status: 'queued' } }), { status: 202 });
    if (url.includes('/latest')) return new Response(JSON.stringify({ ok: true, job: { id: 'j', status: 'processing', progress: 15 } }));
    return new Response(JSON.stringify({ ok: true, job: { id: 'j', status: 'queued' } }), { status: 202 });
  };
  assert.equal((await studioApi.createRenderJob({ projectId: 'p', outputKey: 'v:en', inputSignature: 'sig', spec })).job?.id, 'j');
  assert.deepEqual(calls[0]?.body, { projectId: 'p', outputKey: 'v:en', inputSignature: 'sig', spec });
  assert.equal((await studioApi.latestRenderJob('p')).job?.status, 'processing');
  assert.equal((await studioApi.retryRenderJob('j')).job?.status, 'queued');
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST']);
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
}

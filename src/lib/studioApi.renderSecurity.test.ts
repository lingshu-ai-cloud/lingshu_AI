import assert from 'node:assert/strict';
import { studioApi, type RenderManifest, type RenderSpec } from './studioApi.js';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const spec: RenderSpec = {
  materials: ['shot'], script: 'voice', voice: 'v1', bgm: '', bgmVol: 0, voiceVol: 100,
  coverId: '', coverTitle: '', ratio: '9:16', duration: 3, platform: 'tiktok', language: 'en',
};
const manifest = { jobId: 'test-render' } as RenderManifest;

try {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(studioApi.render(spec), /Failed to fetch/, 'rendering must fail closed when authorization is unavailable');
  assert.equal(calls, 1);
  assert.deepEqual(await studioApi.renderLocal(manifest, null), {
    ok: false, error: '缺少服务端签发的渲染授权，请重试',
  });
  assert.equal(calls, 1, 'a missing token must not call the render endpoint');

  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), { manifest, token: 'signed-token' });
    return new Response(JSON.stringify({ ok: true, outputPath: '/tmp/test.mp4' }), { status: 200 });
  };
  const result = await studioApi.renderLocal(manifest, 'signed-token');
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

import assert from 'node:assert/strict';
import { studioApi } from './studioApi.js';

const previousFetch = globalThis.fetch;
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
try {
  for (const failure of [
    { error: '上游模型额度不足，未生成脚本。', code: 'UPSTREAM_QUOTA_EXHAUSTED', retryable: false },
    { error: '上游模型授权暂不可用，未生成脚本。', code: 'UPSTREAM_AUTH_UNAVAILABLE', retryable: false },
    { error: '上游模型额度不足，未生成脚本。' },
  ]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ source: 'ai_failed', script: '', ...failure }), { status: 502 }); };
    const result = await studioApi.script({ materials: [], language: 'zh', platform: 'tiktok', duration: 15 }, '');
    assert.equal(calls, 1, 'terminal upstream failures must not be resubmitted');
    assert.equal(result.source, 'ai_failed');
    assert.equal(result.error, failure.error);
    assert.equal(result.ok, false);
    assert.equal(result.publishable, false);
    assert.equal(result.script, '');
  }

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const covers = await studioApi.covers(
    { script: 'verified source text', productInfo: 'verified product', language: 'en' },
    ['Low MOQ', 'Fast Turnaround'],
  );
  assert.equal(covers.ok, false, 'network failure must be an explicit generation failure');
  assert.equal(covers.source, 'ai_failed');
  assert.equal(covers.provenance, 'ai_failed');
  assert.equal(covers.publishable, false);
  assert.deepEqual(covers.covers, [], 'caller fallback titles must never masquerade as generated output');

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    source: 'fallback',
    caption: 'FDA-ready with fast turnaround',
    hashtags: ['fda'],
  }), { status: 200 });
  const caption = await studioApi.caption({ productInfo: 'product', platform: 'facebook', language: 'en' }, {
    caption: 'old local caption', hashtags: ['old'],
  });
  assert.equal(caption.ok, false, 'legacy HTTP-200 fallback payloads must be downgraded');
  assert.equal(caption.source, 'ai_failed');
  assert.equal(caption.caption, '');
  assert.deepEqual(caption.hashtags, []);

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    source: 'ai_rejected',
    code: 'UNVERIFIED_COMMERCIAL_CLAIMS',
    error: 'unverified claim',
    fieldsToConfirm: ['MOQ / 起订量'],
  }), { status: 422 });
  const poster = await studioApi.fbPoster({
    mode: 'product', productInfo: 'product', platform: 'facebook', ratio: '4:5', posterStyle: 'clean', language: 'en',
  });
  assert.equal(poster.ok, false);
  assert.equal(poster.source, 'ai_rejected');
  assert.equal(poster.provenance, 'ai_rejected');
  assert.equal(poster.publishable, false);
  assert.equal(poster.poster, undefined, 'rejected copy must not be replaced by a local poster brief');
  assert.deepEqual(poster.fieldsToConfirm, ['MOQ / 起订量']);

  console.log('Studio truthful generation failure checks passed');
} finally {
  globalThis.fetch = previousFetch;
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

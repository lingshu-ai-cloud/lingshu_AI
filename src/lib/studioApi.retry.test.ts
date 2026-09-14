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
  }
  console.log('Studio terminal failure retry checks passed');
} finally {
  globalThis.fetch = previousFetch;
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

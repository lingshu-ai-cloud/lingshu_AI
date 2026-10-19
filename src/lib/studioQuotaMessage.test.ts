import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStudioHttpError, readStudioHttpError } from './studioQuotaMessage.js';

test('only explicit demo error codes use trial allowance copy', () => {
  assert.match(
    formatStudioHttpError({ error: 'demo_quota_exceeded', quota: 'videoGeneration' }, { status: 429 }),
    /今日视频生成额度已用完/,
  );
  assert.match(
    formatStudioHttpError({ code: 'demo_token_quota_exceeded', error: 'token budget blocked' }, { status: 429 }),
    /今日 Token 额度已用完/,
  );
  assert.equal(
    formatStudioHttpError({ error: '渲染任务繁忙，请稍后重试', quota: 'render' }, { status: 429 }),
    '渲染任务繁忙，请稍后重试',
    'a quota-shaped field alone must not turn an unrelated 429 into a demo limit',
  );
  assert.equal(
    formatStudioHttpError({ error: 'subscription_required', message: '当前订阅不可用' }, { status: 402 }),
    '当前订阅不可用',
  );
});

test('rate limits expose the server retry hint without claiming trial exhaustion', async () => {
  assert.equal(
    formatStudioHttpError({ error: 'rate_limit_exceeded', retryAfterSeconds: 7 }, { status: 429 }),
    '请求过于频繁，请在 7 秒后重试。',
  );
  const response = new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '11' },
  });
  assert.equal(await readStudioHttpError(response), '请求过于频繁，请在 11 秒后重试。');
  assert.equal(
    formatStudioHttpError(
      { error: 'rate_limit_exceeded', retryAfterSeconds: 'unknown' },
      { status: 429, retryAfter: '13' },
    ),
    '请求过于频繁，请在 13 秒后重试。',
  );
  assert.equal(
    await readStudioHttpError(new Response('供应商暂时繁忙', { status: 429 })),
    '供应商暂时繁忙',
  );
});

test('unknown 402/429 payloads preserve the backend error', () => {
  assert.equal(
    formatStudioHttpError({ error: '当前工作区成片存储已达 5 GiB 上限，请先清理旧成片' }, { status: 429 }),
    '当前工作区成片存储已达 5 GiB 上限，请先清理旧成片',
  );
  assert.equal(formatStudioHttpError({}, { status: 429 }), '请求失败（HTTP 429）');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantContentTaskIdempotencyKey } from './assistantContentTaskApi.js';

test('instant task retries reuse one key until the thread version changes', () => {
  const first = assistantContentTaskIdempotencyKey(4, '制作  一条产品视频');
  assert.equal(first, assistantContentTaskIdempotencyKey(4, '制作 一条产品视频'));
  assert.notEqual(first, assistantContentTaskIdempotencyKey(5, '制作 一条产品视频'));
  assert.match(first, /^[a-z0-9:_-]{8,200}$/i);
});

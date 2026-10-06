import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedQwenTranscriptionUrl, verifiedAudioCues } from './qwenAlignment.js';

test('accepts the official DashScope OSS result host without opening external download hosts', () => {
  const url = trustedQwenTranscriptionUrl('http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?signature=sample');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com');
  assert.equal(url.search, '?signature=sample');
  assert.equal(trustedQwenTranscriptionUrl('https://oss-cn-beijing.aliyuncs.com/result.json').hostname,
    'oss-cn-beijing.aliyuncs.com');
  for (const value of [
    'https://oss-cn-beijing.aliyuncs.com.evil.test/result.json',
    'https://evil.oss-cn-beijing.aliyuncs.com.evil.test/result.json',
    'https://user@oss-cn-beijing.aliyuncs.com/result.json',
    'file:///tmp/result.json',
    'https://example.com/result.json',
  ]) assert.throws(() => trustedQwenTranscriptionUrl(value), /不可信/);
});

test('retains measured source sentence boundaries for matching spoken copy', () => {
  const raw = { transcripts: [{ text: 'Hello world.', sentences: [
    { text: 'Hello world.', begin_time: 120, end_time: 1880 },
  ] }] };
  assert.deepEqual(verifiedAudioCues(raw, 'Hello world.', 2), [{ text: 'Hello world.', start: 0.12, end: 1.88 }]);
  assert.throws(() => verifiedAudioCues(raw, 'Different words.', 2), /实际音频与口播文本不一致/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { alignQwenFile, trustedQwenTranscriptionUrl, verifiedAudioCues } from './qwenAlignment.js';

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

test('file transcription downloads an official signed result and bounds its size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-qwen-alignment-'));
  const priorFetch = globalThis.fetch;
  const priorKey = process.env.DASHSCOPE_API_KEY;
  let oversized = false;
  let downloadUrl = '';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/services/audio/asr/transcription')) return Response.json({ output: { task_id: 'task-test' } });
    if (url.endsWith('/tasks/task-test')) return Response.json({ output: { task_status: 'SUCCEEDED', result: {
      transcription_url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?signature=sample',
    } } });
    downloadUrl = url;
    return oversized
      ? new Response(new Uint8Array(8 * 1024 * 1024 + 1))
      : Response.json({ transcripts: [{ text: 'Hello world.', sentences: [
        { text: 'Hello world.', begin_time: 120, end_time: 1880 },
      ] }] });
  }) as typeof fetch;
  try {
    assert.deepEqual(await alignQwenFile('https://assets.example.test/source.mp3', 'Hello world.', 2,
      path.join(dir, 'good.json')), [{ text: 'Hello world.', start: 0.12, end: 1.88 }]);
    assert.match(downloadUrl, /^https:\/\/dashscope-result-bj\.oss-cn-beijing\.aliyuncs\.com\/result\.json\?signature=sample$/);
    oversized = true;
    await assert.rejects(alignQwenFile('https://assets.example.test/source.mp3', 'Hello world.', 2,
      path.join(dir, 'large.json')), /音频字幕文件过大/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = priorKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QwenAsrService, qwenAsrCues } from './qwenAsr.js';
import { mapNarrationCues } from '../../src/lib/narrationAlignment.js';
const raw = { transcripts: [{ text: '你好，再见。', sentences: [{ words: [
  { text: '你好', punctuation: '，', begin_time: 80, end_time: 600 },
  { text: '再见', punctuation: '。', begin_time: 1000, end_time: 1600 },
] }] }] };
test('Qwen actual words regroup sentences without estimated timestamps or invented text', () => {
  const result = qwenAsrCues(raw, 2, '你好。\n再见。');
  assert.equal(result.matches, true); assert.equal(result.cues.length, 2);
  assert.equal(result.cues[1].start, 1);
  assert.equal(qwenAsrCues(raw, 2, '新台词。').matches, false);
  assert.throws(() => qwenAsrCues({ transcripts: [{ text: '你好', sentences: [] }] }, 2), /字词/);
  assert.throws(() => qwenAsrCues(raw, 1), /字词/);
  assert.equal(mapNarrationCues(['你好', '无', '再见'], result.cues, 2, 'qwen_asr')[1], null);
});
test('ASR explicit submit, duplicate prevention, durable polling, tenant cache and uncertain handling', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-asr-test-'));
  const oldEnabled = process.env.QWEN_ASR_GENERATION_ENABLED, oldKey = process.env.DASHSCOPE_API_KEY;
  process.env.QWEN_ASR_GENERATION_ENABLED = 'true'; process.env.DASHSCOPE_API_KEY = 'test-only-not-a-key';
  let calls = 0, submissions = 0, fail = false;
  const request = (async (url: any) => {
    calls++;
    if (String(url).includes('/uploads?')) return Response.json({ data: { upload_host: 'https://test.oss-cn-beijing.aliyuncs.com', upload_dir: 'temporary' } });
    if (String(url).includes('/transcription')) { submissions++; if (fail) throw new Error('timeout'); return Response.json({ output: { task_id: 'job1', task_status: 'PENDING' } }); }
    if (String(url).includes('/tasks/')) return Response.json({ output: { task_status: 'SUCCEEDED', result: { transcription_url: 'http://test.oss-cn-beijing.aliyuncs.com/result' } }, usage: { seconds: 2 } });
    if (String(url).endsWith('/result')) return Response.json(raw);
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const makeService = () => new QwenAsrService(root, request, async () => {});
    const service = makeService(), bytes = Buffer.from('audio');
    assert.equal((await service.run('A', bytes, 'audio/wav')).status, 'needs_confirmation'); assert.equal(calls, 0);
    const blocked = new QwenAsrService(root, request, async () => { throw new Error('预算余额不足'); });
    await assert.rejects(blocked.run('A', Buffer.from('budget-block'), 'audio/wav', true), /预算余额不足/);
    assert.equal(calls, 0, 'budget denial must happen before uploads and paid submission');
    await Promise.all([service.run('A', bytes, 'audio/wav', true), service.run('A', bytes, 'audio/wav', true)]); assert.equal(submissions, 1);
    const concurrentAudio = Buffer.from('cross-instance-audio');
    const attempts = await Promise.allSettled([makeService().run('A', concurrentAudio, 'audio/wav', true), makeService().run('A', concurrentAudio, 'audio/wav', true)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(submissions, 2, 'independent service instances must not submit twice');
    assert.equal((await makeService().run('A', bytes, 'audio/wav')).status, 'SUCCEEDED');
    const before = calls; assert.equal((await service.run('A', bytes, 'audio/wav')).status, 'SUCCEEDED'); assert.equal(calls, before);
    assert.equal((await blocked.run('A', bytes, 'audio/wav')).status, 'SUCCEEDED', 'exhausted budget must not block completed cache');
    assert.equal((await service.run('B', bytes, 'audio/wav')).status, 'needs_confirmation');
    fail = true; const other = Buffer.from('other');
    assert.equal((await service.run('A', other, 'audio/wav', true)).status, 'uncertain');
    const submitted = submissions; await makeService().run('A', other, 'audio/wav', true); assert.equal(submissions, submitted);
  } finally {
    if (oldEnabled === undefined) delete process.env.QWEN_ASR_GENERATION_ENABLED; else process.env.QWEN_ASR_GENERATION_ENABLED = oldEnabled;
    if (oldKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = oldKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

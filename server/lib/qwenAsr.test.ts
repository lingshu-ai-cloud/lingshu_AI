import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QwenAsrService, qwenAsrCues, qwenMeasuredWordTimeline, transcribeWordAudioWithQwen } from './qwenAsr.js';
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

test('measured timeline retains provider word boundaries, zero-duration points and English punctuation', () => {
  const measured = { transcripts: [{ text: 'Hi, boss! We are a factory.', sentences: [
    { text: 'Hi, boss!', words: [{ text: 'Hi,', punctuation: ',', begin_time: 90, end_time: 400 }, { text: 'boss', punctuation: '!', begin_time: 400, end_time: 900 }] },
    { text: 'We are a factory.', words: [{ text: 'We', begin_time: 1200, end_time: 1400 }, { text: 'are', begin_time: 1400, end_time: 1600 }, { text: 'a', begin_time: 1600, end_time: 1600 }, { text: 'factory', punctuation: '.', begin_time: 1600, end_time: 2050 }] },
  ] }] };
  const result = qwenMeasuredWordTimeline(measured, 2.1);
  assert.equal(result.words[0].text, 'Hi,');
  assert.deepEqual(result.words[4], { text: 'a', start: 1.6, end: 1.6, timingPrecision: 'point' });
  assert.equal(result.segments[1].start, 1.2);
  assert.equal(result.segments[1].end, 2.05);
  assert.equal(result.segments[1].words.length, 4);
  assert.equal(result.segments[0].provenance, 'qwen_filetrans:measured_words');
  assert.deepEqual(result.warnings, ['provider_zero_duration_word']);
  assert.throws(() => qwenMeasuredWordTimeline({ transcripts: [{ text: 'Hi', sentences: [{ text: 'Hi', begin_time: 0, end_time: 1000 }] }] }, 2), /真实字词/);
  assert.throws(() => qwenMeasuredWordTimeline({ transcripts: [{ text: 'Hi', sentences: [{ text: 'Hi', words: [{ text: 'Hi', begin_time: null, end_time: 1000 }] }] }] }, 2), /无效/);
  assert.throws(() => qwenMeasuredWordTimeline(measured, 1), /越界/);
  assert.throws(() => qwenMeasuredWordTimeline({ transcripts: [{ text: 'Unrelated', sentences: measured.transcripts[0].sentences }] }, 2.1), /全文/);
  const reversed = structuredClone(measured); reversed.transcripts[0].sentences[0].words[1].begin_time = 100;
  assert.throws(() => qwenMeasuredWordTimeline(reversed, 2.1), /顺序/);
});

test('automatic reference ASR requests true words once, polls durably, records unknown accuracy and needs no studio confirmation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-word-asr-test-'));
  const oldEnabled = process.env.QWEN_ASR_GENERATION_ENABLED, oldKey = process.env.DASHSCOPE_API_KEY;
  delete process.env.QWEN_ASR_GENERATION_ENABLED; process.env.DASHSCOPE_API_KEY = 'test-only-not-a-key';
  let submissions = 0, polls = 0;
  const request = (async (url: any, init: any) => {
    if (String(url).includes('/uploads?')) return Response.json({ data: { upload_host: 'https://test.oss-cn-beijing.aliyuncs.com', upload_dir: 'temporary' } });
    if (String(url).includes('/transcription')) {
      submissions++;
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'qwen3-asr-flash-filetrans');
      assert.equal(body.parameters.enable_words, true);
      assert.equal(body.parameters.enable_itn, false);
      return Response.json({ output: { task_id: 'automatic-job', task_status: 'PENDING' } });
    }
    if (String(url).includes('/tasks/')) {
      polls++;
      if (polls === 1) return Response.json({ output: { task_status: 'RUNNING' } });
      return Response.json({ output: { task_status: 'SUCCEEDED', result: { transcription_url: 'https://test.oss-cn-beijing.aliyuncs.com/result' } }, usage: { seconds: 2 } });
    }
    if (String(url).endsWith('/result')) return Response.json(raw);
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const input = { tenant: 'A', audio: Buffer.from('automated-reference-audio'), mimeType: 'audio/mpeg', duration: 2, cacheRoot: root, request, pollIntervalMs: 1 };
    const result = await transcribeWordAudioWithQwen(input);
    assert.equal(result.alignmentStatus, 'aligned');
    assert.equal(result.words.length, 2);
    assert.equal(result.confidence, null);
    assert.equal(result.accuracyMs, null);
    assert.equal(result.sourceSha256.length, 64);
    assert.equal(result.taskId, 'automatic-job');
    await transcribeWordAudioWithQwen(input);
    assert.equal(submissions, 1);
    assert.equal(polls, 2);
  } finally {
    if (oldEnabled === undefined) delete process.env.QWEN_ASR_GENERATION_ENABLED; else process.env.QWEN_ASR_GENERATION_ENABLED = oldEnabled;
    if (oldKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = oldKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

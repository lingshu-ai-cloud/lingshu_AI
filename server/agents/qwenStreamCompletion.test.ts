import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { callLLMChatStream } from './llm';

test('Qwen incomplete streams continue once; incomplete continuation fails honestly', async () => {
  let requests = 0;
  let fallbackFinish = 'stop';
  let streamFinish: string | null = null;
  let streamText = '前半段';
  let fallbackStatus = 200;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests++;
      if (JSON.parse(body).stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: streamText }, finish_reason: streamFinish }] })}\n\ndata: [DONE]\n\n`);
      } else {
        res.writeHead(fallbackStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '后半段' }, finish_reason: fallbackFinish }] }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.DASHSCOPE_BASE_URL;
  const previousKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.DASHSCOPE_API_KEY = 'test-only';
  try {
    let text = '';
    for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen' })) if ('text' in event) text += event.text;
    assert.equal(text, '前半段后半段'); assert.equal(requests, 2);
    fallbackFinish = 'length';
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen' })) void event;
    }, /未完整结束/);
    assert.equal(requests, 4);

    // A proper completed stream must not make another provider request.
    streamFinish = 'stop';
    text = '';
    for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen' })) if ('text' in event) text += event.text;
    assert.equal(text, '前半段');
    assert.equal(requests, 5);

    // An empty stop is not an answer: retry once using the completion path.
    streamText = '';
    fallbackFinish = 'stop';
    text = '';
    for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen' })) if ('text' in event) text += event.text;
    assert.equal(text, '后半段');
    assert.equal(requests, 7);

    // Provider failure after partial text must propagate, not masquerade as success.
    streamText = '前半段';
    streamFinish = null;
    fallbackStatus = 503;
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen' })) void event;
    }, /未完整结束/);
    assert.equal(requests, 9);

    // Cancelling after a chunk must never launch the continuation request.
    const controller = new AbortController();
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '测试' }], { backend: 'qwen', signal: controller.signal })) {
        if ('text' in event) controller.abort();
      }
    });
    assert.equal(requests, 10);
  } finally {
    if (previousUrl === undefined) delete process.env.DASHSCOPE_BASE_URL; else process.env.DASHSCOPE_BASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previousKey;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

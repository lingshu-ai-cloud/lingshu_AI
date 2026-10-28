import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { callLLM } from './llm.js';
test('explicit non-thinking Qwen3 completion sends the actual switch while ordinary defaults remain unchanged', async () => {
 const requests: Array<Record<string, unknown>> = [];
 let fail = false;
 const server = createServer((request, response) => {
  let text = ''; request.on('data', chunk => { text += chunk; });
  request.on('end', () => { requests.push(JSON.parse(text)); response.writeHead(fail ? 503 : 200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '已完成' }, finish_reason: 'stop' }] })); });
 });
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const keys = ['DASHSCOPE_BASE_URL', 'DASHSCOPE_API_KEY', 'QWEN_MAX_RETRIES'] as const, prior = keys.map(key => process.env[key]);
 process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`; process.env.DASHSCOPE_API_KEY = 'fixture-only'; process.env.QWEN_MAX_RETRIES = '2';
 try {
  assert.equal(await callLLM('离线测试', { backend: 'qwen', model: 'qwen3.8-max', deepThinking: false }), '已完成');
  assert.equal(await callLLM('离线测试', { backend: 'qwen', model: 'qwen3.8-max' }), '已完成');
  assert.equal(await callLLM('离线测试', { backend: 'qwen', model: 'qwen-plus', deepThinking: false }), '已完成');
  assert.equal(requests.length, 3); assert.equal(requests[0].enable_thinking, false);
  assert.equal('enable_thinking' in requests[1], false); assert.equal('enable_thinking' in requests[2], false);
  fail = true;
  await assert.rejects(callLLM('离线失败测试', { backend: 'qwen', model: 'qwen3.8-max', deepThinking: false, maxRetries: 0 }));
  assert.equal(requests.length, 4, 'explicit paid-workflow policy disables SDK retries despite a permissive provider default');
 } finally {
  keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; });
  await new Promise<void>(resolve => server.close(() => resolve()));
 }
});

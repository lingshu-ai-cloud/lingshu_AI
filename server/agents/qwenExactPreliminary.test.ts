import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVideoFramesWithQwen } from './qwen.js';

test('exact workflow coarse classification keeps exact model despite its strategy-shaped prompt', async t => {
  const keys = ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'QWEN_EXACT_VL_MODEL', 'QWEN_VL_MODEL'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: 'https://isolated.invalid/v1',
    QWEN_EXACT_VL_MODEL: 'exact-configured', QWEN_VL_MODEL: 'strategy-configured' });
  t.after(() => { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  let model = '';
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const request = input instanceof Request ? input : new Request(input, init);
    model = (await request.json() as any).model;
    return new Response(JSON.stringify({ error: { message: 'test stopped before inference' } }), { status: 400 });
  });
  await assert.rejects(analyzeVideoFramesWithQwen({ frames: [{ base64: 'test', mimeType: 'image/jpeg', timeLabel: '0s' }],
    analysisMode: 'strategy', exactModel: true }));
  assert.equal(model, 'exact-configured');
  await assert.rejects(analyzeVideoFramesWithQwen({ frames: [{ base64: 'test', mimeType: 'image/jpeg', timeLabel: '0s' }], analysisMode: 'strategy' }));
  assert.equal(model, 'strategy-configured');
});

test('hook evidence labels each source frame and rejects image ordinals as timestamps', async t => {
  const { inspectOpeningHookMotionWithQwen } = await import('./qwen.js');
  const before = { key: process.env.DASHSCOPE_API_KEY, url: process.env.DASHSCOPE_BASE_URL };
  process.env.DASHSCOPE_API_KEY = 'test'; process.env.DASHSCOPE_BASE_URL = 'https://isolated.invalid/v1';
  t.after(() => { for (const [key, value] of Object.entries({ DASHSCOPE_API_KEY: before.key, DASHSCOPE_BASE_URL: before.url })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const body = await (input instanceof Request ? input : new Request(input, init)).json() as any;
    const parts = body.messages[0].content;
    assert.deepEqual(parts.filter((x: any) => x.text?.startsWith('SOURCE_TIME_SECONDS=')).map((x: any) => x.text),
      ['SOURCE_TIME_SECONDS=0', 'SOURCE_TIME_SECONDS=0.1', 'SOURCE_TIME_SECONDS=0.2']);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      observations: [0, .1, .2, 1].map(time => ({ time, visibleState: 'observed', confidence: 1 })),
      transitions: [{ from: 0, to: .2, action: 'movement', evidence: 'frames', confidence: 1 },
        { from: 0, to: 1, action: 'invalid ordinal', evidence: 'invalid', confidence: 1 }], uncertainties: [],
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await inspectOpeningHookMotionWithQwen({ frames: [0, .1, .2].map(time => ({ timeLabel: `${time}s`, mimeType: 'image/jpeg', base64: 'test' })), start: 0, end: 1 });
  assert.equal(result.observations.length, 3); assert.equal(result.transitions.length, 1);
});

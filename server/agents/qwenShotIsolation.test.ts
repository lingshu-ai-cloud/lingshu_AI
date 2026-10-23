import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withExactQwenScope } from './exactQwenScope.js';
import { analyzeVideoTimelineDetailsWithQwen } from './qwen.js';
import type { QwenTimelinePlan } from './qwenContracts.js';
test('each Qwen shot description sees only frames inside its own source window', async t => {
  const oldKey = process.env.DASHSCOPE_API_KEY, oldUrl = process.env.DASHSCOPE_BASE_URL;
  process.env.DASHSCOPE_API_KEY = 'isolated-test-key'; process.env.DASHSCOPE_BASE_URL = 'https://isolated.invalid/v1';
  t.after(() => { if (oldKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.DASHSCOPE_BASE_URL; else process.env.DASHSCOPE_BASE_URL = oldUrl; });
  const received: string[][] = [], prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Request) => {
    const body = await input.clone().json() as any;
    const content = body.messages[0].content; prompts.push(content[0].text);
    received.push(content.filter((row: any) => row.type === 'image_url').map((row: any) => row.image_url.url));
    const id = content[0].text.includes('"id":"lab"') ? 'lab' : 'product';
    return new Response(JSON.stringify({ id: 'isolated-response', choices: [{ message: { content: JSON.stringify({
      summary: {}, shots: [{ boundaryId: id, visual: id, materialType: 'product', narrativeRole: 'product_intro', classificationEvidence: 'visible in isolated frame' }],
    }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const scope = { model: 'scoped-vision', endpoint: 'https://isolated.invalid/v1', configurationHash: 'test',
    credentialDigest: createHash('sha256').update('isolated-test-key').digest('hex') };
  const timeline = { boundaries: [{ id: 'lab', start: 0, end: 1.123456 }, { id: 'product', start: 1.123456, end: 2.123456 }] } as QwenTimelinePlan;
  const result = await withExactQwenScope(scope, () => analyzeVideoTimelineDetailsWithQwen({ timeline,
    transcript: { text: '', segments: [{ start: 0, end: 0.9, text: 'LAB_SPEECH' }, { start: 1.2, end: 1.9, text: 'PRODUCT_SPEECH' }, { start: 0.9, end: 1.2, text: 'CROSSING_SPEECH' }] },
    frames: [{ timeLabel: '0.5s', base64: 'LAB', mimeType: 'image/jpeg' }, { timeLabel: '1.5s', base64: 'PRODUCT', mimeType: 'image/jpeg' }] }));
  assert.deepEqual(received.sort(), [['data:image/jpeg;base64,LAB'], ['data:image/jpeg;base64,PRODUCT']]);
  assert.deepEqual(result.scriptDetails15s?.map(row => row.visual), ['lab', 'product']);
  assert.deepEqual(result.scriptDetails15s?.map(row => row.time), ['0-1.123456s', '1.123456-2.123456s']);
  await assert.rejects(withExactQwenScope(scope, () => analyzeVideoTimelineDetailsWithQwen({ timeline, frames: [] })), /frames_missing/);
  assert.ok(prompts.every(prompt => !prompt.includes('CROSSING_SPEECH')));
  assert.ok(prompts.find(prompt => prompt.includes('"id":"lab"'))?.includes('LAB_SPEECH'));
  assert.ok(!prompts.find(prompt => prompt.includes('"id":"lab"'))?.includes('PRODUCT_SPEECH'));
  assert.equal(received.length, 2, 'missing evidence must not submit a provider request');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { RunwayActTwoAdapter } from './runwayActTwoAdapter.js';
import { isDefinitiveSupplierSubmissionError } from './digitalHumanProviderRegistry.js';

test('Runway Act-Two adapter follows official character-performance and task contracts', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []; let state: 'RUNNING' | 'SUCCEEDED' = 'RUNNING';
  const transport = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === 'POST') return Response.json({ id: 'runway-task-1', estimatedCost: { credits: 25 } });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json(state === 'RUNNING' ? { id: 'runway-task-1', status: 'RUNNING', estimatedCost: { credits: 25 }, progress: 0.5 }
      : { id: 'runway-task-1', status: 'SUCCEEDED', output: ['https://output.cloudfront.net/video.mp4'], cost: { credits: 20 } });
  }) as typeof fetch;
  const adapter = new RunwayActTwoAdapter({ apiSecret: 'secret', cnyPerCredit: 0.08, estimatedCostCnyPerSecond: 1.2, qualityInspection: true, transport, baseUrl: 'https://runway.test' });
  assert.equal(adapter.executionProfile.qualityInspection, true);
  const submitted = await adapter.submit({ characterUrl: 'https://assets.test/person-object-without-extension', characterType: 'video', referenceVideoUrl: 'https://assets.test/reference.mp4', ratio: '720:1280', bodyControl: true, expressionIntensity: 4 }, 'durable-request');
  assert.equal(submitted.externalTaskId, 'runway-task-1');
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.deepEqual(body, { model: 'act_two', character: { type: 'video', uri: 'https://assets.test/person-object-without-extension' }, reference: { type: 'video', uri: 'https://assets.test/reference.mp4' }, ratio: '720:1280', bodyControl: true, expressionIntensity: 4 });
  assert.equal((calls[0]?.init.headers as Record<string, string>)['X-Runway-Version'], '2024-11-06');
  assert.deepEqual(await adapter.status('runway-task-1'), { state: 'pending' });
  state = 'SUCCEEDED';
  assert.deepEqual(await adapter.status('runway-task-1'), { state: 'completed', outputUrl: 'https://output.cloudfront.net/video.mp4', actualCostCny: 1.6, costSourceRef: 'runway-task:runway-task-1:credits:20' });
  assert.deepEqual(await adapter.cost('runway-task-1'), { actualCostCny: 1.6, costSourceRef: 'runway-task:runway-task-1:credits:20' });
  assert.deepEqual(await adapter.cancel('runway-task-1'), { cancelled: true, reason: 'runway_cancelled' });
  await assert.rejects(adapter.submit({ characterUrl: '/private/person.jpg', characterType: 'image', referenceVideoUrl: 'https://assets.test/reference.mp4', ratio: '720:1280', bodyControl: true }, 'x'), /HTTPS/);
  await assert.rejects(adapter.submit({ characterUrl: 'https://assets.test/person', referenceVideoUrl: 'https://assets.test/reference.mp4', ratio: '720:1280', bodyControl: true }, 'x'), /素材类型/);
});

test('Runway Act-Two rejects missing or unknown task states instead of waiting forever', async () => {
  let payload: Record<string, unknown> = { id: 'runway-task-2', status: 'NEW_UNKNOWN_STATE' };
  const adapter = new RunwayActTwoAdapter({ apiSecret: 'secret', cnyPerCredit: 0.08,
    transport: (async () => Response.json(payload)) as typeof fetch, baseUrl: 'https://runway.test' });
  await assert.rejects(adapter.status('runway-task-2'), /未知任务状态：NEW_UNKNOWN_STATE/);
  payload = { id: 'runway-task-2' };
  await assert.rejects(adapter.status('runway-task-2'), /未知任务状态：missing/);
});

test('Runway Act-Two distinguishes explicit create rejection from an uncertain submission', async () => {
  const input = { characterUrl: 'https://assets.test/person', characterType: 'image' as const, referenceVideoUrl: 'https://assets.test/reference.mp4', ratio: '720:1280' as const, bodyControl: true };
  const rejected = new RunwayActTwoAdapter({ apiSecret: 'secret', cnyPerCredit: 0.08,
    transport: (async () => Response.json({ error: 'invalid_input' }, { status: 422 })) as typeof fetch });
  await assert.rejects(rejected.submit(input, 'rejected'), error => isDefinitiveSupplierSubmissionError(error) && /422/.test(error.message));
  const uncertain = new RunwayActTwoAdapter({ apiSecret: 'secret', cnyPerCredit: 0.08,
    transport: (async () => Response.json({ error: 'supplier_error' }, { status: 500 })) as typeof fetch });
  await assert.rejects(uncertain.submit(input, 'uncertain'), error => !isDefinitiveSupplierSubmissionError(error) && /500/.test((error as Error).message));
});

for (const status of [408, 409, 429, 500, 503]) {
  test('RunwayActTwoAdapter retains unknown submission classification for HTTP ' + status, async () => {
    let calls = 0;
    const adapter = new RunwayActTwoAdapter({ apiSecret: 'controlled', cnyPerCredit: .08, transport: async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, 'error');
      return Response.json({ error: 'controlled ambiguous outcome' }, { status });
    } });
    const input = { characterUrl: 'https://assets.invalid/person.jpg', characterType: 'image' as const, referenceVideoUrl: 'https://assets.invalid/reference.mp4', ratio: '720:1280' as const, bodyControl: true };
    await assert.rejects(adapter.submit(input, 'original-operation'), error => !isDefinitiveSupplierSubmissionError(error) && String((error as Error).message).includes(String(status)));
    assert.equal(calls, 1);
  });
}

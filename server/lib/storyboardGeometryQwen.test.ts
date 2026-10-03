import assert from 'node:assert/strict';
import { createStoryboardGeometryQwenObserver } from './storyboardGeometryQwen.js';
import { planStoryboardExactProductGeometry, type StoryboardGeometryInput } from './storyboardGeometryPlanner.js';

const input: StoryboardGeometryInput = {
  shotId: 'shot-7', mode: 'replication', scene: 'conveyor',
  confirmedVisual: '原片当前镜头中的产品在传送带中央，正面朝向相机',
  product: { assetId: 'kb-product-photo', version: 'kb-v2', view: 'front', cutoutAspectRatio: .5 },
  sourceFrame: { assetId: 'trend-1:shot-7:first', version: 'frame-hash-v3', mimeType: 'image/jpeg', base64: 'mock-frame' },
};
const observation = { shotId: 'shot-7', sourceFrameAssetId: 'trend-1:shot-7:first', sourceFrameVersion: 'frame-hash-v3',
  scene: 'conveyor', productBox: { x: .4, y: .28, width: .2, height: .4 }, contactSurfaceY: .68,
  productView: 'front', foregroundOcclusion: 'none', confidence: .91,
  evidence: '当前真实首帧中产品立于传送带中央，底部贴合传送带表面' };
let calls = 0;
const observer = createStoryboardGeometryQwenObserver({ apiKey: 'test-only', baseUrl: 'https://mock.qwen/v1', model: 'mock-vl',
  fetcher: (async (url, init) => {
    calls++;
    assert.equal(url, 'https://mock.qwen/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-only');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format, undefined, 'default Qwen-VL-Max alias must not be sent an unsupported structured-output option');
    assert.equal(body.temperature, 0);
    assert.match(body.messages[0].content[0].text, /sourceFrameAssetId="trend-1:shot-7:first"/);
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,mock-frame');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(observation) } }] }),
      { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch,
});
const plan = await planStoryboardExactProductGeometry(input, observer);
assert.equal(plan.status, 'ready');
assert.equal(calls, 1);
const invalidObserver = createStoryboardGeometryQwenObserver({ apiKey: 'test-only', baseUrl: 'https://mock.qwen/v1',
  fetcher: (async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{}\n```' } }] }),
    { headers: { 'content-type': 'application/json' } })) as typeof fetch });
assert.equal((await planStoryboardExactProductGeometry(input, invalidObserver)).status, 'blocked', 'malformed model output must not authorize exact compositing');
const mismatchedObserver = createStoryboardGeometryQwenObserver({ apiKey: 'test-only', baseUrl: 'https://mock.qwen/v1',
  fetcher: (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...observation, shotId: 'shot-8' }) } }] }),
    { headers: { 'content-type': 'application/json' } })) as typeof fetch });
const mismatch = await planStoryboardExactProductGeometry(input, mismatchedObserver);
assert.equal(mismatch.status, 'blocked');
if (mismatch.status === 'blocked') assert.equal(mismatch.code, 'GEOMETRY_EVIDENCE_MISMATCH');
console.log('storyboardGeometryQwen tests passed');

import assert from 'node:assert/strict';
import test from 'node:test';
import { imageEvidenceReviewReasons, type ImagePostEvidenceAnalysis } from './qwenContracts.js';
import { reviewImagePostEvidenceWithOpenAI } from './openaiImageEvidence.js';

const strong = (): ImagePostEvidenceAnalysis => ({
  version: 2, status: 'analyzed',
  observedFacts: [{ imageIndex: 1, subjects: ['product'], scene: 'studio', composition: 'center', colors: ['black'], visibleText: ['NEW'], confidence: .92 }],
  carouselFlow: [{ imageIndex: 1, role: 'product', evidence: 'visible product', confidence: .9 }],
  copyEvidence: { hooks: [], sellingPoints: [], cta: [] },
  reusableModules: [{ module: 'hero', evidence: 'centered', preserve: 'layout', replace: 'brand', confidence: .88 }],
  layerBlueprints: [{ imageIndex: 1, layers: [
    { id: 'background', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: .95 },
    { id: 'product', role: 'product', zIndex: 2, bounds: { x: .2, y: .2, width: .6, height: .6 }, confidence: .9 },
  ], masks: [] }], uncertainties: [],
});

test('strong Qwen evidence avoids paid GPT review', () => {
  assert.deepEqual(imageEvidenceReviewReasons(strong(), 1), []);
});

test('missing and conflicting geometry requires GPT review', () => {
  const weak = strong();
  weak.layerBlueprints = [{ imageIndex: 1, layers: [
    { id: 'same', role: 'product', zIndex: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: .4 },
    { id: 'same', role: 'text', zIndex: 1, bounds: { x: 0, y: 0, width: 1, height: .2 }, confidence: .4 },
  ], masks: [] }];
  const reasons = imageEvidenceReviewReasons(weak, 1);
  assert.ok(reasons.includes('low_confidence'));
  assert.ok(reasons.includes('missing_background_layer'));
  assert.ok(reasons.includes('layer_order_conflict'));
});

test('GPT reviewer sends source image and normalizes returned geometry', async t => {
  const previous = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL, model: process.env.SOCIAL_IMAGE_ANALYSIS_REVIEW_MODEL };
  process.env.OPENAI_API_KEY = 'test-key'; process.env.OPENAI_BASE_URL = 'https://openai.example/v1'; process.env.SOCIAL_IMAGE_ANALYSIS_REVIEW_MODEL = 'gpt-review-test';
  t.after(() => {
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: previous.key, OPENAI_BASE_URL: previous.base, SOCIAL_IMAGE_ANALYSIS_REVIEW_MODEL: previous.model })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let requestBody: any;
  const analysis = await reviewImagePostEvidenceWithOpenAI({
    images: [{ imageIndex: 1, mimeType: 'image/png', base64: 'cG5n' }], reviewReasons: ['low_confidence'], primary: strong(),
    fetcher: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      const result = { ...strong(), layerBlueprints: [{ imageIndex: 1, layers: strong().layerBlueprints![0]!.layers, masks: [{ id: 'shade', shape: 'rectangle', bounds: { x: -.2, y: 0, width: 2, height: 1 }, opacity: 1.4, zIndex: 1, confidence: .9 }] }] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requestBody.model, 'gpt-review-test');
  assert.match(requestBody.messages[1].content[1].image_url.url, /^data:image\/png;base64,cG5n$/);
  assert.deepEqual(analysis.layerBlueprints?.[0]?.masks[0]?.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(analysis.layerBlueprints?.[0]?.masks[0]?.opacity, 1);
});

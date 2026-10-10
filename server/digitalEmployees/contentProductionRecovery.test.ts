import assert from 'node:assert/strict';
import { requiredContentRoutes, contentProductionKnowledgeGaps, paginateAlignedCues, subtitleCuesAreSafe, contentProjectRetryable, sceneHasVisualEvidence, resumeContentProjectForTaskControl, type AssetCandidate } from './contentProduction.js';
import { narrationEvidenceIssues, reviewFinalNarration, generateNarration } from './narration.js';

const text = 'Before selecting this product, ask your supplier to confirm which documented materials and dimensions match your intended use. Review the provided details together before making a decision.';
const oldCues = [{ start: 0.5, end: 10.25, text }, { start: 11, end: 15, text: 'Review the confirmed product details.' }];
assert.equal(subtitleCuesAreSafe(oldCues, 15), false);
const repaired = paginateAlignedCues(oldCues, 15)!;
assert.ok(repaired.length > oldCues.length);
assert.equal(repaired.slice(0, -1).map(cue => cue.text).join(''), text, 'caption pagination must preserve every character of the spoken sentence');
assert.equal(repaired[0].start, 0.5);
assert.equal(repaired.at(-2)!.end, 10.25);
assert.equal(repaired.at(-1)!.start, 11, 'audio silence between original cues must remain silence');
assert.ok(subtitleCuesAreSafe(repaired, 15));
assert.deepEqual(paginateAlignedCues(repaired, 15), repaired, 'repair must be idempotent');
assert.equal(paginateAlignedCues(oldCues, 8), null, 'must not hide truncation by shortening the audio interval');
assert.equal(paginateAlignedCues([{ start: 0, end: 3, text: 'hello' }, { start: 2, end: 4, text: 'world' }], 4), null);
assert.equal(paginateAlignedCues([{ start: 0, end: 1, text: 'mock-product' }], 1), null);
const longWord = 'a'.repeat(190);
assert.equal(paginateAlignedCues([{ start: 0, end: 6, text: longWord }], 6)!.map(cue => cue.text).join(''), longWord);
assert.equal(contentProjectRetryable({ retryPolicy: 'input_required', retryAfter: '2020-01-01' }), false, 'waiting does not repair a deterministic failed render');
assert.equal(contentProjectRetryable({ retryAfter: '2020-01-01' }), true, 'transient failures keep their retry path');
const resumed = resumeContentProjectForTaskControl({ project: { spec: { workflowRunId: 'run', workflowTaskId: 'task', automation: { managedBy: 'digital_employee', stage: 'blocked', resumeStage: 'material_match', retryPolicy: 'input_required' } } }, runId: 'run', affectedTaskIds: new Set(['task']), now: '2026-09-06T00:00:00Z' })!;
assert.equal((resumed.automation as any).stage, 'material_match');
assert.equal((resumed.automation as any).retryPolicy, undefined, 'an explicit corrected-input retry must clear the deterministic block');
assert.ok(narrationEvidenceIssues('产品：产品1').length);
assert.ok(narrationEvidenceIssues('产品：产品1；SKU：123').length);
assert.deepEqual(narrationEvidenceIssues('产品：衬衫；材质：棉', 'This shirt is made of cotton.'), []);
assert.ok(narrationEvidenceIssues('产品：衬衫；材质：棉', 'Stable performance within the operating voltage and temperature range with no derating.').length);
assert.ok((await reviewFinalNarration({ facts: '产品：产品1', spoken: 'Product 1 supports a broad voltage range.', language: 'en', constraints: [] })).length, 'unverifiable legacy narration must fail before any model request');
await assert.rejects(generateNarration({ facts: '产品：产品1', theme: 'intro', audience: 'buyers', language: 'en', duration: 30, cta: 'ask', constraints: [] }), /缺少已确认/);
const asset = { productName: 'Product 1', visualObservations: ['A man at a laptop with a marketing poster'] } as AssetCandidate;
assert.equal(sceneHasVisualEvidence('Show the operating voltage display', asset), false, 'ownership, scores and file names cannot establish visual alignment');
assert.equal(sceneHasVisualEvidence('Show a laptop', asset), true);
assert.equal(sceneHasVisualEvidence('画面：产品展示', { ...asset, visualObservations: ['企业知识库产品“产品1”的已上传图片'] }), false, 'an upload receipt is not a visual observation');
console.log('content production recovery tests passed (isolated; no external generation or business writes)');

const allRoutes = ['clone', 'product', 'material'] as const;
const evidence = { productNames: ['Confirmed shirt'], assetIds: ['shirt-image'], exactAnalysisIds: [] };
const productOnly = requiredContentRoutes({ frozenOrders: [{ route: 'product' }], enabled: [...allRoutes] });
assert.deepEqual(contentProductionKnowledgeGaps({ enabled: productOnly, evidence }), [], 'globally enabled clone capability must not add a clone reference gap to product-only orders');
const cloneOnly = requiredContentRoutes({ videoPlans: [{ route: 'clone' }], projectRoutes: ['product'], enabled: [...allRoutes] });
assert.deepEqual(contentProductionKnowledgeGaps({ enabled: cloneOnly, evidence }).map(gap => gap.key), ['exact_analysis'], 'an explicit all-clone request must retain its mandatory reference gap');
const mixed = requiredContentRoutes({ frozenOrders: [{ route: 'product' }, { route: 'clone' }], enabled: [...allRoutes] });
assert.deepEqual(contentProductionKnowledgeGaps({ enabled: mixed, evidence }).map(gap => gap.key), ['exact_analysis']);
assert.deepEqual(requiredContentRoutes({ projectRoutes: ['product'], enabled: [...allRoutes] }), ['product'], 'historical batch diagnostics use the actual production routes');

// Real multilingual narration lengths that previously produced sub-second tails.
for (const sample of [
  { language: 'es', text: '¿Quieres ver cómo se ve el frente y la parte trasera de esta placa de circuito impreso?', seconds: 4.63 },
  { language: 'es', text: 'En la parte trasera puedes ver la distribución y forma de las pistas y las soldaduras.', seconds: 7.117 },
  { language: 'en', text: 'On the front, you’ll see component placement, slot positioning, and the heatsink layout.', seconds: 5.3565 },
  { language: 'zh', text: '想看看这块电路板的正面和背面是什么样吗？背面可以看到走线和焊点的分布，正面可以看到元器件、插槽和散热结构的位置。你想先了解背面的走线，还是正面的插槽？我们可以根据你的关注点继续展示更多细节。', seconds: 9 },
]) {
  const cues = paginateAlignedCues([{ start: 1, end: 1 + sample.seconds, text: sample.text }], 1 + sample.seconds)!;
  assert.ok(cues.length > 1, sample.language);
  assert.equal(cues.map(cue => cue.text).join(''), sample.text);
  assert.equal(cues[0].start, 1);
  assert.equal(cues.at(-1)!.end, 1 + sample.seconds);
  assert.ok(cues.every(cue => cue.end - cue.start >= 1), `${sample.language}: avoid fleeting tail pages`);
  assert.ok(cues.every(cue => cue.text.length <= 80));
  assert.deepEqual(paginateAlignedCues(cues, 1 + sample.seconds), cues);
}

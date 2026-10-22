import assert from 'node:assert/strict';
import { buildOpenAiImageEvidenceRequest, reviewImagePostEvidenceWithOpenAI, type OpenAiImageEvidencePaidCall } from './openaiImageEvidence.js';

const input = { images: [{ base64: 'aGVsbG8=', mimeType: 'image/png', imageIndex: 1 }], reviewReasons: ['missing_layer_blueprints'] };
const { requestSha256 } = buildOpenAiImageEvidenceRequest(input, 'gpt-4.1-mini');
const events: string[] = [];
const call: OpenAiImageEvidencePaidCall = {
  intent: { operationId: 'review-1', provider: 'openai', model: 'gpt-4.1-mini', accountRef: 'test', stage: 'image_post_evidence_review', shotId: null, inputContractHash: requestSha256, maximumUnits: { inputTokens: 1000, outputTokens: 7000, requests: 1 } },
  async assertProviderBinding() {},
  permit: {
    async beforeSubmit(request) { events.push(`claim:${request.actualUnits.inputTokens}`); },
    async markOutcome(_id, status, receipt) { events.push(`${status}:${receipt}`); },
  },
  async measureInputTokens() { return 100; },
  async persistProviderReceipt({ requestSha256: sha }) { assert.equal(sha, requestSha256); events.push('receipt'); return 'receipt:test'; },
};
let sent = 0;
const fetcher = async () => {
  sent++;
  events.push('send');
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observedFacts: [{ imageIndex: 1, subjects: ['bottle'], confidence: .9 }], layerBlueprints: [] }) } }] }), { status: 200 });
};
await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: { ...call, intent: { ...call.intent, inputContractHash: '0'.repeat(64) } }, fetcher }), /request_binding_invalid/);
assert.equal(sent, 0);
await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: {
  ...call, async assertProviderBinding() { throw Error('account_changed'); },
}, fetcher }), /account_changed/);
assert.equal(sent, 0);
const result = await reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: call, fetcher });
assert.equal(result.observedFacts[0]?.subjects[0], 'bottle');
assert.deepEqual(events, ['claim:100', 'send', 'receipt', 'completed:receipt:test']);
events.length = 0;
await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: call, fetcher: async () => {
  events.push('send'); throw Error('timeout');
} }), /timeout/);
assert.deepEqual(events, ['claim:100', 'send'], 'transport failure remains unknown after the durable claim');
events.length = 0;
await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: { ...call, permit: {
  ...call.permit, async beforeSubmit() { throw Error('budget_missing'); },
} }, fetcher }), /budget_missing/);
assert.equal(sent, 1, 'a missing reservation never reaches the provider');
assert.equal(events.length, 0);
await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...input, apiKey: 'test', paidCall: call, fetcher: async () => {
  events.push('send'); return new Response('{invalid', { status: 200 });
} }), /response_json_invalid/);
assert.deepEqual(events, ['claim:100', 'send', 'receipt', 'completed:receipt:test'], 'malformed output is recovered from its durable receipt, not a new POST');
console.log('OpenAI image evidence paid boundary tests passed');

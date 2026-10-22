import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { imageEvidenceReviewPlanHash, reserveImageEvidencePaidCall, type ImageEvidenceApprovedPlan, type ImageEvidencePaidContextPorts } from './imageEvidencePaidContext.js';
import type { SocialPaidOperationIntent } from '../lib/socialContentTaskBudgetAuthority.js';
import { buildOpenAiImageEvidenceRequest, reviewImagePostEvidenceWithOpenAI } from './openaiImageEvidence.js';
import { createImageEvidenceReceiptStore } from './imageEvidenceReceiptStore.js';

const evidenceInput = { images: [{ base64: 'aGVsbG8=', mimeType: 'image/png', imageIndex: 1 }], reviewReasons: ['missing_layer_blueprints'] };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-evidence-paid-'));
  const recordId = 'image-1', recordSha256 = 'a'.repeat(64);
  const { requestSha256 } = buildOpenAiImageEvidenceRequest(evidenceInput, 'gpt-4.1-mini');
  const intent: SocialPaidOperationIntent = { operationId: 'image-review-1', provider: 'openai', model: 'gpt-4.1-mini',
    accountRef: 'openai:verified-test', stage: 'image_post_evidence_review', shotId: null,
    inputContractHash: requestSha256, maximumUnits: { inputTokens: 1000, outputTokens: 7000 } };
  const authorizationRef = 'approved-record-review-1';
  const scope = { tenantId: 'tenant-1', taskId: `image-evidence:${recordId}:${recordSha256}`, runId: recordSha256,
    planHash: imageEvidenceReviewPlanHash({ tenantId: 'tenant-1', recordId, recordSha256,
      authorizationRef, maximumCny: 10, intent }) };
  const plan: ImageEvidenceApprovedPlan = { scope, recordId, recordSha256, authorizationRef,
    maximumCny: 10, paidOperations: [intent] };
  let current = true, approved = true, sharedVolume = true, tariff = true;
  const ports: ImageEvidencePaidContextPorts = {
    async readApprovedPlan() { return structuredClone(plan); },
    async assertRecordCurrent({ tenantId, recordId: id, recordSha256: snapshot }) {
      if (!current || tenantId !== scope.tenantId || id !== recordId || snapshot !== recordSha256) throw Error('record_changed');
    },
    async assertApproved({ authorizationRef: ref }) { if (!approved || ref !== authorizationRef) throw Error('approval_missing'); },
    async assertProviderBinding({ intent: candidate, baseUrl, credentialSha256 }) {
      if (candidate.accountRef !== intent.accountRef || baseUrl !== 'https://api.openai.com/v1'
        || credentialSha256 !== createHash('sha256').update('isolated-test-key').digest('hex')) throw Error('account_changed');
    },
    async assertSharedVolume() { if (!sharedVolume) throw Error('shared_volume_missing'); },
    async readVerifiedTariff() { return tariff ? { provider: 'openai', model: intent.model, accountRef: intent.accountRef,
      stage: intent.stage, currency: 'CNY', verifiedAccountPrice: true, evidenceRef: 'verified-account-tariff',
      checkedAt: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
      meters: { inputTokens: { priceCny: 1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 },
        outputTokens: { priceCny: 1, unitsPerPrice: 1000, minimumUnits: 0, increment: 1 } } } : null; },
    async measureInputTokens() { return 100; },
  };
  const input = { scope, recordId, recordSha256, requestSha256, ledgerRoot: path.join(root, 'ledger'),
    permitRoot: path.join(root, 'permits'), receiptRoot: path.join(root, 'receipts'), ports };
  return { root, plan, input, setCurrent(value: boolean) { current = value; },
    setApproved(value: boolean) { approved = value; }, setSharedVolume(value: boolean) { sharedVolume = value; },
    setTariff(value: boolean) { tariff = value; } };
}

test('approved record, quote and shared volume are required before reservation', async () => {
  const f = fixture();
  try {
    f.setSharedVolume(false);
    await assert.rejects(reserveImageEvidencePaidCall(f.input), /shared_volume_missing/);
    f.setSharedVolume(true); f.setApproved(false);
    await assert.rejects(reserveImageEvidencePaidCall(f.input), /approval_missing/);
    f.setApproved(true); f.setTariff(false);
    await assert.rejects(reserveImageEvidencePaidCall(f.input), /tariff_missing_or_expired/);
    f.setTariff(true); f.setCurrent(false);
    await assert.rejects(reserveImageEvidencePaidCall(f.input), /record_changed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('durable claim prevents a second submission across context instances', async () => {
  const f = fixture();
  try {
    const call = await reserveImageEvidencePaidCall(f.input);
    assert.equal(call.intent.inputContractHash, f.input.requestSha256);
    const { maximumUnits: _, ...binding } = call.intent;
    await call.permit.beforeSubmit({ ...binding, actualUnits: { inputTokens: 100, outputTokens: 7000 } });
    const second = await reserveImageEvidencePaidCall(f.input);
    await assert.rejects(second.permit.beforeSubmit({ ...binding, actualUnits: { inputTokens: 100, outputTokens: 7000 } }), /receipt_recovery_required/);
    const recovered = await second.permit.assertRecovery?.(call.intent.operationId);
    assert.equal((recovered as { status: string }).status, 'unknown');
    assert.deepEqual(await second.recoverReceipt(), { status: 'unknown', response: null });
    const receiptRef = await call.persistProviderReceipt({ requestSha256: f.input.requestSha256,
      response: { status: 200, body: '{"choices":[]}' } });
    await call.permit.markOutcome(call.intent.operationId, 'completed', receiptRef);
    assert.deepEqual(await second.recoverReceipt(), { status: 'completed', response: { status: 200, body: '{"choices":[]}' } });
    f.setCurrent(false);
    await assert.rejects(second.permit.beforeSubmit({ ...binding, actualUnits: { inputTokens: 100, outputTokens: 7000 } }), /record_changed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('tenant, record and exact request are frozen by plan hash', async () => {
  const f = fixture();
  try {
    await assert.rejects(reserveImageEvidencePaidCall({ ...f.input, requestSha256: 'c'.repeat(64) }), /plan_invalid/);
    await assert.rejects(reserveImageEvidencePaidCall({ ...f.input, scope: { ...f.input.scope, tenantId: 'tenant-2' } }), /plan_invalid/);
    f.plan.paidOperations[0]!.maximumUnits.inputTokens = 2000;
    await assert.rejects(reserveImageEvidencePaidCall(f.input), /plan_invalid/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('approved context executes once and recovers raw provider receipt without repost', async () => {
  const f = fixture();
  let submits = 0;
  const fetcher = async () => {
    submits++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      observedFacts: [{ imageIndex: 1, subjects: ['bottle'], confidence: .9 }], layerBlueprints: [],
    }) } }] }), { status: 200 });
  };
  try {
    const call = await reserveImageEvidencePaidCall(f.input);
    await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...evidenceInput, apiKey: 'wrong-key', paidCall: call, fetcher }), /account_changed/);
    assert.equal(submits, 0);
    const result = await reviewImagePostEvidenceWithOpenAI({ ...evidenceInput, apiKey: 'isolated-test-key', paidCall: call, fetcher });
    assert.equal(result.observedFacts[0]?.subjects[0], 'bottle');
    const resumed = await reserveImageEvidencePaidCall(f.input);
    assert.equal((await resumed.recoverReceipt()).response?.status, 200);
    await assert.rejects(reviewImagePostEvidenceWithOpenAI({ ...evidenceInput, apiKey: 'isolated-test-key', paidCall: resumed, fetcher }), /receipt_recovery_required/);
    assert.equal(submits, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a changed record cannot settle or repost, but an in-flight response is still preserved', async () => {
  const f = fixture();
  try {
    const call = await reserveImageEvidencePaidCall(f.input);
    const { maximumUnits: _, ...binding } = call.intent;
    await call.permit.beforeSubmit({ ...binding, actualUnits: { inputTokens: 100, outputTokens: 7000 } });
    f.setCurrent(false);
    const ref = await call.persistProviderReceipt({ requestSha256: f.input.requestSha256,
      response: { status: 200, body: '{"choices":[]}' } });
    assert.deepEqual(createImageEvidenceReceiptStore({ root: f.input.receiptRoot, scope: f.input.scope,
      operationId: call.intent.operationId, requestSha256: f.input.requestSha256 }).read(ref),
    { status: 200, body: '{"choices":[]}' });
    await assert.rejects(call.permit.markOutcome(call.intent.operationId, 'completed', ref), /record_changed/);
    await assert.rejects(call.permit.beforeSubmit({ ...binding, actualUnits: { inputTokens: 100, outputTokens: 7000 } }), /record_changed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

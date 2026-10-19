import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('./WeeklySamplePolicyCandidateIntervention.tsx', import.meta.url), 'utf8');
const cta = readFileSync(new URL('./WeeklyCtaContactIntervention.tsx', import.meta.url), 'utf8');

test('sample policy candidate is a distinct one-publication intake inside the existing task', () => {
  assert.match(cta, /WeeklySamplePolicyCandidateIntervention scope=\{scope\}/);
  assert.match(editor, /本次仅为所选发布任务留档候选 PDF/);
  assert.match(editor, /publicationTaskId: taskId/);
  assert.doesNotMatch(editor, /Promise\.all\(.*submitWeeklySamplePolicyCandidate|publications\.map\(.*submitWeeklySamplePolicyCandidate/);
  assert.match(editor, /policyStatus !== 'candidate_only'/);
  assert.match(editor, /不解除免费样品成片门禁/);
});

test('candidate submit requires structured terms, real PDF and authoritative reread', () => {
  assert.match(editor, /sampleFeeCny: 0/);
  assert.match(editor, /shippingFeePayer/);
  assert.match(editor, /customsDutyPayer/);
  assert.match(editor, /maximumFreeQuantity/);
  assert.match(editor, /eligibleMarkets/);
  assert.match(editor, /eligibleCustomerTypes/);
  assert.match(editor, /validFrom/);
  assert.match(editor, /validUntil/);
  assert.match(editor, /file\.slice\(0, 5\)\.text\(\) !== '%PDF-'/);
  assert.match(editor, /readWeeklySamplePolicyCandidates\(scope\.programId, scope\.packageId, scope\.packageVersion, taskId\)/);
  assert.match(editor, /submissionUncertain/);
});

test('uncertain submission is reconciled by source digest and terms, then retries only the cached original request', () => {
  assert.match(editor, /matchingSamplePolicyCandidate\(next, uncertain\.sourceSha256, uncertain\.terms\)/);
  assert.match(editor, /expectedContextHash: pending\.expectedContextHash, terms: pending\.terms, pdfDataUrl/);
  assert.match(editor, /重试原提交（同一请求）/);
  assert.doesNotMatch(editor, /next\.candidates\.length > \(view\?\.candidates\.length/);
});

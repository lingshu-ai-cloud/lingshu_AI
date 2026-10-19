import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSamplePolicyCandidate } from './weeklySamplePolicyCandidateRecovery.js';
import type { WeeklySamplePolicyCandidates, WeeklySamplePolicyTerms } from '../../lib/socialProgramApi.js';

const terms: WeeklySamplePolicyTerms = { sampleFeeCny: 0, shippingFeePayer: 'buyer', customsDutyPayer: 'buyer', maximumFreeQuantity: 1, eligibleMarkets: ['VN'], eligibleCustomerTypes: ['buyer'], validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' };
const candidate = { candidateId: 'original', sourceSha256: 'a'.repeat(64), sourceSize: 12, terms, submittedAt: '2026-10-18T00:00:00Z', reviewStatus: 'pending_independent_verification' as const };
const view: WeeklySamplePolicyCandidates = { contextHash: '0'.repeat(64), selection: { productId: 'product', productName: 'Product', productSku: null }, frozenCta: 'Free sample', candidates: [candidate], policyStatus: 'candidate_only' };

test('unknown upload is confirmed only by matching the PDF digest and exact policy terms', () => {
  assert.equal(matchingSamplePolicyCandidate(view, candidate.sourceSha256, terms)?.candidateId, 'original');
  assert.equal(matchingSamplePolicyCandidate(view, 'b'.repeat(64), terms), null);
  assert.equal(matchingSamplePolicyCandidate(view, candidate.sourceSha256, { ...terms, maximumFreeQuantity: 2 }), null);
});

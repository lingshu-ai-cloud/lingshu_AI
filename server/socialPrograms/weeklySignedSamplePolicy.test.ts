import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { verifyPreprovisionedSignedSamplePolicy, type SignedSamplePolicy } from './weeklySignedSamplePolicy.js';

test('only independently preprovisioned signature and live non-revocation validate exact frozen claim', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const scope = { tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 7, publicationTaskId: 'task' };
  const context = { scope, selectionHash: 'a'.repeat(64), productId: 'product', productSku: 'SKU',
    enterpriseFactContentHash: 'b'.repeat(64), frozenCtaHash: 'c'.repeat(64),
    contactReceiptId: 'contact', contactHash: 'd'.repeat(64), targetMarket: 'VN', customerType: 'business' };
  const body = { kind: 'weekly-sample-policy-attestation.v1' as const, issuerId: 'independent-policy-issuer',
    keyId: 'key-1', policyId: 'policy-1', scope, selectionHash: context.selectionHash,
    productId: context.productId, productSku: context.productSku,
    enterpriseFactContentHash: context.enterpriseFactContentHash, frozenCtaHash: context.frozenCtaHash,
    contactReceiptId: context.contactReceiptId, contactHash: context.contactHash, sourceSha256: 'e'.repeat(64),
    terms: { sampleFeeCny: 0 as const, shippingFeePayer: 'seller' as const,
      customsDutyPayer: 'buyer' as const, maximumFreeQuantity: 1,
      eligibleMarkets: ['VN'], eligibleCustomerTypes: ['business'],
      validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' },
    issuedAt: '2026-10-18T00:00:00Z' };
  const policy: SignedSamplePolicy = { ...body,
    signatureBase64: sign(null, Buffer.from(socialRequestHash(body)), privateKey).toString('base64') };
  const root = { issuerId: body.issuerId, keyId: body.keyId, tenantId: scope.tenantId,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const read = (overrides: Record<string, unknown> = {}) => verifyPreprovisionedSignedSamplePolicy({
    policy, context, preprovisionedRoots: [root], isRevoked: async () => false,
    now: new Date('2026-10-19T00:00:00Z'), ...overrides,
  });
  assert.equal(await read(), policy);
  assert.equal(await read({ preprovisionedRoots: [] }), null);
  assert.equal(await read({ isRevoked: async () => true }), null);
  assert.equal(await read({ isRevoked: async () => null }), null);
  assert.equal(await read({ isRevoked: async () => { throw Error('offline'); } }), null);
  assert.equal(await read({ context: { ...context, productSku: 'OTHER' } }), null);
  assert.equal(await read({ context: { ...context, scope: { ...scope, packageVersion: 8 } } }), null);
  assert.equal(await read({ context: { ...context, frozenCtaHash: 'f'.repeat(64) } }), null);
  assert.equal(await read({ context: { ...context, contactReceiptId: 'other' } }), null);
  assert.equal(await read({ context: { ...context, targetMarket: 'US' } }), null);
  assert.equal(await read({ context: { ...context, customerType: 'consumer' } }), null);
  assert.equal(await read({ now: new Date('2026-11-01T00:00:00Z') }), null);
  assert.equal(await read({ policy: { ...policy, terms: { ...policy.terms, sampleFeeCny: 1 } } }), null);
  assert.equal(await read({ policy: { ...policy, terms: { ...policy.terms, shippingFeePayer: 'buyer' } } }), null);
  assert.equal(await read({ policy: { ...policy, signatureBase64: 'fake' } }), null);
});

import assert from 'node:assert/strict';
import { resolveReferenceSalesPresenter } from './referencePresenterLock.js';

const rightsEvidence = {
  authorizationRef: 'rights://sales/authorization', consentRef: 'consent://sales/voice',
  grantedAt: '2025-01-01T00:00:00.000Z', subjectAdultConfirmed: true,
  permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'],
};
const sales = { id: 'sales-1', name: '销售', assetVersion: 2, authorized: true,
  rightsEvidence };

assert.deepEqual(resolveReferenceSalesPresenter([{ payload: { presenters: [sales] } }]), {
  assetId: 'sales-1', assetVersion: '2', rightsVerified: true,
  rightsEvidenceRef: 'rights://sales/authorization',
});
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [{ ...sales, assetVersion: undefined }] } }])?.assetVersion, '1');
assert.equal(resolveReferenceSalesPresenter([]), null);
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [sales] } }, { payload: { presenters: [] } }]), null);
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [sales, { ...sales, id: 'sales-2' }] } }]), null);
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [{ ...sales, rightsEvidence: undefined }] } }]), null);
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [{ ...sales, assetVersion: 0 }] } }]), null);
assert.equal(resolveReferenceSalesPresenter([{ payload: { presenters: [{ ...sales, authorized: false }] } }]), null);

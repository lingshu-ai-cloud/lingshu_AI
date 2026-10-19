import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareWeeklyEnterpriseFactFixture, reopenWeeklyEnterpriseFactFixtureStore } from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import { issueWeeklyPublicationProductSelections, readWeeklyPublicationProductSelectionChoices } from './weeklyPublicationProductSelection.js';
import { adoptWeeklyAutomationTemplate } from './weeklyAutomationTemplate.js';
import { inspectWeeklySamplePolicyCandidates, readWeeklySamplePolicyAdmissionDiagnostic, readWeeklySamplePolicyCandidateContext, readWeeklySamplePolicyEvidence, submitWeeklySamplePolicyCandidate, WEEKLY_SAMPLE_POLICY_CANDIDATES, type SamplePolicyTerms } from './weeklySamplePolicyEvidence.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { readWeeklyCtaContact, saveWeeklyCtaContact } from './weeklyCtaContact.js';

const terms: SamplePolicyTerms = {
  sampleFeeCny: 0, shippingFeePayer: 'buyer', customsDutyPayer: 'buyer', maximumFreeQuantity: 1,
  eligibleMarkets: ['CN'], eligibleCustomerTypes: ['business_buyer'],
  validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-12-31T23:59:59Z',
};

test('policy PDF is candidate-only; authentic selection and frozen CTA are re-read; bytes survive restart', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sample-policy-evidence-'));
  const oldRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT, oldDriver = process.env.OBJECT_STORAGE_DRIVER;
  process.env.LOCAL_OBJECT_STORAGE_ROOT = root; process.env.OBJECT_STORAGE_DRIVER = 'local';
  try {
    const file = path.join(root, 'store.json');
    const f = await prepareWeeklyEnterpriseFactFixture(t, { persistentFile: file });
    const scope = { tenantId: f.task.tenantId, programId: f.task.programId, packageId: f.task.packageId, packageVersion: 1, publicationTaskId: 'pub' };
    const pkgRow = (await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
    const publication = { ...pkgRow.payload.socialContentPackage.publicationTasks[0], motherContentId: 'mother', status: 'planned' };
    await f.store.update('social_weekly_operating_packages', pkgRow.id, {
      payload: { ...pkgRow.payload, socialContentPackage: { ...pkgRow.payload.socialContentPackage, publicationTasks: [publication] } },
    });
    const product = f.profile.products.items![0]!;
    const pdfBytes = Buffer.from('%PDF-1.7\nActual enterprise policy candidate\n%%EOF');
    await assert.rejects(submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner', expectedContextHash: '0'.repeat(64), terms, pdfBytes }), /selection_missing/);
    const choices = await readWeeklyPublicationProductSelectionChoices(f.store, scope);
    await issueWeeklyPublicationProductSelections(f.store, scope, 'owner', { expectedContextHash: choices.contextHash, productId: product.id!, publicationTaskIds: ['pub'] });
    await adoptWeeklyAutomationTemplate(f.store, scope, 'owner');
    const policyContext = await readWeeklySamplePolicyCandidateContext(f.store, scope);
    await assert.rejects(submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'outsider', expectedContextHash: policyContext.contextHash, terms, pdfBytes }), /package_missing/);
    const candidate = await submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner', expectedContextHash: policyContext.contextHash, terms, pdfBytes });
    const beforeContact = await readWeeklySamplePolicyAdmissionDiagnostic(f.store, scope);
    assert.equal(beforeContact.productId, product.id);
    assert.equal(beforeContact.frozenCtaHash, candidate.frozenCtaHash);
    assert.equal(beforeContact.selectionHash, candidate.selectionHash);
    assert.equal(beforeContact.requirements.recordedContactReceipt, false);
    assert.equal(beforeContact.authorizesProduction, false);
    const contactContext = await readWeeklyCtaContact(f.store, scope);
    const savedContact = await saveWeeklyCtaContact(f.store, scope, 'owner', {
      contactChannel: 'whatsapp', contactValue: '+12025550123',
      expectedContextHash: contactContext.contextHash, expectedReceiptId: null,
    });
    const afterContact = await readWeeklySamplePolicyAdmissionDiagnostic(f.store, scope);
    assert.equal(afterContact.contactReceiptId, savedContact.receiptId);
    assert.equal(afterContact.contactValue, '+12025550123');
    assert.equal(afterContact.requirements.recordedContactReceipt, true);
    assert.equal(afterContact.requirements.liveMetaNumberMembership, false);
    assert.equal(afterContact.requirements.independentlyAuthenticatedPolicyIssuer, false);
    assert.equal(afterContact.requirements.productAndTermsCoveredByIssuer, false);
    assert.equal(afterContact.requirements.issuerRevocationChecked, false);
    assert.equal(afterContact.requirements.validAtProductionAndBeforePayment, false);
    assert.equal(afterContact.authorizesProduction, false);
    assert.equal(candidate.productId, product.id);
    assert.equal(candidate.productSku, null, 'the golden-style product may have no structured SKU');
    assert.equal(candidate.authorizesProduction, false);
    assert.equal((await f.store.list(WEEKLY_SAMPLE_POLICY_CANDIDATES)).totalItems, 1);
    const replay = await submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner', expectedContextHash: policyContext.contextHash, terms, pdfBytes });
    assert.equal(replay.candidateId, candidate.candidateId, 'unknown same-content submission must return the original candidate');
    assert.equal((await f.store.list(WEEKLY_SAMPLE_POLICY_CANDIDATES)).totalItems, 1);
    for (let index = 0; index < 100; index++) {
      const copy = { ...candidate, candidateId: `legacy-${index}` };
      await f.store.create(WEEKLY_SAMPLE_POLICY_CANDIDATES, { id: copy.candidateId, tenant_id: scope.tenantId, program_id: scope.programId, package_id: scope.packageId, package_version: scope.packageVersion, publication_task_id: scope.publicationTaskId, payload: copy, content_hash: socialRequestHash(copy) });
    }
    assert.equal((await inspectWeeklySamplePolicyCandidates(f.store, scope)).length, 101, 'historical candidates beyond one page must remain readable');
    assert.equal((await submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner', expectedContextHash: policyContext.contextHash, terms, pdfBytes })).candidateId, candidate.candidateId, 'idempotent replay remains available after the intake cap');
    await assert.rejects(submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner', expectedContextHash: policyContext.contextHash, terms, pdfBytes: Buffer.from('%PDF-1.7\nDifferent source\n%%EOF') }), /candidate_limit_reached/);
    const reopened = reopenWeeklyEnterpriseFactFixtureStore(file);
    assert.equal((await inspectWeeklySamplePolicyCandidates(reopened, scope))[0]?.candidateId, candidate.candidateId);
    assert.equal((await readWeeklySamplePolicyAdmissionDiagnostic(reopened, scope)).contactReceiptId, savedContact.receiptId);
    assert.equal(await readWeeklySamplePolicyEvidence({ store: reopened, scope }), null);
    await writeFile(path.join(root, candidate.sourceKey), Buffer.from('%PDF-1.7\nTampered\n%%EOF'));
    await assert.rejects(inspectWeeklySamplePolicyCandidates(reopened, scope), /source_missing|source_changed/);
    assert.equal(await readWeeklySamplePolicyEvidence({ store: reopened, scope }), null);
  } finally {
    if (oldRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = oldRoot;
    if (oldDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = oldDriver;
    await rm(root, { recursive: true, force: true });
  }
});

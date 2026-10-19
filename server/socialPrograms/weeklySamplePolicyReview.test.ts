import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareWeeklyEnterpriseFactFixture, reopenWeeklyEnterpriseFactFixtureStore } from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import { issueWeeklyPublicationProductSelections, readWeeklyPublicationProductSelectionChoices } from './weeklyPublicationProductSelection.js';
import { adoptWeeklyAutomationTemplate } from './weeklyAutomationTemplate.js';
import { readWeeklyCtaContact, saveWeeklyCtaContact } from './weeklyCtaContact.js';
import { readWeeklySamplePolicyCandidateContext, readWeeklySamplePolicyEvidence, submitWeeklySamplePolicyCandidate } from './weeklySamplePolicyEvidence.js';
import { recordWeeklySamplePolicyReview, readWeeklySamplePolicyReviewLedger, revokeWeeklySamplePolicyReview,
  REVIEW_FIELDS, type FieldFinding, WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS,
  WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS } from './weeklySamplePolicyReview.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';

test('documentary policy review is separate, immutable, revocable and never a production grant', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sample-policy-review-'));
  const oldRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT, oldDriver = process.env.OBJECT_STORAGE_DRIVER;
  process.env.LOCAL_OBJECT_STORAGE_ROOT = root; process.env.OBJECT_STORAGE_DRIVER = 'local';
  try {
    const file = path.join(root, 'store.json');
    const f = await prepareWeeklyEnterpriseFactFixture(t, { persistentFile: file });
    const scope = { tenantId: f.task.tenantId, programId: f.task.programId, packageId: f.task.packageId,
      packageVersion: 1, publicationTaskId: 'pub' };
    const pkg = (await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
    await f.store.update('social_weekly_operating_packages', pkg.id, { payload: {
      ...pkg.payload, socialContentPackage: { ...pkg.payload.socialContentPackage,
        publicationTasks: [{ ...pkg.payload.socialContentPackage.publicationTasks[0], motherContentId: 'mother', status: 'planned' }] },
    } });
    const product = f.profile.products.items![0]!;
    const choices = await readWeeklyPublicationProductSelectionChoices(f.store, scope);
    await issueWeeklyPublicationProductSelections(f.store, scope, 'owner', {
      expectedContextHash: choices.contextHash, productId: product.id!, publicationTaskIds: ['pub'],
    });
    await adoptWeeklyAutomationTemplate(f.store, scope, 'owner');
    const cta = await readWeeklyCtaContact(f.store, scope);
    await saveWeeklyCtaContact(f.store, scope, 'owner', { contactChannel: 'whatsapp', contactValue: '+12025550123',
      expectedContextHash: cta.contextHash, expectedReceiptId: null });
    const policy = await readWeeklySamplePolicyCandidateContext(f.store, scope);
    const candidate = await submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner',
      expectedContextHash: policy.contextHash, pdfBytes: Buffer.from('%PDF-1.7\nIsolated unverified candidate\n%%EOF'),
      terms: { sampleFeeCny: 0, shippingFeePayer: 'buyer', customsDutyPayer: 'buyer', maximumFreeQuantity: 1,
        eligibleMarkets: ['CN'], eligibleCustomerTypes: ['business_buyer'],
        validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-12-31T23:59:59Z' },
    });
    const findings: FieldFinding[] = REVIEW_FIELDS.map(field => ({ field, page: 1,
      excerpt: `Reviewer-reported document location for ${field}`, conclusion: 'supported' }));
    await assert.rejects(recordWeeklySamplePolicyReview({ store: f.store, scope,
      candidateId: candidate.candidateId, expectedCandidateHash: socialRequestHash(candidate),
      reviewerUserId: 'owner', findings }), /reviewer_forbidden/);
    await f.store.create('users', { id: 'reviewer', tenantId: scope.tenantId, role: 'admin', active: true });
    await assert.rejects(recordWeeklySamplePolicyReview({ store: f.store, scope,
      candidateId: candidate.candidateId, expectedCandidateHash: '0'.repeat(64),
      reviewerUserId: 'reviewer', findings }), /candidate_changed/);
    await assert.rejects(recordWeeklySamplePolicyReview({ store: f.store, scope,
      candidateId: candidate.candidateId, expectedCandidateHash: socialRequestHash(candidate),
      reviewerUserId: 'reviewer', findings: findings.slice(1) }), /findings_incomplete/);
    const first = await recordWeeklySamplePolicyReview({ store: f.store, scope,
      candidateId: candidate.candidateId, expectedCandidateHash: socialRequestHash(candidate),
      reviewerUserId: 'reviewer', findings });
    assert.equal(first.authorizesProduction, false);
    const same = await recordWeeklySamplePolicyReview({ store: f.store, scope,
      candidateId: candidate.candidateId, expectedCandidateHash: socialRequestHash(candidate),
      reviewerUserId: 'reviewer', findings });
    assert.equal(same.decisionId, first.decisionId);
    const reopened = reopenWeeklyEnterpriseFactFixtureStore(file);
    const ledger = await readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId);
    assert.deepEqual(ledger.decisions, [{ decisionId: first.decisionId, outcome: 'all_fields_supported', revoked: false }]);
    assert.equal((await readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId,
      new Date('2027-01-01T00:00:00Z'))).expired, true);
    assert.equal(ledger.authorizesProduction, false);
    assert.equal(await readWeeklySamplePolicyEvidence({ store: reopened, scope }), null);
    await reopened.create(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, {
      id: 'orphanoperation', tenant_id: scope.tenantId, program_id: scope.programId,
      package_id: scope.packageId, package_version: scope.packageVersion,
      publication_task_id: scope.publicationTaskId, candidate_id: candidate.candidateId,
      payload: {}, content_hash: '0'.repeat(64),
    });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /ledger_incomplete/);
    await reopened.delete(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, 'orphanoperation');
    await reopened.create(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, {
      id: 'orphanrevocatio', tenant_id: scope.tenantId, program_id: scope.programId,
      package_id: scope.packageId, package_version: scope.packageVersion,
      publication_task_id: scope.publicationTaskId, decision_id: 'missingdecision',
      payload: {}, content_hash: '0'.repeat(64),
    });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /revocation_orphan/);
    await reopened.delete(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, 'orphanrevocatio');
    await reopened.update('users', 'reviewer', { active: false });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /reviewer_revoked/);
    await reopened.update('users', 'reviewer', { active: true });
    await revokeWeeklySamplePolicyReview({ store: reopened, scope, decisionId: first.decisionId,
      actorUserId: 'reviewer', reason: 'Source authority is unproven' });
    assert.equal((await readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId)).decisions[0]?.revoked, true);
    const decisionBeforeChronology = await reopened.getById<any>(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, first.decisionId);
    const operationBeforeChronology = await reopened.getById<any>(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, decisionBeforeChronology.payload.operationId);
    const forgedReviewedAt = new Date(Date.parse(candidate.submittedAt) - 1000).toISOString();
    const forgedDecision = { ...decisionBeforeChronology.payload, reviewedAt: forgedReviewedAt };
    const forgedOperation = { ...operationBeforeChronology.payload, reviewedAt: forgedReviewedAt,
      decisionHash: socialRequestHash(forgedDecision) };
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, first.decisionId,
      { payload: forgedDecision, content_hash: socialRequestHash(forgedDecision) });
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, operationBeforeChronology.id,
      { payload: forgedOperation, content_hash: socialRequestHash(forgedOperation) });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /decision_chronology_invalid/);
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, first.decisionId,
      { payload: decisionBeforeChronology.payload, content_hash: decisionBeforeChronology.content_hash });
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, operationBeforeChronology.id,
      { payload: operationBeforeChronology.payload, content_hash: operationBeforeChronology.content_hash });
    const originalRevocation = (await reopened.list<any>(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS)).items[0]!;
    const earlyRevocation = { ...originalRevocation.payload,
      revokedAt: new Date(Date.parse(decisionBeforeChronology.payload.reviewedAt) - 1000).toISOString() };
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, originalRevocation.id,
      { payload: earlyRevocation, content_hash: socialRequestHash(earlyRevocation) });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /revocation_invalid/);
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, originalRevocation.id,
      { payload: originalRevocation.payload, content_hash: originalRevocation.content_hash });
    await reopened.update('users', 'reviewer', { active: false });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /reviewer_revoked|revoker_revoked/);
    await reopened.update('users', 'reviewer', { active: true });
    const revocationId = (await reopened.list<any>(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS)).items[0]!.id;
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, revocationId, { publication_task_id: 'another-publication' });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /revocation_index_invalid/);
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, revocationId, { publication_task_id: scope.publicationTaskId });
    const row = await reopened.getById<any>(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, first.decisionId);
    await reopened.update(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, first.decisionId,
      { payload: { ...row.payload, reviewerUserId: 'owner' } });
    await assert.rejects(readWeeklySamplePolicyReviewLedger(reopened, scope, candidate.candidateId), /decision_invalid/);
  } finally {
    if (oldRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = oldRoot;
    if (oldDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = oldDriver;
    await rm(root, { recursive: true, force: true });
  }
});

import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { organizationRoleOrNull } from '../lib/organizationRole.js';
import { readWeeklyReviewActor } from './weeklyReviewEvidence.js';
import { inspectWeeklySamplePolicyCandidates, type SamplePolicyScope } from './weeklySamplePolicyEvidence.js';
import { readWeeklyCtaContact } from './weeklyCtaContact.js';
import { withExecutionPackageGate } from './weeklyExecutionGate.js';

/** Documentary review ledger only. An authenticated reviewer route and an
 * independently established policy-source authority are still absent. Never
 * interpret a ledger entry as permission to render the free-sample claim. */
export const WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS = 'social_weekly_sample_policy_review_operations';
export const WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS = 'social_weekly_sample_policy_review_decisions';
export const WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS = 'social_weekly_sample_policy_review_revocations';

export const REVIEW_FIELDS = ['product', 'markets', 'customerTypes', 'maximumFreeQuantity',
  'sampleFee', 'shippingFeePayer', 'customsDutyPayer', 'validity'] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export type FieldFinding = { field: ReviewField; page: number; excerpt: string; conclusion: 'supported' | 'unsupported' };
type Scope = SamplePolicyScope;
type Operation = { kind: 'weekly-sample-policy-review-operation.v1'; operationId: string; scope: Scope;
  candidateId: string; candidateHash: string; contactReceiptId: string; contactHash: string;
  reviewerUserId: string; reviewedAt: string; findingsHash: string; decisionHash: string;
  status: 'recorded_not_authoritative' };
type Decision = { kind: 'weekly-sample-policy-review-decision.v1'; decisionId: string; operationId: string;
  scope: Scope; candidateId: string; candidateHash: string; contactReceiptId: string; contactHash: string;
  reviewerUserId: string; reviewedAt: string; findings: FieldFinding[];
  outcome: 'all_fields_supported' | 'rejected'; authorizesProduction: false;
  authorizesPublishing: false; authorizesCustomerMessages: false };
type Revocation = { kind: 'weekly-sample-policy-review-revocation.v1'; revocationId: string;
  scope: Scope; decisionId: string; revokedBy: string; revokedAt: string; reason: string };
const hash = socialRequestHash;
const id = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 15);
const where = (s: Scope) => ({ tenant_id: s.tenantId, program_id: s.programId,
  package_id: s.packageId, package_version: s.packageVersion, publication_task_id: s.publicationTaskId });
function fail(code: string): never { throw Error(`weekly_sample_policy_review_${code}`); }
function rowMatchesScope(row: Record_, scope: Scope) {
  return Object.entries(where(scope)).every(([field, value]) => row[field] === value);
}
async function scopedRows(store: DataStore, collection: string, filter: Record<string, string | number>) {
  const result: Record_[] = []; const ids = new Set<string>(); let expected: number | null = null;
  for (let page = 1; page <= 1000; page++) {
    const batch = await store.list<Record_>(collection, { where: filter, page, perPage: 100, sort: 'id' });
    if (!Number.isSafeInteger(batch.totalItems) || batch.totalItems < 0
      || (expected !== null && expected !== batch.totalItems)) fail('ledger_pagination_changed');
    expected = batch.totalItems;
    for (const row of batch.items) {
      if (!row.id || ids.has(row.id)) fail('ledger_pagination_duplicate');
      ids.add(row.id); result.push(row);
    }
    if (result.length === expected) return result;
    if (!batch.items.length) fail('ledger_pagination_incomplete');
  }
  fail('ledger_pagination_incomplete');
}
function validActor(row: Record_ | null, tenantId: string, allowed: readonly string[]) {
  return Boolean(row && row.tenantId === tenantId && allowed.includes(organizationRoleOrNull(row.role) ?? '')
    && row.disabled !== true && row.active !== false && !['disabled', 'suspended'].includes(String(row.status)));
}
function assertFindings(findings: FieldFinding[]) {
  if (!Array.isArray(findings) || findings.length !== REVIEW_FIELDS.length
    || new Set(findings.map(f => f.field)).size !== REVIEW_FIELDS.length
    || findings.some(f => !REVIEW_FIELDS.includes(f.field) || !Number.isSafeInteger(f.page) || f.page < 1
      || typeof f.excerpt !== 'string' || f.excerpt.trim() !== f.excerpt || f.excerpt.length < 8
      || f.excerpt.length > 1000 || !['supported', 'unsupported'].includes(f.conclusion))) fail('findings_incomplete');
}
async function context(store: DataStore, scope: Scope, candidateId: string) {
  const candidates = await inspectWeeklySamplePolicyCandidates(store, scope);
  const candidate = candidates.find(item => item.candidateId === candidateId);
  if (!candidate || candidates.filter(item => item.candidateId === candidateId).length !== 1) fail('candidate_missing');
  const contact = await readWeeklyCtaContact(store, scope);
  if (contact.status !== 'recorded' || !contact.receipt) fail('contact_missing');
  return { candidate, candidateHash: hash(candidate), contact: contact.receipt,
    contactHash: hash(contact.receipt) };
}

/** Called only after transport authentication has supplied reviewerUserId.
 * This writes an audit of human assertions; it cannot verify PDF semantics or
 * authority and therefore deliberately cannot produce admission evidence. */
export async function recordWeeklySamplePolicyReview(input: { store: DataStore; scope: Scope;
  candidateId: string; expectedCandidateHash: string; reviewerUserId: string; findings: FieldFinding[] }) {
  assertFindings(input.findings);
  const { store, scope } = input;
  return withExecutionPackageGate(store, scope, async assert => {
    const { candidate, candidateHash, contact, contactHash } = await context(store, scope, input.candidateId);
    if (candidateHash !== input.expectedCandidateHash) fail('candidate_changed');
    const reviewer = await readWeeklyReviewActor(store, scope.tenantId, input.reviewerUserId);
    if (!validActor(reviewer, scope.tenantId, ['super_admin', 'admin'])
      || input.reviewerUserId === candidate.submittedBy || input.reviewerUserId === contact.confirmedBy) fail('reviewer_forbidden');
    const findings = [...input.findings].sort((a, b) => REVIEW_FIELDS.indexOf(a.field) - REVIEW_FIELDS.indexOf(b.field));
    const operationId = id(['weekly-policy-review-operation', scope, candidate.candidateId, candidateHash,
      contact.receiptId, contactHash, input.reviewerUserId, hash(findings)]);
    const old = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, operationId);
    const reviewedAt = old ? (old.payload as Operation | undefined)?.reviewedAt : new Date().toISOString();
    if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) fail('operation_invalid');
    const decisionId = id(['weekly-policy-review-decision', operationId]);
    const decision: Decision = { kind: 'weekly-sample-policy-review-decision.v1', decisionId, operationId,
      scope, candidateId: candidate.candidateId, candidateHash, contactReceiptId: contact.receiptId,
      contactHash, reviewerUserId: input.reviewerUserId, reviewedAt, findings,
      outcome: findings.every(f => f.conclusion === 'supported') ? 'all_fields_supported' : 'rejected',
      authorizesProduction: false, authorizesPublishing: false, authorizesCustomerMessages: false };
    const operation: Operation = { kind: 'weekly-sample-policy-review-operation.v1', operationId, scope,
      candidateId: candidate.candidateId, candidateHash, contactReceiptId: contact.receiptId,
      contactHash, reviewerUserId: input.reviewerUserId, reviewedAt, findingsHash: hash(findings),
      decisionHash: hash(decision), status: 'recorded_not_authoritative' };
    if (old) {
      if (old.id !== operationId || old.content_hash !== hash(operation)
        || hash(old.payload) !== hash(operation)) fail('operation_conflict');
    } else {
      await assert();
      if (!await store.create(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, { id: operationId, ...where(scope),
        candidate_id: candidate.candidateId, content_hash: hash(operation), payload: operation })) fail('operation_write_failed');
    }
    const oldDecision = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, decisionId);
    if (oldDecision) {
      if (oldDecision.id !== decisionId || oldDecision.content_hash !== hash(decision)
        || hash(oldDecision.payload) !== hash(decision)) fail('decision_conflict');
    } else {
      await assert();
      if (!await store.create(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, { id: decisionId, ...where(scope),
        candidate_id: candidate.candidateId, operation_id: operationId, content_hash: hash(decision), payload: decision })) fail('decision_write_failed');
    }
    await assert();
    return { decisionId, outcome: decision.outcome, authorizesProduction: false as const };
  });
}

export async function revokeWeeklySamplePolicyReview(input: { store: DataStore; scope: Scope;
  decisionId: string; actorUserId: string; reason: string }) {
  const { store, scope } = input;
  if (!input.reason.trim() || input.reason.trim() !== input.reason || input.reason.length > 1000) fail('reason_invalid');
  return withExecutionPackageGate(store, scope, async assert => {
    const decisionRow = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, input.decisionId);
    const decision = decisionRow?.payload as Decision | undefined;
    if (!decision || decisionRow?.content_hash !== hash(decision) || decisionRow.id !== decision.decisionId
      || hash(decision.scope) !== hash(scope)) fail('decision_missing');
    const actor = await readWeeklyReviewActor(store, scope.tenantId, input.actorUserId);
    if (!validActor(actor, scope.tenantId, ['super_admin', 'admin'])) fail('revoker_forbidden');
    const revocationId = id(['weekly-policy-review-revoke', scope, input.decisionId]);
    const old = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, revocationId);
    if (old) {
      const prior = old.payload as Revocation | undefined;
      if (!prior || old.content_hash !== hash(prior) || prior.reason !== input.reason
        || prior.revokedBy !== input.actorUserId || hash(prior.scope) !== hash(scope)) fail('revocation_conflict');
      return prior;
    }
    const revocation: Revocation = { kind: 'weekly-sample-policy-review-revocation.v1', revocationId,
      scope, decisionId: input.decisionId, revokedBy: input.actorUserId, revokedAt: new Date().toISOString(), reason: input.reason };
    await assert();
    if (!await store.create(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, { id: revocationId, ...where(scope),
      decision_id: input.decisionId, content_hash: hash(revocation), payload: revocation })) fail('revocation_write_failed');
    return revocation;
  });
}

/** Fail-closed read validates the complete ledger, source bytes, current
 * selection/contact and reviewer role. No source-authority verifier exists, so
 * even an all-fields-supported decision is never production evidence. */
export async function readWeeklySamplePolicyReviewLedger(store: DataStore, scope: Scope, candidateId: string, now = new Date()) {
  if (!Number.isFinite(now.getTime())) fail('clock_invalid');
  const { candidate, candidateHash, contact, contactHash } = await context(store, scope, candidateId);
  const filter = { ...where(scope), candidate_id: candidateId };
  const rows = await scopedRows(store, WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, filter);
  const operations = await scopedRows(store, WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, filter);
  const revocations = await scopedRows(store, WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, where(scope));
  const allScopedDecisions = await scopedRows(store, WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS, where(scope));
  if ([...rows, ...operations, ...revocations, ...allScopedDecisions].some(row => !rowMatchesScope(row, scope))) fail('ledger_scope_invalid');
  const allDecisionIds = new Set(allScopedDecisions.map(row => row.id));
  if (revocations.some(row => !allDecisionIds.has(String(row.decision_id)))) fail('revocation_orphan');
  const decisionIds = new Set(rows.map(row => row.id));
  const operationIds = new Set(operations.map(row => row.id));
  if (rows.some(row => !operationIds.has(String(row.operation_id)))
    || operations.some(row => !decisionIds.has(id(['weekly-policy-review-decision', row.id])))) fail('ledger_incomplete');
  const revocationIds = new Set(revocations.filter(row => decisionIds.has(String(row.decision_id))).map(row => row.id));
  const decisions: Array<{ decisionId: string; outcome: Decision['outcome']; revoked: boolean }> = [];
  for (const row of rows) {
    const d = row.payload as Decision | undefined;
    if (!d || d.kind !== 'weekly-sample-policy-review-decision.v1'
      || row.id !== d.decisionId || d.decisionId !== id(['weekly-policy-review-decision', d.operationId])
      || row.candidate_id !== candidateId || row.operation_id !== d.operationId
      || row.content_hash !== hash(d) || hash(d.scope) !== hash(scope)
      || d.candidateId !== candidateId || d.candidateHash !== candidateHash || d.contactReceiptId !== contact.receiptId
      || d.contactHash !== contactHash || d.authorizesProduction !== false || d.authorizesPublishing !== false
      || d.authorizesCustomerMessages !== false || !Number.isFinite(Date.parse(d.reviewedAt))
      || Date.parse(d.reviewedAt) > now.getTime()) fail('decision_invalid');
    assertFindings(d.findings);
    if (d.outcome !== (d.findings.every(f => f.conclusion === 'supported') ? 'all_fields_supported' : 'rejected')) fail('decision_invalid');
    const operationRow = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS, d.operationId);
    const operation = operationRow?.payload as Operation | undefined;
    if (!operation || operation.kind !== 'weekly-sample-policy-review-operation.v1'
      || operationRow?.id !== d.operationId || operationRow.content_hash !== hash(operation)
      || !rowMatchesScope(operationRow, scope) || operationRow.candidate_id !== candidateId
      || operation.decisionHash !== hash(d) || operation.findingsHash !== hash(d.findings)
      || operation.candidateId !== candidateId || hash(operation.scope) !== hash(scope)
      || operation.candidateHash !== candidateHash || operation.contactReceiptId !== contact.receiptId
      || operation.contactHash !== contactHash
      || operation.reviewerUserId !== d.reviewerUserId || operation.reviewedAt !== d.reviewedAt
      || operation.status !== 'recorded_not_authoritative') fail('operation_invalid');
    const reviewer = await readWeeklyReviewActor(store, scope.tenantId, d.reviewerUserId);
    if (!validActor(reviewer, scope.tenantId, ['super_admin', 'admin'])
      || d.reviewerUserId === candidate.submittedBy || d.reviewerUserId === contact.confirmedBy) fail('reviewer_revoked');
    // The hashes bind the documents, but a forged chronology must not turn a
    // decision made before either input existed into a later valid review.
    if (Date.parse(d.reviewedAt) < Date.parse(candidate.submittedAt)
      || Date.parse(d.reviewedAt) < Date.parse(contact.confirmedAt)) fail('decision_chronology_invalid');
    const revokeId = id(['weekly-policy-review-revoke', scope, d.decisionId]);
    // A damaged secondary scope index must not hide an existing revocation.
    const revokeRow = await store.getById<Record_>(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS, revokeId);
    if (revocations.some(row => row.decision_id === d.decisionId && row.id !== revokeId)) fail('revocation_ambiguous');
    if (revocationIds.has(revokeId) !== Boolean(revokeRow)) fail('revocation_index_invalid');
    if (revokeRow) {
      const revocation = revokeRow.payload as Revocation | undefined;
      if (!revocation || revocation.kind !== 'weekly-sample-policy-review-revocation.v1'
        || revokeRow.content_hash !== hash(revocation) || revocation.revocationId !== revokeId
        || !rowMatchesScope(revokeRow, scope) || revokeRow.decision_id !== d.decisionId
        || revocation.decisionId !== d.decisionId || hash(revocation.scope) !== hash(scope)
        || !revocation.reason || !Number.isFinite(Date.parse(revocation.revokedAt))
        || Date.parse(revocation.revokedAt) > now.getTime()
        || Date.parse(revocation.revokedAt) < Date.parse(d.reviewedAt)) fail('revocation_invalid');
      const revoker = await readWeeklyReviewActor(store, scope.tenantId, revocation.revokedBy);
      if (!validActor(revoker, scope.tenantId, ['super_admin', 'admin'])) fail('revoker_revoked');
    }
    decisions.push({ decisionId: d.decisionId, outcome: d.outcome, revoked: Boolean(revokeRow) });
  }
  const expired = now.getTime() < Date.parse(candidate.terms.validFrom)
    || now.getTime() > Date.parse(candidate.terms.validUntil);
  return { candidateId, policyStatus: 'candidate_only' as const, expired,
    decisions, authorizesProduction: false as const };
}

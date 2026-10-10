import assert from 'node:assert/strict';
import test from 'node:test';
import { decideMvpBoundary, type MvpBoundaryInput } from './mvpDecisionBoundary.js';

function fixture(): MvpBoundaryInput {
  const scope = { tenantId: 'tenant', accountId: 'account', productId: 'product', taskId: 'task', runId: 'run', version: 'v2' };
  return { scope, inputScopes: [{ ...scope }], action: 'generate_a', now: '2026-10-11T00:00:00Z', operation: 'new', outcome: 'none',
    authorizations: [{ scope: { ...scope }, action: 'generate_a', source: 'human', actorId: 'customer', sourceRef: 'conversation:approval', expiresAt: '2026-10-12T00:00:00Z', revoked: false }],
    budget: { allocation: 'A', currency: 'CNY', limitCny: 5, entries: [], nextReservationCny: 4, pricingSourceRef: 'account:current-price' } };
}
test('all frozen scope fields must match; business resolves conflicting inputs', () => {
  for (const key of Object.keys(fixture().scope) as Array<keyof MvpBoundaryInput['scope']>) {
    const input = fixture(); input.inputScopes[0][key] = 'other';
    assert.equal(decideMvpBoundary(input).reason, 'scope_conflict');
    assert.equal(decideMvpBoundary(input).owner, 'business');
  }
});
test('agent approvals never create human authorization or human quality confirmation', () => {
  const input = fixture(); input.authorizations[0].source = 'agent';
  assert.equal(decideMvpBoundary(input).allowed, false);
  input.action = 'human_quality_review'; input.authorizations[0].action = 'human_quality_review';
  assert.equal(decideMvpBoundary(input).allowed, false);
});
test('production, publication and generation authorizations are separate', () => {
  for (const action of ['publish', 'production_change', 'generate_b'] as const) {
    const input = fixture(); input.action = action;
    assert.equal(decideMvpBoundary(input).reason, 'missing_valid_human_authorization');
  }
  const input = fixture(); input.action = 'publish'; input.authorizations[0].action = 'publish';
  assert.equal(decideMvpBoundary(input).allowed, true);
  input.action = 'production_change'; assert.equal(decideMvpBoundary(input).allowed, false);
});
test('revoked, expired, cross-account and untraceable grants fail closed', () => {
  for (const change of [(i: MvpBoundaryInput) => { i.authorizations[0].revoked = true; },
    (i: MvpBoundaryInput) => { i.authorizations[0].expiresAt = i.now; },
    (i: MvpBoundaryInput) => { i.authorizations[0].scope.accountId = 'other'; },
    (i: MvpBoundaryInput) => { i.authorizations[0].sourceRef = ''; }]) {
    const input = fixture(); change(input); assert.equal(decideMvpBoundary(input).allowed, false);
  }
});
test('A five-yuan allocation cannot fund B or grow silently', () => {
  const input = fixture(); input.action = 'generate_b'; input.authorizations[0].action = 'generate_b';
  assert.equal(decideMvpBoundary(input).reason, 'wrong_budget_allocation');
  input.action = 'generate_a'; input.authorizations[0].action = 'generate_a'; input.budget!.limitCny = 6;
  assert.equal(decideMvpBoundary(input).reason, 'a_budget_exceeds_customer_five_cny');
});
test('changing request or version does not reset cumulative spending; actual and reserve are not double counted', () => {
  const input = fixture(); input.budget!.entries = [{ scope: { ...input.scope, version: 'v1' }, allocation: 'A', requestId: 'previous', reservedCny: 2, actualCny: 3 }];
  input.budget!.nextReservationCny = 2; assert.equal(decideMvpBoundary(input).allowed, true);
  input.budget!.nextReservationCny = 2.000001; assert.equal(decideMvpBoundary(input).reason, 'cumulative_budget_exceeded');
});
test('unknown requires original task recovery with no new reservation; absent task ID goes to administrator', () => {
  const input = fixture(); input.outcome = 'unknown';
  assert.equal(decideMvpBoundary(input).reason, 'unknown_original_task_only');
  input.operation = 'recover'; assert.equal(decideMvpBoundary(input).reason, 'unknown_task_id_requires_reconciliation');
  input.originalTaskId = 'supplier-original'; assert.equal(decideMvpBoundary(input).reason, 'recovery_must_not_reserve_again');
  input.budget!.nextReservationCny = 0; assert.equal(decideMvpBoundary(input).allowed, true);
});
test('passed output cannot be regenerated and pricing must have evidence', () => {
  const input = fixture(); input.outcome = 'completed'; assert.equal(decideMvpBoundary(input).reason, 'passed_task_must_not_regenerate');
  input.outcome = 'none'; input.budget!.pricingSourceRef = ''; assert.equal(decideMvpBoundary(input).reason, 'unverified_budget_or_price');
});
test('supplier and model changes within valid scope and budget need no repeated customer approval', () => {
  const input = fixture(); input.supplier = 'supplier-two'; input.model = 'model-two';
  assert.deepEqual(decideMvpBoundary(input), { allowed: true, reason: 'within_authorized_scope', owner: 'agent', requiresCustomerApproval: false });
  input.brandRequirementChanged = true; assert.equal(decideMvpBoundary(input).requiresCustomerApproval, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessContentGoal } from './businessGoalBuilder.js';
import { evaluateProductionOutlineReadiness } from './productionReadiness.js';
import type { BusinessGoalBuildInput, DecisionBlocker } from '../../shared/contracts/socialOperatingDecision.js';

const input: BusinessGoalBuildInput = {
  programRef: { type: 'social_program', id: 'program', version: 1 },
  enterprise: {
    ref: { type: 'enterprise_operating_snapshot', id: 'enterprise', version: 1 },
    products: ['product'], markets: ['US'], audiences: ['buyer'], languages: ['en'],
    prohibitedClaims: [], publicFacts: [{ ref: { type: 'enterprise_fact', id: 'fact', version: 1 }, statement: 'Existing product name' }],
    salesOwnerId: null, weeklyBudgetCny: 75,
  }, accounts: [], conversionRoutes: [],
};
const options = { version: 1, operator: { type: 'system' as const, id: 'system' }, decidedAt: '2026-10-16T00:00:00Z' };

test('outline scope never converts missing outbound readiness into a ready commercial goal or permission', () => {
  const { goal } = buildBusinessContentGoal(input, options);
  const before = structuredClone(goal);
  const proof = evaluateProductionOutlineReadiness(goal);
  assert.equal(proof.ready, true);
  assert.deepEqual(proof.deferredOutboundBlockers, ['account_required', 'conversion_route_required', 'sales_owner_required']);
  assert.equal(proof.authorizesProduction, false);
  assert.equal(proof.authorizesPublishing, false);
  assert.equal(proof.authorizesCustomerMessages, false);
  assert.equal(goal.status, 'blocked');
  assert.deepEqual(goal, before);
});

test('missing public facts and unknown technical/production blockers remain blocking', () => {
  const { goal } = buildBusinessContentGoal(input, options);
  const noFacts = evaluateProductionOutlineReadiness({ ...goal, publicFactRefs: [] });
  assert.equal(noFacts.ready, false);
  assert(noFacts.blockingCodes.includes('public_facts_required'));
  const blocked = evaluateProductionOutlineReadiness({ ...goal, blockers: [...goal.blockers, { code: 'rights_required', field: 'rights', message: 'missing', recoverable: true } as unknown as DecisionBlocker] });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockingCodes, ['rights_required']);
  assert.equal(evaluateProductionOutlineReadiness({ ...goal, blockers: [] }).ready, false);
});

test('evidence identity includes source decision fingerprint and fact versions', () => {
  const { goal } = buildBusinessContentGoal(input, options);
  const first = evaluateProductionOutlineReadiness(goal);
  assert.equal(first.evidenceHash, evaluateProductionOutlineReadiness(structuredClone(goal)).evidenceHash);
  assert.notEqual(first.evidenceHash, evaluateProductionOutlineReadiness({ ...goal, inputFingerprint: 'changed' }).evidenceHash);
  assert.notEqual(first.evidenceHash, evaluateProductionOutlineReadiness({ ...goal, publicFactRefs: [{ ...goal.publicFactRefs[0]!, version: 2 }] }).evidenceHash);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import { planCapacity, type CapacityPlanInput } from './capacityPlanner.js';

const ref = (type: string, id: string, version: number) => ({ type, id, version });
const goal: BusinessContentGoal = {
  goalId: 'goal-1', programId: 'program-1', version: 1, status: 'ready', objective: '获客', products: ['A'], markets: ['US'], audiences: ['buyer'], languages: ['en'],
  accountBoundaries: [], conversionRouteIds: ['route-1'], publicFactRefs: [ref('fact', 'fact-1', 1)], prohibitedClaims: [], weeklyBudgetCny: 1_000,
  evidence: [], blockers: [], inputRefs: [], inputFingerprint: 'goal-fingerprint', ruleVersion: 'business-content-goal/1.0.0',
  decisionRecordRef: ref('decision_record', 'goal-decision', 1), createdBy: 'agent', createdAt: '2026-09-26T00:00:00.000Z',
};
const options = { operator: { type: 'agent' as const, id: 'operating-agent' }, decidedAt: '2026-09-26T01:00:00.000Z' };

function fixture(): CapacityPlanInput {
  return {
    goal, desiredOriginalContents: 10, desiredAdaptations: 16, costPerOriginalCny: 50, costPerAdaptationCny: 20,
    readyMaterialUnits: 20, materialUnitsPerOriginal: 1, productionItemsPerDay: 10, daysUntilDeadline: 7,
    accounts: [
      { ref: ref('account', 'b', 1), accountId: 'b', status: 'active', weeklyPublicationCapacity: 13 },
      { ref: ref('account', 'a', 1), accountId: 'a', status: 'active', weeklyPublicationCapacity: 13 },
    ],
    interactionItemsPerWeek: 260, salesLeadsPerWeek: 52, expectedInteractionsPerPublication: 10, expectedLeadsPerPublication: 2,
    capabilities: { 'studio.production': 'available', 'publishing.calendar': 'available', 'customer.attribution': 'available' },
  };
}

test('allocates deterministic original, adaptation, and account quotas', () => {
  const first = planCapacity(fixture(), options);
  const reordered = fixture();
  reordered.accounts.reverse();
  const second = planCapacity(reordered, options);
  assert.deepEqual(first, second);
  assert.deepEqual(first.plan, {
    status: 'ready', originalContentQuota: 10, adaptationQuota: 16, publicationQuota: 26,
    accountQuotas: [{ accountId: 'a', publicationQuota: 13 }, { accountId: 'b', publicationQuota: 13 }], estimatedCostCny: 820, limitingFactors: [],
  });
});

test('degrades reproducibly for budget and sales handling capacity', () => {
  const input = fixture();
  input.goal = { ...goal, weeklyBudgetCny: 360 };
  input.salesLeadsPerWeek = 20;
  const result = planCapacity(input, options);
  assert.equal(result.plan.status, 'degraded');
  assert.equal(result.plan.publicationQuota, 7);
  assert.deepEqual(result.plan.limitingFactors, ['budget', 'sales']);
  assert.equal(result.decision.outcome, 'degraded');
});

test('fails closed for unavailable capability and unknown capacity', () => {
  const input = fixture();
  input.capabilities['studio.production'] = 'unavailable';
  input.interactionItemsPerWeek = null;
  const result = planCapacity(input, options);
  assert.equal(result.plan.status, 'blocked');
  assert.equal(result.plan.publicationQuota, 0);
  assert.deepEqual(result.decision.blockers.map(item => item.code), ['invalid_or_unknown_input', 'capability_unavailable']);
  assert.equal(result.decision.evidence.find(item => item.key === 'capacity_limits')?.state, 'unknown');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import { resolveReferenceMode, type ReferenceModeInput } from './referenceModeResolver.js';

const goal = { goalId: 'goal-1', version: 1, status: 'ready' } as BusinessContentGoal;
const options = { operator: { type: 'agent' as const, id: 'agent-1' }, decidedAt: '2026-09-26T00:00:00.000Z' };
function fixture(): ReferenceModeInput {
  return { goal, requestedMode: 'ordinary_inspiration', referenceRef: { type: 'reference_analysis', id: 'analysis-1', version: 3 }, referenceRights: 'authorized', exactAnalysis: 'unavailable', productionCapability: 'available', estimatedCostCny: 100, remainingBudgetCny: 500 };
}

test('selects ordinary inspiration and high fidelity deterministically', () => {
  const ordinary = resolveReferenceMode(fixture(), options);
  assert.equal(ordinary.resolution.mode, 'multi_source_hybrid');
  const high = fixture(); high.requestedMode = 'high_fidelity'; high.exactAnalysis = 'available';
  const first = resolveReferenceMode(high, options);
  assert.equal(first.resolution.mode, 'single_source_fidelity');
  assert.deepEqual(resolveReferenceMode(high, options), first);
});

test('high fidelity fails closed without rights or exact analysis', () => {
  const input = fixture(); input.requestedMode = 'high_fidelity'; input.referenceRights = 'restricted';
  const result = resolveReferenceMode(input, options);
  assert.equal(result.resolution.mayEnterProduction, false);
  assert.deepEqual(result.decision.blockers.map(item => item.code), ['rights_insufficient', 'exact_analysis_required']);
});

test('over-budget, unavailable capability, and unknown mode fail closed', () => {
  const input = fixture(); input.requestedMode = 'mystery'; input.productionCapability = 'unavailable'; input.remainingBudgetCny = 50;
  const result = resolveReferenceMode(input, options);
  assert.equal(result.resolution.status, 'blocked');
  assert.deepEqual(result.decision.blockers.map(item => item.code), ['invalid_or_unknown_input', 'capability_unavailable', 'budget_exceeded']);
});

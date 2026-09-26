import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import { buildBoundedPublishingAuthorization } from '../digitalEmployees/publishingExecution.js';
import { resolveAutomationPolicy, type AutomationPolicyInput, type AutomationMode } from './automationPolicyResolver.js';

const ref = (type: string, id: string, version: number) => ({ type, id, version });
const goal = { goalId: 'goal-1', version: 1, status: 'ready' } as BusinessContentGoal;
const options = { operator: { type: 'agent' as const, id: 'agent-1' }, decidedAt: '2026-09-26T00:00:00.000Z' };
const authorization = buildBoundedPublishingAuthorization({
  packageRevision: 1, authorizedBy: 'owner-1', authorizedAt: '2026-09-25T00:00:00.000Z', startsAt: '2026-09-21', endsAt: '2026-09-27',
  accountBindings: [{ accountId: 'account-1', platform: 'tiktok' }], maxPublishItems: 10,
  businessBoundary: { products: 'A', markets: 'US', audience: 'buyer', languages: ['en'], platforms: ['tiktok'], productionBudget: 1000, paidMediaBudget: 0 },
});

function fixture(mode: AutomationMode, action: AutomationPolicyInput['action']): AutomationPolicyInput {
  return { goal, mode, action, capability: { key: 'test', availability: 'available' }, factsVerified: true, withinBudget: true, rightsSufficient: true };
}

test('resolves the suggest, collaborate, and managed threshold matrix', () => {
  assert.equal(resolveAutomationPolicy(fixture('suggest', 'analyze'), options).policy.humanGate, 'approve_each');
  assert.equal(resolveAutomationPolicy(fixture('collaborate', 'analyze'), options).policy.humanGate, 'none');
  assert.equal(resolveAutomationPolicy(fixture('collaborate', 'draft'), options).policy.humanGate, 'review');
  assert.equal(resolveAutomationPolicy(fixture('managed', 'change_scope'), options).policy.humanGate, 'review');
  assert.equal(resolveAutomationPolicy(fixture('managed', 'commercial_commitment'), options).policy.humanGate, 'human_only');
});

test('managed publishing only proceeds inside the existing bounded authorization', () => {
  const input = fixture('managed', 'publish');
  input.publishingAuthorization = authorization;
  input.publishTarget = { accountId: 'account-1', platform: 'tiktok', scheduledAt: '2026-09-26T12:00:00.000Z' };
  assert.equal(resolveAutomationPolicy(input, options).policy.automaticExecutionAllowed, true);
  input.publishTarget.accountId = 'outside';
  const blocked = resolveAutomationPolicy(input, options);
  assert.equal(blocked.policy.status, 'blocked');
  assert.equal(blocked.policy.authorizationIssue, 'bounded_authorization_account_mismatch');
  assert.equal(blocked.decision.blockers[0]?.code, 'authorization_required');
});

test('unknown mode, rights, budget, facts, and capability all fail closed', () => {
  const input = fixture('managed', 'draft');
  input.mode = 'mystery'; input.rightsSufficient = null; input.withinBudget = false; input.factsVerified = null; input.capability.availability = 'unknown';
  const result = resolveAutomationPolicy(input, options);
  assert.equal(result.policy.status, 'blocked');
  assert.equal(result.policy.automaticExecutionAllowed, false);
  assert.ok(result.decision.blockers.length >= 5);
});

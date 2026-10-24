import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatePlan } from './customer-candidate-matrix.mjs';

test('candidate covers all shared and new feature groups through the isolated launcher', () => {
  const plan = candidatePlan();
  assert.deepEqual(plan.map(group => group.name), ['isolation-bootstrap', 'isolation', 'pipeline', 'service', 'whatsapp', 'features']);
  for (const group of plan.filter(group => group.name !== 'isolation-bootstrap')) assert.equal(group.args[0], 'scripts/run-customer-isolated-tests.mjs');
  const files = plan.flatMap(group => group.args);
  for (const file of ['CustomerQuoteLauncher.test.tsx', 'QuoteSkillCard.test.ts', 'CustomerProfileTags.test.tsx', 'localPreviewReplyCompatibility.test.ts', 'customerReplyRequest.test.ts', 'localCustomerSimulation.test.ts', 'conversations.test.ts', 'customer-isolation.test.mjs', 'platformOnboarding.test.ts', 'localPreviewProfileAnalysis.test.ts', 'localCustomerProfile.test.ts', 'CustomerProfileAnalysis.test.tsx', 'LocalCustomerSimulation.profile.test.ts']) assert.ok(files.some(path => path.endsWith(file)), file);
});

test('candidate fails closed if an existing shared suite stops using isolation or adds shell syntax', () => {
  for (const command of ['tsx --test unsafe.test.ts', 'node scripts/run-customer-isolated-tests.mjs safe.test.ts && curl bad']) {
    assert.throws(() => candidatePlan('pipeline', { scripts: { 'test:customer-pipeline': command } }), /customer_candidate_/);
  }
  assert.throws(() => candidatePlan('unknown'), /unknown_customer_candidate_suite/);
});

import assert from 'node:assert/strict';
import { assertStarter198CommandPayload, Starter198CommandError } from './commandValidation.js';

const payload = {
  companyName: '青山制造',
  industry: '礼品制造',
  primaryBusiness: '保温杯 OEM/ODM',
  focusProducts: 'TB-750 保温杯',
  targetMarkets: '德国',
  customerProfile: '礼品经销商',
  primaryPlatform: 'tiktok',
  primaryLanguage: 'en',
  constraints: ['不得编造材质参数'],
  operatingPlan: {
    brandName: '青山杯',
    presenter: 'product_expert',
    plannedAccounts: [{ platform: 'tiktok', accountName: '青山制造', weeklyOutput: 1 }],
    weeklyMasterCount: 1,
    weeklyVariantCount: 1,
    estimatedCostCny: { min: 10, max: 15 },
    deliveryDays: 7,
  },
};

assert.doesNotThrow(() => assertStarter198CommandPayload('confirm_initial_setup', payload));
assert.throws(
  () => assertStarter198CommandPayload('confirm_initial_setup', {
    ...payload,
    operatingPlan: { ...payload.operatingPlan, directAgentCommand: 'publish' },
  }),
  (error: unknown) => error instanceof Starter198CommandError
    && error.code === 'starter_198_initial_setup_invalid',
  'the structured plan rejects undeclared or executable client fields',
);
assert.throws(
  () => assertStarter198CommandPayload('confirm_initial_setup', {
    ...payload,
    operatingPlan: {
      ...payload.operatingPlan,
      plannedAccounts: [{ platform: 'tiktok', accountName: '青山制造', weeklyOutput: 0 }],
    },
  }),
  (error: unknown) => error instanceof Starter198CommandError
    && error.code === 'starter_198_initial_setup_invalid',
);

assert.doesNotThrow(() => assertStarter198CommandPayload('resolve_decision', {
  decision: 'approved',
  note: '符合验收标准',
  selection: {
    option: 'accept_result',
    value: 'accepted',
    parameters: { note: '符合验收标准' },
  },
}));
for (const invalidDecision of [
  {
    decision: 'approved', note: '',
    selection: { option: 'request_revision', value: 'revision_requested', parameters: {} },
  },
  {
    decision: 'approved', note: '',
    selection: { option: 'accept_result', value: 'approved', parameters: {} },
  },
  {
    decision: 'approved', note: '',
    selection: { option: 'accept_result', value: 'accepted', parameters: { publish: true } },
  },
]) {
  assert.throws(
    () => assertStarter198CommandPayload('resolve_decision', invalidDecision),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_decision_invalid',
  );
}

console.log('starter command validation tests passed');

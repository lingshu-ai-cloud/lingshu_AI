import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionRuntime } from './productionRuntime.js';
import type { ProductionRouterOptions } from './productionContracts.js';

test('production reference adapters remain unavailable until an explicit valid budget is configured', () => {
  const saved = process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
  let effects = 0;
  const options: ProductionRouterOptions = {
    adapters: [{ id: 'runway_act_two', methods: ['reenact'], async submit() { effects++; return { externalTaskId: 'forbidden' }; }, async status() { effects++; return { state: 'pending' }; } }],
    reserveReference: async () => { effects++; }, importReferenceVideo: async () => { effects++; return { materialId: 'unused' }; },
    resolveReferenceInputs: async () => { effects++; return { referenceVideoUrl: 'https://controlled.invalid/reference.mp4', characterUrl: 'https://controlled.invalid/person.png', characterType: 'image' }; },
  };
  try {
    for (const raw of [undefined, '', ' ', '-1', 'NaN', 'Infinity']) {
      if (raw === undefined) delete process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
      else process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT = raw;
      assert.deepEqual(createProductionRuntime(options).executableReferenceAdapters(), []);
    }
    for (const referenceBudgetLimitCny of [0, 2]) {
      const runtime = createProductionRuntime({ ...options, referenceBudgetLimitCny });
      assert.equal(runtime.referenceBudgetLimitCny(), referenceBudgetLimitCny);
      assert.deepEqual(runtime.executableReferenceAdapters(), options.adapters);
    }
    assert.equal(effects, 0);
  } finally {
    if (saved === undefined) delete process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
    else process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT = saved;
  }
});

test('the exact exempt tenant does not depend on an internal reference ceiling', () => {
  const savedBudget = process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
  const savedExemptions = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  const options: ProductionRouterOptions = {
    adapters: [{ id: 'runway_act_two', methods: ['reenact'], async submit() { return { externalTaskId: 'unused' }; }, async status() { return { state: 'pending' }; } }],
    reserveReference: async () => undefined,
    importReferenceVideo: async () => ({ materialId: 'unused' }),
    resolveReferenceInputs: async () => ({
      referenceVideoUrl: 'https://controlled.invalid/reference.mp4',
      characterUrl: 'https://controlled.invalid/person.png',
      characterType: 'image',
    }),
  };
  try {
    delete process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'tenant-exact';
    const runtime = createProductionRuntime(options);
    assert.ok(Number(runtime.referenceBudgetLimitCny('tenant-exact')) > 0);
    assert.deepEqual(runtime.executableReferenceAdapters('tenant-exact'), options.adapters);
    assert.equal(runtime.referenceBudgetLimitCny('tenant-other'), null);
    assert.deepEqual(runtime.executableReferenceAdapters('tenant-other'), []);
  } finally {
    if (savedBudget === undefined) delete process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT;
    else process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT = savedBudget;
    if (savedExemptions === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = savedExemptions;
  }
});

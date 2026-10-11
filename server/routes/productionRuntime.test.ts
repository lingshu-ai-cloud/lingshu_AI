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

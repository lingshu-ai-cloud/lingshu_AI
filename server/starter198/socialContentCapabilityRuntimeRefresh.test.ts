import test from 'node:test';
import assert from 'node:assert/strict';
import { socialContentCapabilityRegistry } from './socialContentAgentWorkflowContext.js';

test('product-scene capability reflects verified runtime configuration after module load', () => {
  const keys = ['SEEDANCE_VIDEO_ENABLED', 'SEEDANCE_API_KEY', 'SEEDREAM_API_KEY'] as const;
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.SEEDANCE_VIDEO_ENABLED;
    delete process.env.SEEDANCE_API_KEY;
    delete process.env.SEEDREAM_API_KEY;
    assert.equal(socialContentCapabilityRegistry().find(item => item.strategy === 'aigc_product_scene_replication')?.executable, false);

    process.env.SEEDANCE_VIDEO_ENABLED = 'true';
    process.env.SEEDANCE_API_KEY = 'verified-runtime-key';
    process.env.SEEDREAM_API_KEY = 'verified-runtime-key';
    const refreshed = socialContentCapabilityRegistry().find(item => item.strategy === 'aigc_product_scene_replication');
    assert.equal(refreshed?.executable, true);
    assert.deepEqual(refreshed?.registeredAdapterIds, ['controlled_product_scene_replication.v1']);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

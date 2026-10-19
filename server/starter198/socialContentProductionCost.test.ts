import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import { summarizeSelectedProviderCosts } from './socialContentProductionCost.js';

function asset(input: {
  id: string;
  providerId?: string;
  segments: Array<Record<string, unknown>>;
}): SocialProductionAsset {
  return {
    id: input.id,
    name: input.id,
    type: 'video',
    sourceId: input.id,
    url: `/tmp/${input.id}.mp4`,
    duration: 4,
    visualObservations: [],
    segments: input.segments,
    ...(input.providerId ? { providerId: input.providerId } : {}),
  };
}

test('provider cost aggregation prefers actual charges and keeps estimates unsettled', () => {
  const summary = summarizeSelectedProviderCosts({
    assets: [
      asset({ id: 'product', providerId: 'seedance', segments: [{ actualCostCny: 2.7 }] }),
      asset({ id: 'visual', segments: [{ providerId: 'qwen', estimatedCostCny: 0.3 }] }),
      asset({ id: 'unused', providerId: 'heygen', segments: [{ actualCostCny: 9 }] }),
    ],
    selectedAssetIds: new Set(['product', 'visual']),
  });

  assert.deepEqual(summary, {
    actualCostCny: 2.7,
    estimatedUnsettledCostCny: 0.3,
    recordedCostCny: 3,
    providerSegmentCount: 2,
    settlementStatus: 'partially_settled',
  });
});

test('provider cost aggregation never turns a missing provider bill into zero settlement', () => {
  const summary = summarizeSelectedProviderCosts({
    assets: [asset({ id: 'presenter', providerId: 'heygen', segments: [{ actualCostCny: null }] })],
    selectedAssetIds: new Set(['presenter']),
  });

  assert.equal(summary.actualCostCny, 0);
  assert.equal(summary.recordedCostCny, 0);
  assert.equal(summary.settlementStatus, 'unknown');
});

test('provider-backed output without cost segments remains unknown instead of free', () => {
  const summary = summarizeSelectedProviderCosts({
    assets: [asset({ id: 'provider-output', providerId: 'external-provider', segments: [] })],
    selectedAssetIds: new Set(['provider-output']),
  });

  assert.equal(summary.providerSegmentCount, 1);
  assert.equal(summary.recordedCostCny, 0);
  assert.equal(summary.settlementStatus, 'unknown');
});

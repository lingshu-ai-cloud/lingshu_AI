import assert from 'node:assert/strict';
import test from 'node:test';
import { storyboardFirstFrameExecutionRoute } from './storyboardFirstFrameRouting.js';

test('only a reliable composition plus exact product pixels can bypass Seedream for Seedance 2.x', () => {
  const base = { hasReliableComposition: true, hasExactProductLayer: true, seedanceModel: 'doubao-seedance-2-0-fast-260128' };
  assert.equal(storyboardFirstFrameExecutionRoute(base), 'direct_seedance_input');
  assert.equal(storyboardFirstFrameExecutionRoute({ ...base, hasReliableComposition: false }), 'seedream');
  assert.equal(storyboardFirstFrameExecutionRoute({ ...base, hasExactProductLayer: false }), 'seedream');
  assert.equal(storyboardFirstFrameExecutionRoute({ ...base, seedanceModel: 'seedance-1-5' }), 'seedream');
  assert.equal(storyboardFirstFrameExecutionRoute({ ...base, multimodalEnabled: false }), 'seedream');
});

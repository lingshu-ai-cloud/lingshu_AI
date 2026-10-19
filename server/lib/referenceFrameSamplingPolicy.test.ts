import test from 'node:test';
import assert from 'node:assert/strict';
import { presenterDenseSamplingRanges, referenceFrameSamplingProfile, requiresPresenterDenseSampling } from './referenceFrameSamplingPolicy.js';

const analysis = (materialTypes: string[]) => ({
  scriptDetails15s: materialTypes.map((materialType, index) => ({
    time: `${index}-${index + 1}s`, materialType,
  })),
}) as any;

test('only a confirmed talking-head shot enables dense presenter sampling', () => {
  assert.equal(referenceFrameSamplingProfile(analysis(['talking_head'])), 'talking_head_dense');
  assert.equal(requiresPresenterDenseSampling(analysis(['factory', 'talking_head', 'product'])), true);
});

test('factory, product and D2C footage stay on coarse sampling even when mixed', () => {
  for (const types of [['factory'], ['product'], ['consumer_demo'], ['factory', 'product', 'consumer_demo']]) {
    assert.equal(referenceFrameSamplingProfile(analysis(types)), 'coarse');
    assert.equal(requiresPresenterDenseSampling(analysis(types)), false);
  }
});

test('unknown or missing classification cannot authorize dense sampling', () => {
  assert.equal(referenceFrameSamplingProfile(analysis(['unknown'])), 'coarse');
  assert.equal(referenceFrameSamplingProfile(undefined), 'coarse');
});

test('dense ranges cover only confirmed talking-head intervals and keep absolute time', () => {
  assert.deepEqual(presenterDenseSamplingRanges(analysis(['factory', 'talking_head', 'product', 'talking_head']), 10), [
    { startSeconds: 1, endSeconds: 2 },
    { startSeconds: 3, endSeconds: 4 },
  ]);
});

test('dense ranges merge touching presenter windows and clamp them to media duration', () => {
  const value = { scriptDetails15s: [
    { time: '2-4s', materialType: 'talking_head' },
    { time: '4-7s', materialType: 'talking_head' },
    { time: '7-9s', materialType: 'factory' },
  ] } as any;
  assert.deepEqual(presenterDenseSamplingRanges(value, 6), [{ startSeconds: 2, endSeconds: 6 }]);
});

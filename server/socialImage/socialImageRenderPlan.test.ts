import assert from 'node:assert/strict';
import test from 'node:test';
import { planSocialImageRenderUnits } from './socialImageRenderPlan.js';

test('carousel is capped at four separately idempotent narrative units', () => {
  const units = planSocialImageRenderUnits({
    imageType: 'carousel', poster: { headline: 'Main', sellingPoints: ['A', 'B'], trustBadges: ['Proof'] },
    idempotencyKey: 'task:job', requestedCount: 99,
  });
  assert.equal(units.length, 4);
  assert.equal(units[0]?.poster.pageRole, 'cover');
  assert.equal(units[1]?.poster.pageRole, 'value');
  assert.equal(units[2]?.poster.pageRole, 'proof');
  assert.equal(units[3]?.poster.pageRole, 'conversion');
  assert.deepEqual(units.map(unit => unit.idempotencyKey), ['task:job:unit:1', 'task:job:unit:2', 'task:job:unit:3', 'task:job:unit:4']);
});

test('gif output plans at least two background plates and single output stays single', () => {
  assert.equal(planSocialImageRenderUnits({ imageType: 'gif_poster', poster: {}, idempotencyKey: 'gif', requestedCount: 1 }).length, 2);
  const single = planSocialImageRenderUnits({ imageType: 'product_poster', poster: { headline: 'One' }, idempotencyKey: 'single', requestedCount: 4 });
  assert.equal(single.length, 1);
  assert.equal(single[0]?.idempotencyKey, 'single');
});

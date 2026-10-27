import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMediaDuration } from './mediaDuration';
test('media clocks hide unknown values and format fractional seconds consistently', () => {
  assert.equal(formatMediaDuration(63.719999999999999), '01:03');
  assert.equal(formatMediaDuration(12.433333300000001), '00:12');
  assert.equal(formatMediaDuration(59.999), '00:59');
  assert.equal(formatMediaDuration(60), '01:00');
  for (const value of [undefined, null, NaN, Infinity, -1, 0]) assert.equal(formatMediaDuration(value), '—');
});

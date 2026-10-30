import assert from 'node:assert/strict';
import test from 'node:test';
import { storedVideoAvailability } from './storedVideoAvailability.js';

test('stored object references are not proof of available media', async () => {
  assert.equal(await storedVideoAvailability('video', async key => {
    assert.equal(key, 'video'); return { size: 100, contentType: 'video/mp4' };
  }), 'available');
  assert.equal(await storedVideoAvailability('missing', async () => null), 'missing');
  assert.equal(await storedVideoAvailability('empty', async () => ({ size: 0, contentType: 'video/mp4' })), 'missing');
  assert.equal(await storedVideoAvailability('offline', async () => { throw Error('temporary network failure'); }), 'unavailable');
});

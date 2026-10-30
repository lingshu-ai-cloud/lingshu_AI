import assert from 'node:assert/strict';
import test from 'node:test';
import { frontendReloadAvailable, runtimeVersionMismatch } from './runtimeVersion';

test('mixed server releases are a real mismatch but do not send users into a reload loop', () => {
  assert.equal(runtimeVersionMismatch('frontend-new', 'backend-old'), true);
  assert.equal(frontendReloadAvailable('frontend-new', 'frontend-new'), false);
  assert.equal(frontendReloadAvailable('frontend-old', 'frontend-new'), true);
  assert.equal(frontendReloadAvailable('frontend-new', ''), false);
  assert.equal(runtimeVersionMismatch('unknown', 'backend'), false);
  assert.equal(runtimeVersionMismatch('same', 'same'), false);
});

import assert from 'node:assert/strict';
import { adReleasePolicy, assertAdReleaseAction } from './releasePolicy.js';
assert.equal(adReleasePolicy({ NODE_ENV: 'production' }).mode, 'disabled');
assert.equal(adReleasePolicy({ NODE_ENV: 'test' }).mode, 'full');
assert.equal(adReleasePolicy({ PLATFORM_ADS_RELEASE_MODE: 'typo' }).mode, 'disabled');
const previous = process.env.PLATFORM_ADS_RELEASE_MODE;
try {
  process.env.PLATFORM_ADS_RELEASE_MODE = 'paused_only';
  for (const action of ['create', 'pause']) assert.doesNotThrow(() => assertAdReleaseAction('meta', action));
  for (const action of ['activate', 'resume', 'adjust_budget']) assert.throws(() => assertAdReleaseAction('meta', action), /未开放/);
  for (const provider of ['tiktok', 'google']) assert.throws(() => assertAdReleaseAction(provider, 'create'));
  process.env.PLATFORM_ADS_RELEASE_MODE = 'disabled';
  assert.throws(() => assertAdReleaseAction('meta', 'create'));
} finally { if (previous === undefined) delete process.env.PLATFORM_ADS_RELEASE_MODE; else process.env.PLATFORM_ADS_RELEASE_MODE = previous; }
console.log('Production release policy fails closed and blocks spending actions');

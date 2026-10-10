import assert from 'node:assert/strict';
import test from 'node:test';
import {
  socialContentHasSafetyBlocker,
  socialContentReviewAdmissionAllowed,
  socialContentTestBypassEnabled,
} from './socialContentTestBypass.js';

test('content creation bypass defaults on only for local development', () => {
  assert.equal(socialContentTestBypassEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(socialContentTestBypassEnabled({}), true);
  assert.equal(socialContentTestBypassEnabled({ NODE_ENV: 'test' }), false);
  assert.equal(socialContentTestBypassEnabled({ NODE_ENV: 'development', CONTENT_CREATION_TEST_BYPASS: 'false' }), false);
});

test('production cannot enable the content creation bypass', () => {
  assert.equal(socialContentTestBypassEnabled({ NODE_ENV: 'production', CONTENT_CREATION_TEST_BYPASS: 'true' }), false);
});

test('only the budget ceiling may be bypassed in local development', () => {
  const environment = { NODE_ENV: 'development', CONTENT_CREATION_TEST_BYPASS: 'true' };
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['budget_exceeded'], environment }), true);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['capability_mismatch'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['facts_missing'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['rights_missing'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['duration_mismatch'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['generation_failed'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: ['expression_failed'], environment }), false);
  assert.equal(socialContentReviewAdmissionAllowed({ approved: false, reasonCodes: [], environment }), false);
  assert.equal(socialContentHasSafetyBlocker(['budget_exceeded', 'rights_missing']), true);
});

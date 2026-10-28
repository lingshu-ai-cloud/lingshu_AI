import assert from 'node:assert/strict';
import test from 'node:test';
import { socialImagePlanningFailureCode } from './socialImageExecutionRuntime.js';

test('planning failures preserve pre-provider system and provider reasons', () => {
  assert.equal(socialImagePlanningFailureCode(new Error('ECONNREFUSED')), 'ECONNREFUSED');
  assert.equal(socialImagePlanningFailureCode({ body: { code: 'social_image_planning_provider_outcome_unknown' } }), 'social_image_planning_provider_outcome_unknown');
  assert.equal(socialImagePlanningFailureCode(null), 'social_image_planning_failed');
});

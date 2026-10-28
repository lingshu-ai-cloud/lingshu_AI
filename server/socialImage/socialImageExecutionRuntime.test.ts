import assert from 'node:assert/strict';
import test from 'node:test';
import { socialImagePlanningFailureCode } from './socialImageExecutionRuntime.js';

test('planning failures preserve pre-provider budget and system reasons', () => {
  assert.equal(socialImagePlanningFailureCode(new Error('social_image_budget_required')), 'social_image_budget_required');
  assert.equal(socialImagePlanningFailureCode(new Error('ECONNREFUSED')), 'ECONNREFUSED');
  assert.equal(socialImagePlanningFailureCode({ body: { code: 'social_image_planning_provider_outcome_unknown' } }), 'social_image_planning_provider_outcome_unknown');
  assert.equal(socialImagePlanningFailureCode(null), 'social_image_planning_failed');
});

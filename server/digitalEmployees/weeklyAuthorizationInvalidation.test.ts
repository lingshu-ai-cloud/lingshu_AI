import assert from 'node:assert/strict';
import {
  directorDecisionInvalidatesWeeklyAuthorization,
  taskCorrectionInvalidatesWeeklyAuthorization,
} from './weeklyAuthorizationInvalidation.js';

assert.equal(taskCorrectionInvalidatesWeeklyAuthorization('retry'), false, 'provider and execution retries retain the approved weekly boundary');
for (const action of ['skip', 'manual_complete', 'replan'] as const) {
  assert.equal(taskCorrectionInvalidatesWeeklyAuthorization(action), true, `${action} can change the approved deliverable boundary`);
}
assert.equal(directorDecisionInvalidatesWeeklyAuthorization('continue'), false, 'continuing the frozen direction is not a new business boundary');
assert.equal(directorDecisionInvalidatesWeeklyAuthorization('adjust'), true);
assert.equal(directorDecisionInvalidatesWeeklyAuthorization('abandon'), true);

console.log('Weekly authorization invalidation boundary tests passed');

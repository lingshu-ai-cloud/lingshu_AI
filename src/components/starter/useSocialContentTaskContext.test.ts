import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOCIAL_CONTENT_TASK_STATUSES } from '../../../shared/contracts/socialContentWorkflow.js';
import {
  socialContentTaskNeedsPolling,
  socialContentTaskPollDelay,
} from './useSocialContentTaskContext.js';
import { socialContentTaskIdFromApiPath } from '../../lib/socialContentTaskRefresh.js';

for (const status of SOCIAL_CONTENT_TASK_STATUSES) {
  const active = status === 'producing' || status === 'packaging';
  assert.equal(socialContentTaskNeedsPolling(status), active,
    `${status} must ${active ? '' : 'not '}keep polling`);
}

const regularDelay = socialContentTaskPollDelay('social-task-a');
assert.ok(regularDelay >= 55_000 && regularDelay <= 65_000,
  'healthy active tasks poll about once a minute');
const failureDelays = [1, 2, 3, 4, 5, 10]
  .map(failures => socialContentTaskPollDelay('social-task-a', failures));
assert.ok(failureDelays.every((delay, index) => index === 0 || delay >= failureDelays[index - 1]),
  'failed requests back off monotonically');
assert.ok(failureDelays.every(delay => delay <= 300_000), 'failure backoff is capped at five minutes');

assert.equal(socialContentTaskIdFromApiPath('/tasks/task-a/artifacts'), 'task-a');
assert.equal(socialContentTaskIdFromApiPath('/tasks/task%3Aone/start'), 'task:one');
assert.equal(socialContentTaskIdFromApiPath('/publications/publication-a/metrics'), undefined);

const hookSource = readFileSync(new URL('./useSocialContentTaskContext.ts', import.meta.url), 'utf8');
const barSource = readFileSync(new URL('./SocialTaskContextBar.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../lib/socialContentApi.ts', import.meta.url), 'utf8');
assert.doesNotMatch(hookSource, /setInterval/, 'the context bar must not leave a permanent interval running');
assert.match(hookSource, /document\.visibilityState === 'visible'/,
  'background tabs must not schedule task polling');
assert.match(hookSource, /SOCIAL_CONTENT_TASK_REFRESH_EVENT[\s\S]*?refresh\(true\)/,
  'a completed manual action must request an immediate refresh');
assert.match(hookSource, /socialContentTaskNeedsPolling\(latestTask\.status\)/,
  'the next request must be conditional on the confirmed task status');
assert.match(barSource, /useSocialContentTaskContext\(socialTaskId\)/);
assert.doesNotMatch(barSource, /setTimeout|setInterval|socialContentApi\.getTask/,
  'polling policy stays centralized in the tested hook');
assert.match(apiSource, /notifySocialContentTaskChanged\(socialContentTaskIdFromApiPath\(path\)\)/,
  'successful task mutations must wake the context projection');

console.log('social task context polling tests passed');

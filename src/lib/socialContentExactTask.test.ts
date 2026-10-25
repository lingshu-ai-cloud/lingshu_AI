import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreSavedSocialContentTask } from './socialContentTaskPagination.js';
import type { SocialContentWorkspace, SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';

test('explicit production links never fall back to the newest or another task', async () => {
  const workspace = { currentTask: { taskId: 'newest' }, tasks: [] } as unknown as SocialContentWorkspace;
  const missing = async () => { throw new Error('task_not_found'); };
  await assert.rejects(restoreSavedSocialContentTask(workspace, 'original', missing, true), /task_not_found/);
  await assert.rejects(restoreSavedSocialContentTask(workspace, 'original', async () => ({ taskId: 'wrong' } as SocialContentTaskDetail), true), /任务身份/);
  assert.equal(await restoreSavedSocialContentTask(workspace, 'old-preference', missing), workspace,
    'a stale optional preference retains the existing legacy recovery behavior');
});

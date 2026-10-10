import assert from 'node:assert/strict';
import {
  socialMutationEnvelope,
  socialSourceOptionPage,
  socialTaskEnvelope,
  socialTaskPage,
  socialWorkspaceResponse,
} from './socialContentResponse.js';
import { mergeSocialContentTaskSummaries, restoreSavedSocialContentTask } from './socialContentTaskPagination.js';

const task = {
  taskId: 'socialtask_1', version: '1', status: 'draft',
  brief: { title: '任务', objective: '品牌认知', productRef: null, audience: null, markets: [], languages: [], platforms: [], formats: [], aspectRatio: null, cadence: null, requestedOutputCount: null, dueAt: null, brandNotes: null, restrictions: [], callToAction: null },
  packageSelection: [], readiness: { complete: false, missing: ['product'] }, runId: null,
  sourceCount: 0, artifactCount: 0, approvedArtifactCount: 0, deliveryPackageCount: 0, publicationCount: 0, metricSubmissionCount: 0,
  createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
  sources: [], artifacts: [], deliveryPackages: [], publications: [], metricSubmissions: [],
};

assert.throws(() => socialTaskEnvelope({}), /内容不完整/);
assert.equal(socialTaskEnvelope({ task }).taskId, task.taskId);
assert.throws(() => socialTaskEnvelope({ task: { ...task, sourceCount: -1 } }), /内容不完整/);
assert.equal(socialMutationEnvelope({ source: { sourceId: 'source_1', taskId: task.taskId }, task }, 'source').source.sourceId, 'source_1');
assert.throws(() => socialMutationEnvelope({ source: { sourceId: 'source_1', taskId: 'another_task' }, task }, 'source'), /内容不完整/);
const firstTaskPage = socialTaskPage({ items: [task], page: 1, perPage: 50, totalItems: 51, totalPages: 2 });
assert.equal(firstTaskPage.items[0].taskId, task.taskId);
assert.equal(firstTaskPage.totalPages, 2);
const updatedTask = { ...firstTaskPage.items[0], version: '2', updatedAt: '2026-09-14T01:00:00.000Z' };
assert.deepEqual(
  mergeSocialContentTaskSummaries(firstTaskPage.items, [updatedTask, updatedTask]),
  [updatedTask],
  'additional pages replace stale summaries and never duplicate a task',
);
const pageTask = (taskId: string, updatedAt: string) => ({ ...firstTaskPage.items[0], taskId, updatedAt });
const initialFirstPage = [pageTask('task_a', '2026-09-14T04:00:00.000Z'), pageTask('task_b', '2026-09-14T03:00:00.000Z')];
const reorderedFirstPage = [pageTask('task_c', '2026-09-14T05:00:00.000Z'), initialFirstPage[0]];
const reorderedSecondPage = [initialFirstPage[1], pageTask('task_d', '2026-09-14T01:00:00.000Z')];
const reorderedWindow = mergeSocialContentTaskSummaries(initialFirstPage, [...reorderedFirstPage, ...reorderedSecondPage]);
assert.deepEqual(
  new Set(reorderedWindow.map(item => item.taskId)),
  new Set(['task_a', 'task_b', 'task_c', 'task_d']),
  'refreshing page one closes an offset boundary after an edit reorders tasks without changing totalItems',
);
assert.throws(() => socialTaskPage({ items: [task, task], page: 1, perPage: 50, totalItems: 2, totalPages: 1 }), /内容不完整/);
assert.throws(() => socialTaskPage({ items: [task], page: 1, perPage: 50, totalItems: 51, totalPages: 1 }), /内容不完整/);
const workspace = socialWorkspaceResponse({
  catalog: [{ kind: 'content_rocket', packageKey: 'rocket', version: '1', name: '内容火箭包', available: true, requiredInputs: [], deliverables: [] }],
  tasks: [task],
  taskList: { page: 1, perPage: 50, totalItems: 51, totalPages: 2 },
  currentTask: task,
});
assert.equal(workspace.taskList.totalItems, 51);
const savedOffPageTask = socialTaskEnvelope({ task: { ...task, taskId: 'socialtask_saved_off_page' } });
const restoredWorkspace = await restoreSavedSocialContentTask(workspace, savedOffPageTask.taskId, async () => savedOffPageTask);
assert.equal(restoredWorkspace.currentTask?.taskId, savedOffPageTask.taskId);
assert.equal(restoredWorkspace.tasks.length, 2);
assert.equal(restoredWorkspace.taskList.totalItems, 51, 'restoring an existing off-page task must not inflate the server total');
const fallbackWorkspace = await restoreSavedSocialContentTask(workspace, 'socialtask_missing', async () => { throw new Error('not found'); });
assert.equal(fallbackWorkspace.currentTask?.taskId, task.taskId, 'an unreadable saved task falls back to the first-page current task');
assert.throws(() => socialWorkspaceResponse({ catalog: [], tasks: [], currentTask: null }), /内容不完整/);
assert.throws(() => socialSourceOptionPage({ items: [], page: 1, perPage: 24, totalItems: 0, totalPages: 1, status: 'unknown' }), /内容不完整/);
assert.deepEqual(socialSourceOptionPage({ items: [], page: 1, perPage: 24, totalItems: 0, totalPages: 1, status: 'ready' }).items, []);

console.log('social content response validation tests passed');

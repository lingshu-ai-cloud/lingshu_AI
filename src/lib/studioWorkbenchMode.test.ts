import assert from 'node:assert/strict';
import {
  STUDIO_CONFIRM_REVISION_LABEL,
  STUDIO_WORKBENCH_MODE_LABELS,
  resolveStudioWorkbenchView,
  setStudioWorkbenchMode,
  setStudioWorkbenchPage,
  withStudioWorkbenchView,
} from './studioWorkbenchMode.js';

const agentView = resolveStudioWorkbenchView({
  taskId: 'agent-task-1',
  agentTaskEntry: true,
});
assert.deepEqual(agentView, {
  schemaVersion: 1,
  taskId: 'agent-task-1',
  entry: 'agent_task',
  mode: 'demo',
  page: 0,
});
assert.equal(STUDIO_WORKBENCH_MODE_LABELS.demo, '演示模式');
assert.equal(STUDIO_WORKBENCH_MODE_LABELS.edit, '编辑模式');

const storyboardDemo = setStudioWorkbenchPage(agentView, 1);
const deliveryDemo = setStudioWorkbenchPage(storyboardDemo, 2);
assert.equal(storyboardDemo.page, 1, 'demo users can inspect the populated storyboard page');
assert.equal(deliveryDemo.page, 2, 'demo users can inspect the populated audio and delivery page');

const editView = setStudioWorkbenchMode(storyboardDemo, 'edit');
assert.equal(editView.mode, 'edit');
assert.equal(editView.page, 1, 'switching mode keeps the page and task context');
assert.equal(STUDIO_CONFIRM_REVISION_LABEL, '确认修改并生成新成片');

const persisted = withStudioWorkbenchView({
  productionDepth: 2,
  productionDetail: { page: 'smartAssets', directStudio: true },
}, editView);
assert.deepEqual(persisted.productionDetail, {
  page: 'smartAssets',
  directStudio: true,
  studioWorkbenchView: editView,
});
assert.deepEqual(resolveStudioWorkbenchView({
  taskId: 'agent-task-1',
  agentTaskEntry: true,
  historyState: persisted,
}), editView, 'Back/Forward restores the exact task view');

assert.equal(resolveStudioWorkbenchView({
  taskId: 'agent-task-2',
  agentTaskEntry: true,
  historyState: persisted,
}).mode, 'demo', 'a different Agent task cannot inherit edit mode');

assert.equal(resolveStudioWorkbenchView({
  taskId: 'manual-task',
  agentTaskEntry: false,
}).mode, 'edit', 'ordinary content creation remains editable by default');

assert.equal(resolveStudioWorkbenchView({
  taskId: 'agent-task-1',
  agentTaskEntry: true,
  historyState: {
    productionDetail: {
      studioWorkbenchView: { ...editView, page: 9 },
    },
  },
}).mode, 'demo', 'invalid persisted pages fail closed to the Agent demo entry');

console.log('Studio workbench mode contract tests passed');

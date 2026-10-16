import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentProjectExplicitWorkflowScope,
  contentProjectLineageFields,
  managedContentProjectBelongsToWorkflowScope,
} from './contentProjectLineage.js';

function managedProject(runId: string, taskId: string) {
  const spec = {
    workflowRunId: runId,
    workflowTaskId: taskId,
    workflowTaskKey: 'content_production',
    automation: { managedBy: 'digital_employee' },
  };
  return { tenant_id: 'tenant', spec, ...contentProjectLineageFields({ tenantId: 'tenant', spec }) };
}

test('managed content scope ignores stale mutable refs and requires indexed lineage', () => {
  const current = managedProject('run-current', 'task-current');
  const historical = managedProject('run-current', 'task-old');
  const scope = new Set(['task-current']);
  assert.equal(managedContentProjectBelongsToWorkflowScope(current, 'run-current', scope), true);
  assert.equal(managedContentProjectBelongsToWorkflowScope(historical, 'run-current', scope), false);
  assert.equal(managedContentProjectBelongsToWorkflowScope({ ...current, workflow_task_id: 'tampered' }, 'run-current', scope), false);
  assert.equal(managedContentProjectBelongsToWorkflowScope({ spec: { automation: {} } }, 'run-current', scope), null);
});

test('an upstream routing-screen draft is not production evidence', () => {
  const scope = new Set(['task-production']);
  const routingDraft = { spec: { contentMode: 'video', workflowRunId: 'run-current', workflowTaskId: 'task-routing', workflowTaskKey: 'content_mode_routing' } };
  const productionDraft = { spec: { contentMode: 'video', workflowRunId: 'run-current', workflowTaskId: 'task-production', workflowTaskKey: 'content_production' } };
  assert.equal(contentProjectExplicitWorkflowScope(routingDraft, 'run-current', scope), false);
  assert.equal(contentProjectExplicitWorkflowScope(productionDraft, 'run-current', scope), true);
  assert.equal(contentProjectExplicitWorkflowScope({ spec: { contentMode: 'video' } }, 'run-current', scope), null);
});

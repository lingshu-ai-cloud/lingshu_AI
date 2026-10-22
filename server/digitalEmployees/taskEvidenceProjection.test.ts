import assert from 'node:assert/strict';
import test from 'node:test';
import { contentProjectLineageFields } from './contentProjectLineage.js';
import {
  contentProjectTaskScope,
  hasSucceededApprovalAncestor,
  recordBelongsToTask,
  scopedProof,
  studioProjectCompleted,
  studioProjectRendered,
  taskExecutionMetadata,
  taskScope,
} from './taskEvidenceProjection.js';
import type { PlanRecord, RunRecord, TaskRecord } from '../routes/digitalEmployeeRecords.js';

const task = (id: string, taskKey: string, extra: Record<string, unknown> = {}): TaskRecord => ({
  id, task_key: taskKey, depends_on: [], business_refs: [], output: {}, kind: 'action', status: 'pending', ...extra,
} as unknown as TaskRecord);
const run = { id: 'run-1' } as RunRecord;

test('task evidence scope keeps assistant-independent work and business refs separate', () => {
  const approval = task('approval-1', 'approval', { kind: 'approval', status: 'succeeded' });
  const production = task('production-1', 'content_production', {
    depends_on: ['approval'], business_refs: [{ id: 'project-1' }],
  });
  const unrelated = task('assistant-1', 'assistant_task', {
    output: { assistantIndependent: true }, business_refs: [{ id: 'project-other' }],
  });
  const scope = taskScope(production, [approval, production, unrelated]);
  assert.deepEqual([...scope.taskIds].sort(), ['approval-1', 'production-1']);
  assert.deepEqual([...scope.refIds], ['project-1']);
  assert.equal(hasSucceededApprovalAncestor(production, [approval, production]), true);
  assert.deepEqual([...contentProjectTaskScope(production, [approval, production, unrelated]).taskIds], ['production-1']);
  assert.equal(recordBelongsToTask({ id: 'project-1' }, run, scope), true);
  assert.equal(recordBelongsToTask({ id: 'project-other', metadata: { workflowRunId: 'run-2', workflowTaskId: 'assistant-1' } }, run, scope), false);
});

test('managed project lineage overrides mutable task references and requires render proof', () => {
  const production = task('production-1', 'content_production', { business_refs: [{ id: 'managed-other' }] });
  const scope = taskScope(production, [production]);
  const spec = {
    workflowRunId: 'run-2', workflowTaskId: 'production-1', workflowTaskKey: 'content_production',
    automation: { managedBy: 'digital_employee', stage: 'completed', renderOutputPath: '/safe/output.mp4', quality: { passed: true } },
  };
  const project = { id: 'managed-other', tenant_id: 'tenant-1', status: 'ready_for_approval', spec,
    ...contentProjectLineageFields({ tenantId: 'tenant-1', spec }) };
  assert.equal(recordBelongsToTask(project, run, scope), false);
  assert.equal(studioProjectCompleted(project), true);
  assert.equal(studioProjectRendered(project), true);
  assert.equal(studioProjectRendered({ ...project, spec: { ...spec, automation: { ...spec.automation, renderOutputPath: '' } } }), false);
});

test('task metadata and proof preserve existing fallback and pending semantics', () => {
  const planned = { id: 'plan-1', plan: { tasks: [{ key: 'content_production', executionMode: 'observe', destination: 'smartAssets' }] } } as PlanRecord;
  assert.equal(taskExecutionMetadata(task('production-1', 'content_production'), planned).executionMode, 'observe');
  assert.equal(taskExecutionMetadata(task('approval-1', 'approval', { kind: 'approval' }), null).executionMode, 'approval');
  assert.equal(scopedProof('rendered', 'studio', [], [], null).proof.status, 'pending');
});

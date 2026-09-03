import assert from 'node:assert/strict';
import {
  publicWorkflowApproval,
  publicWorkflowEvent,
  publicWorkflowHandoff,
  publicWorkflowRun,
  publicWorkflowTask,
  publicWorkflowValue,
} from './publicWorkflow.js';

const internalPath = '/Users/operator/private/customer/video.mp4';
const output = {
  summary: 'rendered',
  tenantId: 'tenant-secret',
  studioProject: {
    id: 'studio-project-1',
    deepLink: '/studio?project=studio-project-1',
    videoPath: internalPath,
    videoSha256: 'a'.repeat(64),
    providerOperationId: 'exact-provider-handle',
  },
};

const task = publicWorkflowTask({
  id: 'task-1', tenant_id: 'tenant-secret', run_id: 'run-1', task_key: 'content_execution_pack',
  title: 'Render', description: 'Render content', agent_role: 'content', kind: 'production', status: 'succeeded',
  sequence: 3, priority: 'high', requires_approval: false, depends_on: [], output, owner_id: 'owner-1',
  updated_at: '2026-09-03T00:00:00.000Z', lease_owner: 'worker-secret', lease_expires_at: '2099-01-01T00:00:00Z',
  blocked_reason: `ffmpeg failed opening '${internalPath}' with Bearer ${'x'.repeat(48)}`,
  error_detail: 'ENOENT: no such file or directory, open /custom/runtime/render/output.mp4?token=sensitive',
  idempotency_key: 'internal-idempotency', actual_cost: 1,
});
assert.equal('tenant_id' in task, false);
assert.equal('lease_owner' in task, false);
assert.equal('idempotency_key' in task, false);
assert.equal(JSON.stringify(task).includes(internalPath), false);
assert.equal(JSON.stringify(task).includes('exact-provider-handle'), false);
assert.equal(JSON.stringify(task).includes('/custom/runtime'), false);
assert.equal(JSON.stringify(task).includes('x'.repeat(48)), false);
assert.equal(
  ((task.output as Record<string, unknown>).studioProject as Record<string, unknown>).previewUrl,
  '/api/overseas/digital-employees/artifacts/studio-project-1/video',
);

const event = publicWorkflowEvent({
  id: 'event-1', tenant_id: 'tenant-secret', run_id: 'run-1', task_id: 'task-1', sequence: 7,
  type: 'task.completed', level: 'success', summary: `failed at ${internalPath}`,
  payload: { output, handleCipher: 'ciphertext-secret', diagnostic: 'spawn /custom/bin/renderer failed' },
  occurred_at: '2026-09-03T00:00:00.000Z',
});
assert.equal('tenant_id' in event, false);
assert.equal(JSON.stringify(event).includes(internalPath), false);
assert.equal(JSON.stringify(event).includes('ciphertext-secret'), false);
assert.equal(JSON.stringify(event).includes('/custom/bin'), false);

const approval = publicWorkflowApproval({
  id: 'approval-1', tenant_id: 'tenant-secret', goal_id: 'goal-1', run_id: 'run-1', task_id: 'task-1',
  status: 'pending', action_summary: 'approve', risk_level: 'high', evidence: [{ artifactReferences: output }],
  requested_by_agent: 'risk', owner_id: 'owner-1', decided_by: '', decision_note: '', action_version: 2,
  payload_hash: 'b'.repeat(64), action_type: 'register_schedule', action_payload: {
    artifact: { type: 'studio_project', id: 'studio-project-1', videoPath: internalPath, previewUrl: '/api/overseas/digital-employees/artifacts/studio-project-1/video' },
    schedulePayload: { tenantId: 'tenant-secret', videoPath: internalPath, title: 'safe title' },
  }, created_at: '2026-09-03T00:00:00.000Z', decided_at: '', lease_owner: 'worker-secret',
});
const approvalJson = JSON.stringify(approval);
assert.equal(approvalJson.includes('tenant-secret'), false);
assert.equal(approvalJson.includes(internalPath), false);
assert.match(approvalJson, /artifacts\/studio-project-1\/video/);

const handoff = publicWorkflowHandoff({
  id: 'handoff-1', tenant_id: 'tenant-secret', run_id: 'run-1', task_id: 'task-1', status: 'active',
  taken_by: 'owner-1', snapshot: { task: { output }, lease_owner: 'worker-secret' }, started_at: '', returned_at: '',
});
assert.equal(JSON.stringify(handoff).includes('tenant-secret'), false);
assert.equal(JSON.stringify(handoff).includes(internalPath), false);

const run = publicWorkflowRun({
  id: 'run-1', tenant_id: 'tenant-secret', goal_id: 'goal-1', plan_id: 'plan-1', status: 'running',
  current_controller: 'agent', pause_reason: '', budget_limit: 10, budget_spent: 1, started_at: '', completed_at: '',
  lease_owner: 'worker-secret', execution_snapshot: { tenantId: 'tenant-secret' }, arbitrary_internal: 'hidden',
});
assert.ok(run);
assert.equal('tenant_id' in run, false);
assert.equal('lease_owner' in run, false);
assert.equal('execution_snapshot' in run, false);
assert.equal('arbitrary_internal' in run, false);

const nested = publicWorkflowValue({
  safe: 'visible',
  tenant_id: 'tenant-secret',
  nested: { accessToken: 'token-secret', webhookSecret: 'webhook-secret', path: '/custom/runtime/video.mp4', publicUrl: '/api/safe' },
}) as Record<string, unknown>;
assert.deepEqual(nested, { safe: 'visible', nested: { publicUrl: '/api/safe' } });

console.log('digital employee public workflow DTOs strip tenant, lease, provider, credential, and host-path internals');

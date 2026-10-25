import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { assistantReplicationQueueState, isAssistantReplicationTask } from './assistantReplicationQueue';
const task = {
  taskId: 'task-1', status: 'draft', runId: null, version: '1',
  brief: { title: '任务', creationMode: 'viral_replication', specialRequirements: JSON.stringify({source:'assistant_replication_confirmation'}), platforms: [], formats: [], languages: [] },
  readiness: { complete: false, missing: ['material'] }, updatedAt: '2026-10-26T00:00:00Z',
  artifacts: [], deliveryPackages: [],
} as unknown as SocialContentTaskDetail;
test('saved tasks never turn draft blockers or estimates into execution evidence', () => {
  assert.equal(isAssistantReplicationTask(task), true);
  assert.equal(isAssistantReplicationTask({...task, brief: {...task.brief, specialRequirements: '{'}}), false);
  assert.deepEqual(assistantReplicationQueueState(task), { label: '待调度', blockers: [], running: false });
  assert.equal(assistantReplicationQueueState({...task, status:'cancelled'}).label, '已取消');
});
test('real running tasks collect blockers under intervention and preserve completion', () => {
  const active = {...task, runId:'run-1', status:'needs_input' as const};
  assert.equal(assistantReplicationQueueState(active).label, '待介入');
  assert.equal(assistantReplicationQueueState(active).blockers[0].value, '补充可用产品素材');
  assert.equal(assistantReplicationQueueState({...active, status:'delivered', readiness:{complete:true,missing:[]}}).label, '已完成');
});

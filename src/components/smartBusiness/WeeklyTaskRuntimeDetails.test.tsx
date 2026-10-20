import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { WeeklyTaskWorkspace } from '../../../shared/contracts/weeklyTaskWorkspace';
import WeeklyTaskRuntimeDetails from './WeeklyTaskRuntimeDetails';

const workspace: WeeklyTaskWorkspace = {
  schemaVersion: 'weekly-task-workspace.v1', workspaceId: 'workspace-1', tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 3,
  executionTaskId: 'execution-1', taskIdempotencyKey: 'intent-1', stepKind: 'video_generation', kind: 'content', phase: 'blocked', title: '制作任务', responsibleActor: 'content_agent', taskStatus: 'blocked', scheduledStartAt: null, scheduledFinishAt: null,
  upstreamTaskIds: [], blockingCodes: ['provider_wait'], resultRefs: [], contentTaskId: 'content-1', runId: 'run-1', accountId: null, publicationTaskId: 'publication-1', createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z',
  runtime: {
    pauseReasons: [{ code: 'provider_wait', message: '供应商任务暂停', retryable: true, occurredAt: '2026-10-20T01:30:00.000Z' }],
    completedWork: [{ executionTaskId: 'execution-upstream', stepKind: 'director_analysis', finishedAt: '2026-10-20T01:10:00.000Z', resultRefs: [{ type: 'director_analysis', id: 'analysis-1', version: 1 }] }],
    actualCost: { status: 'known', totalCny: 12.5, evidenceRefs: ['ledger-1'] },
    recovery: { taskAttempt: 2, taskMaximumAttempts: 3, recoveredFromDeadLetterAt: null, jobId: 'job-1', jobStatus: 'blocked', jobAttempt: 2, reconciliationAttempt: 1, retryClass: 'provider_wait', nextAttemptAt: '2026-10-20T02:30:00.000Z', providerReceipts: [{ provider: 'mock-provider', requestId: 'request-1', state: 'pending', providerTaskId: 'provider-task-1', updatedAt: '2026-10-20T02:00:00.000Z' }] },
    checkpoints: [{ key: 'render', version: '2', inputHash: 'a'.repeat(64), updatedAt: '2026-10-20T02:00:00.000Z' }],
    nextActions: [{ code: 'resolve_task_blocker', label: '核验供应商结果', userRequired: true }],
    mayChargeAgain: { status: 'possible', reason: '重新提交供应商前必须再次授权费用。' },
  },
};

test('runtime evidence stays bound to one execution task and exposes intervention facts', () => {
  const html = renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={workspace}/>);
  assert.match(html, /data-execution-task-id="execution-1"/);
  for (const label of ['暂停原因', '已完成工作', '真实费用', 'Job / Checkpoint / 恢复证据', '下一动作', '再次执行可能产生费用']) assert.match(html, new RegExp(label));
  assert.match(html, /¥12\.50/);
  assert.match(html, /job-1/);
  assert.match(html, /request-1/);
  assert.match(html, /需要用户处理/);
  const rejected = renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="another-execution" loading={false} error="" workspace={workspace}/>);
  assert.match(rejected, /任务运行证据身份不一致/);
  assert.doesNotMatch(rejected, /¥12\.50|job-1|request-1/);
});

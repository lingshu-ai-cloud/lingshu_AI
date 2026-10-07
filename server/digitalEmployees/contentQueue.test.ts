import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { buildContentQueueProjection } from './contentQueue.js';
import type { WorkflowTask } from '../../src/lib/digitalEmployees.js';

const productionTask: WorkflowTask = {
  id: 'task-production', run_id: 'run-1', task_key: 'content_production', title: '制作内容', description: '', agent_role: 'content', kind: 'production',
  status: 'running', sequence: 1, priority: 'normal', requires_approval: false, depends_on: [], output: {}, blocked_reason: '', owner_id: '', updated_at: '2026-09-29T10:00:00Z',
};
const order = {
  id: 'content_order_1', goalId: 'goal-1', productId: 'product-1', productName: '检测设备', theme: { key: 'buyer_problem', label: '采购验机' }, platform: 'tiktok',
  accountId: 'tt-1', accountLabel: '德国采购号', route: 'clone', languages: ['en'], configurationSnapshot: { configVersion: 1, policyVersion: 'p1', factsVersion: 'f1' }, cta: '私信', constraints: [], evidenceRefs: [{ type: 'exact_analysis', id: 'viral-1' }], status: 'planned',
  videoPlan: { route: 'clone', productName: '检测设备', theme: '采购验机', buyerProblem: '到厂前如何验机？', evidenceRequirement: '展示检测流程', language: 'en', duration: 30, platform: 'tiktok', materialIds: [], referenceId: 'viral-1', presenter: 'material', heygenAvatarId: '', avatarConsent: false, voice: 'v1', contentId: 'content-1', plannedPublishDate: '2026-10-01', estimatedCost: 2.5, planningEvidence: { generatedFrom: 'matrix_benchmark_viral', matrixAccountId: 'tt-1', requiredCount: 3, slot: 1, referenceTitle: '爆款验机视频', referenceViews: '1.2M', benchmarkAccount: 'Benchmark Factory', matchScore: 92, factors: ['矩阵要求 3 条', '同平台'] } },
};

const originalList = store.list;
try {
  store.list = (async (collection: string) => {
    let items: Array<Record<string, unknown>> = [];
    if (collection === 'content_batch_plans') items = [{ id: 'batch-1', tenant_id: 'tenant-1', run_id: 'run-1', status: 'planned', orders: [order] }];
    if (collection === 'studio_projects') items = [{
      id: 'project-1', tenant_id: 'tenant-1', updated_at: '2026-09-29T11:00:00Z',
      spec: {
        workflowRunId: 'run-1', contentOrderId: 'content_order_1::en', lang: 'en',
        contentOrder: { ...order, id: 'content_order_1::en', sourceContentOrderId: 'content_order_1' },
        automation: { managedBy: 'digital_employee', stage: 'render', status: 'queued', quality: {} },
      },
    }, {
      id: 'project-manual', tenant_id: 'tenant-1', updated_at: '2026-09-29T09:30:00Z',
      spec: { socialContentTaskId: 'social-manual-1' },
    }];
    if (collection === 'studio_digital_human_executions') items = [{ id: 'execution-1', tenant_id: 'tenant-1', project_id: 'project-1', job_id: 'job-1', plan_id: 'plan-1', payload: { costStatus: 'reconciled', actualCostCny: 1.25 } }];
    if (collection === 'starter_social_content_tasks') items = [{
      id: 'social-row-1', task_id: 'social-manual-1', tenant_id: 'tenant-1', task_mode: 'instant', status: 'asset_review', version: 'v3',
      created_at: '2026-09-29T09:00:00Z', updated_at: '2026-09-29T09:30:00Z',
      brief: { title: '手动创建的展会短视频', objective: '为展会获得询盘', productRef: '检测设备', platforms: ['youtube'], languages: ['en'], formats: ['Shorts'], requestedOutputCount: 2, weeklyBudgetCny: 80, dueAt: '2026-10-03' },
    }];
    return { items, page: 1, perPage: 500, totalItems: items.length, totalPages: 1 } as any;
  }) as typeof store.list;
  const queue = await buildContentQueueProjection({
    tenantId: 'tenant-1', runId: 'run-1', planBody: {}, tasks: [productionTask], planId: 'weekly-plan-1',
    goal: { id: 'goal-1', objective: '本周获得 10 条询盘', startsAt: '2026-09-28', endsAt: '2026-10-04', version: 2 },
  });
  assert.equal(queue.sourceStatus, 'available');
  assert.equal(queue.items.length, 2, 'manual and weekly-plan content must share the same queue projection');
  assert.equal(queue.items[0]?.status, 'producing');
  assert.equal(queue.items[0]?.progress, 67);
  assert.equal(queue.items[0]?.settledCostCny, 1.25, 'only project-scoped reconciled supplier cost is actual spend');
  assert.equal(queue.items[0]?.estimatedCostCny, 2.5);
  assert.equal(queue.items[0]?.matchScore, 92);
  assert.equal(queue.items[0]?.benchmarkAccount, 'Benchmark Factory');
  assert.deepEqual(queue.items[0]?.projectIds, ['project-1']);
  assert.equal(queue.items[0]?.origin, 'weekly_plan');
  assert.equal(queue.items[0]?.lineage.goalId, 'goal-1');
  assert.equal(queue.items[0]?.lineage.planId, 'weekly-plan-1');
  assert.equal(queue.items[0]?.lineage.factsVersion, 'f1');
  assert.equal(queue.items[0]?.outputSummary.durationSeconds, 30);
  assert.equal(queue.items[0]?.confidence?.production.level, 'high');
  assert.equal(queue.items[0]?.confidence?.business.level, 'medium', 'reference match is evidence, not a promised business success rate');
  assert.match(queue.items[0]?.confidence?.note || '', /不是.*成功概率/);
  assert.equal(queue.items[0]?.steps.length, 10, 'production must expose each user-visible step instead of a coarse stage only');
  assert.equal(queue.items[0]?.steps.find(step => step.key === 'video_generation')?.responsibleAgent, '内容 Agent');
  assert.equal(queue.items[0]?.steps.find(step => step.key === 'video_generation')?.estimatedMinutes, 90);
  assert.equal(queue.items[0]?.steps.find(step => step.key === 'quality_check')?.responsibleAgent, '质检 Agent');
  assert.equal(queue.items[0]?.steps.find(step => step.key === 'user_approval')?.responsibleAgent, '用户');
  assert.equal(queue.items[1]?.origin, 'manual');
  assert.equal(queue.items[1]?.socialContentTaskId, 'social-manual-1');
  assert.equal(queue.items[1]?.status, 'waiting_review');
  assert.equal(queue.items[1]?.lineage.objective, '为展会获得询盘');
  assert.equal(queue.items[1]?.lineage.budgetCny, 40);
  assert.deepEqual(queue.items[1]?.projectIds, ['project-manual']);
  assert.deepEqual(queue.items[1]?.outputSummary, { count: 2, durationSeconds: null, formats: ['Shorts'] });
  assert.equal(queue.items[1]?.confidence?.business.level, 'insufficient');
  assert.equal(queue.items[1]?.steps.find(step => step.key === 'quality')?.estimatedMinutes, 25);

  const acceptedProject = {
    id: 'project-complete', tenant_id: 'tenant-1', updated_at: '2026-09-29T12:00:00Z',
    spec: {
      workflowRunId: 'run-1', contentOrderId: 'content_order_1::en', lang: 'en', contentOrder: { ...order, id: 'content_order_1::en', sourceContentOrderId: 'content_order_1' },
      automation: { managedBy: 'digital_employee', stage: 'completed', status: 'completed', quality: { passed: true } },
    },
  };
  store.list = (async (collection: string) => {
    const items = collection === 'content_batch_plans' ? [{ id: 'batch-1', tenant_id: 'tenant-1', run_id: 'run-1', status: 'planned', orders: [order] }]
      : collection === 'studio_projects' ? [acceptedProject]
        : [];
    return { items, page: 1, perPage: 500, totalItems: items.length, totalPages: 1 } as any;
  }) as typeof store.list;
  const awaitingAcceptance = await buildContentQueueProjection({
    tenantId: 'tenant-1', runId: 'run-1', planBody: {}, tasks: [productionTask], planId: 'weekly-plan-1',
    goal: { id: 'goal-1', objective: '本周获得 10 条询盘', startsAt: '2026-09-28', endsAt: '2026-10-04', version: 2 },
  });
  assert.equal(awaitingAcceptance.items[0]?.status, 'waiting_review');
  assert.equal(awaitingAcceptance.items[0]?.progress, 90, '100% is reserved for a user-accepted deliverable');
} finally {
  store.list = originalList;
}

console.log('content queue projection tests passed');

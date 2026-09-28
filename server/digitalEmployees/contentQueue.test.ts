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
    }];
    if (collection === 'studio_digital_human_executions') items = [{ id: 'execution-1', tenant_id: 'tenant-1', project_id: 'project-1', job_id: 'job-1', plan_id: 'plan-1', payload: { costStatus: 'reconciled', actualCostCny: 1.25 } }];
    return { items, page: 1, perPage: 500, totalItems: items.length, totalPages: 1 } as any;
  }) as typeof store.list;
  const queue = await buildContentQueueProjection({ tenantId: 'tenant-1', runId: 'run-1', planBody: {}, tasks: [productionTask] });
  assert.equal(queue.sourceStatus, 'available');
  assert.equal(queue.items.length, 1, 'every frozen order must have exactly one queue row');
  assert.equal(queue.items[0]?.status, 'producing');
  assert.equal(queue.items[0]?.progress, 67);
  assert.equal(queue.items[0]?.settledCostCny, 1.25, 'only project-scoped reconciled supplier cost is actual spend');
  assert.equal(queue.items[0]?.estimatedCostCny, 2.5);
  assert.equal(queue.items[0]?.matchScore, 92);
  assert.equal(queue.items[0]?.benchmarkAccount, 'Benchmark Factory');
  assert.deepEqual(queue.items[0]?.projectIds, ['project-1']);
} finally {
  store.list = originalList;
}

console.log('content queue projection tests passed');

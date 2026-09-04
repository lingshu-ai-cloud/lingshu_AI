import assert from 'node:assert/strict';
import { summarizeContentFeedback } from './contentReview.js';

const result = summarizeContentFeedback({
  orders: [{
    id: 'order-1', goalId: 'goal-1', productId: 'sku-1', productName: 'A', theme: { key: 'use', label: '场景' }, platform: 'youtube', accountId: 'account-1', accountLabel: '账号', route: 'product',
    configurationSnapshot: { configVersion: 1, policyVersion: 'p1', factsVersion: 'f1' }, cta: '私信', constraints: [], evidenceRefs: [{ type: 'enterprise_material', id: 'asset-a' }], status: 'planned',
  }],
  projects: [{ id: 'project-1', status: 'ready_for_approval', spec: { automation: { contentOrderId: 'order-1' } } }],
  approvals: [{ id: 'approval-1', status: 'approved', decision_note: '开头更直接' }],
  posts: [{ id: 'post-1', platform_post_id: 'yt-1', stats: { sourceProjectId: 'project-1', views: 120, likes: 10 } }],
});
assert.equal(result.items[0]?.publicationStatus, 'published');
assert.equal(result.items[0]?.performance.status, 'available');
assert.deepEqual(result.routeCounts, { product: 1 });
assert.match(result.nextPlanRecommendations.join('\n'), /审批反馈/);

console.log('content review tests passed');

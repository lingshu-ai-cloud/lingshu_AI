import assert from 'node:assert/strict';
import { summarizeContentFeedback } from './contentReview.js';

const result = summarizeContentFeedback({
  orders: [{
    id: 'order-1', goalId: 'goal-1', productId: 'sku-1', productName: 'A', theme: { key: 'use', label: '场景' }, platform: 'youtube', accountId: 'account-1', accountLabel: '账号', route: 'product',
    configurationSnapshot: { configVersion: 1, policyVersion: 'p1', factsVersion: 'f1' }, cta: '私信', constraints: [], evidenceRefs: [{ type: 'enterprise_material', id: 'asset-a' }], status: 'planned',
  }],
  projects: [{ id: 'project-1', status: 'ready_for_approval', spec: { automation: { contentOrderId: 'order-1' } } }],
  approvals: [{ id: 'approval-1', status: 'approved', decision_note: '开头更直接' }],
  posts: [{ id: 'post-1', platform_post_id: 'yt-1', permalink: 'https://www.youtube.com/shorts/example', tags: ['factory'], stats: { sourceProjectId: 'project-1', views: 120, likes: 10, leads: 2 } }],
  trendVideos: [
    { id: 'trend-1', title: '采购商开始关注小批量交付', platform: 'tiktok', sourceUrl: 'https://www.tiktok.com/@factory/video/1', tags: JSON.stringify(['smallbatch', 'factory']), views: '12K', updatedAt: '2026-10-08T08:00:00.000Z' },
    { id: 'trend-2', title: '工厂透明度成为热门话题', platform: 'tiktok', sourceUrl: 'https://www.tiktok.com/@factory/video/2', tags: JSON.stringify(['factory', 'transparency']), views: '10K', updatedAt: '2026-10-08T07:00:00.000Z' },
  ],
  previousHotTags: ['factory', 'oldtag'],
});
assert.equal(result.items[0]?.publicationStatus, 'published');
assert.equal(result.items[0]?.performance.status, 'available');
assert.deepEqual(result.routeCounts, { product: 1 });
assert.match(result.nextPlanRecommendations.join('\n'), /审批反馈/);
assert.equal(result.nextRoundRecommendations.contentInheritance.status, 'ready');
assert.equal(result.nextRoundRecommendations.contentInheritance.sourceUrl, 'https://www.youtube.com/shorts/example');
assert.equal(result.nextRoundRecommendations.contentInheritance.paidBoost.status, 'recommended_for_review');
assert.deepEqual(result.nextRoundRecommendations.tagAdaptation.newTags.sort(), ['smallbatch', 'transparency']);
assert.deepEqual(result.nextRoundRecommendations.tagAdaptation.droppedTags, ['oldtag']);
assert.equal(result.nextRoundRecommendations.tagAdaptation.requiresConfirmation, true);
assert.equal(result.nextRoundRecommendations.industryTrends.signals.length, 2);
assert.equal(result.nextRoundRecommendations.industryTrends.signals[0]?.sourceUrl, 'https://www.tiktok.com/@factory/video/1');

console.log('content review tests passed');

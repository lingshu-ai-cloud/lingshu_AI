import assert from 'node:assert/strict';
import { buildNextRoundRecommendationCards } from './nextRoundRecommendations.js';

const cards = buildNextRoundRecommendationCards({
  completionRate: 100, automationRate: 100, approvalRate: 100, handoffRate: 0,
  completedTasks: 3, totalTasks: 3, failedTasks: 0, highlights: [], nextGoalSuggestion: '', knowledgeCandidates: [],
  nextRoundRecommendations: {
    contentInheritance: {
      status: 'ready', sourceContentId: 'content-1', title: '工厂透明度', platform: 'tiktok', hook: '采购商为什么不敢下单', framework: ['真人口播 · 钩子', '工厂生产 · 能力证明'], tags: ['factory'], sourceUrl: 'https://www.tiktok.com/@factory/video/1', reason: '本期综合表现最高',
      paidBoost: { status: 'recommended_for_review', reason: '先做小额测试' }, systemActions: ['写入下一周编导约束'],
    },
    tagAdaptation: { status: 'changed', publishedTags: ['factory'], hotTags: ['factory', 'smallbatch'], newTags: ['smallbatch'], droppedTags: [], requiresConfirmation: true, systemActions: ['生成采集范围候选'] },
    industryTrends: { status: 'available', signals: [{ id: 'trend-1', title: '查看行业变化', platform: 'tiktok', summary: '12K 播放', sourceUrl: 'https://www.tiktok.com/@factory/video/2', observedAt: '2026-10-08T08:00:00.000Z', tags: ['factory'] }], systemActions: ['写入编导参考池'] },
  },
});

assert.equal(cards.length, 3);
assert.equal(cards[0]?.status, 'ready');
assert.match(cards[0]?.conclusion || '', /工厂透明度/);
assert.match(cards[1]?.evidence.join('\n') || '', /#smallbatch/);
assert.equal(cards[2]?.links[0]?.url, 'https://www.tiktok.com/@factory/video/2');

const fallback = buildNextRoundRecommendationCards();
assert.equal(fallback.every(card => card.status === 'waiting'), true);
assert.equal(fallback.flatMap(card => card.links).length, 0);

console.log('next round recommendation view model tests passed');

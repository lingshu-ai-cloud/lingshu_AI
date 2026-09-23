import assert from 'node:assert/strict';
import {
  buildSocialCrawlStrategy,
  buildSocialInspirationHandoff,
  evaluateSocialCandidateEvidence,
  scoreSocialInspirationCandidate,
} from './socialInspirationStrategy';

const strategy = buildSocialCrawlStrategy({
  businessGoal: '获取高质量询盘',
  productTerms: ['五轴加工'],
  sceneClusters: [{ label: '小批量打样顾虑', demandDimension: 'decision_concern', evidence: ['inquiry'], status: 'approved' }],
  platforms: ['youtube', 'tiktok'],
  market: '德国',
  language: '德语',
  companyRole: 'factory',
  audienceRole: 'brand_buyer',
  now: new Date('2026-09-23T08:00:00.000Z'),
});
assert.deepEqual(strategy.keywords.map(item => item.category), ['discovery_seed', 'scene_cluster', 'evidence_query', 'competitor_account', 'task_override']);
assert.ok(strategy.keywords.find(item => item.category === 'discovery_seed')?.values.includes('五轴加工'));
assert.equal(strategy.keywordSet.scope.companyRole, 'factory');
assert.equal(strategy.keywordSet.graph.sceneClusters[0]?.evidence[0], 'inquiry');
assert.equal(strategy.platformQuotas.every(item => item.limit === 30), true);

const breakout = scoreSocialInspirationCandidate({ currentPerformance: 10_000, accountPlatformBaseline: 1_000, engagementQuality: 0.8, freshness: 1, weeklyGoalRelevance: 0.9, structuralTransferability: 0.9, evidenceQuality: 0.8, platformWeight: 0.8, accountWeight: 0.5, accountTypeWeight: 1, industryRelevance: 1, strategyMatch: 1 });
const famousAverage = scoreSocialInspirationCandidate({ currentPerformance: 1_000_000, accountPlatformBaseline: 900_000, engagementQuality: 0.6, freshness: 1, weeklyGoalRelevance: 0.7, structuralTransferability: 0.6, evidenceQuality: 0.6, platformWeight: 1, accountWeight: 1, accountTypeWeight: 1, industryRelevance: 0.8, strategyMatch: 0.8 });
assert.ok(breakout.contentOpportunityScore > famousAverage.contentOpportunityScore,
  'a small-account breakout can outrank a famous account with merely high absolute views');
assert.equal(scoreSocialInspirationCandidate({ currentPerformance: 1000, accountPlatformBaseline: 0 }).relativePerformance, null);

const candidate = evaluateSocialCandidateEvidence({
  inspirationId: 'inspiration-1', discoveryPath: ['keyword', 'account'], taskRelevance: 0.9,
  currentPerformance: 10_000, accountPlatformBaseline: 2_000, hasTimeSeries: false,
  transferability: 0.8, mechanisms: ['前三秒结果钩子'], evidenceRefs: ['video:0-3'],
});
assert.equal(candidate.momentum.level, 'high_performance', 'a point-in-time metric must not be called rising');
assert.equal(candidate.relevance.level, 'high');

const handoff = buildSocialInspirationHandoff({
  inspirationId: 'inspiration-1', analysisId: 'analysis-1', analysisVersion: '2',
  source: { platform: 'youtube', sourceUrl: 'https://example.test/video' }, taskContext: {},
  whySelected: ['钩子清楚'], referenceRole: 'primary_structure',
  reusableLogic: { hookTypes: ['结果先行'], revealOrder: ['结果', '过程'], proofPlacement: ['中段'], pacing: '快', emotionalProgression: '疑问到确信', ctaPosition: '结尾' },
  adaptationBoundary: { reusable: ['结构'], mustReplace: ['产品事实'], prohibited: ['原台词'] },
  productionImplications: { requiredEvidence: ['真实产品图'], likelyAssetNeeds: ['产品图'], risks: [] },
  evidenceRefs: [{ startTime: 0, endTime: 3, description: '结果钩子', confidence: 0.9, needsReview: false }],
  rights: { mayAnalyze: true, mayUseOriginalMedia: false, mayAdapt: false, note: '仅供参考' },
  analysisState: { hasMetadata: true, hasQuickAnalysis: true, hasStrategyAnalysis: true, hasExactTimeline: false, rightsClear: true },
});
assert.equal(handoff.readiness, 'strategy_reference');
console.log('social inspiration strategy tests passed');

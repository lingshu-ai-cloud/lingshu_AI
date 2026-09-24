import assert from 'node:assert/strict';
import {
  buildSocialCrawlStrategy,
  buildSocialInspirationHandoff,
  buildSocialReplicationFactorSpecs,
  buildSocialTimelineBeats,
  evaluateSocialCandidateEvidence,
  inferSocialReplicationReferenceMode,
  scoreSocialInspirationCandidate,
} from './socialInspirationStrategy';
import type { SocialReferenceVideoAnalysis } from './contracts/socialContentWorkflow';

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

const detailedAnalysis: SocialReferenceVideoAnalysis = {
  analysisId: 'analysis-detailed', version: '3', referenceSourceId: 'source-detailed', status: 'ready', durationSeconds: 3,
  coverage: { fullDurationSeconds: 3, precisionIntervals: [{ startSeconds: 0, endSeconds: 3, level: 'L3' }], gaps: [], overallConfidence: 0.94, fullTimelineCovered: true },
  shots: [{
    shotId: 'shot-cream', startSeconds: 0, endSeconds: 3, visualDescription: '手在生活化桌面触碰已开盖面霜', spokenText: null, captionText: null,
    audioDescription: '轻快音乐', rhythmDescription: '第一秒手入镜', purpose: 'hook',
    tags: { sceneTypes: ['生活化桌面'], subjects: ['面霜产品', '手'], subjectRelations: ['手触碰瓶身'], cameraLanguage: ['近景', '侧俯拍'], contentFunctions: ['hook'], soundTypes: ['音乐'], onScreenInformation: [], truthRequirements: ['none'], suggestedProductionMethods: ['customer_product_image_animation'] },
    fidelityPoints: ['瓶盖保持打开', '生活化桌面与轻微杂物', '柔和侧光'], mustDifferPoints: ['替换产品品牌和人物身份'],
  }],
  timelineBeats: [{
    beatId: 'beat-cream', referenceAnalysisId: 'analysis-detailed', referenceShotId: 'shot-cream', startSeconds: 0, endSeconds: 3, purpose: 'hook',
    subjects: [{ subjectId: 'cream', kind: 'product', description: '面霜瓶', identitySensitive: true }],
    action: { startState: '产品静置', path: '手在 0.6 秒入镜并触碰瓶身', endState: '产品轻微转向', spatialRelation: '手在产品右侧', startsAtSeconds: 0.6, revealAtSeconds: 0.8 },
    objectStates: [{ subjectId: 'cream', attribute: 'lid', value: 'open', visibility: 'clear', continuityKey: 'cream-lid' }, { subjectId: 'cream', attribute: 'surface', value: 'used_irregular', visibility: 'clear', continuityKey: 'cream-surface' }],
    shotLanguage: { shotSize: '近景', cameraAngle: '侧俯拍', movement: '轻微推进', composition: '产品位于视觉中心偏左', subjectAreaRatio: 0.32, subjectPosition: 'center-left' },
    lighting: { direction: 'left-back', softness: 'soft', colorTemperature: 'warm-neutral', contrast: 'low', shadowAndHighlight: 'soft shadow' },
    environment: { semanticType: 'lived-in vanity table', materials: ['wood'], clutterDensity: 'light', livedInDetails: ['small everyday objects'] },
    audioLayers: { voice: null, captions: null, ambient: null, music: 'light upbeat', soundEffects: null },
    rhythm: { description: '0.6 秒动作钩子', cutAtSeconds: 3, beatAtSeconds: [0.6] },
    continuity: { incomingState: ['lid=open'], outgoingState: ['lid=open'], conflicts: [] },
    observation: { observableFacts: ['瓶盖打开', '存在使用痕迹'], inferredIntent: ['强化真实使用感'], causalGaps: [], confidence: 0.94, needsHumanReview: false },
  }],
  hookAnalysis: null, rightsNotice: '仅分析，不复用原媒体', createdAt: '2026-09-24T00:00:00.000Z',
};
assert.equal(buildSocialTimelineBeats(detailedAnalysis)[0]?.objectStates[0]?.value, 'open');
assert.equal(inferSocialReplicationReferenceMode({ referenceCount: 1 }), 'single_source_fidelity');
const factors = buildSocialReplicationFactorSpecs({
  analysis: detailedAnalysis,
  referenceMode: 'single_source_fidelity',
  version: 'factor-v1',
  frozenAt: '2026-09-24T00:00:00.000Z',
  additionalEvidence: [{
    matchText: 'lid',
    evidence: { evidenceId: 'experiment-lid', level: 'owned_account_experiment', sourceRef: 'experiment:lid-open-vs-closed', description: '自有账号单变量实验支持开盖状态', confidence: 0.88, supports: ['causal_role'], capturedAtSeconds: null },
  }],
});
const lidFactor = factors.find(factor => factor.target.metric === 'object_state.lid');
assert.equal(lidFactor?.policy, 'lock');
assert.equal(lidFactor?.importance, 'critical');
assert.equal(lidFactor?.causalStatus, 'experimental_support');
assert.equal(lidFactor?.validator.kind, 'vision_state');
assert.ok(factors.some(factor => factor.policy === 'replace_identity'));
assert.ok(factors.every(factor => factor.target.metric && factor.evidenceRefs.length && factor.validator.detector));
console.log('social inspiration strategy tests passed');

import type {
  SocialAudienceRole,
  SocialBenchmarkAccountType,
  SocialCandidateEvidence,
  SocialCompanyRole,
  SocialContentSearchUnit,
  SocialCrawlKeywordCategory,
  SocialCrawlStrategy,
  SocialDiscoveryMode,
  SocialInspirationHandoff,
  SocialInspirationReadiness,
  SocialInspirationScores,
  SocialKeywordEvidenceSource,
  SocialSceneCluster,
} from './contracts/socialContentWorkflow';

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function clamp01(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : 0;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${stableHash(JSON.stringify(value))}`;
}

export interface SocialSceneClusterInput {
  label: string;
  productTask?: string;
  demandDimension: SocialSceneCluster['demandDimension'];
  queryVariants?: string[];
  evidence?: SocialKeywordEvidenceSource[];
  status?: SocialSceneCluster['status'];
}

/** Builds a Director-owned discovery plan only from traceable business inputs. */
export function buildSocialCrawlStrategy(input: {
  businessGoal: string;
  productTerms?: string[];
  sceneClusters?: SocialSceneClusterInput[];
  evidenceQueries?: SocialContentSearchUnit[];
  taskOverrides?: string[];
  competitorTerms?: string[];
  platforms: string[];
  benchmarkAccounts?: Array<{ accountRef: string; type: SocialBenchmarkAccountType; weight?: number }>;
  market?: string | null;
  language?: string | null;
  companyRole?: SocialCompanyRole;
  audienceRole?: SocialAudienceRole;
  lookbackDays?: number;
  resultLimit?: number;
  budgetLimitCny?: number | null;
  productionGap?: string | null;
  now?: Date;
}): SocialCrawlStrategy {
  const productTerms = unique(input.productTerms ?? []);
  const market = input.market?.trim() || '';
  const language = input.language?.trim() || '';
  const companyRole = input.companyRole ?? 'brand';
  const audienceRole = input.audienceRole ?? 'consumer';
  const competitors = unique(input.competitorTerms ?? []);
  const platforms = unique(input.platforms);
  const createdAt = (input.now ?? new Date()).toISOString();
  const scopeIdentity = { productTerms, market, language, companyRole, audienceRole, competitors };
  const keywordSetId = stableId('market_keyword_set', scopeIdentity);
  const discoverySeeds = productTerms.slice(0, 5).map((label, index) => ({
    seedId: stableId('seed', { keywordSetId, label, index }),
    label,
    queryVariants: [label],
    evidence: ['product'] as SocialKeywordEvidenceSource[],
    enabled: true,
  }));
  const sceneClusters = (input.sceneClusters ?? []).map((scene, index) => ({
    sceneId: stableId('scene', { keywordSetId, label: scene.label, index }),
    label: scene.label.trim(),
    productTask: scene.productTask?.trim() || productTerms[0] || '',
    demandDimension: scene.demandDimension,
    queryVariants: unique(scene.queryVariants?.length ? scene.queryVariants : [scene.label]),
    evidence: unique(scene.evidence ?? ['user']) as SocialKeywordEvidenceSource[],
    status: scene.status ?? 'suggested',
  })).filter(scene => scene.label && scene.queryVariants.length);
  const evidenceQueries = (input.evidenceQueries ?? []).map(query => ({
    ...query,
    queryVariants: unique(query.queryVariants),
    evidence: unique(query.evidence) as SocialKeywordEvidenceSource[],
  })).filter(query => query.productEntity && query.buyerQuestion && query.observableEvidence && query.queryVariants.length);
  const keyword = (category: SocialCrawlKeywordCategory, values: string[]) => ({ category, values: unique(values) });
  const keywordSet = {
    keywordSetId,
    version: 1,
    name: [productTerms[0], market, audienceRole].filter(Boolean).join(' · ') || '待确认发现范围',
    scope: {
      productRef: productTerms[0] || '',
      market,
      language,
      companyRole,
      audienceRole,
      verifiedCompetitors: competitors.map(value => ({ type: 'brand' as const, value })),
    },
    graph: { discoverySeeds, sceneClusters, evidenceQueries, edges: [] },
    status: productTerms.length && market && language ? 'active' as const : 'draft' as const,
    createdBy: 'director_agent' as const,
    createdAt,
  };
  const crawlStrategyId = stableId('crawl_strategy', { keywordSetId, businessGoal: input.businessGoal, platforms });
  const discoveryBrief = {
    discoveryBriefId: stableId('discovery_brief', { crawlStrategyId, createdAt }),
    keywordSetId,
    keywordSetVersion: keywordSet.version,
    productRef: keywordSet.scope.productRef,
    market,
    audience: audienceRole,
    discoverySeedIds: discoverySeeds.map(item => item.seedId),
    trackedSceneIds: sceneClusters.filter(item => item.status === 'approved' || item.status === 'watching').map(item => item.sceneId),
    competitorAccounts: (input.benchmarkAccounts ?? []).map(item => item.accountRef),
    discoveryModes: ['momentum', 'account', 'innovation'] as SocialDiscoveryMode[],
    platforms,
    lookbackDays: Math.max(1, Math.min(30, Math.floor(input.lookbackDays ?? 7))),
    resultLimit: Math.max(1, Math.min(50, Math.floor(input.resultLimit ?? 30))),
    budgetLimitCny: Number.isFinite(input.budgetLimitCny) ? Math.max(0, Number(input.budgetLimitCny)) : null,
    productionGap: input.productionGap?.trim() || null,
    createdBy: 'director_agent' as const,
  };
  return {
    crawlStrategyId,
    version: createdAt,
    businessGoal: input.businessGoal,
    keywordSet,
    discoveryBrief,
    keywords: [
      keyword('discovery_seed', discoverySeeds.flatMap(item => item.queryVariants)),
      keyword('scene_cluster', sceneClusters.flatMap(item => item.queryVariants)),
      keyword('evidence_query', evidenceQueries.flatMap(item => item.queryVariants)),
      keyword('competitor_account', competitors),
      keyword('task_override', input.taskOverrides ?? []),
    ],
    benchmarkAccounts: (input.benchmarkAccounts ?? []).map(account => ({ ...account, weight: clamp01(account.weight ?? 0.7) })),
    platformQuotas: platforms.map(platform => ({ platform, limit: discoveryBrief.resultLimit, weight: 1 })),
    refreshIntervalMinutes: 24 * 60,
    stopConditions: ['连续三轮没有新增有效内容时暂停当前查询分支', '来源连续失败三次时熔断并等待复核', '达到单次结果、预算或超时上限时停止'],
    market: market || null,
    language: language || null,
    cultureTags: [],
    seasonTags: [],
    regionalPlatformWeights: {},
    createdBy: 'director_agent',
  };
}

/** Source reliability and content opportunity stay separate for legacy cards. */
export function scoreSocialInspirationCandidate(input: {
  platformWeight?: number;
  accountWeight?: number;
  accountTypeWeight?: number;
  industryRelevance?: number;
  strategyMatch?: number;
  currentPerformance?: number | null;
  accountPlatformBaseline?: number | null;
  engagementQuality?: number;
  freshness?: number;
  weeklyGoalRelevance?: number;
  structuralTransferability?: number;
  evidenceQuality?: number;
}): SocialInspirationScores {
  const baseline = Number(input.accountPlatformBaseline);
  const current = Number(input.currentPerformance);
  const relativePerformance = Number.isFinite(current) && current >= 0 && Number.isFinite(baseline) && baseline > 0 ? current / baseline : null;
  const relativeSignal = relativePerformance === null ? 0 : Math.min(1, relativePerformance / 5);
  const sourcePriority = Math.round(100 * (
    clamp01(input.platformWeight) * 0.25
    + clamp01(input.accountWeight) * 0.2
    + clamp01(input.accountTypeWeight) * 0.15
    + clamp01(input.industryRelevance) * 0.25
    + clamp01(input.strategyMatch) * 0.15
  ));
  const contentOpportunityScore = Math.round(100 * (
    relativeSignal * 0.32
    + clamp01(input.engagementQuality) * 0.18
    + clamp01(input.freshness) * 0.12
    + clamp01(input.weeklyGoalRelevance) * 0.16
    + clamp01(input.structuralTransferability) * 0.14
    + clamp01(input.evidenceQuality) * 0.08
  ));
  const reasons = [
    ...(relativePerformance === null ? ['账号同平台基线不足，只能标记高表现候选，不能声称正在起量'] : [`相对账号同平台基线 ${relativePerformance.toFixed(1)} 倍`]),
    ...(clamp01(input.weeklyGoalRelevance) >= 0.7 ? ['与本周经营目标高度相关'] : []),
    ...(clamp01(input.structuralTransferability) >= 0.7 ? ['结构具有较强可迁移性'] : []),
    ...(clamp01(input.evidenceQuality) < 0.4 ? ['证据质量偏低，不能直接进入事实型表达'] : []),
  ];
  return { sourcePriority, contentOpportunityScore, relativePerformance, reasons };
}

export function evaluateSocialCandidateEvidence(input: {
  inspirationId: string;
  discoveryPath: SocialCandidateEvidence['discoveryPath'];
  sceneIds?: string[];
  taskRelevance?: number;
  currentPerformance?: number | null;
  accountPlatformBaseline?: number | null;
  hasTimeSeries?: boolean;
  transferability?: number;
  mechanisms?: string[];
  limitations?: string[];
  evidenceRefs?: string[];
  novelty?: number | null;
}): SocialCandidateEvidence {
  const relevanceScore = clamp01(input.taskRelevance);
  const transferScore = clamp01(input.transferability);
  const current = Number(input.currentPerformance);
  const baseline = Number(input.accountPlatformBaseline);
  const relative = Number.isFinite(current) && current >= 0 && Number.isFinite(baseline) && baseline > 0 ? current / baseline : null;
  const momentumLevel = input.hasTimeSeries && relative !== null && relative >= 1.5
    ? 'rising' as const
    : relative !== null && relative >= 1.5
      ? 'high_performance' as const
      : 'unknown' as const;
  const level = (score: number): 'high' | 'medium' | 'low' => score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return {
    inspirationId: input.inspirationId,
    discoveryPath: unique(input.discoveryPath) as SocialCandidateEvidence['discoveryPath'],
    sceneIds: unique(input.sceneIds ?? []),
    relevance: { level: level(relevanceScore), reasons: relevanceScore >= 0.7 ? ['与当前产品、市场和沟通对象高度相关'] : ['需要结合当前任务进一步确认'] },
    momentum: {
      level: momentumLevel,
      reasons: relative === null ? ['缺少可用账号基线'] : [`相对账号基线 ${relative.toFixed(1)} 倍${input.hasTimeSeries ? '，且有时间序列证据' : '，但没有连续增长证据'}`],
      confidence: relative === null ? 0.25 : input.hasTimeSeries ? 0.85 : 0.55,
    },
    ...(Number.isFinite(input.novelty) ? { novelty: { level: level(clamp01(input.novelty)), reasons: ['与当前场景库相比存在可解释的新内容'], confidence: clamp01(input.novelty) } } : {}),
    transferability: { level: level(transferScore), mechanisms: unique(input.mechanisms ?? []), limitations: unique(input.limitations ?? []) },
    evidenceRefs: unique(input.evidenceRefs ?? []),
  };
}

export function inspirationReadinessForAnalysis(input: {
  hasMetadata: boolean;
  hasQuickAnalysis: boolean;
  hasStrategyAnalysis: boolean;
  hasExactTimeline: boolean;
  rightsClear: boolean;
}): SocialInspirationReadiness {
  if (input.hasExactTimeline && input.rightsClear) return 'production_reference';
  if (input.hasStrategyAnalysis) return 'strategy_reference';
  return 'discovery_reference';
}

export function buildSocialInspirationHandoff(input: Omit<SocialInspirationHandoff, 'readiness'> & {
  analysisState: Parameters<typeof inspirationReadinessForAnalysis>[0];
}): SocialInspirationHandoff {
  const { analysisState, ...handoff } = input;
  return { ...handoff, readiness: inspirationReadinessForAnalysis(analysisState) };
}

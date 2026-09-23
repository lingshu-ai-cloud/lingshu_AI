/** Public contracts for the Starter 198 social-content workflow. */

export const SOCIAL_CONTENT_TASK_STATUSES = [
  'draft',
  'needs_input',
  'plan_review',
  'producing',
  'asset_review',
  'packaging',
  'delivered',
  'awaiting_publish',
  'awaiting_metrics',
  'reviewed',
  'paused',
  'attention',
] as const;
export type SocialContentTaskStatus = typeof SOCIAL_CONTENT_TASK_STATUSES[number];

export const SOCIAL_WORK_PACKAGE_KINDS = [
  'industry_launch',
  'content_rocket',
  'task_express',
] as const;
export type SocialWorkPackageKind = typeof SOCIAL_WORK_PACKAGE_KINDS[number];

export const SOCIAL_WORK_PACKAGE_STATUSES = ['draft', 'internal_trial', 'active', 'retired'] as const;
export type SocialWorkPackageStatus = typeof SOCIAL_WORK_PACKAGE_STATUSES[number];

export const SOCIAL_SOURCE_KINDS = ['material', 'knowledge', 'reference_link', 'text_note'] as const;
export type SocialSourceKind = typeof SOCIAL_SOURCE_KINDS[number];

/** Customer-facing creation modes. Instant creation always represents one output. */
export const SOCIAL_CONTENT_TASK_MODES = ['weekly', 'instant'] as const;
export type SocialContentTaskMode = typeof SOCIAL_CONTENT_TASK_MODES[number];

/** The two customer-facing creation entries. Scheduling remains a separate concern. */
export const SOCIAL_CONTENT_CREATION_MODES = ['material_processing', 'viral_replication'] as const;
export type SocialContentCreationMode = typeof SOCIAL_CONTENT_CREATION_MODES[number];

/** Readiness of customer-owned visual material; `none` is a supported starting state. */
export const SOCIAL_ASSET_AVAILABILITIES = ['ready', 'limited', 'none'] as const;
export type SocialAssetAvailability = typeof SOCIAL_ASSET_AVAILABILITIES[number];

/** One-click managed is the default experience; advanced exposes optional shot controls. */
export const SOCIAL_CONTENT_MANAGEMENT_MODES = ['one_click_managed', 'advanced'] as const;
export type SocialContentManagementMode = typeof SOCIAL_CONTENT_MANAGEMENT_MODES[number];

/**
 * `social_ready` means the task targets delivery-quality social content. It no
 * longer implies that customer-shot material must already exist: a task with
 * `limited` or `none` availability may start when it has a truthful,
 * executable asset-supply plan. `concept_preview` is retained for historic or
 * internal non-publishable visual sketches.
 */
export const SOCIAL_CONTENT_PRODUCTION_MODES = ['social_ready', 'concept_preview'] as const;
export type SocialContentProductionMode = typeof SOCIAL_CONTENT_PRODUCTION_MODES[number];

/**
 * Stable first-level themes. A free-form topic is classified into one of these
 * values (or kept pending confirmation); it never becomes a sixth theme.
 */
export const SOCIAL_CONTENT_THEME_IDS = [
  'product_value',
  'scenario_solution',
  'supplier_capability',
  'customization_process',
  'customer_case',
] as const;
export type SocialContentThemeId = typeof SOCIAL_CONTENT_THEME_IDS[number];

export type SocialThemeClassificationStatus = 'confirmed' | 'pending_confirmation';

export interface SocialContentThemeCard {
  themeId: SocialContentThemeId;
  name: string;
  description: string;
  exampleTopics: string[];
  minimumShots: string[];
}

export interface SocialContentThemeSelection {
  themeId: SocialContentThemeId | null;
  inputKind: 'preset' | 'custom';
  topic: string;
  classificationStatus: SocialThemeClassificationStatus;
}

export const SOCIAL_MATERIAL_REQUIREMENT_STATUSES = [
  'missing',
  'partial',
  'pending_confirmation',
  'satisfied',
  'unusable',
] as const;
export type SocialMaterialRequirementStatus = typeof SOCIAL_MATERIAL_REQUIREMENT_STATUSES[number];

/** Public material-readiness view. Internal formula identifiers are intentionally absent. */
export interface SocialMaterialRequirement {
  requirementId: string;
  required: boolean;
  targetTheme: SocialContentThemeId;
  shotFunction: string;
  subject: string;
  action: string;
  environment: string | null;
  orientation: 'portrait' | 'landscape' | 'either';
  durationSeconds: { minimum: number; maximum: number } | null;
  status: SocialMaterialRequirementStatus;
  matchedSourceIds: string[];
  confidence: number | null;
  reason: string | null;
  recalculatedAt: string;
  ruleVersion: string;
}

export interface SocialMaterialReadiness {
  complete: boolean;
  requiredCount: number;
  satisfiedRequiredCount: number;
  blockingRequirementIds: string[];
}

export const SOCIAL_ASSET_SUPPLY_ROUTES = [
  'real_asset_enhancement',
  'product_anchored_generation',
  'zero_asset_generation',
] as const;
export type SocialAssetSupplyRoute = typeof SOCIAL_ASSET_SUPPLY_ROUTES[number];

export const SOCIAL_SHOT_FUNCTIONS = [
  'hook',
  'problem',
  'value',
  'demonstration',
  'proof',
  'trust',
  'transition',
  'call_to_action',
] as const;
export type SocialShotFunction = typeof SOCIAL_SHOT_FUNCTIONS[number];

export const SOCIAL_TRUTH_SENSITIVE_SUBJECTS = [
  'none',
  'customer_factory',
  'customer_case',
  'product_effect',
] as const;
export type SocialTruthSensitiveSubject = typeof SOCIAL_TRUTH_SENSITIVE_SUBJECTS[number];

export const SOCIAL_SHOT_SOURCE_STRATEGIES = [
  'customer_real_asset',
  'customer_product_image_animation',
  'authorized_digital_presenter',
  'licensed_stock_asset',
  'non_evidentiary_ai_visual',
  'motion_graphics',
  'verified_fact_card',
] as const;
export type SocialShotSourceStrategy = typeof SOCIAL_SHOT_SOURCE_STRATEGIES[number];

export const SOCIAL_TRUTH_PROHIBITIONS = [
  'depict_generated_factory_as_customer_factory',
  'invent_customer_case_or_results',
  'depict_generated_effect_as_verified_product_result',
  'alter_locked_product_identity',
  'present_synthetic_media_as_customer_evidence',
] as const;
export type SocialTruthProhibition = typeof SOCIAL_TRUTH_PROHIBITIONS[number];

export const SOCIAL_PRODUCTION_FEASIBILITIES = [
  'full_fidelity',
  'functional_equivalent',
  'goal_degraded',
  'blocked_for_facts_or_rights',
] as const;
export type SocialProductionFeasibility = typeof SOCIAL_PRODUCTION_FEASIBILITIES[number];

/** Public truth boundary used by both the Director and Content Agent. */
export interface SocialShotTruthBoundary {
  subject: SocialTruthSensitiveSubject;
  /** Synthetic media may explain the topic, but it may not act as customer evidence. */
  syntheticVisualAllowed: boolean;
  customerEvidenceRequired: boolean;
  customerEvidenceRefs: string[];
  confirmedFactRefs: string[];
  mustNotImplyCustomerReality: boolean;
  prohibitedRepresentations: SocialTruthProhibition[];
}

/** How an unavailable reference shot keeps its job without inventing evidence. */
export interface SocialFunctionalEquivalentReplacement {
  required: boolean;
  preservesFunction: SocialShotFunction;
  replacesSubject: SocialTruthSensitiveSubject | null;
  description: string | null;
  reason: string | null;
}

export interface SocialAssetSupplyShotPlan {
  shotId: string;
  function: SocialShotFunction;
  requestedDescription: string | null;
  sourceStrategy: SocialShotSourceStrategy;
  sourceRefs: string[];
  fallbackSourceStrategy: SocialShotSourceStrategy | null;
  productionInstruction: string;
  truthBoundary: SocialShotTruthBoundary;
  functionalEquivalentReplacement: SocialFunctionalEquivalentReplacement;
  feasibility: SocialProductionFeasibility;
  feasibilityReason: string;
  customerShootRequired: false;
}

/**
 * A complete, customer-safe source plan. Missing visual assets are solved by
 * the system; only unconfirmed facts or rights may remain as customer actions.
 */
export interface SocialAssetSupplyPlan {
  planVersion: string;
  creationMode: SocialContentCreationMode;
  assetAvailability: SocialAssetAvailability;
  managementMode: SocialContentManagementMode;
  productionRoute: SocialAssetSupplyRoute;
  status: 'ready' | 'goal_degraded' | 'requires_fact_confirmation' | 'requires_rights_confirmation';
  overallFeasibility: SocialProductionFeasibility;
  /** @deprecated Use `overallFeasibility`; retained for old clients only. */
  canProduceWithoutCustomerShoot: boolean;
  customerActions: Array<'confirm_facts' | 'confirm_rights'>;
  systemActions: string[];
  optionalEnhancements: string[];
  shots: SocialAssetSupplyShotPlan[];
}

export interface SocialReferenceShotTags {
  sceneTypes: string[];
  subjects: string[];
  subjectRelations: string[];
  cameraLanguage: string[];
  contentFunctions: SocialShotFunction[];
  soundTypes: string[];
  onScreenInformation: string[];
  truthRequirements: SocialTruthSensitiveSubject[];
  suggestedProductionMethods: SocialShotSourceStrategy[];
}

/** A multimodal, shot-level reading of one reference video; never a reusable formula. */
export interface SocialReferenceShotAnalysis {
  shotId: string;
  startSeconds: number;
  endSeconds: number;
  visualDescription: string;
  spokenText: string | null;
  captionText: string | null;
  audioDescription: string | null;
  rhythmDescription: string;
  purpose: SocialShotFunction;
  action?: { startState: string; path: string; endState: string; spatialRelation: string };
  shotLanguage?: { shotSize: string; cameraAngle: string; movement: string; composition: string };
  audioLayers?: {
    voice: string | null;
    captions: string | null;
    ambient: string | null;
    music: string | null;
    soundEffects: string | null;
  };
  observation?: {
    observableFacts: string[];
    inferredIntent: string[];
    causalGaps: string[];
    postProductionOverlays: string[];
  };
  tags: SocialReferenceShotTags;
  fidelityPoints: string[];
  mustDifferPoints: string[];
}

export interface SocialThreeSecondHook {
  hookId: string;
  role: 'primary' | 'alternative';
  firstFrame: string;
  firstSecondAction: string;
  spokenLine: string | null;
  caption: string | null;
  mechanism: string;
  audiovisualPlan: string;
  sourceStrategy: SocialShotSourceStrategy;
  truthBoundary: SocialShotTruthBoundary;
  referencePoints: string[];
  mustDifferPoints: string[];
  status: 'draft' | 'recommended' | 'confirmed' | 'rejected';
}

export interface SocialReferenceVideoAnalysis {
  analysisId: string;
  /** Incrementing analysis version. Optional only on historic records. */
  version?: string;
  referenceSourceId: string;
  status: 'analyzing' | 'ready' | 'blocked';
  durationSeconds: number | null;
  analysisLayers?: Array<{
    level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
    status: 'complete' | 'partial' | 'pending';
    scope: string;
    confidence: number | null;
  }>;
  coverage?: {
    fullDurationSeconds: number | null;
    precisionIntervals: Array<{ startSeconds: number; endSeconds: number; level: 'L1' | 'L2' | 'L3' | 'L4' }>;
    gaps: Array<{ startSeconds: number; endSeconds: number; reason: string }>;
    overallConfidence: number | null;
    fullTimelineCovered: boolean;
  };
  shots: SocialReferenceShotAnalysis[];
  hookAnalysis: SocialThreeSecondHook | null;
  rightsNotice: string;
  createdAt: string;
}

/** Multi-sample retrieval memory. It is evidence-backed guidance, never a mandatory formula. */
export interface SocialCreativePatternMemory {
  patternMemoryId: string;
  version: string;
  status: 'candidate' | 'validated' | 'retired';
  evidenceAnalysisIds: string[];
  productionResultIds: string[];
  hookTypes: string[];
  revealOrder: SocialShotFunction[];
  evidencePositions: number[];
  rhythm: string[];
  emotionChanges: string[];
  ctaPositions: number[];
  applicableIndustries: string[];
  failureConditions: string[];
  confidence: number;
  createdBy: 'system_learning';
  updatedAt: string;
}

export type SocialCompanyRole = 'factory' | 'brand' | 'importer' | 'distributor' | 'retailer';
export type SocialAudienceRole = 'brand_buyer' | 'importer' | 'distributor' | 'retailer' | 'consumer';
export type SocialSearchIntent = 'learn' | 'compare' | 'buy' | 'use';
export type SocialKeywordEvidenceSource = 'product' | 'website' | 'inquiry' | 'competitor' | 'user' | 'content' | 'comment';
export type SocialDiscoveryMode = 'momentum' | 'account' | 'innovation';
export type SocialDiscoveryPath = 'keyword' | 'account' | 'relation' | 'performance' | 'innovation';
export type SocialInspirationReadiness = 'discovery_reference' | 'strategy_reference' | 'production_reference';
export type SocialAccountTrackingStatus = 'candidate' | 'trial' | 'tracked' | 'watching' | 'stopped';
export type SocialCrawlKeywordCategory = 'discovery_seed' | 'scene_cluster' | 'evidence_query' | 'competitor_account' | 'task_override';
export type SocialBenchmarkAccountType = 'brand_factory' | 'professional_creator' | 'channel' | 'user_reviewer' | 'industry_media' | 'expression_reference';

export interface SocialKeywordScope {
  productRef: string;
  market: string;
  language: string;
  companyRole: SocialCompanyRole;
  audienceRole: SocialAudienceRole;
  verifiedCompetitors: Array<{ type: 'brand' | 'domain' | 'account'; value: string }>;
}

export interface SocialDiscoverySeed {
  seedId: string;
  label: string;
  queryVariants: string[];
  evidence: SocialKeywordEvidenceSource[];
  enabled: boolean;
}

export interface SocialSceneCluster {
  sceneId: string;
  label: string;
  productTask: string;
  demandDimension: 'audience' | 'scene' | 'problem' | 'desired_result' | 'decision_concern' | 'mechanism' | 'proof';
  queryVariants: string[];
  evidence: SocialKeywordEvidenceSource[];
  status: 'suggested' | 'approved' | 'rejected' | 'watching';
}

export interface SocialContentSearchUnit {
  unitId: string;
  groupLabel: string;
  productEntity: string;
  buyerQuestion: string;
  observableEvidence: string;
  contentPattern?: 'test' | 'process' | 'comparison' | 'tutorial' | 'case' | 'demo';
  intent: SocialSearchIntent;
  queryVariants: string[];
  evidence: SocialKeywordEvidenceSource[];
  status: 'suggested' | 'approved' | 'rejected';
}

export interface SocialKeywordRelation {
  relationId: string;
  fromId: string;
  toId: string;
  evidenceRefs: string[];
  occurrenceCount: number;
  confidence: number;
}

export interface SocialKeywordGraph {
  discoverySeeds: SocialDiscoverySeed[];
  sceneClusters: SocialSceneCluster[];
  evidenceQueries: SocialContentSearchUnit[];
  edges: SocialKeywordRelation[];
}

export interface SocialMarketKeywordSet {
  keywordSetId: string;
  version: number;
  name: string;
  scope: SocialKeywordScope;
  graph: SocialKeywordGraph;
  status: 'draft' | 'active' | 'retired';
  createdBy: 'director_agent' | 'user';
  createdAt: string;
}

export interface SocialDiscoveryBrief {
  discoveryBriefId: string;
  keywordSetId: string;
  keywordSetVersion: number;
  productRef: string;
  market: string;
  audience: string;
  discoverySeedIds: string[];
  trackedSceneIds: string[];
  competitorAccounts: string[];
  discoveryModes: SocialDiscoveryMode[];
  platforms: string[];
  lookbackDays: number;
  resultLimit: number;
  budgetLimitCny: number | null;
  productionGap: string | null;
  createdBy: 'director_agent' | 'user';
}

export interface SocialCandidateEvidence {
  inspirationId: string;
  discoveryPath: SocialDiscoveryPath[];
  sceneIds: string[];
  relevance: { level: 'high' | 'medium' | 'low'; reasons: string[] };
  momentum: { level: 'rising' | 'high_performance' | 'unknown'; reasons: string[]; confidence: number };
  novelty?: { level: 'high' | 'medium' | 'low'; reasons: string[]; confidence: number };
  transferability: { level: 'high' | 'medium' | 'low'; mechanisms: string[]; limitations: string[] };
  evidenceRefs: string[];
}

export interface SocialInspirationHandoff {
  inspirationId: string;
  analysisId: string;
  analysisVersion: string;
  readiness: SocialInspirationReadiness;
  source: { platform: string; sourceUrl: string; author?: string; publishedAt?: string };
  taskContext: { taskId?: string; productRef?: string; market?: string; audience?: string; userNote?: string };
  whySelected: string[];
  referenceRole: 'primary_structure' | 'proof_reference' | 'visual_rhythm' | 'cta_reference';
  reusableLogic: { hookTypes: string[]; revealOrder: string[]; proofPlacement: string[]; pacing: string; emotionalProgression: string; ctaPosition: string };
  adaptationBoundary: { reusable: string[]; mustReplace: string[]; prohibited: string[] };
  productionImplications: { requiredEvidence: string[]; likelyAssetNeeds: string[]; difficulty?: 'low' | 'medium' | 'high'; risks: string[] };
  evidenceRefs: Array<{ startTime?: number; endTime?: number; description: string; confidence: number; needsReview: boolean }>;
  rights: { mayAnalyze: boolean; mayUseOriginalMedia: boolean; mayAdapt: boolean; note?: string };
}

export interface SocialAccountTrackingDecision {
  accountId: string;
  decision: 'trial' | 'track' | 'watch' | 'stop';
  status: SocialAccountTrackingStatus;
  accountRole: SocialBenchmarkAccountType;
  reasons: string[];
  evidenceVideoIds: string[];
  relatedSceneIds: string[];
  missingEvidence: string[];
  nextReviewAt?: string;
  recommendedCadence?: string;
  confidence: number;
}

export interface SocialCrawlStrategy {
  crawlStrategyId: string;
  version: string;
  businessGoal: string;
  keywordSet: SocialMarketKeywordSet;
  discoveryBrief: SocialDiscoveryBrief;
  /** Compiled execution view kept for existing scheduler consumers. */
  keywords: Array<{ category: SocialCrawlKeywordCategory; values: string[] }>;
  benchmarkAccounts: Array<{ accountRef: string; type: SocialBenchmarkAccountType; weight: number }>;
  platformQuotas: Array<{ platform: string; limit: number; weight: number }>;
  refreshIntervalMinutes: number;
  stopConditions: string[];
  market: string | null;
  language: string | null;
  cultureTags: string[];
  seasonTags: string[];
  regionalPlatformWeights: Record<string, number>;
  createdBy: 'director_agent' | 'user';
}

export interface SocialInspirationScores {
  sourcePriority: number;
  contentOpportunityScore: number;
  relativePerformance: number | null;
  reasons: string[];
}

export interface SocialReplicationScriptShot {
  shotId: string;
  referenceShotId: string | null;
  startSeconds: number;
  endSeconds: number;
  purpose: SocialShotFunction;
  visualInstruction: string;
  spokenText: string | null;
  captionText: string | null;
  audioAndTransition: string | null;
  fidelityPoints: string[];
  mustDifferPoints: string[];
  materialPlan: SocialAssetSupplyShotPlan;
  lockedRegions: string[];
  risks: string[];
}

export interface SocialReplicationScriptVersion {
  version: string;
  referenceAnalysisId: string;
  status: 'draft' | 'review_required' | 'confirmed' | 'superseded';
  primaryHookId: string;
  hookOptions: SocialThreeSecondHook[];
  shots: SocialReplicationScriptShot[];
  structureFidelitySummary: string;
  originalityDifferenceSummary: string;
  createdAt: string;
}

export interface SocialShotMaterialMapEntry {
  shotId: string;
  customerAssetIds: string[];
  generatedAssetIds: string[];
  licensedAssetIds: string[];
  sourceStrategy: SocialShotSourceStrategy;
  truthBoundary: SocialShotTruthBoundary;
  functionalEquivalentReplacement: SocialFunctionalEquivalentReplacement;
}

export const SOCIAL_AGENT_WORKFLOW_STAGES = [
  'planned',
  'reference_ready',
  'director_ready',
  'execution_planning',
  'director_review',
  'producing',
  'technical_review',
  'creative_review',
  'asset_review',
  'ready_to_publish',
  'needs_facts',
  'needs_rights',
  'needs_budget',
  'goal_degraded',
  'failed_recoverable',
] as const;
export type SocialAgentWorkflowStage = typeof SOCIAL_AGENT_WORKFLOW_STAGES[number];

export interface SocialWeeklyContentPackage {
  packageId: string;
  version: string;
  businessGoal: string;
  productFocus: string | null;
  audience: string | null;
  markets: string[];
  languages: string[];
  originalContentCount: number;
  adaptationVersionCount: number;
  publicationTaskCount: number;
  platforms: string[];
  publicationMatrix: Array<{
    platform: string;
    accountRef: string | null;
    accountPositioning: string | null;
    publishWindow: string | null;
  }>;
  weeklyBudgetCny: number | null;
  perItemBudgetCny: number | null;
  dueAt: string | null;
  availableAssetRefs: string[];
  customerCanShoot: boolean;
  availableCapabilities: SocialShotSourceStrategy[];
  priorities: Array<'must_do' | 'can_delay' | 'experiment'>;
  successCriteria: string[];
  metricTargets: string[];
  createdBy: 'business_agent';
}

export interface SocialAdHocBusinessContext {
  contextId: string;
  version: string;
  objective: string;
  productRef: string | null;
  audience: string | null;
  platforms: string[];
  markets: string[];
  languages: string[];
  budgetCny: number | null;
  dueAt: string | null;
  factSourceRefs: string[];
  createdBy: 'business_agent';
}

export interface SocialDirectorBriefScene {
  sceneId: string;
  order: number;
  referenceShotId: string | null;
  purpose: SocialShotFunction;
  targetVisual: string;
  requiredEvidence: string[];
  action: { startState: string; path: string; endState: string };
  shotLanguage: { shotSize: string; cameraAngle: string; movement: string; composition: string };
  spaceAndContinuity: string[];
  audioLayers: {
    voiceover: string | null;
    dialogue: string | null;
    captionIntent: string | null;
    ambient: string | null;
    music: string | null;
    soundEffects: string | null;
  };
  duration: { startSeconds: number; endSeconds: number; targetSeconds: number };
  truthBoundary: SocialShotTruthBoundary;
  allowedVariation: string[];
  acceptanceCriteria: string[];
  fidelityPoints: string[];
  mustDifferPoints: string[];
}

/** Director-owned expression contract. It deliberately contains no asset, clip, model or provider choice. */
export interface SocialDirectorBrief {
  directorBriefId: string;
  version: string;
  status: 'ready' | 'blocked';
  source: { weeklyPackageId: string | null; adHocBusinessContextId: string | null };
  referenceAnalysis: {
    analysisId: string;
    version: string;
    fullDurationSeconds: number | null;
    precisionIntervals: Array<{ startSeconds: number; endSeconds: number; level: 'L1' | 'L2' | 'L3' | 'L4' }>;
    gaps: Array<{ startSeconds: number; endSeconds: number; reason: string }>;
    overallConfidence: number | null;
  } | null;
  inspirationHandoffIds?: string[];
  topic: string;
  audience: string | null;
  platforms: string[];
  accountRefs: string[];
  creativeIntent: string;
  narrativeStructure: string[];
  rhythm: string;
  primaryHookId: string | null;
  coreSellingPoints: string[];
  callToAction: string | null;
  totalDurationSeconds: number;
  aspectRatio: string | null;
  languages: string[];
  brandRequirements: string[];
  factSourceRefs: string[];
  rightsConstraints: string[];
  referenceEvidence: Array<{
    analysisId: string;
    referenceShotId: string | null;
    transferable: string[];
    mustReplace: string[];
  }>;
  budgetCny: number | null;
  dueAt: string | null;
  scenes: SocialDirectorBriefScene[];
  createdBy: 'director_agent';
}

export interface SocialExecutionCandidate {
  candidateId: string;
  kind: 'asset' | 'capability';
  label: string;
  sourceRef: string | null;
  sourceStrategy: SocialShotSourceStrategy;
  evidenceStrength: 'strong' | 'supporting' | 'non_evidentiary';
  rightsStatus: 'confirmed' | 'restricted' | 'requires_confirmation';
  enterpriseOwnershipScore: number;
  semanticScore: number;
  evidenceScore: number;
  actionAndShotScore: number;
  qualityScore: number;
  durationFitScore: number;
  repetitionPenalty: number;
  estimatedCostCny: number;
  estimatedSeconds: number;
  estimatedSuccessRate: number;
  dataTransfer: 'local_only' | 'external_processor';
  providerId: string | null;
  modelId: string | null;
  clipId: string | null;
  timeRange: { startSeconds: number; endSeconds: number } | null;
  promptRef: string | null;
  retryPolicy: { maxAttempts: number; fallbackStrategies: SocialShotSourceStrategy[] };
  provenance: {
    origin: 'customer' | 'licensed_library' | 'system_capability';
    inputVersion: string;
    authorizationRef: string | null;
    executionRecordId: string | null;
  };
}

export interface SocialContentExecutionScenePlan {
  sceneId: string;
  feasibility: SocialProductionFeasibility;
  feasibilityReason: string;
  candidates: SocialExecutionCandidate[];
  recommendedCandidateIds: string[];
  alternativeCandidateGroups: string[][];
  selectedSourceStrategy: SocialShotSourceStrategy;
  fallbackSourceStrategy: SocialShotSourceStrategy | null;
  estimatedCostCny: number;
  estimatedSeconds: number;
  estimatedSuccessRate: number;
  rightsRisks: string[];
  dataTransferRisks: string[];
  idempotencyKey: string;
}

/** Content-Agent-owned implementation plan. */
export interface SocialContentExecutionPlan {
  executionPlanId: string;
  version: string;
  directorBriefId: string;
  directorBriefVersion: string;
  status: 'planning' | 'review_required' | 'approved' | 'blocked';
  reviewRound: number;
  maxReviewRounds: number;
  budgetLimitCny: number | null;
  deadlineAt: string | null;
  estimatedTotalCostCny: number;
  estimatedTotalSeconds: number;
  scenes: SocialContentExecutionScenePlan[];
  createdBy: 'content_agent';
}

export type SocialExecutionPlanReviewReason =
  | 'material_insufficient'
  | 'facts_missing'
  | 'rights_missing'
  | 'budget_exceeded'
  | 'capability_mismatch'
  | 'duration_mismatch'
  | 'generation_failed'
  | 'expression_failed';

export interface SocialExecutionPlanSceneReview {
  sceneId: string;
  approved: boolean;
  feasibility: SocialProductionFeasibility;
  failedCriteria: string[];
  requiredRevision: string[];
  goalImpact: 'none' | 'video' | 'weekly_plan';
  reasonCodes: SocialExecutionPlanReviewReason[];
}

export interface SocialExecutionPlanReview {
  reviewId: string;
  version: string;
  executionPlanId: string;
  executionPlanVersion: string;
  directorBriefId: string;
  directorBriefVersion: string;
  approved: boolean;
  sceneResults: SocialExecutionPlanSceneReview[];
  failedCriteria: string[];
  requiredRevision: string[];
  goalImpact: 'none' | 'video' | 'weekly_plan';
  reasonCodes: SocialExecutionPlanReviewReason[];
  createdBy: 'director_agent';
}

export interface SocialProductionResult {
  productionResultId: string;
  version: string;
  executionPlanId: string;
  executionPlanVersion: string;
  executionPlanReviewId: string;
  artifactId: string | null;
  creativeReviewId: string;
  publishAssignmentId: string | null;
  status: 'technical_review_passed' | 'creative_review_passed' | 'asset_review';
  sceneResults: Array<{
    sceneId: string;
    idempotencyKey: string;
    sourceStrategy: SocialShotSourceStrategy;
    feasibility: SocialProductionFeasibility;
    provenanceCandidateIds: string[];
  }>;
  technicalReview: { approved: boolean; checkedScenes: number; failures: string[] };
  creativeReview: { approved: boolean; failedCriteria: string[]; reviewedBy: 'director_agent' };
  artifactResourceRef: string;
  createdAt: string;
}

export interface SocialContentAgentWorkflow {
  schemaVersion: 'social-content-agent-workflow.v1';
  stage: SocialAgentWorkflowStage;
  contentPlanId: string;
  videoTaskId: string;
  weeklyPackage: SocialWeeklyContentPackage | null;
  adHocBusinessContext: SocialAdHocBusinessContext | null;
  discoveryBrief: SocialDiscoveryBrief | null;
  inspirationHandoffs: SocialInspirationHandoff[];
  directorBrief: SocialDirectorBrief;
  executionPlan: SocialContentExecutionPlan;
  executionPlanReview: SocialExecutionPlanReview;
  productionResult: SocialProductionResult | null;
}

export const SOCIAL_ARTIFACT_STATUSES = ['draft', 'review_required', 'approved', 'changes_requested', 'superseded'] as const;
export type SocialArtifactStatus = typeof SOCIAL_ARTIFACT_STATUSES[number];

export interface SocialWorkPackageCard {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
  available: boolean;
  summary: string | null;
  requiredInputs: string[];
  deliverables: string[];
}

export interface SocialWorkPackageFramework {
  applicability: string[];
  requiredInputs: string[];
  workOutline: string[];
  deliverables: string[];
  userDecisions: string[];
  qualityChecks: string[];
  metricRequirements: string[];
  fallbackPolicy: string[];
}

export interface SocialWorkPackageVersionDetail extends SocialWorkPackageCard {
  summary: string | null;
  status: SocialWorkPackageStatus;
  framework: SocialWorkPackageFramework;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  recordVersion: string;
  updatedAt: string;
  builtin: boolean;
}

export interface CreateSocialWorkPackageVersionInput {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
  summary?: string | null;
  framework?: Partial<SocialWorkPackageFramework>;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}

export interface UpdateSocialWorkPackageVersionInput {
  expectedVersion: string;
  changes: Partial<Omit<CreateSocialWorkPackageVersionInput, 'kind' | 'packageKey' | 'version'>>;
}

export interface SocialWorkPackageSelection {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
}

export interface SocialContentTaskBrief {
  title: string;
  objective: string;
  productRef: string | null;
  audience: string | null;
  markets: string[];
  languages: string[];
  platforms: string[];
  formats: string[];
  aspectRatio: string | null;
  cadence: string | null;
  requestedOutputCount: number | null;
  weeklyBudgetCny?: number | null;
  perItemBudgetCny?: number | null;
  retryReserveCny?: number | null;
  planningMode?: 'fixed' | 'auto_adjust';
  shootingWindowMinutes?: number | null;
  specialRequirements?: string | null;
  dueAt: string | null;
  brandNotes: string | null;
  restrictions: string[];
  callToAction: string | null;
  /** New two-entry workflow. Omitted on historic tasks. */
  creationMode?: SocialContentCreationMode;
  /** Customer visual readiness is informative and must never be the sole blocker. */
  assetAvailability?: SocialAssetAvailability;
  /** Defaults to one-click managed for newly created customer tasks. */
  managementMode?: SocialContentManagementMode;
  /** Always present on newly created tasks; optional for historic projections. */
  productionMode?: SocialContentProductionMode;
}

/** Public metadata only. Formula identifiers and internal prompt templates stay server-side. */
export interface SocialScriptBaselineSummary {
  version: string;
  source: 'reference_analysis' | 'asset_supply_plan' | 'inspiration_script' | 'knowledge_fallback' | 'system_theme_baseline' | 'formula';
  sceneCount: number;
  language: 'zh' | 'en';
  lockedAt: string;
  /** Public lineage only; internal formula/script identifiers remain private. */
  matchConfidence?: number;
  groundingVersion?: string;
  /** Active task reference source; absent for system recommendations and historic records. */
  referenceSourceId?: string | null;
}

/**
 * Customer-safe projection of the versioned Director Agent handoff. Formula
 * identifiers, internal templates and material scoring evidence remain on the
 * server; the user can still understand exactly what the director prepared for
 * the Content Agent.
 */
export interface SocialDirectorPlanSummary {
  version: string;
  status: 'ready' | 'blocked';
  scriptSource: 'reference_analysis' | 'asset_supply_plan' | 'inspiration_script' | 'knowledge_fallback' | 'system_theme_baseline' | 'formula';
  baselineVersion: string;
  sceneCount: number;
  language: 'zh' | 'en';
  createdAt: string;
  /** @deprecated Kept only while historic formula-backed plans remain readable. */
  formulaConfigured: boolean;
  qualityPassed: boolean;
  reshootSuggestionCount: number;
  scriptSummary: string;
  voiceoverSummary: string;
  subtitleSummary: string;
  shotRhythmSummary: string;
  /** Active task reference source; null for a clearly-labelled system recommendation. */
  referenceSourceId?: string | null;
}

export interface SocialContentTaskSummary {
  taskId: string;
  brief: SocialContentTaskBrief;
  status: SocialContentTaskStatus;
  version: string;
  packageSelection: SocialWorkPackageSelection[];
  readiness: {
    complete: boolean;
    /** Only conditions that genuinely prevent any safe production. */
    missing: string[];
    /** Optional inputs that improve personalization but never block production. */
    personalizationGaps?: string[];
  };
  runId: string | null;
  sourceCount: number;
  knowledgeSourceCount: number;
  materialSourceCount: number;
  artifactCount: number;
  approvedArtifactCount: number;
  deliveryPackageCount: number;
  publicationCount: number;
  metricSubmissionCount: number;
  createdAt: string;
  updatedAt: string;
  /** Present for theme-driven tasks; omitted only for records created before this workflow. */
  mode?: SocialContentTaskMode;
  weeklyPlanId?: string | null;
  theme?: SocialContentThemeSelection | null;
  materialReadiness?: SocialMaterialReadiness;
  assetSupplyPlan?: SocialAssetSupplyPlan;
  scriptBaseline?: SocialScriptBaselineSummary;
  /** Present after the Director Agent has handed a locked plan to Content Agent. */
  directorPlan?: SocialDirectorPlanSummary;
}

export interface SocialTaskSource {
  sourceId: string;
  taskId: string;
  kind: SocialSourceKind;
  sourceRef: string;
  sourceVersion: string | null;
  label: string;
  purpose: string | null;
  status: 'active' | 'replaced' | 'removed';
  createdAt: string;
}

export interface SocialContentFile {
  fileId: string;
  taskId: string;
  usage: 'source' | 'metric_evidence' | 'artifact_media';
  fileRef: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  /** Authenticated application-backend URL; never an application-server path. */
  downloadUrl?: string;
}

export interface SocialContentSourceOption {
  optionId: string;
  kind: 'knowledge' | 'material';
  sourceRef: string;
  sourceVersion: string;
  label: string;
  type: string;
  thumbnailHref: string | null;
}

export interface SocialContentSourceOptionPage {
  items: SocialContentSourceOption[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  status: 'ready' | 'partial' | 'unavailable';
}

export interface SocialContentArtifact {
  artifactId: string;
  taskId: string;
  kind: string;
  platform: string | null;
  language: string | null;
  version: string;
  status: SocialArtifactStatus;
  origin: 'agent' | 'manual';
  resourceRef: string | null;
  content: Record<string, unknown> | null;
  parentArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialDeliveryPackage {
  packageId: string;
  taskId: string;
  version: string;
  status: 'preparing' | 'ready' | 'confirmed' | 'superseded';
  artifactIds: string[];
  packageHash: string;
  downloadHref: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPublicationRecord {
  publicationId: string;
  taskId: string;
  packageId: string;
  platform: string;
  accountLabel: string | null;
  publicUrl: string | null;
  platformPostId: string | null;
  publishedAt: string;
  notes: string | null;
  status: 'registered';
  createdAt: string;
  updatedAt: string;
}

export interface SocialMetricSubmission {
  submissionId: string;
  taskId: string;
  publicationId: string;
  method: 'link' | 'platform_id' | 'table' | 'screenshot' | 'manual' | 'connected_account';
  capturedAt: string;
  metrics: Record<string, number | null>;
  evidenceRefs: string[];
  notes: string | null;
  status: 'received' | 'needs_confirmation' | 'confirmed';
  version: string;
  createdAt: string;
}

export interface SocialContentTaskDetail extends SocialContentTaskSummary {
  sources: SocialTaskSource[];
  artifacts: SocialContentArtifact[];
  deliveryPackages: SocialDeliveryPackage[];
  publications: SocialPublicationRecord[];
  metricSubmissions: SocialMetricSubmission[];
  materialRequirements?: SocialMaterialRequirement[];
  referenceVideoAnalysis?: SocialReferenceVideoAnalysis | null;
  replicationScript?: SocialReplicationScriptVersion | null;
  shotMaterialMap?: SocialShotMaterialMapEntry[];
  /** Unified Business → Director → Content Agent projection. */
  agentWorkflow?: SocialContentAgentWorkflow;
}

export interface SocialWeeklyPlanItemInput {
  title: string;
  objective: string;
  themeId?: SocialContentThemeId | null;
  customTopic?: string | null;
  topic?: string | null;
}

export interface CreateSocialWeeklyPlanInput {
  title: string;
  objective: string;
  productRef?: string | null;
  audience?: string | null;
  items: SocialWeeklyPlanItemInput[];
}

export interface SocialWeeklyPlan {
  weeklyPlanId: string;
  title: string;
  objective: string;
  productRef: string | null;
  audience: string | null;
  taskIds: string[];
  status: 'draft' | 'active' | 'completed';
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialContentTaskPage {
  items: SocialContentTaskSummary[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export type SocialContentTaskListMeta = Omit<SocialContentTaskPage, 'items'>;

export interface SocialContentWorkspace {
  catalog: SocialWorkPackageCard[];
  tasks: SocialContentTaskSummary[];
  taskList: SocialContentTaskListMeta;
  currentTask: SocialContentTaskDetail | null;
  weeklyPlans?: SocialWeeklyPlan[];
  themes?: SocialContentThemeCard[];
}

export interface CreateSocialContentTaskInput {
  title: string;
  objective: string;
  productRef?: string | null;
  audience?: string | null;
  markets?: string[];
  languages?: string[];
  platforms?: string[];
  formats?: string[];
  aspectRatio?: string | null;
  cadence?: string | null;
  requestedOutputCount?: number | null;
  weeklyBudgetCny?: number | null;
  perItemBudgetCny?: number | null;
  retryReserveCny?: number | null;
  planningMode?: 'fixed' | 'auto_adjust';
  shootingWindowMinutes?: number | null;
  specialRequirements?: string | null;
  dueAt?: string | null;
  brandNotes?: string | null;
  restrictions?: string[];
  callToAction?: string | null;
  creationMode?: SocialContentCreationMode;
  assetAvailability?: SocialAssetAvailability;
  managementMode?: SocialContentManagementMode;
  productionMode?: SocialContentProductionMode;
  mode?: SocialContentTaskMode;
  weeklyPlanId?: string | null;
  themeId?: SocialContentThemeId | null;
  customTopic?: string | null;
  topic?: string | null;
  /** Compatibility marker for historic material/clone/product entry routes. */
  legacyCreationRoute?: 'material' | 'clone' | 'product' | null;
}

export interface UpdateSocialContentTaskInput {
  expectedVersion: string;
  changes: Partial<CreateSocialContentTaskInput>;
}

export interface AddSocialTaskSourceInput {
  kind: SocialSourceKind;
  sourceRef: string;
  sourceVersion?: string | null;
  label: string;
  purpose?: string | null;
}

export interface SelectSocialWorkPackagesInput {
  expectedVersion: string;
  selections: Array<Pick<SocialWorkPackageSelection, 'kind' | 'packageKey' | 'version'>>;
}

export interface CreateSocialArtifactInput {
  kind: string;
  platform?: string | null;
  language?: string | null;
  origin: 'agent' | 'manual';
  resourceRef?: string | null;
  content?: Record<string, unknown> | null;
  parentArtifactId?: string | null;
}

export interface DecideSocialArtifactInput {
  expectedVersion: string;
  decision: 'approved' | 'changes_requested';
  note?: string | null;
}

export interface DecideSocialArtifactBatchInput {
  artifacts: Array<{ artifactId: string; expectedVersion: string }>;
  decision: 'approved' | 'changes_requested';
  note?: string | null;
}

export interface CreateSocialDeliveryPackageInput {
  expectedTaskVersion: string;
  artifactIds: string[];
}

export interface RegisterSocialPublicationInput {
  expectedTaskVersion: string;
  packageId: string;
  platform: string;
  accountLabel?: string | null;
  publicUrl?: string | null;
  platformPostId?: string | null;
  publishedAt: string;
  notes?: string | null;
}

export interface SubmitSocialMetricsInput {
  method: SocialMetricSubmission['method'];
  capturedAt: string;
  metrics: Record<string, number | null>;
  evidenceRefs?: string[];
  notes?: string | null;
}

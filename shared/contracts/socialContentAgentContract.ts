import {
  SOCIAL_CONTENT_TASK_STATUSES,
  SOCIAL_WORK_PACKAGE_KINDS,
  SOCIAL_WORK_PACKAGE_STATUSES,
  SOCIAL_SOURCE_KINDS,
  SOCIAL_CONTENT_TASK_MODES,
  SOCIAL_CONTENT_CREATION_MODES,
  SOCIAL_REPLICATION_REFERENCE_MODES,
  SOCIAL_ASSET_AVAILABILITIES,
  SOCIAL_CONTENT_MANAGEMENT_MODES,
  SOCIAL_CONTENT_PRODUCTION_MODES,
  SOCIAL_CONTENT_THEME_IDS,
  SOCIAL_MATERIAL_REQUIREMENT_STATUSES,
  SOCIAL_ASSET_SUPPLY_ROUTES,
  SOCIAL_SHOT_FUNCTIONS,
  SOCIAL_TRUTH_SENSITIVE_SUBJECTS,
  SOCIAL_SHOT_SOURCE_STRATEGIES,
  SOCIAL_TRUTH_PROHIBITIONS,
  SOCIAL_PRODUCTION_FEASIBILITIES,
  SOCIAL_REPLICATION_FACTOR_CATEGORIES,
  SOCIAL_REPLICATION_FACTOR_POLICIES,
  type SocialContentTaskStatus,
  type SocialWorkPackageKind,
  type SocialWorkPackageStatus,
  type SocialSourceKind,
  type SocialContentTaskMode,
  type SocialContentCreationMode,
  type SocialReplicationReferenceMode,
  type ReferenceMode,
  type SocialAssetAvailability,
  type SocialContentManagementMode,
  type SocialContentProductionMode,
  type SocialContentThemeId,
  type SocialThemeClassificationStatus,
  type SocialContentThemeCard,
  type SocialContentThemeSelection,
  type SocialMaterialRequirementStatus,
  type SocialMaterialRequirement,
  type SocialMaterialReadiness,
  type SocialAssetSupplyRoute,
  type SocialShotFunction,
  type SocialTruthSensitiveSubject,
  type SocialShotSourceStrategy,
  type SocialTruthProhibition,
  type SocialProductionFeasibility,
  type SocialShotTruthBoundary,
  type SocialFunctionalEquivalentReplacement,
  type SocialAssetSupplyShotPlan,
  type SocialAssetSupplyPlan,
  type SocialReferenceShotTags,
  type SocialReferenceShotAnalysis,
  type SocialTimelineSubjectKind,
  type SocialTimelineBeat,
  type SocialThreeSecondHook,
  type SocialReferenceVideoAnalysis,
  type SocialVersionedObjectRef,
  type SocialBenchmarkAccountSnapshot,
  type SocialReferenceContentAnalysis,
  type SocialAccountPlaybookRef,
  type SocialReplicationReferenceChain,
  type SocialReplicationFactorCategory,
  type SocialReplicationFactorPolicy,
  type SocialReplicationFactorImportance,
  type SocialReplicationCausalRole,
  type SocialReplicationCausalStatus,
  type SocialReplicationFactorEvidence,
  type SocialReplicationFactorTarget,
  type SocialReplicationFactorTolerance,
  type SocialReplicationFactorValidator,
  type SocialReplicationFactorSpec,
  type ReplicationFactorSpec,
  type SocialReplicationReferenceAssignment,
  type SocialReplicationJobContext,
  type SocialReplicationJob,
  type ReplicationJob,
  type SocialCreativePatternMemory,
  type SocialCompanyRole,
  type SocialAudienceRole,
  type SocialSearchIntent,
  type SocialKeywordEvidenceSource,
  type SocialDiscoveryMode,
  type SocialDiscoveryPath,
  type SocialInspirationReadiness,
  type SocialAccountTrackingStatus,
  type SocialCrawlKeywordCategory,
  type SocialBenchmarkAccountType,
  type SocialKeywordScope,
  type SocialDiscoverySeed,
  type SocialSceneCluster,
  type SocialContentSearchUnit,
  type SocialKeywordRelation,
  type SocialKeywordGraph,
  type SocialMarketKeywordSet,
  type SocialDiscoveryBrief,
  type SocialDiscoveryModePolicy,
  type SocialCollectionRunStatus,
  type SocialCollectionStopReason,
  type SocialDiscoveryModeRunStats,
  type SocialInspirationCollectionRun,
  type SocialProductionGapRequirement,
  type SocialProductionGapBudget,
  type SocialProductionGapTask,
  type SocialDiscoverySummary,
  type SocialCandidateEvidence,
  type SocialInspirationHandoff,
  type SocialAccountTrackingDecision,
  type SocialCrawlStrategy,
  type SocialInspirationScores,
  type SocialReplicationScriptShot,
  type SocialReplicationScriptVersion,
  type SocialShotMaterialMapEntry,
} from './socialContentWorkflow.js';

export const SOCIAL_AGENT_WORKFLOW_STAGES = [
  'planned',
  'reference_ready',
  'factor_ready',
  'director_ready',
  'execution_planning',
  'director_review',
  'producing',
  'technical_review',
  'media_evaluation',
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
  /**
   * Machine-verifiable subset of the frozen factor spec. Optional only for
   * historic DirectorBrief records created before ReplicationJob v1.
   */
  replicationFactors?: Array<{
    factorId: string;
    factorSpecVersion: string;
    category: SocialReplicationFactorCategory;
    policy: SocialReplicationFactorPolicy;
    importance: SocialReplicationFactorImportance;
    target: SocialReplicationFactorTarget;
    tolerance: SocialReplicationFactorTolerance;
    validator: SocialReplicationFactorValidator;
  }>;
  /** @deprecated Human-readable compatibility projection. */
  fidelityPoints: string[];
  /** @deprecated Human-readable compatibility projection. */
  mustDifferPoints: string[];
}

/** Director-owned expression contract. It deliberately contains no asset, clip, model or provider choice. */
export interface SocialDirectorBrief {
  directorBriefId: string;
  version: string;
  status: 'ready' | 'blocked';
  source: { weeklyPackageId: string | null; adHocBusinessContextId: string | null };
  /** Present for viral replication; optional only on historic records. */
  replicationJobRef?: { replicationJobId: string; version: string; factorSpecVersion: string } | null;
  referenceMode?: SocialReplicationReferenceMode | null;
  accountPlaybookRef?: SocialAccountPlaybookRef | null;
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
  /** Frozen Director-owned requirements this scene must realize. */
  replicationFactorIds?: string[];
  factorFeasibility?: Array<{
    factorId: string;
    feasible: boolean;
    reason: string;
    plannedValidatorId: string;
  }>;
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

export interface SocialReplicationEvaluationDimension {
  status: 'passed' | 'failed' | 'review_required' | 'not_applicable';
  score: number | null;
  blockingFactorIds: string[];
  evidenceRefs: string[];
  summary: string;
}

/** Independent evidence report. It may not change factor weights or tolerances. */
export interface SocialReplicationEvaluation {
  evaluationId: string;
  version: string;
  replicationJobId: string;
  replicationJobVersion: string;
  factorSpecVersion: string;
  productionResultId: string;
  attemptId: string;
  status: 'running' | 'passed' | 'failed' | 'review_required';
  viralFactorFidelity: SocialReplicationEvaluationDimension;
  identityReplacement: SocialReplicationEvaluationDimension;
  originalityDifference: SocialReplicationEvaluationDimension;
  unauthorizedReuseRisk: SocialReplicationEvaluationDimension;
  accountAndFactFit: SocialReplicationEvaluationDimension;
  sceneResults: Array<{
    sceneId: string;
    factorResults: Array<{
      factorId: string;
      status: 'passed' | 'failed' | 'review_required';
      measuredValue: string | number | boolean | string[] | null;
      evidenceRefs: string[];
      repairAction: string | null;
    }>;
  }>;
  generatedBy: 'media_evaluation_worker';
  generatedAt: string;
  directorDecision: {
    status: 'pending' | 'approved' | 'changes_required';
    reviewedBy: 'director_agent';
    failedCriteria: string[];
    reviewedAt: string | null;
  };
}

export interface SocialWorkflowResponsibilityBoundary {
  businessGoalOwner: 'business_agent';
  factorDecisionOwner: 'director_agent';
  executionOwner: 'content_agent';
  metricEvidenceProvider: 'metrics_worker';
  mediaEvidenceProvider: 'media_evaluation_worker';
  finalGateOrder: ['content_agent', 'media_evaluation_worker', 'director_agent', 'business_agent', 'rules_engine'];
  selfApprovalForbidden: true;
}

export interface SocialContentAgentWorkflow {
  schemaVersion: 'social-content-agent-workflow.v1' | 'social-content-agent-workflow.v2';
  stage: SocialAgentWorkflowStage;
  contentPlanId: string;
  videoTaskId: string;
  weeklyPackage: SocialWeeklyContentPackage | null;
  adHocBusinessContext: SocialAdHocBusinessContext | null;
  discoveryBrief: SocialDiscoveryBrief | null;
  inspirationHandoffs: SocialInspirationHandoff[];
  /** Unified job is absent only for material-processing or historic records. */
  replicationJob?: SocialReplicationJob | null;
  responsibilityBoundary?: SocialWorkflowResponsibilityBoundary;
  directorBrief: SocialDirectorBrief;
  executionPlan: SocialContentExecutionPlan;
  executionPlanReview: SocialExecutionPlanReview;
  productionResult: SocialProductionResult | null;
  replicationEvaluation?: SocialReplicationEvaluation | null;
}

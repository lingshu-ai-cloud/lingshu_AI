/** Public contracts for the Starter 198 social-content workflow. */

import type {
  SocialSceneCapabilitySignature,
  SocialSceneProductionAdmission,
  SocialSceneVisualContract,
} from '../sceneVisualContract.js';
import type { PresenterShotMeasurements } from './presenterStackPolicy.js';

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

/**
 * How reference evidence is allowed to shape a viral-replication task.
 * Historic clone tasks omit this field and are projected as
 * `single_source_fidelity` when they contain one production reference.
 */
export const SOCIAL_REPLICATION_REFERENCE_MODES = [
  'single_source_fidelity',
  'account_format_series',
  'multi_source_hybrid',
] as const;
export type SocialReplicationReferenceMode = typeof SOCIAL_REPLICATION_REFERENCE_MODES[number];
/** Product-language alias used by the PRD and API documentation. */
export type ReferenceMode = SocialReplicationReferenceMode;

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
 * Customer-selected implementation route. `material_polish` remains readable
 * for historic tasks but is no longer offered by the current three-option UI.
 * New tasks promote the hybrid `ai_enhanced` route, with `material_cut` as the
 * free route and `shooting_plan` as a non-rendering production checklist.
 */
export const SOCIAL_PRODUCTION_APPROACHES = ['material_cut', 'material_polish', 'ai_enhanced', 'shooting_plan'] as const;
export type SocialProductionApproach = typeof SOCIAL_PRODUCTION_APPROACHES[number];

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
  'd_to_c',
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
  'aigc_product_scene_replication',
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

/**
 * Published identity used by one social account. New tasks must reference the
 * published version instead of choosing an avatar and voice independently.
 */
export interface SocialAccountPresenterLock {
  socialAccountId: string;
  presenterProfileId: string;
  presenterProfileVersion: string;
  presenterAssetId: string;
  avatarId: string;
  voiceProfileId: string;
  consentRef: string;
  commercialRightsStatus: 'cleared' | 'restricted' | 'expired';
  status: 'published' | 'retired';
  /** Stable account + profile + version key persisted on every generated clip. */
  consistencyKey: string;
}

export interface SocialProductIdentityGroup {
  productRef: string;
  referenceImageIds: string[];
  requiredVisibleElements: string[];
  forbiddenChanges: Array<'shape' | 'material' | 'color' | 'logo' | 'label_text' | 'packaging_structure'>;
}

/** Machine-verifiable product-scene contract; this is not a free-form prompt. */
export interface SocialProductSceneReplicationSpec {
  schemaVersion: 'social-product-scene-replication.v1';
  templateSource: 'reference_shot' | 'account_scene_template' | 'system_clean_stage';
  sceneTemplateKey: string;
  referenceShotId: string | null;
  /** Source video used to recover the real environment/composition frame. */
  referenceSourceId?: string | null;
  referenceStartSeconds?: number | null;
  referenceEndSeconds?: number | null;
  productIdentity: {
    groups: SocialProductIdentityGroup[];
    identitySimilarityMinimum: number;
    ocrExactMatchRequired: boolean;
  };
  sceneLock: {
    environment: string;
    background: string;
    platform: string;
    lighting: string;
    composition: string;
    productSlots: Array<{
      slotId: string;
      productRef: string;
      placement: string;
      orientation: string;
      scale: number;
    }>;
  };
  cameraLock: {
    shotSize: string;
    cameraAngle: string;
    lensFeel: string;
    startFrame: string;
    movementPath: string;
    endFrame: string;
    durationSeconds: number;
    easing: string;
  };
  tolerance: {
    durationSeconds: number;
    productPositionRatio: number;
    productScaleRatio: number;
    cameraPathDeviationRatio: number;
  };
  validation: {
    requiredChecks: Array<'product_identity' | 'label_ocr' | 'scene_topology' | 'product_slot_layout' | 'camera_trajectory'>;
    singleShotRetryOnFailure: true;
  };
}

export interface SocialAssetSupplyShotPlan {
  shotId: string;
  referenceProductionRouting?: import('../referenceShotProductionRouting.js').ReferenceShotProductionRouting;
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
  /** Shared Director-to-Content visual requirements; absent on historic plans. */
  visualContract?: SocialSceneVisualContract;
  /** Content-Agent-selected material range. When present, execution must use
   * this exact segment rather than selecting another part of the same file. */
  selectedMaterialSegment?: {
    sourceRef: string;
    segmentId: string;
    startSeconds: number;
    endSeconds: number;
  } | null;
  /** Present when real product reference images drive a full generated scene. */
  productSceneReplication?: SocialProductSceneReplicationSpec;
  /** Present only when this storyboard shot uses the shared digital-human stack. */
  digitalHumanPlan?: {
    workflow: 'material_processing' | 'viral_replication';
    method: 'talking' | 'replace' | 'reenact';
    presenterAssetIds: string[];
    referenceMaterialIds: string[];
    referenceRequired: boolean;
    candidateTools: string[];
    executionState: 'needs_presenter' | 'needs_confirmation' | 'preview_only' | 'ready_for_capability_check';
    /** Null on historic plans and on tasks that still need an account profile. */
    accountPresenterLock?: SocialAccountPresenterLock | null;
  };
}

/**
 * A complete, customer-safe source plan. Missing visual assets are solved by
 * the system; only unconfirmed facts or rights may remain as customer actions.
 */
export interface SocialAssetSupplyPlan {
  planVersion: string;
  creationMode: SocialContentCreationMode;
  /** Optional only on plans created before customer-selectable production routes. */
  productionApproach?: SocialProductionApproach;
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
  /** Account identity frozen for every presenter shot in this plan. */
  accountPresenterLock?: SocialAccountPresenterLock | null;
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
  referenceProductionRouting?: import('../referenceShotProductionRouting.js').ReferenceShotProductionRouting;
  presenterContinuityEvidence?: import('../referenceShotProductionRouting.js').ReferencePresenterContinuityEvidence;
  /** Same verified source person across shots. Missing means identity continuity is unknown. */
  personContinuityId?: string | null;
    observedPresenterRole?: 'sales_presenter' | 'presenter_action' | 'background' | 'none' | 'unknown';
  startSeconds: number;
  endSeconds: number;
  /** Server-verified inputs for deterministic presenter-stack routing. Null fields require more evidence. */
  presenterMeasurements?: PresenterShotMeasurements;
  /** User-facing content and communication intent of this exact source segment. */
  semanticLabel?: { content: string; intent: string };
  /** Extracted evidence, never a generated replacement or a claim of ownership. */
  materialEvidence?: {
    sourceVideoRef: string | null;
    clipRef: string | null;
    firstFrameRef: string | null;
    firstFrameSeconds: number;
    extractionStatus: 'ready' | 'unavailable';
  };
  visualDescription: string;
  spokenText: string | null;
  /** ASR/manual evidence for the original source sentence. A generated script
   * cue alone is never proof of phrase-level timing. */
  spokenTextTiming?: {
    precision: 'phrase' | 'coarse' | 'none';
    provenance: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
  };
  /** Every original spoken sentence must carry its own source interval.
   * A long physical shot may contain several lines; a summary span is not enough. */
  spokenLines?: Array<{
    text: string;
    startSeconds: number;
    endSeconds: number;
    precision: 'phrase' | 'coarse';
    provenance: string;
  }>;
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
  /** Shared machine-readable scene contract. Optional on historic analyses. */
  visualContract?: SocialSceneVisualContract;
  tags: SocialReferenceShotTags;
  fidelityPoints: string[];
  mustDifferPoints: string[];
}

export type SocialTimelineSubjectKind = 'person' | 'product' | 'prop' | 'environment' | 'screen_text' | 'other';

/**
 * Production-grade semantic beat. This is intentionally richer than the
 * legacy shot analysis: micro states and continuity must be data, not prompt
 * prose, before a high-fidelity task may claim to preserve them.
 */
export interface SocialTimelineBeat {
  beatId: string;
  referenceAnalysisId: string;
  referenceShotId: string | null;
  startSeconds: number;
  endSeconds: number;
  purpose: SocialShotFunction;
  subjects: Array<{
    subjectId: string;
    kind: SocialTimelineSubjectKind;
    description: string;
    identitySensitive: boolean;
  }>;
  action: {
    startState: string;
    path: string;
    endState: string;
    spatialRelation: string;
    startsAtSeconds: number | null;
    revealAtSeconds: number | null;
  };
  objectStates: Array<{
    subjectId: string | null;
    attribute: string;
    value: string;
    visibility: 'clear' | 'partial' | 'uncertain';
    continuityKey: string | null;
  }>;
  shotLanguage: {
    shotSize: string;
    cameraAngle: string;
    movement: string;
    composition: string;
    subjectAreaRatio: number | null;
    subjectPosition: string | null;
  };
  lighting: {
    direction: string | null;
    softness: string | null;
    colorTemperature: string | null;
    contrast: string | null;
    shadowAndHighlight: string | null;
  };
  environment: {
    semanticType: string | null;
    materials: string[];
    clutterDensity: string | null;
    livedInDetails: string[];
  };
  audioLayers: {
    voice: string | null;
    captions: string | null;
    ambient: string | null;
    music: string | null;
    soundEffects: string | null;
  };
  rhythm: {
    description: string;
    cutAtSeconds: number | null;
    beatAtSeconds: number[];
  };
  continuity: {
    incomingState: string[];
    outgoingState: string[];
    conflicts: string[];
  };
  observation: {
    observableFacts: string[];
    inferredIntent: string[];
    causalGaps: string[];
    confidence: number | null;
    needsHumanReview: boolean;
  };
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
  /** High-threshold 0–3s reading used by Director and material matching; optional on historic analyses. */
  detailedAnalysis?: {
    firstFrameComposition: string;
    primarySubject: string;
    subjectScaleAndPosition: string;
    actionStartAndPeak: string;
    cameraMovement: string;
    captionTrigger: string;
    audioTrigger: string;
    informationDensity: string;
    swipeRisk: string;
    minimumMaterialMatchScore: number;
  };
  /** Current-stack requirements derived from the high-precision hook contract. */
  capabilitySignature?: SocialSceneCapabilitySignature;
  /** Collection-time admission result. Optional on historic analyses. */
  productionAdmission?: SocialSceneProductionAdmission;
  status: 'draft' | 'recommended' | 'confirmed' | 'rejected';
}

export interface SocialReferenceVideoAnalysis {
  narrationProducts?: string[];
  narrationBrands?: string[];
  analysisId: string;
  /** Incrementing analysis version. Optional only on historic records. */
  version?: string;
  referenceSourceId: string;
  /** Stable inspiration-library record used to retrieve the exact reference media at execution time. */
  referenceRecordId?: string;
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
  /** Optional on historic analyses; projected from `shots` when absent. */
  timelineBeats?: SocialTimelineBeat[];
  hookAnalysis: SocialThreeSecondHook | null;
  rightsNotice: string;
  createdAt: string;
}

export interface SocialVersionedObjectRef {
  objectType: string;
  id: string;
  version: string;
}

/** Account-level evidence; metrics are always relative to this account/platform. */
export type SocialBenchmarkAccountType = 'brand_factory' | 'professional_creator' | 'channel' | 'user_reviewer' | 'industry_media' | 'expression_reference';

export interface SocialBenchmarkAccountSnapshot {
  snapshotId: string;
  version: string;
  platform: string;
  platformAccountId: string;
  canonicalUrl: string;
  displayName: string;
  accountType: SocialBenchmarkAccountType;
  positioning: string[];
  audiences: string[];
  recurringFormats: string[];
  styleFingerprint: string[];
  performanceBaselineRefs: string[];
  representativeContentAnalysisIds: string[];
  conversionEntryPoints: string[];
  capturedAt: string;
}

/** Content-level bridge between an account snapshot and exact media analysis. */
export interface SocialReferenceContentAnalysis {
  contentAnalysisId: string;
  version: string;
  benchmarkAccountSnapshotId: string | null;
  sourceContentId: string;
  referenceAnalysisId: string | null;
  businessPurpose: string;
  audienceStage: string | null;
  narrativeShell: string;
  hook: string;
  proofMethod: string[];
  callToAction: string | null;
  relativePerformance: number | null;
  transferableMechanisms: string[];
  mustReplace: string[];
  inapplicableConditions: string[];
  evidenceRefs: string[];
}

/** Frozen account rules are referenced by version, never silently re-read. */
export interface SocialAccountPlaybookRef extends SocialVersionedObjectRef {
  objectType: 'account_playbook';
  accountRef: string;
}

/** Account → content → media → beat lineage used by every replication decision. */
export interface SocialReplicationReferenceChain {
  benchmarkAccountSnapshot: SocialVersionedObjectRef | null;
  referenceContentAnalysis: SocialVersionedObjectRef | null;
  referenceAnalysis: SocialVersionedObjectRef | null;
  timelineBeats: SocialVersionedObjectRef[];
  targetAccountPlaybook: SocialAccountPlaybookRef | null;
  integrity: {
    complete: boolean;
    missing: Array<'benchmark_account' | 'reference_content' | 'reference_analysis' | 'timeline_beats' | 'account_playbook'>;
    checkedAt: string;
  };
}

export const SOCIAL_REPLICATION_FACTOR_CATEGORIES = [
  'hook',
  'composition',
  'lighting',
  'environment',
  'object_state',
  'interaction',
  'camera',
  'rhythm',
  'audio',
  'caption',
  'identity',
] as const;
export type SocialReplicationFactorCategory = typeof SOCIAL_REPLICATION_FACTOR_CATEGORIES[number];

export const SOCIAL_REPLICATION_FACTOR_POLICIES = [
  'lock',
  'equivalent',
  'bounded',
  'replace_identity',
  'prohibit_reuse',
  'free',
] as const;
export type SocialReplicationFactorPolicy = typeof SOCIAL_REPLICATION_FACTOR_POLICIES[number];
export type SocialReplicationFactorImportance = 'critical' | 'high' | 'medium' | 'low';
export type SocialReplicationCausalRole = 'retention' | 'understanding' | 'proof' | 'trust' | 'emotion' | 'conversion';
export type SocialReplicationCausalStatus = 'creative_hypothesis' | 'observed_correlation' | 'repeated_association' | 'experimental_support';

export interface SocialReplicationFactorEvidence {
  evidenceId: string;
  level: 'source_observation' | 'account_relative_performance' | 'repeated_format' | 'timepoint_behavior' | 'owned_account_experiment';
  sourceRef: string;
  description: string;
  confidence: number;
  supports: Array<'presence' | 'causal_role' | 'policy'>;
  capturedAtSeconds: number | null;
}

/** Machine-readable target; `description` is display-only and never the gate. */
export interface SocialReplicationFactorTarget {
  metric: string;
  value: string | number | boolean | string[];
  unit: string | null;
  regionRef: string | null;
  stateKey: string | null;
}

export interface SocialReplicationFactorTolerance {
  metric: string;
  minimum: number | null;
  maximum: number | null;
  allowedValues: string[];
  maximumDeviation: number | null;
  unit: string | null;
  humanReviewWhen: string[];
}

export interface SocialReplicationFactorValidator {
  validatorId: string;
  kind: 'timeline_alignment' | 'vision_state' | 'spatial_relation' | 'composition' | 'lighting' | 'motion' | 'audio' | 'ocr' | 'identity' | 'rights_fingerprint' | 'human_review';
  detector: string;
  blocking: boolean;
  threshold: number | null;
  evidenceOutput: Array<'reference_frame' | 'output_frame' | 'measurement' | 'match_region' | 'audio_segment' | 'review_note'>;
  fallbackToHuman: boolean;
}

/** One frozen, independently verifiable Director-owned replication factor. */
export interface SocialReplicationFactorSpec {
  factorId: string;
  version: string;
  beatId: string;
  referenceShotId: string | null;
  category: SocialReplicationFactorCategory;
  description: string;
  causalRole: SocialReplicationCausalRole;
  causalStatus: SocialReplicationCausalStatus;
  policy: SocialReplicationFactorPolicy;
  target: SocialReplicationFactorTarget;
  tolerance: SocialReplicationFactorTolerance;
  importance: SocialReplicationFactorImportance;
  observationConfidence: number;
  causalConfidence: number;
  evidenceRefs: SocialReplicationFactorEvidence[];
  validator: SocialReplicationFactorValidator;
  status: 'draft' | 'frozen' | 'superseded';
  frozenAt: string | null;
  decisionOwner: 'director_agent';
}
/** Product-language alias used by the PRD and API documentation. */
export type ReplicationFactorSpec = SocialReplicationFactorSpec;

export interface SocialReplicationReferenceAssignment {
  assignmentId: string;
  inspirationId: string;
  analysisId: string;
  analysisVersion: string;
  role: 'primary_structure' | 'proof_reference' | 'visual_rhythm' | 'cta_reference';
  primary: boolean;
  purpose: string;
  chain: SocialReplicationReferenceChain;
}

export interface SocialReplicationJobContext {
  verifiedPrimaryReference?: {recordId:string;sourceVersion:string;sourceSha256:string;analysisRunId:string;runtimeAnalysisId:string;runtimeAnalysisVersion:string;sourceAnalysisId:string;sourceAnalysisVersion:string};
  verifiedAccountPlaybook?: {recordHash:string;audience:string[];pillars:string[];recurringFormats:string[];conversionRoute:import('./socialProgram.js').AccountPlaybook['conversionRoute'];evidenceRules:string[];visualRules:string[];languageRules:string[];presenterRules:string[];fixedFactors:string[];experimentFactors:string[]};
  programRef?: SocialVersionedObjectRef | null;
  targetAccountRef?: SocialVersionedObjectRef | null;
  accountPlaybookRef?: SocialAccountPlaybookRef | null;
  benchmarkAccountSnapshotRef?: SocialVersionedObjectRef | null;
  referenceContentAnalysisRef?: SocialVersionedObjectRef | null;
  referenceMode?: SocialReplicationReferenceMode;
  primaryReferenceAnalysisId?: string | null;
  primaryExperimentVariable?: string | null;
}

/** Single source of truth shared by the legacy Studio entry and the new Agent chain. */
export interface SocialReplicationJob {
  replicationJobId: string;
  version: string;
  contentTaskId: string;
  status: 'draft' | 'reference_ready' | 'factor_ready' | 'director_ready' | 'producing' | 'evaluating' | 'creative_review' | 'completed' | 'blocked';
  referenceMode: SocialReplicationReferenceMode;
  target: {
    programRef: SocialVersionedObjectRef | null;
    accountRef: SocialVersionedObjectRef | null;
    accountPlaybookRef: SocialAccountPlaybookRef | null;
    productRef: string | null;
  };
  businessContextRef: SocialVersionedObjectRef;
  referenceAssignments: SocialReplicationReferenceAssignment[];
  primaryReferenceAnalysisId: string | null;
  referenceChain: SocialReplicationReferenceChain;
  factorSpecVersion: string;
  factorSpecs: SocialReplicationFactorSpec[];
  primaryExperimentVariable: string | null;
  frozenAt: string | null;
  inputRefs: SocialVersionedObjectRef[];
  createdBy: 'director_agent';
  createdAt: string;
}
/** Product-language alias used by the PRD and API documentation. */
export type ReplicationJob = SocialReplicationJob;

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

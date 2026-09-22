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
  status: 'ready' | 'requires_fact_confirmation' | 'requires_rights_confirmation';
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
  referenceSourceId: string;
  status: 'analyzing' | 'ready' | 'blocked';
  durationSeconds: number | null;
  shots: SocialReferenceShotAnalysis[];
  hookAnalysis: SocialThreeSecondHook | null;
  rightsNotice: string;
  createdAt: string;
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

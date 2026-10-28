export const SOCIAL_IMAGE_PRODUCTION_NODES = [
  'task_binding',
  'business_context',
  'asset_manifest',
  'reference_snapshot',
  'element_inventory',
  'hook_factors',
  'adaptation',
  'director_brief',
  'execution_plan',
  'render_spec',
  'candidate_generation',
  'quality_check',
  'director_review',
  'repair',
  'user_approval',
  'delivery',
] as const;

export type SocialImageProductionNodeId = typeof SOCIAL_IMAGE_PRODUCTION_NODES[number];
export type SocialImageProductionNodeStatus =
  | 'waiting'
  | 'running'
  | 'completed'
  | 'needs_review'
  | 'stale'
  | 'blocked'
  | 'failed'
  | 'outcome_unknown'
  | 'skipped';

export type SocialImageBusinessStage = 'clarify' | 'plan' | 'produce' | 'accept';

export interface SocialImageVersionedRef {
  objectType: string;
  id: string;
  version: string | number;
  contentHash: string;
}

export interface SocialImageNodeEnvelope<T> {
  schemaVersion: 'social-image-node-envelope.v1';
  id: string;
  tenantId: string;
  contentTaskId: string;
  productionRunId: string;
  nodeId: SocialImageProductionNodeId;
  version: number;
  status: Exclude<SocialImageProductionNodeStatus, 'waiting' | 'skipped'>;
  inputRefs: SocialImageVersionedRef[];
  createdBy: { kind: 'agent' | 'worker' | 'user' | 'system'; id: string };
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  evidenceRefs: SocialImageVersionedRef[];
  warnings: string[];
  blockingReasons: string[];
  value: T;
}

export interface SocialImageProductionBinding {
  schemaVersion: 'social-image-production-binding.v1';
  contentTaskId: string;
  contentTaskVersion: string;
  productionRunId: string;
  deliverableKey: string;
  entrySource: 'assistant' | 'workspace' | 'weekly_package';
  creationMode: 'free_creation' | 'viral_replication';
  idempotencyKeyHash: string;
  requestHash: string;
  resumeToken: string;
  boundAt: string;
  taskContextSnapshot: import('./socialContentTaskContract.js').TaskContextSnapshot;
}

export interface SocialImageProductionNodeState {
  nodeId: SocialImageProductionNodeId;
  status: SocialImageProductionNodeStatus;
  attempt: number;
  outputRef?: SocialImageVersionedRef;
  blockingReasons: string[];
  startedAt?: string;
  finishedAt?: string;
}

export interface SocialImageProductionEvent {
  schemaVersion: 'social-image-production-event.v1';
  sequence: number;
  eventId: string;
  productionRunId: string;
  nodeId: SocialImageProductionNodeId;
  status: SocialImageProductionNodeStatus;
  messageKey: string;
  occurredAt: string;
  taskVersion: number;
  blockingReasons: string[];
  /** Current candidate references available when this event was emitted. */
  artifactRefs?: SocialImageVersionedRef[];
}

export interface SocialImageProductionRuntime {
  schemaVersion: 'social-image-production-runtime.v1';
  binding?: SocialImageProductionBinding;
  currentNode: SocialImageProductionNodeId;
  nodes: SocialImageProductionNodeState[];
  events: SocialImageProductionEvent[];
  /** Append-only formal outputs. A later stale envelope never overwrites prior evidence. */
  nodeOutputs: Array<SocialImageNodeEnvelope<unknown>>;
  nextEventSequence: number;
}

export interface SocialImageProductionSnapshot {
  schemaVersion: 'social-image-production-snapshot.v1';
  contentTaskId: string | null;
  productionRunId: string;
  taskVersion: number;
  businessStage: SocialImageBusinessStage;
  currentNode: SocialImageProductionNodeId;
  currentStatus: SocialImageProductionNodeStatus;
  progress: { kind: 'known'; completed: number; total: number } | { kind: 'indeterminate' };
  activityKey: string;
  nodeLabel: string;
  userFacingSummary: string;
  waitingFor: 'system' | 'user' | 'provider_reconciliation' | null;
  canApprove: boolean;
  decisionRequest: null | {
    decisionId: string;
    kind: 'supply_input' | 'confirm_generation' | 'review_candidates' | 'repair' | 'reconcile_provider';
    label: string;
    taskVersion: number;
    idempotencyKey: string;
    candidateRefs: SocialImageVersionedRef[];
  };
  blockingReasons: string[];
  previews: Array<{
    candidateId: string;
    candidateVersion: number;
    contentHash: string | null;
    state: 'pending' | 'generating' | 'quality_checking' | 'repair_required' | 'blocked' | 'approved';
    mediaUrl?: string;
    materialId?: string;
  }>;
  latestEventSequence: number;
  updatedAt: string;
}

export type SocialImageHookCausalRole = 'attention' | 'comprehension' | 'proof' | 'trust' | 'emotion' | 'conversion';
export type SocialImageHookEffectStatus = 'validated_hook' | 'supported_hypothesis' | 'visual_hypothesis';

export interface SocialImageHookFactor {
  factorId: string;
  regionRefs: string[];
  priorityRank: 1 | 2 | 3 | 4 | 5;
  category: string;
  observableDescription: string;
  causalRole: SocialImageHookCausalRole;
  importance: 'critical' | 'high' | 'medium';
  evidenceRefs: SocialImageVersionedRef[];
  analysisConfidence: number;
  causalConfidence: number;
  effectStatus: SocialImageHookEffectStatus;
  transferability: 'high' | 'medium' | 'low' | 'prohibited';
  validator: {
    kind: 'region_presence' | 'saliency_order' | 'ocr_match' | 'visual_similarity' | 'human_review' | 'account_experiment';
    observableTarget: string;
  };
}

export interface SocialImageHookFactorSpec {
  schemaVersion: 'social-image-hook-factor-spec.v1';
  factors: SocialImageHookFactor[];
  ordinaryVisualNotes: string[];
  evidenceGaps: string[];
}

export type SocialImageAdaptationPolicy =
  | 'lock'
  | 'equivalent'
  | 'bounded'
  | 'replace_identity'
  | 'prohibit_reuse'
  | 'free';

export interface SocialImageAdaptationSpec {
  schemaVersion: 'social-image-adaptation-spec.v1';
  factorPolicies: Array<{ factorId: string; policy: SocialImageAdaptationPolicy; reason: string }>;
  keepHooks: string[];
  innovationPoints: Array<{
    replaceElement: string;
    reason: string;
    newDirection: string;
    requiredAssets: string[];
    differenceRequirement: string;
  }>;
  excludedElements: string[];
  originalityConstraints: string[];
  brandConstraints: string[];
}

export interface SocialImageDirectorReviewDecision {
  schemaVersion: 'social-image-director-review.v1';
  decision: 'accept_for_user_review' | 'repair' | 'regenerate' | 'block';
  candidateId: string;
  candidateVersion: number;
  /** Ordered, frozen outputs reviewed together for a carousel or GIF. */
  candidateRefs?: SocialImageVersionedRef[];
  candidateSetHash?: string;
  /** Hash of the candidate quality checks and factor evidence at review time. */
  qualityEvidenceHash?: string;
  passedCriteria: string[];
  failedCriteria: string[];
  factorResults: Array<{ factorId: string; verdict: 'pass' | 'fail' | 'uncertain'; evidenceRefs: SocialImageVersionedRef[] }>;
  problemRegions: string[];
  reasonCodes: string[];
  repairInstructions: string[];
  reviewConfidence: number;
  reviewedAt: string;
}

export interface SocialImageApprovalDecision {
  schemaVersion: 'social-image-approval-decision.v1';
  decisionId: string;
  /** Stable identity of the explicit user action. Historic decisions may not
   * have one, but every new decision is persisted with this key. */
  idempotencyKey?: string;
  decision: 'approved' | 'rejected';
  candidateId: string;
  candidateVersion: number;
  candidateContentHash: string;
  /** Exact item the user acted on. Multi-output approval is item-by-item even
   * when the last item also closes the immutable reviewed set. */
  selectedCandidateRef?: SocialImageVersionedRef;
  candidateRefs?: SocialImageVersionedRef[];
  reviewSetHash?: string;
  decidedBy: string;
  decidedAt: string;
  source: 'explicit_user_action';
  qualitySummaryHash: string;
  directorReviewHash?: string;
  note?: string;
}

export interface SocialImageApprovedArtifact {
  schemaVersion: 'approved-image-artifact.v1';
  artifactId: string;
  contentTaskId: string;
  productionRunId: string;
  candidateId: string;
  candidateVersion: number;
  contentHash: string;
  candidateRefs?: SocialImageVersionedRef[];
  mediaItems?: Array<{ candidateId: string; role: string; label: string; mediaUrl?: string; materialId?: string }>;
  mediaUrl?: string;
  materialId?: string;
  approvalDecisionId: string;
  usageRestrictions: string[];
  frozenAt: string;
}

export interface SocialImageRepairPlan {
  schemaVersion: 'social-image-repair-plan.v1';
  repairPlanId: string;
  sourceCandidateId: string;
  fromVersion: number;
  toVersion: number;
  failedCheckRefs: string[];
  targetRegions: string[];
  targetLayers: Array<'background' | 'product' | 'logo' | 'typography' | 'timeline' | 'full_composite'>;
  repairMethod: 'local_repaint' | 'layer_edit' | 'regenerate' | 'text_layer_fix';
  preservedLayers: string[];
  instruction: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

export interface SocialImageDeliveryPackage {
  schemaVersion: 'social-image-delivery-package.v1';
  packageId: string;
  contentTaskId: string;
  productionRunId: string;
  packageVersion: number;
  status: 'ready';
  approvedArtifactRef: SocialImageVersionedRef;
  platformVariant: {
    platform: string;
    aspectRatio: string;
    language: string;
    mediaUrl?: string;
    materialId?: string;
    mediaItems?: Array<{ candidateId: string; role: string; label: string; mediaUrl?: string; materialId?: string }>;
    caption: string;
  };
  packageHash: string;
  publicationPackageRefs: SocialImageVersionedRef[];
  publicationEvidenceRefs: SocialImageVersionedRef[];
  createdAt: string;
}

export interface SocialImageBusinessContext {
  objective: string;
  topicType: string;
  deliverableType: 'product_hero' | 'social_single' | 'carousel_cover';
  productRefs: string[];
  enterpriseFactSnapshotRef: SocialImageVersionedRef | null;
  audience: string[];
  ownedAccountId: string | null;
  accountDraftId: string | null;
  platforms: string[];
  targetAction: string | null;
  successMetrics: string[];
  deliverySpec: { platform: string; aspectRatio: string; language: string; outputCount: number; format: string };
  budgetAndDeadline: { maximumCostCny: number | null; dueAt: string | null };
  fieldsToConfirm: string[];
}

export interface SocialImageAssetManifest {
  enterpriseFactSnapshotRef: SocialImageVersionedRef | null;
  assets: Array<{
    assetId: string;
    version: string | number;
    contentHash: string;
    role: 'product' | 'logo' | 'scene' | 'evidence' | 'style_only';
    required: boolean;
    readable: boolean;
    dimensions: { width: number; height: number } | null;
    rights: 'cleared' | 'restricted' | 'unknown';
    /** Server-resolved authorization evidence, never inferred from readable bytes. */
    rightsEvidenceRef?: string;
    observedSubjects: string[];
    ocr: string[];
    confidence: number;
  }>;
  requiredEvidence: string[];
  missingCapabilities: string[];
  prohibitedClaims: string[];
}

export interface SocialImageReferenceEvidenceSnapshot {
  referenceId: string;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  imageAssetRef: SocialImageVersionedRef;
  platform: string | null;
  account: string | null;
  publishedAt: string | null;
  rightsPolicy: 'permitted' | 'structure_only' | 'unknown' | 'prohibited';
  performanceEvidence: SocialImageVersionedRef[];
  relativePerformance: number | null;
  referencePurpose: Array<'structure' | 'visual_hook' | 'proof' | 'cta'>;
  fingerprint: string;
  styleObservation?: { kind: 'advertising' | 'imitable'; elements: import('./imageReferenceProductionLabel.js').ImageReferenceStyleElement[]; sourceSha256: string; analysisVersion: 'image-post-evidence.v2' } | null;
}

export interface SocialImageElementInventory {
  canvas: { width: number; height: number; aspectRatio: string };
  regions: Array<{
    regionId: string;
    bbox: { x: number; y: number; width: number; height: number };
    layerRole: string;
    observedContent: string;
    toolScores: Record<string, number | null>;
    evidenceRef: SocialImageVersionedRef;
  }>;
  ocrBlocks: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>;
  saliencyOrder: string[];
  composition: Record<string, unknown>;
  colorAndLighting: Record<string, unknown>;
  informationHierarchy: string[];
  observations: Array<{ kind: 'observed' | 'interpreted'; description: string; evidenceRefs: SocialImageVersionedRef[] }>;
  analysisConfidence: number;
}

export interface SocialImageDirectorBriefV1 {
  objective: string;
  singleCoreClaim: string;
  headline: string;
  supportingText: string;
  caption: string;
  cta: string;
  requiredFacts: string[];
  prohibitedInferences: string[];
  visualMustShow: string[];
  visualMustNotImply: string[];
  compositionIntent: string;
  imageTextRelation: string;
  visualProof: string;
  brandAndOriginalityRules: string[];
  acceptanceCriteria: Array<{ criterionId: string; observableTarget: string; validator: string }>;
  factorSpecRef: SocialImageVersionedRef | null;
  adaptationSpecRef: SocialImageVersionedRef | null;
}

export interface SocialImageExecutionPlanV1 {
  productionStrategy: 'reuse_existing' | 'compose_assets' | 'reference_generate' | 'generate_supporting';
  selectedAssetRefs: SocialImageVersionedRef[];
  assetRoles: Array<{ assetRef: SocialImageVersionedRef; role: string }>;
  renderRoute: string;
  candidateCount: number;
  layerPlan: Array<{ layerId: string; role: string; sourceRef: SocialImageVersionedRef | null }>;
  estimatedCost: { currency: 'CNY'; amount: number | null };
  estimatedDurationSeconds: number | null;
  fallbackRoutes: string[];
  unmetCriteria: string[];
}

export interface SocialImageRenderSpecV1 {
  width: number;
  height: number;
  aspectRatio: string;
  assetInputs: Array<SocialImageVersionedRef & { role: string }>;
  layoutConstraints: Record<string, unknown>;
  textLayers: Array<{ role: string; text: string; region: string }>;
  subjectConstraints: string[];
  factorTargets: Array<{ factorId: string; observableTarget: string }>;
  negativeConstraints: string[];
  providerAdapterVersion: string;
  seedPolicy: 'fixed' | 'provider_random' | 'derived';
  idempotencyKey: string;
  inputHash: string;
}

export interface SocialImageCandidateSetV1 {
  jobId: string;
  providerReceipt: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'outcome_unknown';
  candidates: Array<{
    candidateId: string;
    artifactRef: SocialImageVersionedRef;
    version: number;
    width: number;
    height: number;
    contentHash: string;
    renderSpecRef: SocialImageVersionedRef;
  }>;
  cost: { currency: 'CNY'; amount: number | null };
  timing: { queuedAt: string; completedAt: string | null };
  generationWarnings: string[];
}

export interface SocialImageQualityReportV1 {
  candidateId: string;
  candidateHash: string;
  checks: Array<{
    key: string;
    verdict: 'pass' | 'fail' | 'uncertain' | 'not_applicable';
    severity: 'hard' | 'soft';
    checker: 'deterministic' | 'multimodal' | 'human';
    score: number | null;
    threshold: number | null;
    region: { x: number; y: number; width: number; height: number } | null;
    evidenceRefs: SocialImageVersionedRef[];
    note: string;
    repairSuggestion: string | null;
  }>;
  hardGatePassed: boolean;
  recommendedAction: 'accept_for_director_review' | 'repair' | 'regenerate' | 'block';
}

export interface SocialImagePerformanceObservation {
  artifactRef: SocialImageVersionedRef;
  metricSnapshots: SocialImageVersionedRef[];
  factorObservations: Array<{ factorId: string; observation: string; evidenceRefs: SocialImageVersionedRef[]; causalClaim: false }>;
  nextExperimentSuggestion: string | null;
}

export interface SocialImageNodeValueMap {
  task_binding: SocialImageProductionBinding;
  business_context: SocialImageBusinessContext;
  asset_manifest: SocialImageAssetManifest;
  reference_snapshot: SocialImageReferenceEvidenceSnapshot;
  element_inventory: SocialImageElementInventory;
  hook_factors: SocialImageHookFactorSpec;
  adaptation: SocialImageAdaptationSpec;
  director_brief: SocialImageDirectorBriefV1;
  execution_plan: SocialImageExecutionPlanV1;
  render_spec: SocialImageRenderSpecV1;
  candidate_generation: SocialImageCandidateSetV1;
  quality_check: SocialImageQualityReportV1;
  director_review: SocialImageDirectorReviewDecision;
  repair: SocialImageRepairPlan;
  user_approval: SocialImageApprovalDecision;
  delivery: SocialImageDeliveryPackage | SocialImagePerformanceObservation;
}

export function socialImageHookFactorIssues(spec: SocialImageHookFactorSpec): string[] {
  const issues: string[] = [];
  const factors = Array.isArray(spec.factors) ? spec.factors : [];
  const evidenceGaps = Array.isArray(spec.evidenceGaps) ? spec.evidenceGaps : [];
  if (spec.schemaVersion !== 'social-image-hook-factor-spec.v1') issues.push('social_image_hook_schema_invalid');
  if (!Array.isArray(spec.factors) || factors.length > 5) issues.push('social_image_hook_count_invalid');
  if (factors.length < 4 && !evidenceGaps.length) issues.push('social_image_hook_evidence_gap_required');
  const ranks = new Set<number>();
  const ids = new Set<string>();
  for (const factor of factors) {
    if (!factor.factorId || ids.has(factor.factorId)) issues.push('social_image_hook_identity_invalid');
    ids.add(factor.factorId);
    if (!Number.isInteger(factor.priorityRank) || factor.priorityRank < 1 || factor.priorityRank > 5 || ranks.has(factor.priorityRank)) {
      issues.push('social_image_hook_priority_invalid');
    }
    ranks.add(factor.priorityRank);
    if (!factor.observableDescription?.trim() || !factor.evidenceRefs?.length) issues.push('social_image_hook_evidence_missing');
    if (!Number.isFinite(factor.analysisConfidence) || factor.analysisConfidence < 0 || factor.analysisConfidence > 1
      || !Number.isFinite(factor.causalConfidence) || factor.causalConfidence < 0 || factor.causalConfidence > 1) {
      issues.push('social_image_hook_confidence_invalid');
    }
    if (factor.effectStatus === 'validated_hook' && factor.validator.kind !== 'account_experiment') {
      issues.push('social_image_hook_causal_claim_unproven');
    }
  }
  const fifth = factors.find(factor => factor.priorityRank === 5);
  if (fifth) {
    const higher = factors.filter(factor => factor.priorityRank < 5);
    const independent = higher.every(factor => factor.causalRole !== fifth.causalRole)
      || higher.every(factor => factor.validator.kind !== fifth.validator.kind);
    if (!independent) issues.push('social_image_hook_fifth_not_independent');
  }
  return [...new Set(issues)];
}
export function socialImageAdaptationIssues(spec: SocialImageAdaptationSpec, factors: SocialImageHookFactorSpec): string[] {
  const issues: string[] = [];
  const hookFactors = Array.isArray(factors.factors) ? factors.factors : [];
  const policies = Array.isArray(spec.factorPolicies) ? spec.factorPolicies : [];
  const innovationPoints = Array.isArray(spec.innovationPoints) ? spec.innovationPoints : [];
  if (spec.schemaVersion !== 'social-image-adaptation-spec.v1') issues.push('social_image_adaptation_schema_invalid');
  if (!Array.isArray(spec.factorPolicies) || !Array.isArray(spec.innovationPoints)
    || !Array.isArray(spec.excludedElements) || !Array.isArray(spec.originalityConstraints)
    || !Array.isArray(spec.brandConstraints)) issues.push('social_image_adaptation_shape_invalid');
  const factorIds = new Set(hookFactors.map(factor => factor.factorId));
  const policyIds = new Set(policies.map(policy => policy.factorId));
  if (policyIds.size !== policies.length || [...factorIds].some(id => !policyIds.has(id))
    || policies.some(policy => !factorIds.has(policy.factorId))) issues.push('social_image_adaptation_factor_coverage_invalid');
  if (policies.length && policies.every(policy => policy.policy === 'lock')) {
    issues.push('social_image_adaptation_all_locked');
  }
  if (policies.some(policy => ['equivalent', 'bounded', 'replace_identity'].includes(policy.policy))
    && !innovationPoints.length) issues.push('social_image_adaptation_innovation_missing');
  return [...new Set(issues)];
}

export function socialImageNodeEnvelopeIssues(envelope: SocialImageNodeEnvelope<unknown>): string[] {
  const issues: string[] = [];
  if (envelope.schemaVersion !== 'social-image-node-envelope.v1') issues.push('social_image_node_envelope_schema_invalid');
  if (!SOCIAL_IMAGE_PRODUCTION_NODES.includes(envelope.nodeId) || !envelope.id || !envelope.tenantId
    || !envelope.contentTaskId || !envelope.productionRunId || !Number.isSafeInteger(envelope.version) || envelope.version < 1) {
    issues.push('social_image_node_envelope_identity_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(envelope.contentHash)) issues.push('social_image_node_envelope_hash_invalid');
  if (envelope.inputRefs.some(ref => !ref.id || !/^[a-f0-9]{64}$/.test(ref.contentHash))
    || envelope.evidenceRefs.some(ref => !ref.id || !/^[a-f0-9]{64}$/.test(ref.contentHash))) {
    issues.push('social_image_node_envelope_reference_invalid');
  }
  if (envelope.status === 'completed' && envelope.blockingReasons.length) issues.push('social_image_node_envelope_status_invalid');
  if (['blocked', 'failed', 'outcome_unknown'].includes(envelope.status) && !envelope.blockingReasons.length) {
    issues.push('social_image_node_envelope_blocker_missing');
  }
  return [...new Set(issues)];
}

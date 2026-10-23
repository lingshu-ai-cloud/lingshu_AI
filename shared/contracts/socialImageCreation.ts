import type {
  SocialImageAdaptationSpec,
  SocialImageApprovedArtifact,
  SocialImageApprovalDecision,
  SocialImageDirectorReviewDecision,
  SocialImageDeliveryPackage,
  SocialImageHookFactorSpec,
  SocialImageProductionRuntime,
  SocialImageRepairPlan,
} from './socialImageProduction';

export const SOCIAL_IMAGE_CONTENT_TYPES = [
  'light_packaging', 'product_poster', 'brand_news', 'experiment_comparison',
  'trend', 'infographic', 'carousel', 'gif_poster',
] as const;

export type SocialImageContentType = typeof SOCIAL_IMAGE_CONTENT_TYPES[number];
export type SocialImageCreationPath = 'material_processing' | 'viral_replication';
export type SocialImageFactuality = 'verified' | 'user_supplied' | 'mock';
export type SocialImageTaskStep = 'type' | 'inputs' | 'plan' | 'generate' | 'motion' | 'review';
export type SocialImageTaskStatus = 'draft' | 'planned' | 'generating' | 'review_required' | 'blocked' | 'approved';

export interface SocialImageReferenceSnapshot {
  sourceRecordId?: string;
  sourceUrl?: string;
  platform?: string;
  accountName?: string;
  title?: string;
  caption?: string;
  imageUrls: string[];
  collectedAt: string;
  fingerprint: string;
}

export type SocialImageReferenceLayerRole = 'background' | 'mask' | 'product' | 'text' | 'logo' | 'decoration';
export type SocialImageReferenceMaskShape = 'rectangle' | 'rounded_rectangle' | 'ellipse' | 'polygon' | 'linear_gradient';

export interface SocialImageReferenceLayerBlueprint {
  imageIndex: number;
  layers: Array<{
    id: string;
    role: SocialImageReferenceLayerRole;
    zIndex: number;
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  masks: Array<{
    id: string;
    shape: SocialImageReferenceMaskShape;
    bounds: { x: number; y: number; width: number; height: number };
    opacity: number;
    color?: string;
    cornerRadius?: number;
    feather?: number;
    angle?: number;
    points?: Array<{ x: number; y: number }>;
    zIndex: number;
    confidence: number;
  }>;
}

export interface SocialImageReplicationRecipe {
  contentArchetype: string;
  imageCopyRelation: SocialImageCreativeRecipe['imageTextRelation'];
  preserve: string[];
  replace: string[];
  palette: string[];
  layoutRegions: Array<{ id: string; role: string; x: number; y: number; width: number; height: number }>;
  productPresentation?: 'single' | 'combination' | 'set' | 'auto_from_reference';
  typographyRegions?: Array<{
    role: 'headline' | 'subheadline' | 'supporting';
    region: string;
    relativeSize: 'display' | 'large' | 'medium' | 'small';
    alignment: 'left' | 'center' | 'right';
    preserveLineBreaks: boolean;
  }>;
  protectedSubjects: string[];
  overlayZones: string[];
  referenceLayerBlueprints?: SocialImageReferenceLayerBlueprint[];
  motionMechanism?: SocialImageDeliverySpec['motion'] extends infer T ? T extends { mechanism: infer M } ? M : never : never;
}

export type SocialImageEnterpriseAssetRole = 'product' | 'logo' | 'scene' | 'evidence';
export interface SocialImageEnterpriseAssetBinding {
  assetId: string;
  role: SocialImageEnterpriseAssetRole;
  name: string;
  source: 'enterprise_knowledge_base' | 'enterprise_material_library';
  contentHash?: string;
  required: boolean;
}

export interface SocialImageGenerationJob {
  id: string;
  idempotencyKey: string;
  planVersion?: number;
  unitIndex?: number;
  plannedInputHash?: string;
  /** Hash of the server-admitted render request, frozen before a paid call. */
  inputHash?: string;
  status: 'queued' | 'running' | 'output_ready' | 'quality_checking' | 'repairing' | 'completed' | 'failed' | 'outcome_unknown';
  outputNodeIds: string[];
  provider?: string;
  providerReceipt?: string;
  attempt: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialImageFrozenRenderPlan {
  version: number;
  sourceHash: string;
  createdAt: string;
  units: Array<{
    jobId: string;
    index: number;
    count: number;
    label: string;
    role: 'carousel_page' | 'gif_plate';
    poster: Record<string, unknown>;
    idempotencyKey: string;
    plannedInputHash: string;
  }>;
}

export interface SocialImageRepairInstruction {
  id: string;
  outputNodeId: string;
  failedChecks: SocialImageQualityCheckKey[];
  targetLayer: 'background' | 'product' | 'logo' | 'typography' | 'timeline' | 'full_composite';
  instruction: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  fromVersion: number;
  toVersion?: number;
}

export interface SocialImageEvidenceItem {
  id: string;
  label: string;
  source: 'enterprise_profile' | 'user_input' | 'reference' | 'mock';
  value: string;
}

export interface SocialImageContentBrief {
  objective: 'awareness' | 'trust' | 'education' | 'lead_generation' | 'event_conversion';
  topicType: 'trend' | 'ingredient_launch' | 'formulation_demo' | 'experiment_comparison' | 'brand_news' | 'partnership_news' | 'origin_story' | 'factory_trust' | 'technical_solution';
  coreClaim: string;
  audience: string[];
  productRefs: string[];
  productNames: string[];
  evidenceItems: SocialImageEvidenceItem[];
  partnerName?: string;
  factuality: SocialImageFactuality;
  targetAction?: string;
  prohibitedClaims: string[];
}

export interface SocialImageCreativeRecipe {
  narrativePattern: 'news_announcement' | 'problem_solution' | 'visible_experiment' | 'trend_to_opportunity' | 'origin_to_benefit' | 'person_to_trust';
  visualProof: 'event_photo' | 'product_hero' | 'before_after' | 'process_sequence' | 'texture_macro' | 'lab_scene' | 'source_landscape' | 'data_visualization';
  layoutRecipe: 'news_search_card' | 'hero_product_poster' | 'split_comparison' | 'editorial_story' | 'step_carousel' | 'minimal_luxury' | 'technical_infographic';
  copyPattern: string;
  imageTextRelation: 'image_proves_copy' | 'image_contextualizes_copy' | 'image_explains_copy' | 'image_evokes_copy';
  colorStrategy: 'derive_from_product' | 'derive_from_brand' | 'derive_from_event' | 'benchmark_locked';
  referenceStrength: number;
}

export interface SocialImageTextContract {
  headline: string;
  supportingText?: string;
  caption: string;
  hashtags: string[];
  cta?: string;
  requiredFacts: string[];
  prohibitedInferences: string[];
  visualMustShow: string[];
  visualMustNotImply: string[];
}

export interface SocialImageDeliverySpec {
  format: 'jpg' | 'png' | 'carousel' | 'gif';
  platform: 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin';
  aspectRatio: '1:1' | '4:5' | '9:16' | '16:9';
  language: string;
  outputCount: number;
  imageGeneration?: {
    provider: 'openai';
    model: 'gpt-image-2';
    quality: 'low' | 'medium' | 'high';
  };
  motion?: {
    mechanism: 'background_switch' | 'typewriter' | 'state_reveal' | 'crossfade';
    fixedLayers: string[];
    dynamicLayers: string[];
    loopDurationMs: number;
  };
}

export type SocialImageQualityCheckKey =
  | 'file_decode' | 'pixel_dimensions' | 'product_identity' | 'packaging_visibility' | 'subject_visibility' | 'label_ocr'
  | 'fact_consistency' | 'copy_visual_consistency' | 'brand_consistency'
  | 'text_overflow' | 'safe_zone' | 'reference_structure_similarity' | 'motion_mechanism_similarity'
  | `hook_factor:${string}`;

export interface SocialImageQualityCheck {
  key: SocialImageQualityCheckKey;
  verdict: 'pass' | 'fail' | 'uncertain' | 'not_applicable';
  severity: 'hard' | 'soft';
  note: string;
  score?: number;
  checker?: 'deterministic' | 'multimodal' | 'human';
  evidence?: string[];
  region?: { x: number; y: number; width: number; height: number };
  repairSuggestion?: string;
}

export interface SocialImageOutputNode {
  id: string;
  role: 'single' | 'carousel_page' | 'gif_plate' | 'gif_frame' | 'gif_output';
  label: string;
  state: 'pending' | 'generating' | 'quality_checking' | 'repair_required' | 'blocked' | 'approved' | 'superseded';
  mediaUrl?: string;
  materialId?: string;
  /** Hash of the actual candidate bytes, not its URL or database binding. */
  contentHash?: string;
  version: number;
  qualityChecks: SocialImageQualityCheck[];
  /** Durable one-shot receipt for the paid visual preflight of exact candidate and reference bytes. */
  qualityPreflight?: {
    inputHash: string;
    status: 'claimed' | 'completed' | 'outcome_unknown';
    claimedAt: string;
    completedAt?: string;
    visualChecks?: SocialImageQualityCheck[];
  };
  sourceJobId?: string;
}

export interface SocialImageGifDelivery {
  planVersion: number;
  sourceHash: string;
  frameOutputIds: string[];
  finalOutputId: string;
}

export interface SocialImageCreationTask {
  schemaVersion: 'social-image-creation.v1' | 'social-image-creation.v2' | 'social-image-creation.v3';
  id: string;
  version: number;
  title: string;
  creationPath: SocialImageCreationPath;
  contentMode: 'image';
  imageType: SocialImageContentType;
  step: SocialImageTaskStep;
  status: SocialImageTaskStatus;
  contentBrief: SocialImageContentBrief;
  creativeRecipe: SocialImageCreativeRecipe;
  imageTextContract: SocialImageTextContract;
  renderBrief?: {
    headline: string;
    subheadline: string;
    originBadge: string;
    trustBadges: string[];
    sellingPoints: string[];
    process: string[];
    categories: Array<{ name: string; description: string }>;
    bottomBar: string[];
    cta: string;
  };
  deliverySpec: SocialImageDeliverySpec;
  materialIds: string[];
  referenceUrls: string[];
  referenceSnapshot?: SocialImageReferenceSnapshot;
  replicationRecipe?: SocialImageReplicationRecipe;
  layerGraph?: SocialImageLayerGraph;
  enterpriseAssets: SocialImageEnterpriseAssetBinding[];
  generationJobs: SocialImageGenerationJob[];
  renderPlan?: SocialImageFrozenRenderPlan;
  gifDelivery?: SocialImageGifDelivery;
  repairInstructions: SocialImageRepairInstruction[];
  outputs: SocialImageOutputNode[];
  /** V3: one child run under the canonical ContentTask, including resumable node events. */
  productionRuntime?: SocialImageProductionRuntime;
  hookFactorSpec?: SocialImageHookFactorSpec;
  adaptationSpec?: SocialImageAdaptationSpec;
  directorReviewDecision?: SocialImageDirectorReviewDecision;
  approvalDecisions?: SocialImageApprovalDecision[];
  approvedArtifact?: SocialImageApprovedArtifact;
  repairPlans?: SocialImageRepairPlan[];
  deliveryPackages?: SocialImageDeliveryPackage[];
  fieldsToConfirm: string[];
  publishable: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SOCIAL_IMAGE_HARD_CHECKS: SocialImageQualityCheckKey[] = [
  'file_decode', 'pixel_dimensions', 'product_identity', 'packaging_visibility', 'subject_visibility', 'label_ocr',
  'fact_consistency', 'copy_visual_consistency', 'brand_consistency', 'text_overflow', 'safe_zone',
];

export function socialImageCurrentOutputs(task: Pick<SocialImageCreationTask, 'outputs'>): SocialImageOutputNode[] {
  const latest = new Map<string, SocialImageOutputNode>();
  for (const output of task.outputs) {
    const key = `${output.role}:${output.label}`;
    const current = latest.get(key);
    if (!current || output.version > current.version) latest.set(key, output);
  }
  return [...latest.values()];
}

/** The customer approves one deliverable set, never an isolated carousel page
 * or an internal GIF background plate. Order is frozen by the paid plan. */
export function socialImageReviewOutputs(task: SocialImageCreationTask): SocialImageOutputNode[] {
  const current = socialImageCurrentOutputs(task).filter(output => output.state !== 'superseded');
  if (task.imageType !== 'carousel' && task.imageType !== 'gif_poster') {
    const candidate = current.find(output => output.role === 'single');
    return candidate ? [candidate] : [];
  }
  const plan = task.renderPlan;
  if (!plan || plan.units.length !== task.deliverySpec.outputCount || !plan.units.length) return [];
  const units = [...plan.units].sort((left, right) => left.index - right.index);
  if (units.some((unit, index) => unit.index !== index)) return [];
  if (task.imageType === 'carousel') {
    const pages = units.map(unit => {
      const job = task.generationJobs.find(item => item.id === unit.jobId && item.planVersion === plan.version
        && item.unitIndex === unit.index && item.plannedInputHash === unit.plannedInputHash);
      return current.find(output => output.role === 'carousel_page' && output.label === unit.label
        && job?.outputNodeIds.includes(output.id)
        && output.materialId && output.mediaUrl && /^[a-f0-9]{64}$/.test(output.contentHash || ''));
    });
    return pages.every(Boolean) ? pages as SocialImageOutputNode[] : [];
  }
  const delivery = task.gifDelivery;
  if (!delivery || delivery.planVersion !== plan.version || delivery.sourceHash !== plan.sourceHash
    || delivery.frameOutputIds.length !== units.length) return [];
  const frames = units.map(unit => current.find(output => output.id === delivery.frameOutputIds[unit.index]
    && output.role === 'gif_frame' && output.sourceJobId === unit.jobId && output.materialId && output.mediaUrl
    && /^[a-f0-9]{64}$/.test(output.contentHash || '')));
  const final = current.find(output => output.id === delivery.finalOutputId && output.role === 'gif_output'
    && output.materialId && output.mediaUrl && /^[a-f0-9]{64}$/.test(output.contentHash || ''));
  return frames.every(Boolean) && final ? [...frames as SocialImageOutputNode[], final] : [];
}

export function socialImageOutputHardChecksPassed(output: SocialImageOutputNode): boolean {
  const standard = SOCIAL_IMAGE_HARD_CHECKS.every(key => output.qualityChecks.some(check => check.key === key
    && check.severity === 'hard' && (check.verdict === 'pass' || check.verdict === 'not_applicable')));
  if (!standard || output.role !== 'gif_output') return standard;
  return output.qualityChecks.some(check => check.key === 'motion_mechanism_similarity'
    && check.severity === 'hard' && check.verdict === 'pass' && check.checker === 'deterministic'
    && check.evidence?.includes(`candidate-sha256:${output.contentHash}`));
}

function socialImageMultiOutputComplete(task: SocialImageCreationTask, outputs: SocialImageOutputNode[]): boolean {
  if (task.imageType !== 'carousel' && task.imageType !== 'gif_poster') return true;
  const plan = task.renderPlan;
  if (!plan || plan.units.length !== task.deliverySpec.outputCount) return false;
  const unitsReady = plan.units.every(unit => {
    const job = task.generationJobs.find(item => item.id === unit.jobId && item.planVersion === plan.version && item.unitIndex === unit.index);
    const output = outputs.find(item => item.role === unit.role && item.label === unit.label && item.materialId
      && (task.imageType === 'gif_poster' ? item.state !== 'superseded' : item.state === 'approved'));
    return Boolean(job && output && job.outputNodeIds.includes(output.id));
  });
  if (!unitsReady) return false;
  if (task.imageType !== 'gif_poster') return true;
  const delivery = task.gifDelivery;
  return Boolean(delivery && delivery.planVersion === plan.version && delivery.sourceHash === plan.sourceHash
    && delivery.frameOutputIds.length === plan.units.length
    && plan.units.every(unit => outputs.some(output => output.id === delivery.frameOutputIds[unit.index]
      && output.role === 'gif_frame' && output.sourceJobId === unit.jobId && output.materialId && output.state === 'approved'))
    && outputs.some(output => output.id === delivery.finalOutputId && output.role === 'gif_output' && output.materialId && output.state === 'approved'));
}

function deliverableOutputs(task: SocialImageCreationTask, outputs: SocialImageOutputNode[]): SocialImageOutputNode[] {
  if (task.imageType === 'carousel' || task.imageType === 'gif_poster') {
    const reviewSet = socialImageReviewOutputs(task);
    return reviewSet.length ? reviewSet : outputs.filter(output => task.imageType === 'carousel'
      ? output.role === 'carousel_page' : output.role === 'gif_frame' || output.role === 'gif_output');
  }
  return outputs;
}

export function socialImageTaskIssues(task: SocialImageCreationTask): string[] {
  const issues: string[] = [];
  if (!['social-image-creation.v1', 'social-image-creation.v2', 'social-image-creation.v3'].includes(task.schemaVersion)) issues.push('合同版本无效');
  if (!task.title.trim()) issues.push('缺少任务标题');
  if (!SOCIAL_IMAGE_CONTENT_TYPES.includes(task.imageType)) issues.push('图片类型无效');
  if (!task.contentBrief.coreClaim.trim()) issues.push('缺少核心主张');
  if (!task.contentBrief.productRefs.length) issues.push('至少选择一个企业产品');
  if (!task.deliverySpec.language.trim()) issues.push('缺少内容语言');
  if (task.deliverySpec.outputCount < 1 || task.deliverySpec.outputCount > 10) issues.push('输出数量须为 1–10');
  if (task.imageType === 'gif_poster' && task.deliverySpec.format !== 'gif') issues.push('GIF 动态海报必须输出 GIF');
  if (task.deliverySpec.format === 'gif' && !task.deliverySpec.motion) issues.push('GIF 缺少动效规格');
  if (task.contentBrief.factuality === 'mock' && task.publishable) issues.push('模拟内容不可直接发布');
  if (task.creationPath === 'viral_replication' && task.schemaVersion !== 'social-image-creation.v1' && !task.referenceSnapshot) issues.push('爆款复刻缺少参考作品快照');
  const identityBindings = task.enterpriseAssets.filter(asset => asset.role === 'product' || asset.role === 'logo');
  if (task.schemaVersion !== 'social-image-creation.v1' && identityBindings.some(asset => !asset.assetId || !asset.source.startsWith('enterprise_'))) issues.push('产品或 Logo 必须绑定企业知识库资产');
  if (task.schemaVersion === 'social-image-creation.v3' && !task.productionRuntime?.binding) issues.push('图片运行未绑定统一内容任务');
  const currentOutputs = socialImageCurrentOutputs(task);
  if (task.status === 'approved' && !socialImageMultiOutputComplete(task, currentOutputs)) issues.push('多图单元或最终动图未全部完成审阅');
  const deliverables = deliverableOutputs(task, currentOutputs);
  const hardChecks = deliverables.flatMap(output => output.qualityChecks).filter(check => check.severity === 'hard');
  const failedHard = hardChecks.some(check => check.verdict !== 'pass' && check.verdict !== 'not_applicable');
  const missingHard = deliverables.length > 0 && deliverables.some(output => !socialImageOutputHardChecksPassed(output));
  if (failedHard && task.publishable) issues.push('硬质量门未全部通过');
  if (missingHard && task.publishable) issues.push('硬质量门结果不完整');
  if (task.schemaVersion === 'social-image-creation.v3' && task.status === 'approved') {
    const approval = task.approvalDecisions?.at(-1);
    const artifact = task.approvedArtifact;
    if (!approval || approval.decision !== 'approved' || approval.source !== 'explicit_user_action' || !artifact
      || artifact.approvalDecisionId !== approval.decisionId || artifact.contentHash !== approval.candidateContentHash) {
      issues.push('缺少显式用户验收凭证');
    }
    if ((task.imageType === 'carousel' || task.imageType === 'gif_poster') && artifact && approval) {
      const reviewOutputs = socialImageReviewOutputs(task);
      const expected = reviewOutputs.map(output => `${output.id}:${output.version}:${output.contentHash}`);
      const approved = (artifact.candidateRefs || []).map(ref => `${ref.id}:${ref.version}:${ref.contentHash}`);
      const decided = (approval.candidateRefs || []).map(ref => `${ref.id}:${ref.version}:${ref.contentHash}`);
      if (!expected.length || JSON.stringify(expected) !== JSON.stringify(approved)
        || JSON.stringify(expected) !== JSON.stringify(decided)) issues.push('多图成品验收引用与当前版本不一致');
      if (!artifact.mediaItems || artifact.mediaItems.length !== reviewOutputs.length
        || reviewOutputs.some((output, index) => artifact.mediaItems?.[index]?.candidateId !== output.id
          || artifact.mediaItems?.[index]?.role !== output.role || artifact.mediaItems?.[index]?.materialId !== output.materialId
          || artifact.mediaItems?.[index]?.mediaUrl !== output.mediaUrl)) issues.push('多图成品交付素材不完整');
    }
  }
  return issues;
}

export function socialImageTaskCanPublish(task: SocialImageCreationTask): boolean {
  const currentOutputs = socialImageCurrentOutputs(task);
  const deliverables = deliverableOutputs(task, currentOutputs);
  const hardChecksPassed = deliverables.length > 0 && deliverables.every(socialImageOutputHardChecksPassed);
  const explicitApproval = task.schemaVersion !== 'social-image-creation.v3' || Boolean(task.approvedArtifact
    && task.approvalDecisions?.at(-1)?.decision === 'approved'
    && task.approvalDecisions.at(-1)?.decisionId === task.approvedArtifact.approvalDecisionId);
  return task.status === 'approved' && explicitApproval && task.contentBrief.factuality !== 'mock' && task.fieldsToConfirm.length === 0 && socialImageTaskIssues({ ...task, publishable: false }).length === 0
    && currentOutputs.length > 0
    && socialImageMultiOutputComplete(task, currentOutputs)
    && deliverables.every(output => output.state === 'approved') && hardChecksPassed;
}
import type { SocialImageLayerGraph } from './socialImageLayerGraph';

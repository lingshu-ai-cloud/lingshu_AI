import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask, SocialImageQualityCheck } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageLayerGraph, SocialImageNormalizedRect } from '../../shared/contracts/socialImageLayerGraph.js';
import type {
  SocialImageAdaptationSpec, SocialImageElementInventory, SocialImageHookFactor,
  SocialImageHookFactorSpec, SocialImageNodeEnvelope, SocialImageNodeValueMap, SocialImageVersionedRef,
} from '../../shared/contracts/socialImageProduction.js';
import { socialImageCanvasForAspectRatio } from './referenceCanvas.js';
import { analyzeSocialImageReference, type SocialImageOcrPort } from './socialImageEvidenceWorker.js';
import { SocialImageProductionRunError, recordSocialImageHookStrategy, recordSocialImageNodeOutput } from './socialImageProductionRun.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { assertSocialImageLayerGraph } from './layerGraphValidation.js';
import { socialImageV3RenderSpecInputHash } from './socialImagePaidPrerequisites.js';
import { referenceProductCheckHashIssue } from './socialImageReferenceProductPolicy.js';

type InventoryEnvelope = SocialImageNodeEnvelope<SocialImageElementInventory>;
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const nodeRef = (node: SocialImageNodeEnvelope<unknown>): SocialImageVersionedRef => ({
  objectType: node.schemaVersion, id: node.id, version: node.version, contentHash: node.contentHash,
});
const latest = (task: SocialImageCreationTask, id: string) => task.productionRuntime?.nodeOutputs
  .filter(node => node.nodeId === id).sort((a, b) => b.version - a.version)[0];
const clamp = (value: number, limit: number) => Math.max(.025, Math.min(limit, value));
const overlap = (a: SocialImageNormalizedRect, b: SocialImageNormalizedRect) => Math.max(0,
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0,
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const unitBox = (box: SocialImageNormalizedRect) => [box.x, box.y, box.width, box.height].every(Number.isFinite)
  && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
  && box.x + box.width <= 1.001 && box.y + box.height <= 1.001;

function regionForBox(inventory: SocialImageElementInventory, box: SocialImageNormalizedRect) {
  return [...inventory.regions].sort((a, b) => overlap(b.bbox, box) - overlap(a.bbox, box))[0];
}

/** Only measurable visual mechanisms enter the factor list. No reach/causal claim is inferred from a single picture. */
export function deriveSocialImageReferenceStrategy(task: SocialImageCreationTask, inventory: SocialImageElementInventory): {
  hooks: SocialImageHookFactorSpec; adaptation: SocialImageAdaptationSpec;
} {
  const regions = inventory.regions.filter(region => unitBox(region.bbox) && region.evidenceRef?.contentHash);
  const ranked = [...regions].sort((a, b) => Number(b.toolScores.saliency || 0) - Number(a.toolScores.saliency || 0));
  const strongest = ranked[0];
  const weakest = ranked.at(-1);
  const contrast = Number(strongest?.toolScores.saliency || 0) - Number(weakest?.toolScores.saliency || 0);
  const factors: SocialImageHookFactor[] = [];
  const gaps = ['single_reference_has_no_causal_performance_evidence', 'semantic_subject_identity_not_machine_verified'];
  if (strongest && contrast >= .045) factors.push({
    factorId: 'reference-attention-region', regionRefs: [strongest.regionId], priorityRank: 1,
    category: 'measured_saliency', observableDescription: `第一注意区位于 ${strongest.layerRole}；网格显著性差 ${contrast.toFixed(3)}`,
    causalRole: 'attention', importance: 'high', evidenceRefs: [strongest.evidenceRef],
    analysisConfidence: Math.min(.95, .5 + contrast), causalConfidence: .15,
    effectStatus: 'visual_hypothesis', transferability: 'medium',
    validator: { kind: 'saliency_order', observableTarget: strongest.layerRole },
  });
  else gaps.push('saliency_region_not_distinguishable');
  const observedText = inventory.ocrBlocks.filter(block => unitBox(block.bbox) && block.confidence >= .75)
    .sort((a, b) => b.confidence - a.confidence)[0];
  const textRegion = observedText && regionForBox(inventory, observedText.bbox);
  if (observedText && textRegion) factors.push({
    factorId: 'reference-text-hierarchy', regionRefs: [textRegion.regionId],
    priorityRank: (factors.length + 1) as 1 | 2,
    category: 'measured_text_region', observableDescription: `可读文字区位于 ${textRegion.layerRole}；不沿用原参考文案`,
    causalRole: 'comprehension', importance: 'high', evidenceRefs: [textRegion.evidenceRef],
    analysisConfidence: observedText.confidence, causalConfidence: .1,
    effectStatus: 'visual_hypothesis', transferability: 'medium',
    validator: { kind: 'ocr_match', observableTarget: textRegion.layerRole },
  });
  else gaps.push('reference_text_region_unverified');
  gaps.push('proof_trust_conversion_effects_unverified');
  const hooks: SocialImageHookFactorSpec = {
    schemaVersion: 'social-image-hook-factor-spec.v1', factors,
    ordinaryVisualNotes: ['只迁移证据支持的区域关系与注意顺序；产品、品牌、人物、原文案必须替换'],
    evidenceGaps: gaps,
  };
  const adaptation: SocialImageAdaptationSpec = {
    schemaVersion: 'social-image-adaptation-spec.v1',
    factorPolicies: factors.map(factor => ({ factorId: factor.factorId, policy: 'equivalent' as const,
      reason: '仅复用可测的传播作用与相对区域，不复用参考图像素或身份' })),
    keepHooks: factors.map(factor => factor.factorId),
    innovationPoints: [{ replaceElement: 'reference_identity_and_copy', reason: '参考图授权仅限结构分析',
      newDirection: '使用当前 ContentTask 的企业产品和主张重新合成',
      requiredAssets: task.contentBrief.productRefs, differenceRequirement: '不得出现参考品牌、原文案或原图像素' }],
    excludedElements: ['reference_original_pixels', 'reference_brand_or_logo', 'reference_copy', 'reference_person_identity'],
    originalityConstraints: ['source_image_structure_only', 'no_reference_pixel_reuse'],
    brandConstraints: ['use_current_enterprise_product_identity'],
  };
  return { hooks, adaptation };
}

/** Writes both formal outputs from the just-frozen reference inventory; browser cannot submit either result. */
export async function prepareSocialImageReferenceStrategy(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
}) {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const inventoryNode = latest(task, 'element_inventory') as InventoryEnvelope | undefined;
  const referenceNode = latest(task, 'reference_snapshot');
  if (inventoryNode?.status !== 'completed' || referenceNode?.status !== 'completed') {
    throw new SocialImageProductionRunError('social_image_reference_evidence_incomplete', 422);
  }
  const { hooks, adaptation } = deriveSocialImageReferenceStrategy(task, inventoryNode.value);
  return recordSocialImageHookStrategy({ ...input, hookFactorSpec: hooks, adaptationSpec: adaptation });
}

function measuredReferenceLayout(inventory: SocialImageElementInventory, ratio: SocialImageCreationTask['deliverySpec']['aspectRatio']) {
  const canvas = socialImageCanvasForAspectRatio(ratio);
  if (!Number.isFinite(inventory.canvas.width) || !Number.isFinite(inventory.canvas.height)
    || inventory.canvas.width <= 0 || inventory.canvas.height <= 0) {
    return null;
  }
  const sourceAspectRatio = inventory.canvas.width / inventory.canvas.height;
  const fitBoxToDelivery = (box: SocialImageNormalizedRect): SocialImageNormalizedRect => {
    if (sourceAspectRatio > canvas.aspectRatio) {
      const scale = canvas.aspectRatio / sourceAspectRatio;
      return { x: box.x, y: (1 - scale) / 2 + box.y * scale, width: box.width, height: box.height * scale };
    }
    const scale = sourceAspectRatio / canvas.aspectRatio;
    return { x: (1 - scale) / 2 + box.x * scale, y: box.y, width: box.width * scale, height: box.height };
  };
  const ranked = [...inventory.regions].sort((a, b) => Number(b.toolScores.saliency || 0) - Number(a.toolScores.saliency || 0));
  const weakest = ranked.at(-1);
  const text = inventory.ocrBlocks.filter(block => unitBox(block.bbox) && block.confidence >= .75
    && (block.text.match(/[\p{L}\p{N}]/gu)?.length || 0) >= 3)
    .sort((a, b) => b.bbox.width * b.bbox.height * b.confidence
      - a.bbox.width * a.bbox.height * a.confidence)[0];
  const textRegion = text && regionForBox(inventory, text.bbox);
  // Large headlines can have the strongest edge score. Place the product in
  // the strongest independently observed column instead of covering that copy.
  const textColumn = textRegion?.layerRole.split('_')[1];
  const focal = ranked.find(region => region.regionId !== textRegion?.regionId
    && region.layerRole.split('_')[1] !== textColumn);
  if (!focal || !weakest || Number(focal.toolScores.saliency || 0) - Number(weakest.toolScores.saliency || 0) < .045
    || !text || !textRegion) {
    return null;
  }
  const centered = (box: SocialImageNormalizedRect, width: number, height: number): SocialImageNormalizedRect => ({
    x: clamp(box.x + box.width / 2 - width / 2, 1 - width - .025),
    y: clamp(box.y + box.height / 2 - height / 2, 1 - height - .025), width, height,
  });
  const product = centered(fitBoxToDelivery(focal.bbox), .38, .48);
  const headline = centered(fitBoxToDelivery(text.bbox), .36, .14);
  if (overlap(product, headline) / (product.width * product.height) > .04) {
    return null;
  }
  const rawRgb = inventory.colorAndLighting.meanRgb;
  if (!Array.isArray(rawRgb) || rawRgb.length < 3 || rawRgb.slice(0, 3).some(value => !Number.isFinite(Number(value)))) {
    return null;
  }
  const color = `#${rawRgb.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(255, Number(value)))).toString(16).padStart(2, '0')).join('')}`;
  return { canvas, focal, textRegion, product, headline, color };
}

function systemFallbackLayout(inventory: SocialImageElementInventory,
  ratio: SocialImageCreationTask['deliverySpec']['aspectRatio']) {
  const canvas = socialImageCanvasForAspectRatio(ratio);
  const rawRgb = inventory.colorAndLighting.meanRgb;
  const color = Array.isArray(rawRgb) && rawRgb.length >= 3
    && rawRgb.slice(0, 3).every(value => Number.isFinite(Number(value)))
    ? `#${rawRgb.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(255, Number(value))))
      .toString(16).padStart(2, '0')).join('')}`
    : '#f7f8fa';
  if (canvas.aspectRatio > 1.2) return {
    canvas, color,
    headline: { x: .06, y: .14, width: .38, height: .24 },
    product: { x: .54, y: .1, width: .4, height: .8 },
  };
  if (canvas.aspectRatio < .8) return {
    canvas, color,
    headline: { x: .08, y: .08, width: .84, height: .16 },
    product: { x: .16, y: .3, width: .68, height: .62 },
  };
  return {
    canvas, color,
    headline: { x: .08, y: .08, width: .84, height: .16 },
    product: { x: .22, y: .3, width: .56, height: .62 },
  };
}

export function compileEvidenceGuidedSocialImage(input: {
  task: SocialImageCreationTask; inventory: SocialImageElementInventory; productId: string; headline: string; now?: string;
}): SocialImageLayerGraph {
  const measured = measuredReferenceLayout(input.inventory, input.task.deliverySpec.aspectRatio);
  const layout = measured || systemFallbackLayout(input.inventory, input.task.deliverySpec.aspectRatio);
  const templateId = measured ? 'reference-evidence-layout-v1' : 'system-product-layout-v1';
  const graph: SocialImageLayerGraph = {
    schemaVersion: 'social-image-layer-graph.v1', templateId,
    canvas: { width: layout.canvas.width, height: layout.canvas.height, background: layout.color },
    layers: [
      { id: 'background', kind: 'background', zIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 },
        styleToken: measured ? 'reference-measured-color' : 'system-fallback-color' },
      { id: 'headline', kind: 'text', zIndex: 20, rect: layout.headline, content: input.headline,
        styleToken: 'reference-adaptive-headline', ...(measured ? { evidenceRefs: [measured.textRegion.evidenceRef.id] } : {}) },
      { id: 'product-hero', kind: 'product', zIndex: 30, rect: layout.product, sourceAssetId: input.productId,
        fit: 'contain', protectedAnchors: ['cap', 'brand', 'label', 'product_body'],
        ...(measured ? { evidenceRefs: [measured.focal.evidenceRef.id] } : {}) },
    ],
    protectedRegions: [layout.product], overlayAllowedRegions: [layout.headline],
    fontManifest: [{ token: 'reference-adaptive-headline', family: 'Arial', fileHash: 'system-font-arial-v1' }],
    compiledAt: input.now || new Date().toISOString(),
  };
  assertSocialImageLayerGraph(graph);
  return graph;
}

/** The graph and all three planning nodes are frozen from current, non-stale reference evidence. */
export async function compileSocialImageReferencePlan(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number; productName: string; now?: string;
}) {
  const loaded = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!loaded) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (loaded.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (loaded.schemaVersion !== 'social-image-creation.v3' || loaded.creationPath !== 'viral_replication') {
    throw new SocialImageProductionRunError('social_image_reference_plan_scope_invalid', 422);
  }
  let task: SocialImageCreationTask = loaded;
  const inventoryNode = latest(task, 'element_inventory') as InventoryEnvelope | undefined;
  const hookNode = latest(task, 'hook_factors'), adaptationNode = latest(task, 'adaptation');
  const manifestNode = latest(task, 'asset_manifest');
  if ([inventoryNode, hookNode, adaptationNode, manifestNode].some(node => node?.status !== 'completed')
    || !task.hookFactorSpec || !task.adaptationSpec) {
    throw new SocialImageProductionRunError('social_image_reference_plan_evidence_incomplete', 422);
  }
  const reference = latest(task, 'reference_snapshot')?.value as SocialImageNodeValueMap['reference_snapshot'] | undefined;
  const referenceIssue = referenceProductCheckHashIssue(task, reference?.imageAssetRef?.contentHash || '');
  if (referenceIssue) throw new SocialImageProductionRunError(referenceIssue, 422);
  const productId = task.contentBrief.productRefs[0];
  if (!productId || !task.enterpriseAssets.some(asset => asset.assetId === productId && asset.required)) {
    throw new SocialImageProductionRunError('social_image_required_product_missing', 422);
  }
  const requiredAssets = (manifestNode!.value as SocialImageNodeValueMap['asset_manifest']).assets.filter(asset => asset.required);
  if (requiredAssets.length !== 1 || requiredAssets[0]?.assetId !== productId
    || requiredAssets[0]?.role !== 'product') {
    throw new SocialImageProductionRunError('social_image_reference_asset_layout_unsupported', 422);
  }
  const headline = task.imageTextContract.headline.trim() || task.contentBrief.coreClaim.trim();
  if (!headline) throw new SocialImageProductionRunError('social_image_headline_missing', 422);
  const graph = compileEvidenceGuidedSocialImage({ task, inventory: inventoryNode!.value, productId, headline, now: input.now });
  const graphHash = sha(graph);
  const usesMeasuredReferenceLayout = graph.templateId === 'reference-evidence-layout-v1';
  const director = await recordSocialImageNodeOutput({ ...input, expectedVersion: task.version,
    nodeId: 'director_brief', status: 'completed',
    value: { objective: task.contentBrief.coreClaim, singleCoreClaim: task.contentBrief.coreClaim,
      headline, supportingText: '', caption: task.imageTextContract.caption, cta: '',
      requiredFacts: task.imageTextContract.requiredFacts, prohibitedInferences: task.imageTextContract.prohibitedInferences,
      visualMustShow: [input.productName], visualMustNotImply: task.imageTextContract.visualMustNotImply,
      compositionIntent: usesMeasuredReferenceLayout
        ? `参考显著区 ${graph.layers.find(layer => layer.kind === 'product')?.evidenceRefs?.[0]} 与文字留白区 ${graph.layers.find(layer => layer.kind === 'text')?.evidenceRefs?.[0]}`
        : '参考图结构不可可靠复用，采用系统通用产品版式；不沿用参考图布局、品牌或文案',
      imageTextRelation: usesMeasuredReferenceLayout ? 'measured_reference_layout' : 'system_product_layout',
      visualProof: 'enterprise_product_asset',
      brandAndOriginalityRules: task.adaptationSpec!.originalityConstraints,
      acceptanceCriteria: usesMeasuredReferenceLayout ? task.hookFactorSpec!.factors.map(factor => ({ criterionId: factor.factorId,
        observableTarget: factor.validator.observableTarget, validator: factor.validator.kind })) : [],
      factorSpecRef: nodeRef(hookNode!), adaptationSpecRef: nodeRef(adaptationNode!) },
    inputRefs: [nodeRef(hookNode!), nodeRef(adaptationNode!), nodeRef(manifestNode!)],
    evidenceRefs: task.hookFactorSpec.factors.flatMap(factor => factor.evidenceRefs),
    createdBy: { kind: 'agent', id: 'image_director_evidence_plan' },
    taskPatch: { renderBrief: { headline, subheadline: '', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: '' }, imageTextContract: { ...task.imageTextContract, headline }, step: 'plan' }, now: input.now });
  task = director;
  const directorNode = latest(task, 'director_brief')!;
  task = await recordSocialImageNodeOutput({ ...input, expectedVersion: task.version,
    nodeId: 'execution_plan', status: 'completed', value: {
      productionStrategy: 'compose_assets', selectedAssetRefs: [nodeRef(manifestNode!)],
      assetRoles: [{ assetRef: nodeRef(manifestNode!), role: 'enterprise_product' }],
      renderRoute: usesMeasuredReferenceLayout ? 'local_evidence_guided_layer_compositor'
        : 'local_system_fallback_layer_compositor', candidateCount: 1,
      layerPlan: graph.layers.map(layer => ({ layerId: layer.id, role: layer.kind,
        sourceRef: layer.kind === 'product' ? nodeRef(manifestNode!) : null })),
      estimatedCost: { currency: 'CNY', amount: 0 }, estimatedDurationSeconds: null,
      fallbackRoutes: [], unmetCriteria: [],
    }, inputRefs: [nodeRef(directorNode)], createdBy: { kind: 'agent', id: 'content_agent_local_planner' }, now: input.now });
  const planNode = latest(task, 'execution_plan')!;
  task = await recordSocialImageNodeOutput({ ...input, expectedVersion: task.version,
    nodeId: 'render_spec', status: 'completed', value: {
      width: graph.canvas.width, height: graph.canvas.height, aspectRatio: task.deliverySpec.aspectRatio,
      assetInputs: (manifestNode!.value as SocialImageNodeValueMap['asset_manifest']).assets.filter(asset => asset.required)
        .map(asset => ({ objectType: 'enterprise-image-asset', id: asset.assetId,
        version: asset.version, contentHash: asset.contentHash, role: asset.role })),
      layoutConstraints: { graphHash, templateId: graph.templateId, inventoryRef: nodeRef(inventoryNode!) },
      textLayers: [{ role: 'headline', text: headline, region: graph.layers.find(layer => layer.id === 'headline')?.evidenceRefs?.[0] || '' }],
      subjectConstraints: ['enterprise_product_required'],
      factorTargets: usesMeasuredReferenceLayout ? task.hookFactorSpec!.factors.map(factor => ({ factorId: factor.factorId,
        observableTarget: factor.validator.observableTarget })) : [],
      negativeConstraints: task.adaptationSpec!.excludedElements,
      providerAdapterVersion: 'local-evidence-layered.v1', seedPolicy: 'fixed',
      idempotencyKey: sha({ taskId: task.id, graphHash }), inputHash: socialImageV3RenderSpecInputHash(task, graph),
    }, inputRefs: [nodeRef(planNode), nodeRef(inventoryNode!)], createdBy: { kind: 'worker', id: 'local_layer_spec_compiler' }, now: input.now });
  const updated = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    layerGraph: graph, status: 'planned', step: 'generate',
  });
  if (updated.kind !== 'updated') throw new SocialImageProductionRunError(updated.kind === 'conflict'
    ? 'social_image_version_conflict' : 'social_image_reference_plan_persist_failed', updated.kind === 'conflict' ? 409 : 422);
  return { task: updated.task, graph };
}

/** Each verdict is checked against the current candidate bytes, not a generic reference score. */
export async function inspectSocialImageCandidateFactors(input: {
  task: SocialImageCreationTask; bytes: Buffer; mimeType: string; ocr?: SocialImageOcrPort;
}): Promise<SocialImageQualityCheck[]> {
  if (input.task.creationPath !== 'viral_replication') return [];
  if (input.task.layerGraph?.templateId === 'system-product-layout-v1') return [];
  const inventoryNode = latest(input.task, 'element_inventory') as InventoryEnvelope | undefined;
  if (inventoryNode?.status !== 'completed' || !input.task.hookFactorSpec) return [];
  const candidateHash = createHash('sha256').update(input.bytes).digest('hex');
  let candidate: SocialImageElementInventory | null = null;
  try { candidate = await analyzeSocialImageReference({ bytes: input.bytes, mimeType: input.mimeType,
    referenceId: `candidate-${candidateHash}`, ocr: input.ocr }); } catch { /* Unreadable candidate stays uncertain. */ }
  return input.task.hookFactorSpec.factors.map(factor => {
    const referenceRegion = inventoryNode.value.regions.find(region => factor.regionRefs.includes(region.regionId));
    const matchingRegion = candidate?.regions.find(region => region.layerRole === referenceRegion?.layerRole);
    const evidence = [`candidate-sha256:${candidateHash}`, ...(referenceRegion ? [`reference-region-sha256:${referenceRegion.evidenceRef.contentHash}`] : [])];
    let verdict: SocialImageQualityCheck['verdict'] = 'uncertain';
    if (candidate && referenceRegion && matchingRegion) {
      if (factor.validator.kind === 'saliency_order') {
        const rank = candidate.saliencyOrder.indexOf(matchingRegion.regionId);
        verdict = rank >= 0 && rank <= 2 ? 'pass' : 'fail';
      } else if (factor.validator.kind === 'ocr_match' && input.ocr) {
        const headline = input.task.imageTextContract.headline.trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const observed = candidate.ocrBlocks.filter(block => block.confidence >= .5
          && overlap(block.bbox, matchingRegion.bbox) > 0)
          .sort((left, right) => left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x)
          .map(block => block.text).join(' ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        // Headlines are often wrapped into several OCR blocks. Requiring one
        // block to contain the entire title made a correct wrapped title fail.
        verdict = headline && observed.includes(headline) ? 'pass' : candidate.ocrBlocks.length ? 'fail' : 'uncertain';
      }
    }
    return { key: `hook_factor:${factor.factorId}`, verdict, severity: 'soft', checker: 'deterministic',
      note: verdict === 'uncertain' ? '候选缺少该爆点因素的可定位像素证据' : verdict === 'pass'
        ? '该因素在候选像素中有独立可定位证据' : '候选未满足参考因素的可观察条件', evidence,
      ...(matchingRegion ? { region: matchingRegion.bbox } : {}),
      ...(verdict === 'fail' ? { repairSuggestion: '依据对应候选区域重新排版并复检' } : {}),
    };
  });
}

export function socialImageFrozenGraphMatches(task: SocialImageCreationTask): boolean {
  const spec = latest(task, 'render_spec');
  const value = spec?.value as SocialImageNodeValueMap['render_spec'] | undefined;
  return spec?.status === 'completed' && Boolean(task.layerGraph
    && value?.layoutConstraints?.graphHash === sha(task.layerGraph)
    && value?.inputHash === socialImageV3RenderSpecInputHash(task));
}

/** The local compositor must use the same product and reference bytes that produced the frozen evidence. */
export function socialImageFrozenSourceIssue(input: {
  task: SocialImageCreationTask; productBytes: Map<string, Buffer>; referenceBytes: Buffer | null;
}): string | null {
  const manifestNode = latest(input.task, 'asset_manifest');
  const referenceNode = latest(input.task, 'reference_snapshot');
  if (manifestNode?.status !== 'completed' || referenceNode?.status !== 'completed') return 'social_image_reference_evidence_stale';
  const manifest = manifestNode.value as SocialImageNodeValueMap['asset_manifest'];
  const reference = referenceNode.value as SocialImageNodeValueMap['reference_snapshot'];
  if (manifest.assets.filter(asset => asset.required).some(asset =>
    !input.productBytes.has(asset.assetId)
    || createHash('sha256').update(input.productBytes.get(asset.assetId)!).digest('hex') !== asset.contentHash)) {
    return 'social_image_required_asset_bytes_changed';
  }
  if (!input.referenceBytes) return 'social_image_reference_unreadable';
  if (createHash('sha256').update(input.referenceBytes).digest('hex') !== reference.imageAssetRef.contentHash) {
    return 'social_image_reference_bytes_changed';
  }
  return null;
}

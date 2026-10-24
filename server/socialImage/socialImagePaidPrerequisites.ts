import { createHash } from 'node:crypto';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageLayerGraph } from '../../shared/contracts/socialImageLayerGraph.js';
import type { SocialImageNodeEnvelope, SocialImageProductionNodeId, SocialImageNodeValueMap } from '../../shared/contracts/socialImageProduction.js';
import { socialImageCanvasForAspectRatio } from './referenceCanvas.js';
import { taskContextSnapshotIssue } from './taskContextSnapshot.js';

const HASH = /^[a-f0-9]{64}$/;
const PREPARATION_NODES = ['asset_manifest', 'reference_snapshot', 'element_inventory', 'hook_factors', 'adaptation'] as const;
const PLAN_NODES = ['director_brief', 'execution_plan', 'render_spec'] as const;

/** Frozen V3 copy cannot be silently sanitized into a different paid request. */
export function socialImageFrozenCommercialIssue(input: {
  issues: readonly string[]; fieldsToConfirm: readonly string[]; headline: string; imagePrompt: string;
}): string | null {
  if (!input.headline.trim() || !input.imagePrompt.trim()) return 'social_image_frozen_render_input_incomplete';
  if (input.issues.length || input.fieldsToConfirm.length) return 'social_image_frozen_commercial_claim_replan_required';
  return null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

function latestOutput(task: SocialImageCreationTask, nodeId: SocialImageProductionNodeId): SocialImageNodeEnvelope<unknown> | null {
  const outputs = task.productionRuntime?.nodeOutputs.filter(output => output.nodeId === nodeId) || [];
  return outputs.reduce<SocialImageNodeEnvelope<unknown> | null>((latest, output) =>
    !latest || output.version > latest.version ? output : latest, null);
}

function completedOutput(task: SocialImageCreationTask, nodeId: SocialImageProductionNodeId): SocialImageNodeEnvelope<unknown> | null {
  const output = latestOutput(task, nodeId);
  const state = task.productionRuntime?.nodes.find(node => node.nodeId === nodeId);
  return output?.status === 'completed' && state?.status === 'completed'
    && state.outputRef?.id === output.id && output.productionRunId === task.id
    && output.contentTaskId === task.productionRuntime?.binding?.contentTaskId
    && HASH.test(output.contentHash)
    && output.contentHash === createHash('sha256').update(JSON.stringify(canonical({
      value: output.value, inputRefs: output.inputRefs, evidenceRefs: output.evidenceRefs,
    }))).digest('hex') ? output : null;
}

function linkedTo(output: SocialImageNodeEnvelope<unknown>, upstream: SocialImageNodeEnvelope<unknown>): boolean {
  return output.inputRefs.some(ref => ref.id === upstream.id && ref.version === upstream.version
    && ref.contentHash === upstream.contentHash);
}

/** V2 projects retain their historical admission path. V3 must use formal, current evidence. */
export function socialImageV3PaidPrerequisiteIssue(task: SocialImageCreationTask, stage: 'queue' | 'execute'): string | null {
  if (task.schemaVersion !== 'social-image-creation.v3') return null;
  const runtime = task.productionRuntime;
  if (!runtime?.binding || runtime.binding.productionRunId !== task.id) return 'social_image_content_task_binding_missing';
  const snapshotIssue = taskContextSnapshotIssue(runtime.binding.taskContextSnapshot, {
    tenantId: runtime.binding.taskContextSnapshot?.tenantId || '', contentTaskId: runtime.binding.contentTaskId,
    contentTaskVersion: runtime.binding.contentTaskVersion, productionRunId: runtime.binding.productionRunId,
  });
  if (snapshotIssue) return snapshotIssue;
  // The canonical ContentTask has one authoritative productId. Do not let a
  // second image-only product acquire formal evidence or a paid render slot.
  if (task.contentBrief.productRefs.length > 1) return 'social_image_single_product_required';
  const businessOutput = completedOutput(task, 'business_context');
  const business = businessOutput?.value as SocialImageNodeValueMap['business_context'] | undefined;
  if (!businessOutput || !business || businessOutput.createdBy.kind !== 'system'
    || !businessOutput.inputRefs.some(ref => ref.objectType === 'social_content_task'
      && ref.id === runtime.binding!.contentTaskId && String(ref.version) === runtime.binding!.contentTaskVersion)
    || !task.contentBrief.productRefs.length || !task.contentBrief.coreClaim.trim()
    || business.objective !== task.contentBrief.coreClaim
    || JSON.stringify(business.productRefs) !== JSON.stringify(task.contentBrief.productRefs)
    || business.deliverySpec?.aspectRatio !== task.deliverySpec.aspectRatio
    || business.deliverySpec?.language !== task.deliverySpec.language
    || business.deliverySpec?.format !== task.deliverySpec.format
    || business.deliverySpec?.outputCount !== task.deliverySpec.outputCount
    || business.topicType !== task.contentBrief.topicType
    || JSON.stringify(business.audience) !== JSON.stringify(task.contentBrief.audience)
    || !Array.isArray(business.platforms) || !business.platforms.includes(task.deliverySpec.platform)) return 'social_image_business_context_incomplete';

  const assetOutput = completedOutput(task, 'asset_manifest');
  if (!assetOutput || assetOutput.createdBy.kind !== 'worker') return 'social_image_asset_manifest_required';
  const manifest = assetOutput.value as SocialImageNodeValueMap['asset_manifest'];
  if (!manifest || !Array.isArray(manifest.assets) || !Array.isArray(manifest.requiredEvidence)) {
    return 'social_image_asset_manifest_invalid';
  }
  const required = task.enterpriseAssets.filter(asset => asset.required);
  if (!required.length || task.contentBrief.productRefs.length > 1 || task.materialIds.length > 3
    || task.contentBrief.productRefs.some(productId => !required.some(asset =>
    asset.role === 'product' && asset.assetId === productId))
    || task.materialIds.some(materialId => !required.some(asset => asset.assetId === materialId))
    || required.some(asset => {
      const matches = manifest.assets.filter(observed => observed.assetId === asset.assetId && observed.role === asset.role);
      const observed = matches[0];
      return matches.length !== 1 || !manifest.requiredEvidence.includes(asset.assetId)
        || !observed?.required || !observed.readable || observed.rights !== 'cleared'
        || !observed.rightsEvidenceRef?.trim() || !HASH.test(observed.contentHash)
        || !observed.dimensions?.width || !observed.dimensions?.height
        || Boolean(asset.contentHash && asset.contentHash !== observed.contentHash)
        || !assetOutput.evidenceRefs.some(ref => ref.id === asset.assetId && ref.contentHash === observed.contentHash);
    })) return 'social_image_required_asset_evidence_invalid';

  if (task.creationPath === 'viral_replication') {
    for (const nodeId of PREPARATION_NODES.slice(1)) {
      if (!completedOutput(task, nodeId)) return `social_image_${nodeId}_required`;
    }
    const reference = latestOutput(task, 'reference_snapshot')?.value as SocialImageNodeValueMap['reference_snapshot'] | undefined;
    if (!reference || !['structure_only', 'permitted'].includes(reference.rightsPolicy)
      || !HASH.test(reference.imageAssetRef?.contentHash || '')) return 'social_image_reference_rights_or_bytes_unverified';
  } else {
    for (const nodeId of PREPARATION_NODES.slice(1)) {
      if (runtime.nodes.find(node => node.nodeId === nodeId)?.status !== 'skipped'
        || latestOutput(task, nodeId)) return `social_image_${nodeId}_unexpected`;
    }
  }

  const directorOutput = completedOutput(task, 'director_brief');
  if (!directorOutput || !task.renderBrief?.headline?.trim() || !task.imageTextContract.headline.trim()) {
    return 'social_image_director_brief_required';
  }
  const director = directorOutput.value as SocialImageNodeValueMap['director_brief'];
  const requiredFacts = [task.contentBrief.coreClaim, ...task.contentBrief.evidenceItems
    .filter(item => item.source !== 'mock').map(item => item.value)].filter(Boolean);
  if (task.fieldsToConfirm.length || !linkedTo(directorOutput, businessOutput) || !linkedTo(directorOutput, assetOutput)
    || director.objective !== task.contentBrief.coreClaim || director.singleCoreClaim !== task.contentBrief.coreClaim
    || director.headline !== task.renderBrief.headline || director.headline !== task.imageTextContract.headline
    || director.supportingText !== task.renderBrief.subheadline || director.caption !== task.imageTextContract.caption
    || director.cta !== task.renderBrief.cta || director.compositionIntent !== task.creativeRecipe.layoutRecipe
    || director.imageTextRelation !== task.creativeRecipe.imageTextRelation
    || director.visualProof !== task.creativeRecipe.visualProof
    || JSON.stringify(director.requiredFacts) !== JSON.stringify(requiredFacts)
    || JSON.stringify(director.visualMustShow) !== JSON.stringify(task.contentBrief.productNames)) {
    return 'social_image_director_brief_stale';
  }
  if (stage === 'execute') {
    for (const nodeId of PLAN_NODES.slice(1)) {
      if (!completedOutput(task, nodeId)) return `social_image_${nodeId}_required`;
    }
    const multi = task.imageType === 'carousel' || task.imageType === 'gif_poster';
    if (multi ? !task.renderPlan : Boolean(task.renderPlan)) return 'social_image_frozen_plan_invalid';
    const executionOutput = completedOutput(task, 'execution_plan');
    const executionPlan = executionOutput?.value as SocialImageNodeValueMap['execution_plan'] | undefined;
    if (!executionOutput || !linkedTo(executionOutput, directorOutput)
      || !executionPlan || executionPlan.productionStrategy !== 'reference_generate'
      || !executionPlan.renderRoute?.endsWith('/fb-poster/render') || !Array.isArray(executionPlan.unmetCriteria)
      || executionPlan.unmetCriteria.length || !Array.isArray(executionPlan.selectedAssetRefs)
      || required.some(asset => !executionPlan.selectedAssetRefs.some(ref => ref.id === asset.assetId
        && ref.contentHash === manifest.assets.find(item => item.assetId === asset.assetId)?.contentHash))
      || executionPlan.candidateCount < 1) return 'social_image_paid_render_route_not_authorized';
    const renderOutput = completedOutput(task, 'render_spec');
    const renderSpec = renderOutput?.value as SocialImageNodeValueMap['render_spec'] | undefined;
    const canvas = ['1:1', '4:5', '9:16', '16:9'].includes(task.deliverySpec.aspectRatio)
      ? socialImageCanvasForAspectRatio(task.deliverySpec.aspectRatio as '1:1' | '4:5' | '9:16' | '16:9') : null;
    const constraints = renderSpec?.layoutConstraints;
    if (!renderOutput || !linkedTo(renderOutput, executionOutput) || !renderSpec
      || !Array.isArray(renderSpec.assetInputs) || !canvas
      || renderSpec.inputHash !== socialImageV3RenderSpecInputHash(task)
      || renderSpec.aspectRatio !== task.deliverySpec.aspectRatio
      || renderSpec.width !== canvas.width || renderSpec.height !== canvas.height
      || renderSpec.providerAdapterVersion !== 'studio-fb-poster-render.v1'
      || !renderSpec.idempotencyKey?.trim() || !Array.isArray(renderSpec.textLayers)
      || !renderSpec.textLayers.some(layer => layer.role === 'headline' && layer.text === task.renderBrief?.headline)
      || constraints?.quality !== (task.deliverySpec.imageGeneration?.quality || 'low')
      || JSON.stringify(constraints?.pendingRepairs) !== JSON.stringify(task.repairInstructions
        .filter(item => item.status === 'pending').map(item => ({ id: item.id, targetLayer: item.targetLayer, instruction: item.instruction })))
      || constraints?.frozenPlanVersion !== (task.renderPlan?.version || null)
      || constraints?.frozenPlanSourceHash !== (task.renderPlan?.sourceHash || null)
      || executionPlan.candidateCount !== (task.renderPlan?.units.length || 1)
      || (multi && renderSpec.idempotencyKey !== `${task.id}:plan:${task.renderPlan!.version}`)
      || required.some(asset => !renderSpec.assetInputs.some(input => input.id === asset.assetId
        && input.contentHash === manifest.assets.find(item => item.assetId === asset.assetId)?.contentHash))) {
      return 'social_image_render_spec_stale';
    }
  }
  return null;
}

/** Binds a V3 queued unit or frozen plan to the exact current evidence generation. */
export function socialImageV3PaidEvidenceHash(task: SocialImageCreationTask, includePlanNodes = true): string {
  const outputRefs = ['business_context' as const, ...PREPARATION_NODES, 'director_brief' as const,
    ...(includePlanNodes ? PLAN_NODES.slice(1) : [])].map(nodeId => {
    const output = latestOutput(task, nodeId);
    return output ? { nodeId, id: output.id, version: output.version, status: output.status, contentHash: output.contentHash } : null;
  });
  const snapshot = task.productionRuntime?.binding?.taskContextSnapshot;
  return createHash('sha256').update(JSON.stringify({ binding: task.productionRuntime?.binding?.contentTaskVersion,
    taskContextSnapshot: snapshot ? { id: snapshot.id, snapshotVersion: snapshot.snapshotVersion,
      contentHash: snapshot.contentHash, factVersionId: snapshot.factVersionId } : null,
    outputRefs, requiredAssets: task.enterpriseAssets, materialIds: task.materialIds,
    productRefs: task.contentBrief.productRefs })).digest('hex');
}

export function socialImageV3ReferencePermitted(task: SocialImageCreationTask): boolean {
  return task.schemaVersion !== 'social-image-creation.v3'
    || (completedOutput(task, 'reference_snapshot')?.value as SocialImageNodeValueMap['reference_snapshot'] | undefined)?.rightsPolicy === 'permitted';
}

/** A V3 single-image request is reconstructed from the frozen server task, not browser JSON. */
export function socialImageV3SingleRenderInput(task: SocialImageCreationTask, jobId: string) {
  if (task.schemaVersion !== 'social-image-creation.v3'
    || task.imageType === 'carousel' || task.imageType === 'gif_poster') return null;
  const issue = socialImageV3PaidPrerequisiteIssue(task, 'execute');
  if (issue) throw new Error(issue);
  const job = task.generationJobs.find(item => item.id === jobId);
  if (!job || job.status !== 'queued' || job.inputHash || job.outputNodeIds.length
    || job.plannedInputHash !== socialImageV3PaidEvidenceHash(task)) throw new Error('social_image_paid_job_identity_invalid');
  const renderSpec = completedOutput(task, 'render_spec')?.value as SocialImageNodeValueMap['render_spec'] | undefined;
  if (!renderSpec || job.idempotencyKey !== renderSpec.idempotencyKey) throw new Error('social_image_paid_job_spec_mismatch');
  return {
    poster: structuredClone(task.renderBrief),
    imagePrompt: [task.contentBrief.coreClaim, task.contentBrief.audience.join(', '),
      task.creativeRecipe.layoutRecipe, task.creativeRecipe.imageTextRelation,
      ...task.repairInstructions.filter(item => item.status === 'pending')
        .map(item => `Targeted repair (${item.targetLayer}): ${item.instruction}`)].filter(Boolean).join('. '),
    imageQuality: task.deliverySpec.imageGeneration?.quality || 'low',
    ratio: task.deliverySpec.aspectRatio,
    materialIds: [...task.materialIds],
    productIds: [...task.contentBrief.productRefs],
    referencePlan: [],
    referenceImageUrls: task.creationPath === 'viral_replication' && socialImageV3ReferencePermitted(task)
      ? task.referenceSnapshot?.imageUrls.slice(0, 1) || [] : [],
    idempotencyKey: job.idempotencyKey,
    deliverableType: 'social_poster' as const,
    productionStrategy: 'reference_generate' as const,
    confirmedFields: {},
  };
}

/** Recomputable frozen specification identity; actual provider bytes are additionally hashed at claim. */
export function socialImageV3RenderSpecInputHash(task: SocialImageCreationTask, graph: SocialImageLayerGraph | undefined = task.layerGraph): string {
  const value = {
    taskId: task.id, contentTaskVersion: task.productionRuntime?.binding?.contentTaskVersion,
    imageType: task.imageType, creationPath: task.creationPath, contentBrief: task.contentBrief,
    renderBrief: task.renderBrief, imageTextContract: task.imageTextContract,
    deliverySpec: task.deliverySpec, enterpriseAssets: task.enterpriseAssets,
    materialIds: task.materialIds, referenceSnapshot: task.referenceSnapshot,
    layerGraph: graph, renderPlan: task.renderPlan,
    evidenceHash: socialImageV3PaidEvidenceHash(task, false),
    executionPlanHash: latestOutput(task, 'execution_plan')?.contentHash || null,
    pendingRepairs: task.repairInstructions.filter(item => item.status === 'pending')
      .map(item => ({ id: item.id, targetLayer: item.targetLayer, instruction: item.instruction })),
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Compare the exact bytes that will be sent (or composited for GIF) with the inspected manifest. */
export function socialImageV3ResolvedAssetIssue(task: SocialImageCreationTask, input: {
  productHashes: Record<string, string>;
  materialHashes: Record<string, string>;
  referenceHash: string | null;
}): string | null {
  if (task.schemaVersion !== 'social-image-creation.v3') return null;
  const manifest = completedOutput(task, 'asset_manifest')?.value as SocialImageNodeValueMap['asset_manifest'] | undefined;
  if (!manifest) return 'social_image_asset_manifest_required';
  for (const asset of task.enterpriseAssets.filter(item => item.required)) {
    const expected = manifest.assets.find(item => item.assetId === asset.assetId && item.role === asset.role)?.contentHash;
    const actual = asset.source === 'enterprise_knowledge_base' ? input.productHashes[asset.assetId]
      : input.materialHashes[asset.assetId];
    if (!expected || expected !== actual) return 'social_image_required_asset_bytes_changed';
  }
  if (task.creationPath === 'viral_replication') {
    const reference = completedOutput(task, 'reference_snapshot')?.value as SocialImageNodeValueMap['reference_snapshot'] | undefined;
    if (!reference?.imageAssetRef?.contentHash || reference.imageAssetRef.contentHash !== input.referenceHash) {
      return 'social_image_reference_bytes_changed';
    }
  }
  return null;
}

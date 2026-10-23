import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageNodeEnvelope, SocialImageNodeValueMap, SocialImageVersionedRef } from '../../shared/contracts/socialImageProduction.js';
import { socialImageCanvasForAspectRatio, type SocialImageAspectRatio } from './referenceCanvas.js';
import { socialImagePlanSourceHash } from './socialImageDurablePlan.js';
import { socialImageV3PaidPrerequisiteIssue, socialImageV3RenderSpecInputHash } from './socialImagePaidPrerequisites.js';
import { recordSocialImageNodeOutput, SocialImageProductionRunError } from './socialImageProductionRun.js';
import { readSocialImageTask } from './socialImageTask.js';

type PlannerPoster = NonNullable<SocialImageCreationTask['renderBrief']>;
export interface SocialImageFormalPlannerResult {
  poster: PlannerPoster;
  caption: string;
  hashtags: string[];
  fieldsToConfirm: string[];
  provenance: string;
}

function latest(task: SocialImageCreationTask, nodeId: SocialImageNodeEnvelope<unknown>['nodeId']) {
  return task.productionRuntime?.nodeOutputs.filter(output => output.nodeId === nodeId)
    .reduce<SocialImageNodeEnvelope<unknown> | null>((current, output) => !current || output.version > current.version ? output : current, null) || null;
}

function completed(task: SocialImageCreationTask, nodeId: SocialImageNodeEnvelope<unknown>['nodeId']) {
  const output = latest(task, nodeId);
  if (!output || output.status !== 'completed' || task.productionRuntime?.nodes.find(node => node.nodeId === nodeId)?.outputRef?.id !== output.id) {
    throw new SocialImageProductionRunError(`social_image_${nodeId}_required`, 422);
  }
  return output;
}

function ref(output: SocialImageNodeEnvelope<unknown>): SocialImageVersionedRef {
  return { objectType: output.schemaVersion, id: output.id, version: output.version, contentHash: output.contentHash };
}

/** Bound plans never use browser-supplied product, platform or material descriptions. */
export function socialImageV3TrustedPlanningRequest(task: SocialImageCreationTask) {
  return {
    productInfo: task.contentBrief.productNames.map(name => `产品名称：${name}`).join('\n'),
    platform: task.deliverySpec.platform, ratio: task.deliverySpec.aspectRatio,
    posterStyle: task.imageType === 'brand_news' ? 'news-editorial'
      : task.imageType === 'experiment_comparison' ? 'comparison-proof' : 'oem-factory',
    language: task.deliverySpec.language,
    materials: task.enterpriseAssets.filter(asset => task.materialIds.includes(asset.assetId))
      .map(asset => ({ id: asset.assetId, name: asset.name, role: asset.role })),
    referenceNotes: [task.referenceSnapshot?.title || '', task.contentBrief.coreClaim,
      task.imageType].filter(Boolean).join(' · '),
    referenceCaption: task.referenceSnapshot?.caption || '',
    categoryTerms: [...task.contentBrief.productNames],
    targetMarket: task.contentBrief.audience.join(', '),
    confirmedFields: Object.fromEntries(task.contentBrief.evidenceItems.filter(item => item.source === 'user_input')
      .map(item => [item.label, item.value])),
  };
}

/** Record the actual server planner response; a browser PATCH cannot self-declare the director node. */
export async function recordSocialImageV3DirectorBrief(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number; result: SocialImageFormalPlannerResult;
}): Promise<SocialImageCreationTask> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (task.schemaVersion !== 'social-image-creation.v3') throw new SocialImageProductionRunError('social_image_v3_run_required', 409);
  const prerequisite = socialImageV3PaidPrerequisiteIssue(task, 'queue');
  if (!['social_image_director_brief_required', 'social_image_director_brief_stale'].includes(prerequisite || '')) {
    throw new SocialImageProductionRunError(prerequisite || 'social_image_director_brief_already_completed', 422);
  }
  const { poster } = input.result;
  if (!poster?.headline?.trim() || !input.result.caption?.trim()
    || !Array.isArray(input.result.hashtags) || !Array.isArray(input.result.fieldsToConfirm)) {
    throw new SocialImageProductionRunError('social_image_director_planner_result_invalid', 422);
  }
  const business = completed(task, 'business_context');
  const assets = completed(task, 'asset_manifest');
  const inputRefs = [ref(business), ref(assets), ...(task.creationPath === 'viral_replication'
    ? [ref(completed(task, 'hook_factors')), ref(completed(task, 'adaptation'))] : [])];
  const assetManifest = assets.value as SocialImageNodeValueMap['asset_manifest'];
  const evidenceRefs = [...assets.evidenceRefs, ...(task.creationPath === 'viral_replication'
    ? completed(task, 'element_inventory').evidenceRefs : [])];
  const pending = [...new Set([...task.fieldsToConfirm, ...input.result.fieldsToConfirm].map(value => value.trim()).filter(Boolean))];
  const value: SocialImageNodeValueMap['director_brief'] = {
    objective: task.contentBrief.coreClaim, singleCoreClaim: task.contentBrief.coreClaim,
    headline: poster.headline, supportingText: poster.subheadline, caption: input.result.caption, cta: poster.cta,
    requiredFacts: [task.contentBrief.coreClaim, ...task.contentBrief.evidenceItems.filter(item => item.source !== 'mock').map(item => item.value)].filter(Boolean),
    prohibitedInferences: [...new Set([...task.contentBrief.prohibitedClaims, ...assetManifest.prohibitedClaims])],
    visualMustShow: [...task.contentBrief.productNames],
    visualMustNotImply: task.contentBrief.factuality === 'mock' ? ['真实已发生的商业合作或发布'] : [],
    compositionIntent: task.creativeRecipe.layoutRecipe, imageTextRelation: task.creativeRecipe.imageTextRelation,
    visualProof: task.creativeRecipe.visualProof,
    brandAndOriginalityRules: task.creationPath === 'viral_replication'
      ? ['仅迁移参考图的通用结构，不复用竞品身份、商标、包装、原文案'] : ['产品包装和品牌身份以企业资产为准'],
    acceptanceCriteria: [
      { criterionId: 'product_identity', observableTarget: '成片产品与已核验企业图片一致', validator: 'independent_quality_check' },
      { criterionId: 'copy_accuracy', observableTarget: '可见文字与已确认的图文合同一致', validator: 'ocr_and_human_review' },
      { criterionId: 'safe_zone', observableTarget: '产品主体和标题均未越出交付画布安全区', validator: 'deterministic_preflight' },
    ],
    factorSpecRef: task.creationPath === 'viral_replication' ? ref(completed(task, 'hook_factors')) : null,
    adaptationSpecRef: task.creationPath === 'viral_replication' ? ref(completed(task, 'adaptation')) : null,
  };
  const ready = input.result.provenance === 'ai' && pending.length === 0;
  return recordSocialImageNodeOutput({ store: input.store, tenantId: input.tenantId, taskId: task.id,
    expectedVersion: task.version, nodeId: 'director_brief', status: ready ? 'completed' : 'needs_review',
    value, inputRefs, evidenceRefs, createdBy: { kind: ready ? 'agent' : 'system', id: 'studio_poster_director' },
    blockingReasons: ready ? [] : ['social_image_planner_result_requires_review'],
    taskPatch: { renderBrief: poster, imageTextContract: {
      ...task.imageTextContract, headline: poster.headline, supportingText: poster.subheadline,
      caption: input.result.caption, hashtags: input.result.hashtags, cta: poster.cta,
      requiredFacts: value.requiredFacts, prohibitedInferences: value.prohibitedInferences,
      visualMustShow: value.visualMustShow, visualMustNotImply: value.visualMustNotImply,
    }, fieldsToConfirm: pending, status: 'planned', step: ready ? 'generate' : 'plan' } });
}

/** Compile actual frozen inputs into the two versioned plan nodes before a paid claim. */
export async function compileSocialImageV3PaidPlan(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
}): Promise<SocialImageCreationTask> {
  const found = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!found) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  let task: SocialImageCreationTask = found;
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (task.schemaVersion !== 'social-image-creation.v3') throw new SocialImageProductionRunError('social_image_v3_run_required', 409);
  if (task.creationPath === 'viral_replication') throw new SocialImageProductionRunError('social_image_viral_plan_route_pending', 422);
  if (socialImageV3PaidPrerequisiteIssue(task, 'execute') === null) return task;
  const issue = socialImageV3PaidPrerequisiteIssue(task, 'queue');
  if (issue) throw new SocialImageProductionRunError(issue, 422);
  const multi = task.imageType === 'carousel' || task.imageType === 'gif_poster';
  if (multi && (!task.renderPlan || task.renderPlan.sourceHash !== socialImagePlanSourceHash(task))) {
    throw new SocialImageProductionRunError('social_image_frozen_plan_invalid', 409);
  }
  if (!multi && task.renderPlan) throw new SocialImageProductionRunError('social_image_unexpected_multi_plan', 409);
  if (task.generationJobs.some(job => ['running', 'outcome_unknown'].includes(job.status)
    || (job.status === 'queued' && (job.attempt > 0 || Boolean(job.inputHash))))) {
    throw new SocialImageProductionRunError('social_image_prior_paid_job_unresolved', 409);
  }
  const director = completed(task, 'director_brief');
  const manifest = completed(task, 'asset_manifest').value as SocialImageNodeValueMap['asset_manifest'];
  const selectedAssetRefs: SocialImageVersionedRef[] = task.enterpriseAssets.filter(asset => asset.required).map(asset => {
    const observed = manifest.assets.find(item => item.assetId === asset.assetId && item.role === asset.role);
    if (!observed || !observed.readable || observed.rights !== 'cleared') {
      throw new SocialImageProductionRunError('social_image_required_asset_evidence_invalid', 422);
    }
    return { objectType: 'enterprise-image-asset', id: observed.assetId, version: observed.version, contentHash: observed.contentHash };
  });
  const route = '/api/overseas/studio/fb-poster/render';
  const planRef: SocialImageVersionedRef[] = task.renderPlan ? [{ objectType: 'social-image-frozen-render-plan.v1',
    id: `${task.id}:plan:${task.renderPlan.version}`, version: task.renderPlan.version, contentHash: task.renderPlan.sourceHash }] : [];
  const execution: SocialImageNodeValueMap['execution_plan'] = {
    productionStrategy: 'reference_generate', selectedAssetRefs,
    assetRoles: selectedAssetRefs.map(assetRef => ({ assetRef,
      role: task.enterpriseAssets.find(asset => asset.assetId === assetRef.id)?.role || 'scene' })),
    renderRoute: route, candidateCount: task.renderPlan?.units.length || 1,
    layerPlan: [
      ...selectedAssetRefs.map((sourceRef, index) => ({ layerId: `asset-${index + 1}`, role: 'identity_reference', sourceRef })),
      { layerId: 'headline', role: 'text', sourceRef: null },
    ],
    estimatedCost: { currency: 'CNY', amount: null }, estimatedDurationSeconds: null,
    fallbackRoutes: [], unmetCriteria: [],
  };
  task = await recordSocialImageNodeOutput({ store: input.store, tenantId: input.tenantId, taskId: task.id,
    expectedVersion: task.version, nodeId: 'execution_plan', status: 'completed', value: execution,
    inputRefs: [ref(director), ...planRef], evidenceRefs: selectedAssetRefs,
    createdBy: { kind: 'agent', id: 'social_image_content_planner' } });
  const canvas = socialImageCanvasForAspectRatio(task.deliverySpec.aspectRatio as SocialImageAspectRatio);
  const pendingRepairs = task.repairInstructions.filter(item => item.status === 'pending')
    .map(item => ({ id: item.id, targetLayer: item.targetLayer, instruction: item.instruction }));
  const idempotencyKey = task.renderPlan ? `${task.id}:plan:${task.renderPlan.version}`
    : `${task.id}:render:${director.contentHash.slice(0, 24)}${pendingRepairs.length
      ? `:repair:${createHash('sha256').update(JSON.stringify(pendingRepairs)).digest('hex').slice(0, 24)}` : ''}`;
  const poster = task.renderBrief!;
  const renderSpec: SocialImageNodeValueMap['render_spec'] = {
    width: canvas.width, height: canvas.height, aspectRatio: task.deliverySpec.aspectRatio,
    assetInputs: selectedAssetRefs.map(assetRef => ({ ...assetRef,
      role: task.enterpriseAssets.find(asset => asset.assetId === assetRef.id)?.role || 'scene' })),
    layoutConstraints: { layoutRecipe: task.creativeRecipe.layoutRecipe,
      imageTextRelation: task.creativeRecipe.imageTextRelation,
      frozenPlanVersion: task.renderPlan?.version || null, frozenPlanSourceHash: task.renderPlan?.sourceHash || null,
      quality: task.deliverySpec.imageGeneration?.quality || 'low', pendingRepairs },
    textLayers: [{ role: 'headline', text: poster.headline, region: 'headline' },
      ...(poster.subheadline ? [{ role: 'supporting', text: poster.subheadline, region: 'subheadline' }] : []),
      ...(poster.cta ? [{ role: 'cta', text: poster.cta, region: 'cta' }] : [])],
    subjectConstraints: [...task.contentBrief.productNames],
    factorTargets: task.hookFactorSpec?.factors.map(factor => ({ factorId: factor.factorId,
      observableTarget: factor.validator.observableTarget })) || [],
    negativeConstraints: [...task.contentBrief.prohibitedClaims],
    providerAdapterVersion: 'studio-fb-poster-render.v1', seedPolicy: 'provider_random',
    idempotencyKey, inputHash: socialImageV3RenderSpecInputHash(task),
  };
  task = await recordSocialImageNodeOutput({ store: input.store, tenantId: input.tenantId, taskId: task.id,
    expectedVersion: task.version, nodeId: 'render_spec', status: 'completed', value: renderSpec,
    inputRefs: [ref(completed(task, 'execution_plan')), ...planRef], evidenceRefs: selectedAssetRefs,
    createdBy: { kind: 'agent', id: 'social_image_content_planner' }, taskPatch: { status: 'planned', step: 'generate' } });
  const finalIssue = socialImageV3PaidPrerequisiteIssue(task, 'execute');
  if (finalIssue) throw new SocialImageProductionRunError(finalIssue, 422);
  return task;
}

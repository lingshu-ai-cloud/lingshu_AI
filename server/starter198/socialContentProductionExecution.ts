import {assertMeasuredCaptionTiming} from './socialContentCaptionTiming.js';
import {isInternalBudgetExemptTenant} from '../lib/tenantBudgetExemption.js';
import {applyPresenterFirstBudgetRouting} from './socialContentBudgetRouting.js';
import {applyPresenterFirstBudgetDegradation} from './socialContentBudgetDegradation.js';
import { assertBoundPresenterAudio, readBoundPresenterVoice } from './socialContentBoundPresenterVoice.js';
import { prepareSocialContentProductionBudget, type ProductionBudgetReadPorts } from './socialContentProductionBudgetPreflight.js';
import type {PaidStageRequirement} from './socialContentPaidOperationPlan.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import { socialProductionSupplyAdapters } from './socialContentRecoveryAdapters.js';
import {
  assertCurrentContentExecutionActive,
  currentContentProviderReceipt,
  readCurrentContentExecutionCheckpoint,
  recordCurrentContentExecutionCheckpoint,
  recordCurrentContentProviderReceipt,
} from '../contentExecution/context.js';
import {readWeeklyReplicationAuthority} from './socialWeeklyReplicationAuthority.js';
import {assertAccountPlaybookBaselineCurrent} from './socialAccountProductionConstraints.js';
import {readWeeklySchedulerMaterialPlan} from './socialWeeklySchedulerMaterialPlan.js';
import {assertWeeklyProductionMaterialAdmission} from './socialWeeklyProductionMaterialGate.js';
import {freezeWeeklyPreSupplyHandoff,pauseWeeklyPreSupplyStage,readWeeklyPreSupplyHandoff} from './socialWeeklyPreSupplyHandoff.js';
import { persistSocialProductionWorkspace } from './socialContentProductionWorkspace.js';
import {persistInitialSocialSceneCache,initialSceneCacheInputFingerprint,initialSceneSourceHashes,type InitialSceneQualityReport} from './socialContentInitialSceneCache.js';
import {buildSocialProductionHandoff} from './socialContentProductionHandoff.js';
import { createProductionBudgetRuntimeReaders } from './socialContentProductionBudgetRuntimeReaders.js';
import { createSocialContentMaterialPaidContext, type SocialMaterialPaidRuntimePorts } from './socialContentMaterialPaidContext.js';
import { socialContentMaterialAnalysisInputs } from './socialContentMaterialAnalysisInputs.js';
import {ensureStrictPresenterFirstFrames} from './socialContentPresenterFirstFrameRuntime.js';
import { createProductionBudgetRouteReaders } from './socialContentProductionBudgetRoutes.js';
import { createSocialContentPaidRuntimePorts } from './socialContentPaidRuntimePorts.js';
import { prepareSocialContentWholeVoice, type PreparedWholeVoice } from './socialContentPreparedWholeVoice.js';
import { socialDirectorSpokenNarration } from './socialContentDirectorHandoff.js';
import { createNativeStudioVoicePaidContext } from '../lib/studioNativeVoicePaidContext.js';
import type { ProductPaidContext } from './socialContentProductPaidContext.js';
import {assertStoredWeeklyProductionCoverage} from '../runtime/weeklyProductionCoverageAdmission.js';
import {readWeeklyTemplateStructure} from '../socialPrograms/weeklyTemplateStructure.js';
import {contentTemplateOutputMatches} from '../../shared/socialContentTemplateStructure.js';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type { SocialAssetSupplyPlan, SocialContentTaskBrief, SocialContentTaskDetail, SocialContentThemeId, SocialProductionResult, SocialTaskSource } from '../../shared/contracts/socialContentWorkflow.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';
import { automationBgmAudio, automationBgmCatalog, readTenantEnterpriseProfile, synthesizeStudioVoiceForAutomation } from '../lib/socialContentLegacyPorts.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import { objectStorageEnabled, objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { createSocialContentArtifact } from './socialContentOutputs.js';
import { archiveGeneratedSocialContentFile, registerSocialContentFile, socialContentFileDownloadUrl, storeTransientSocialContentFile, type SocialContentBackendFilePort } from './socialContentFiles.js';
import { materializeSocialContentCloudMaterial, socialContentCloudMaterialRecordId, type SocialContentCloudMaterialPort } from './socialContentMaterialAccess.js';
import { withSocialContentRenderWorkspace } from './socialContentRenderWorkspace.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import {
  freezeSocialScriptBaseline,
  parseStoredSocialScriptBaseline,
  SOCIAL_SCRIPT_GROUNDING_VERSION,
  verifiedSocialScriptContext,
  type StoredSocialScriptBaseline,
} from './socialContentScriptBaseline.js';
import { resolveSocialContentFormulaReference } from './socialContentFormulas.js';
import { runOutsideSocialContentMutationScope } from './socialContentMutation.js';
import { resolveSocialInspirationScript, resolveSocialTaskReferenceScript } from './socialContentScriptSources.js';
import { socialExecutionExternalCost } from './socialContentAgentWorkflow.js';
import {
  buildSocialProductionPlan,
  type SocialProductionAsset,
  type SocialProductionPlan,
} from './socialContentProductionPlan.js';
import { evaluateSocialReplicationResult } from './replicationEvaluationAdapter.js';
import {
  executeSocialAssetSupplyPlan,
  type SocialAssetSupplyExecution,
  type SocialAssetSupplyProviderAdapter,
} from './socialContentAssetSupplyExecution.js';
import { createConfiguredSocialAiVisualAdapter } from './socialContentAiVisualAdapter.js';
import { createSocialProductSceneAdapter } from './socialContentProductSceneAdapter.js';
import { createEnvironmentSeedanceProductScenePorts } from './socialContentSeedanceProductScene.js';
import { createSocialDigitalPresenterAdapter } from './socialContentDigitalPresenterAdapter.js';
import { createEnvironmentSocialSeedancePresenterBridge } from './socialContentSeedancePresenterEnvironment.js';
import { createSeedancePresenterFunding } from './socialContentSeedancePresenterFunding.js';
import { createEnvironmentSocialHeyGenBridge } from './socialContentHeyGenBridge.js';
import {createWholeTrackSocialHeyGenBridge} from './socialContentWholeTrackHeyGenBridge.js';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {preparePresenterMotherSupply} from './presenterMotherSupplyBridge.js';
import type {PresenterMotherExecutionResult} from './presenterMotherSegmentExecution.js';
import {automaticallyConfirmPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval,type PresenterFirstFrameApprovalContract} from './socialContentPresenterFirstFrameApproval.js';
import type {FrozenPresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {heyGenRuntimeRouteEvidence,readTrustedHeyGenRuntimeBinding} from './socialContentHeyGenRuntimeBinding.js';
import { replicationExecutionGaps, selectPresenterExecutions, verifyNamedPresenterLock, type PresenterExecutionSelection } from './socialContentPresenterExecutionPolicy.js';
import { socialDirectorFrozenDirection, buildSocialDirectorPlan, parseStoredSocialDirectorPlan, publicSocialDirectorPlanSummary, reviseSocialDirectorPlanForVoiceoverFit, socialDirectorContentHandoff, socialDirectorHandoffWithBoundVoice, socialDirectorCoverTimestamp, socialDirectorRenderTimeline, socialDirectorVoiceAlignedCaptionCues, socialDirectorScriptText, type SocialDirectorBgmSelection, type SocialDirectorBgmTrack, type SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import { latestSocialDirectorPlanVersion, persistSocialDirectorPlanVersion, resolveSocialDirectorArtifactLineage } from './socialContentDirectorPlanVersions.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { socialProductionReferenceFidelityFailures, socialProductionCollaborationFailures, socialProductionCollaborationTrace, socialProductionExecutionSceneForFinal } from './socialContentProductionCollaboration.js';
import { socialContentReviewAdmissionAllowed } from './socialContentTestBypass.js';
import { voiceLearningReadiness } from '../videoProduction/voiceQualityLearning.js';
import {
  analyzeSocialProductionAssetsWithCheckpoint,
  narrationReceiptRequiresRecovery,
  readNarrationAudioCheckpoint,
  recordNarrationAudioCheckpoint,
  restoreSocialAssetSupplyCheckpointAssets,
  socialAssetSupplyCheckpointInputHash,
} from './socialContentProductionCheckpoints.js';
import { generatedAssetArchive } from '../lib/generatedAssetArchive.js';
const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as { composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }> };
import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, systemThemeGraphicAssets, applyZeroAssetTruthSafeNarration, socialReviewRevisionDirective, applySocialReviewRevision, createVideoCover } from './socialContentAutoProduction.js';
import { AUTO_SCHEMA, analyzeProductionAssets, existingAssetSupplyAdapters, finishExecution, productionAdaptation, resolveLockedBgm, selectDirectorBgm, writeExecutionStage } from './socialContentAutoProduction.js';
export interface SocialContentAutoProductionRuntime {
  productionBudgetReadPorts?: ProductionBudgetReadPorts;
  materialPaidRuntimePorts?: SocialMaterialPaidRuntimePorts;
  productPaidRuntimePorts?: Pick<ProductPaidContext, 'assertProviderBinding' | 'measureInputTokens' | 'measureVideoOutputTokens'>;
  loadProductionAssets?: typeof taskProductionAssets;
  analyzeAssets?: typeof analyzeProductionAssets;
  selectDirectorBgm?: typeof selectDirectorBgm;
  synthesizeVoice?: typeof synthesizeStudioVoiceForAutomation;
  resolveBgm?: typeof resolveLockedBgm;
  renderComposite?: typeof composite;
  inspectVisuals?: typeof inspectRenderedVisuals;
  inspectScenes?: typeof inspectRenderedScenes;
  runFfmpeg?: typeof runVisualFfmpeg;
  createCover?: typeof createVideoCover;
  evaluateReplication?: typeof evaluateSocialReplicationResult;
  archiveGeneratedMedia?: typeof generatedAssetArchive.archiveNewMedia;
  backendFilePort?: SocialContentBackendFilePort;
  /** Local/staged compositor only. It may remove the source person, create a
   * background plate and authorized-presenter preview, run first-frame QA and
   * persist one approval contract per mother group. It must not create video. */
  preparePresenterMotherFirstFrames?: (input:{
    scope:{tenantId:string;taskId:string;runId:string;planHash:string};
    grouping:FrozenPresenterMotherSegments;
    groups:Array<{groupId:string;presenterGroupContractHash:string;presenterAssetId:string;executionKind?:'seedance_motion';compositions:Array<{referenceShotId:string;referenceFirstFrameUrl:string;background:string;framing:string;camera:string;composition:string}>}>;
    paidStatic:{requirements:PaidStageRequirement[];intents:SocialPaidOperationIntent[];permit:ReturnType<typeof createSocialContentPaidOperationPermit>};
  })=>Promise<PresenterFirstFrameApprovalContract[]>;
  evaluatePresenterMotherDynamicQa?: (input:{tenantId:string;taskId:string;runId:string;segmentId:string;segmentHash:string;presenterAssetId:string;outputPath:string;outputSha256:string;spokenText:string})=>Promise<{identitySimilarity:number;identityThreshold:number;lipSyncScore?:number|null;lipSyncThreshold?:number|null;lipSyncStatus?:'passed'|'skipped_unconfigured';receiptRef:string;reportHash:string}>;
}
type ProductionTaskDetail = NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;
export type SocialGraphApprovedContext = Pick<ProductionTaskDetail, 'version' | 'agentWorkflow' | 'assetSupplyPlan'> & { revisionPlanHash?: string };
import { executeSocialRenderStage, executeSocialQualityStage, rebindSocialGraphRenderSources, type SocialProductionGraphPhase } from './socialContentProductionStages.js';

export const SOCIAL_SHOOTING_PLAN_SCHEMA = 'social-content.shooting-plan.v1';

/** Type-aware routing is authored by the task planner, not by Content-Agent
 * candidates. Graph checkpoints created by older workers can omit these
 * execution-only fields, so bind them back from the current canonical plan
 * while keeping every other approved shot decision frozen. */
export function bindCanonicalTypeAwareRouting<T extends NonNullable<ProductionTaskDetail['assetSupplyPlan']>>(approved: T, canonical: T): T {
  const canonicalById=new Map(canonical.shots.map(shot=>[shot.shotId,shot]));
  const approvedIds=approved.shots.map(shot=>shot.shotId),canonicalIds=canonical.shots.map(shot=>shot.shotId);
  if(!canonicalIds.length||approvedIds.length!==canonicalIds.length||new Set(approvedIds).size!==approvedIds.length
    ||new Set(canonicalIds).size!==canonicalIds.length||canonicalIds.some(id=>!id)
    || socialRequestHash([...approvedIds].sort())!==socialRequestHash([...canonicalIds].sort()))throw Error('type_aware_frozen_scene_set_changed');
  const shots=approved.shots.map(shot=>{
    const authority=canonicalById.get(shot.shotId);
    if(!authority?.materialRouting)throw Error(`type_aware_canonical_routing_missing:${shot.shotId}`);
    const generatesProduct=authority.sourceStrategy==='aigc_product_scene_replication';
    const eligibleProduct=canonical.materialRoutingPolicyVersion==='type-aware.v2'&&authority.materialRouting.productGenerationDecision?.state==='eligible';
    if(generatesProduct&&!authority.productSceneReplication)throw Error(`type_aware_canonical_product_spec_missing:${shot.shotId}`);
    const {productSceneReplication:_staleProductSpec,...approvedShot}=structuredClone(shot);
    const realLocalRoute=authority.materialRouting.policy==='local_only'&&(authority.materialRouting.materialType!=='product'||canonical.materialRoutingPolicyVersion==='type-aware.v2');
    const matchedRefs=realLocalRoute?authority.materialRouting.localMatch.sourceRefs:[];
    const matchedSegment=realLocalRoute&&authority.selectedMaterialSegment&&matchedRefs.includes(authority.selectedMaterialSegment.sourceRef)
      ?structuredClone(authority.selectedMaterialSegment):undefined;
    return {...approvedShot,
      ...(realLocalRoute?{sourceStrategy:'customer_real_asset' as const,sourceRefs:[...matchedRefs],
        fallbackSourceStrategy:null,selectedMaterialSegment:matchedSegment}:{}),
      materialRouting:structuredClone(authority.materialRouting),
      ...(generatesProduct||eligibleProduct?{productSceneReplication:structuredClone(authority.productSceneReplication!)}:{})};
  });
  if(shots.some(shot=>!shot.materialRouting))throw Error('type_aware_frozen_routing_incomplete');
  if(shots.some(shot=>shot.sourceStrategy==='aigc_product_scene_replication'&&!shot.productSceneReplication)
    ||shots.some(shot=>shot.sourceStrategy!=='aigc_product_scene_replication'&&shot.productSceneReplication&&!(canonical.materialRoutingPolicyVersion==='type-aware.v2'&&shot.materialRouting?.productGenerationDecision?.state==='eligible')))throw Error('type_aware_frozen_product_contract_incomplete');
  return {...structuredClone(approved),materialRoutingPolicyVersion:canonical.materialRoutingPolicyVersion,shots} as T;
}

export function assertCompleteTypeAwareExecutionPlan(plan: NonNullable<ProductionTaskDetail['assetSupplyPlan']>, expectedShotIds?: readonly string[]) {
  const actualIds=plan.shots.map(shot=>shot.shotId);
  if(!actualIds.length||actualIds.some(id=>!id)||new Set(actualIds).size!==actualIds.length
    ||(expectedShotIds&&(expectedShotIds.length!==actualIds.length||new Set(expectedShotIds).size!==expectedShotIds.length
      ||socialRequestHash([...expectedShotIds].sort())!==socialRequestHash([...actualIds].sort()))))throw Error('type_aware_execution_scene_set_invalid');
  const missingRoute=plan.shots.find(shot=>!shot.materialRouting);
  if(missingRoute)throw Error(`type_aware_execution_routing_missing:${missingRoute.shotId}`);
  const generatedProducts=plan.shots.filter(shot=>shot.sourceStrategy==='aigc_product_scene_replication');
  const missingSpec=generatedProducts.find(shot=>shot.materialRouting?.materialType!=='product'||!shot.productSceneReplication);
  if(missingSpec)throw Error(`type_aware_execution_product_spec_missing:${missingSpec.shotId}`);
  const staleSpec=plan.shots.find(shot=>shot.sourceStrategy!=='aigc_product_scene_replication'&&shot.productSceneReplication);
  if(staleSpec)throw Error(`type_aware_execution_product_spec_unexpected:${staleSpec.shotId}`);
}

export type SocialGeneratedShotArchiveCandidate = {
  sceneId: string;
  assetGenerationKind: 'product_scene' | 'concept_visual' | 'motion_graphics';
  asset: SocialProductionAsset;
  execution: SocialAssetSupplyExecution['shots'][number];
};

/** Select only media created by this supply run. Customer uploads, licensed
 * stock and digital presenters already have their own ownership/archive path
 * and must not be duplicated into the non-person generation collection. */
export function socialGeneratedShotArchiveCandidates(input: {
  assets: SocialProductionAsset[];
  execution: SocialAssetSupplyExecution | null;
}): SocialGeneratedShotArchiveCandidate[] {
  if (!input.execution) return [];
  const assets = new Map(input.assets.map(asset => [asset.id, asset]));
  return input.execution.shots.flatMap(execution => {
    if (!execution.provenance.synthetic) return [];
    const assetGenerationKind = execution.sourceStrategy === 'aigc_product_scene_replication'
      ? 'product_scene' as const
      : execution.sourceStrategy === 'non_evidentiary_ai_visual'
        ? 'concept_visual' as const
        : ['motion_graphics', 'verified_fact_card'].includes(execution.sourceStrategy)
          ? 'motion_graphics' as const
          : null;
    if (!assetGenerationKind) return [];
    const asset = assets.get(execution.assetId);
    return asset ? [{ sceneId: execution.sceneId, assetGenerationKind, asset, execution }] : [];
  });
}

function archiveMimeType(asset: SocialProductionAsset): string {
  if (asset.type === 'image') {
    const ext = path.extname(asset.localPath || asset.url).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  }
  return path.extname(asset.localPath || asset.url).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
}

export async function archiveSocialGeneratedShots(input: {
  tenantId: string;
  taskId: string;
  assets: SocialProductionAsset[];
  execution: SocialAssetSupplyExecution | null;
  now?: Date;
  archiveMedia?: typeof generatedAssetArchive.archiveNewMedia;
}): Promise<void> {
  const adoptedAt = (input.now ?? new Date()).toISOString();
  for (const candidate of socialGeneratedShotArchiveCandidates(input)) {
    const { asset, execution } = candidate;
    if (!asset.localPath && !asset.objectKey) {
      throw new Error(`generated_asset_archive_media_missing:${candidate.sceneId}`);
    }
    let contentSha256 = socialText(asset.contentHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentSha256) && asset.localPath) {
      contentSha256 = createHash('sha256').update(await fsp.readFile(asset.localPath)).digest('hex');
    }
    const segment = socialObject(asset.segments[0]) ?? {};
    const providerTaskId = socialText(asset.providerTaskId || segment.providerTaskId);
    const idempotencyKey = socialText(asset.idempotencyKey || segment.idempotencyKey)
      || socialRequestHash({ taskId: input.taskId, sceneId: candidate.sceneId, assetId: asset.id });
    const generationExecutionId = providerTaskId || idempotencyKey;
    const qualityReport = segment.quality ?? null;
    const archived = await (input.archiveMedia ?? generatedAssetArchive.archiveNewMedia)({
      tenantId: input.tenantId,
      ...(asset.automaticMaterial?{automaticMaterial:asset.automaticMaterial}:{}),
      name: asset.name,
      media: {
        type: asset.type,
        ...(asset.localPath ? { localPath: asset.localPath } : {}),
        ...(asset.objectKey ? { objectKey: asset.objectKey } : {}),
        mimeType: archiveMimeType(asset),
        duration: asset.duration,
        contentSha256,
      },
      generation: {
        pipelineId: 'non_person_generation',
        assetGenerationKind: candidate.assetGenerationKind,
        pipelineVersion: 'social-content.asset-supply-execution.v1',
        executionId: generationExecutionId,
        provider: execution.providerId,
        model: socialText(segment.model) || execution.providerId,
        ...(providerTaskId ? { providerTaskId } : {}),
        idempotencyKey,
        inputFingerprint: socialRequestHash({ taskId: input.taskId, sceneId: candidate.sceneId, assetId: asset.id, idempotencyKey }),
        promptOrSpecHash: socialRequestHash({ sceneId: candidate.sceneId, segment, strategy: execution.sourceStrategy }),
        inputMaterialIds: Array.from(new Set([
          ...(execution.truthBoundary.customerEvidenceRefs ?? []),
          ...[segment.productIdentityRefs].flatMap(value => Array.isArray(value) ? value.map(socialText) : []),
        ].filter(Boolean))),
        ...(Number.isFinite(Number(segment.estimatedCostCny)) ? { estimatedCostCny: Number(segment.estimatedCostCny) } : {}),
        ...(typeof segment.actualCostCny === 'number' && Number.isFinite(segment.actualCostCny) && segment.actualCostCny >= 0 ? { actualCostCny: segment.actualCostCny } : {}),
      },
      lineage: { sourceTaskId: input.taskId, sourceShotId: candidate.sceneId },
      quality: {
        state: 'accepted',
        policyVersion: 'social-generated-shot.v1',
        checkedAt: adoptedAt,
        checks: [
          { key: 'provider_completed', status: 'passed', evidence: `${execution.providerId}:${providerTaskId || asset.sourceId}` },
          { key: 'truth_boundary', status: 'passed', evidence: execution.provenance.representation },
          ...(qualityReport ? [{ key: 'pipeline_quality', status: 'passed' as const, evidence: 'adapter_quality_gate_passed' }] : []),
          ...(asset.automaticMaterial?.requirement.evidenceRequirement==='product_identity'? [{key:'product_identity',status:'passed' as const,evidence:asset.automaticMaterial.independentVisualCheckRef}]:[]),
        ],
        ...(qualityReport ? { rawReport: qualityReport } : {}),
      },
      rightsScope: 'tenant_generated_reusable',
    });
    execution.archivedMaterial = {
      materialId: archived.id,
      materialRevision: contentSha256,
      generationExecutionId,
      adoptedAt,
    };
  }
}

/** Freeze the Content Agent's reviewed candidate back into the executable
 * supply plan. This makes the keyframe/range shown for review authoritative. */
export function assetSupplyPlanWithExecutionSelections(
  plan: SocialAssetSupplyPlan,
  workflow: NonNullable<SocialContentTaskDetail['agentWorkflow']>,
): SocialAssetSupplyPlan {
  const executionByScene = new Map(workflow.executionPlan.scenes.map(scene => [scene.sceneId, scene]));
  return {
    ...structuredClone(plan),
    shots: plan.shots.map(shot => {
      const execution = executionByScene.get(shot.shotId);
      if (!execution) return structuredClone(shot);
      const recommendedId = execution.recommendedCandidateIds[0];
      const candidate = execution.candidates.find(item => item.candidateId === recommendedId);
      if (!candidate) return {
        ...structuredClone(shot),
        sourceStrategy: execution.selectedSourceStrategy,
        fallbackSourceStrategy: execution.fallbackSourceStrategy,
      };
      const segment = candidate.materialSegments?.[0];
      return {
        ...structuredClone(shot),
        sourceStrategy: execution.selectedSourceStrategy,
        fallbackSourceStrategy: execution.fallbackSourceStrategy,
        ...(candidate.kind === 'capability' && !['authorized_digital_presenter', 'customer_product_image_animation'].includes(execution.selectedSourceStrategy)
          ? { sourceRefs: [] } : {}),
        ...(candidate.kind === 'asset' && candidate.sourceRef ? {
          sourceRefs: [candidate.sourceRef],
          selectedMaterialSegment: segment ? {
            sourceRef: candidate.sourceRef,
            segmentId: segment.segmentId,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
          } : null,
        } : {}),
      };
    }),
  };
}


export function typeAwareRequiredMaterialIds(plan:SocialAssetSupplyPlan|null):string[]{
  return [...new Set((plan?.shots??[]).flatMap(shot=>[
    ...shot.sourceRefs,
    ...(shot.materialRouting?.localMatch?.sourceRefs??[]),
    ...(shot.materialRouting?.generation?.productImageRefs??[]),
  ]).filter(Boolean))];
}

export function rebindDivergentLocalRoutesFromApprovedContext(input:{plan:SocialAssetSupplyPlan;approved:SocialAssetSupplyPlan;assets:ProductionAsset[]}){
  const approvedById=new Map(input.approved.shots.map(shot=>[shot.shotId,shot]));
  const usableAssets=new Map(input.assets.filter(asset=>asset.type==='video'&&Boolean(asset.localPath)&&existsSync(asset.localPath!)
    &&statSync(asset.localPath!).size>0).map(asset=>[asset.id,asset]));
  const rebindings:Array<{shotId:string;previousRefs:string[];selectedRefs:string[];approvalEvidenceRef:string;assetHashes:string[]}>=[];
  const plan={...input.plan,shots:input.plan.shots.map(shot=>{
    const route=shot.materialRouting;
    if(route?.policy!=='local_only'||route.localMatch.state!=='matched')return shot;
    const approved=approvedById.get(shot.shotId),approvedRoute=approved?.materialRouting;
    if(approvedRoute?.localMatch.sourceRefs.length===route.localMatch.sourceRefs.length
      &&approvedRoute.localMatch.sourceRefs.every(ref=>route.localMatch.sourceRefs.includes(ref)))return shot;
    if(!approved||approvedRoute?.policy!=='local_only'||approvedRoute.localMatch.state!=='matched'
      ||approvedRoute.materialType!==route.materialType||!approvedRoute.localMatch.evidenceRef
      ||!approvedRoute.localMatch.sourceRefs.length
      ||approvedRoute.localMatch.sourceRefs.some(ref=>!usableAssets.has(ref))
      ||(shot.truthBoundary.subject==='customer_factory'&&approvedRoute.localMatch.sourceRefs.some(ref=>!ref.startsWith('owned-'))))return shot;
    rebindings.push({shotId:shot.shotId,previousRefs:[...route.localMatch.sourceRefs],selectedRefs:[...approvedRoute.localMatch.sourceRefs],
      approvalEvidenceRef:approvedRoute.localMatch.evidenceRef,
      assetHashes:approvedRoute.localMatch.sourceRefs.map(ref=>usableAssets.get(ref)!.contentHash||'')});
    return {...shot,sourceStrategy:'customer_real_asset' as const,sourceRefs:[...approvedRoute.localMatch.sourceRefs],fallbackSourceStrategy:null,
      selectedMaterialSegment:approved.selectedMaterialSegment&&approvedRoute.localMatch.sourceRefs.includes(approved.selectedMaterialSegment.sourceRef)
        ?structuredClone(approved.selectedMaterialSegment):undefined,materialRouting:structuredClone(approvedRoute)};
  })};
  return{plan,rebindings};
}

/** Pure projection used by the non-rendering third option. Keeping this
 * separate from the worker makes it testable that a shooting-plan request has
 * all Director controls without touching TTS, providers or the renderer. */
export function buildSocialShootingPlanArtifactContent(
  detail: Pick<SocialContentTaskDetail, 'taskId' | 'version' | 'brief' | 'agentWorkflow' | 'referenceVideoAnalysis'>,
): Record<string, unknown> {
  const workflow = detail.agentWorkflow;
  if (!workflow) throw new Error('shooting_plan_director_brief_missing');
  const director = workflow.directorBrief;
  return {
    workflowSchema: SOCIAL_SHOOTING_PLAN_SCHEMA,
    sourceKey: `social_task_shooting_plan:${detail.taskId}`,
    contentType: 'shooting_plan',
    taskVersion: detail.version,
    title: `${detail.brief.title || '社媒内容'}·代拍清单`,
    estimatedOutputDurationSeconds: director.totalDurationSeconds,
    productionMode: 'non_rendering_checklist',
    providerCallsRequired: false,
    product: director.contentRequirements?.product ?? {
      required: Boolean(detail.brief.productRef),
      productRef: detail.brief.productRef,
      confidence: detail.brief.productRef ? 1 : 0,
      reason: detail.brief.productRef ? '任务已指定产品' : '未锁定产品，代拍可使用现场可用产品',
    },
    hook: {
      intervalSeconds: [0, Math.min(3, director.totalDurationSeconds)],
      precision: 'hook_high',
      referenceAnalysisId: director.referenceAnalysis?.analysisId ?? detail.referenceVideoAnalysis?.analysisId ?? null,
      instruction: '前三秒必须逐帧复核第一帧主体、人物动作、人物-产品-环境交互、镜头轨迹、字幕和声音触发',
    },
    scenes: director.scenes.map(scene => ({
      sceneId: scene.sceneId,
      order: scene.order,
      timing: structuredClone(scene.duration),
      purpose: scene.purpose,
      voiceover: scene.audioLayers.voiceover,
      caption: scene.audioLayers.captionIntent,
      targetVisual: scene.targetVisual,
      action: structuredClone(scene.action),
      shotLanguage: structuredClone(scene.shotLanguage),
      spaceAndContinuity: [...scene.spaceAndContinuity],
      requiredEvidence: [...scene.requiredEvidence],
      productSceneReplication: scene.productSceneReplication
        ? structuredClone(scene.productSceneReplication) : null,
      truthBoundary: structuredClone(scene.truthBoundary),
      acceptanceCriteria: [...scene.acceptanceCriteria],
      hookPrecision: scene.duration.startSeconds < 3,
    })),
    createdBy: 'content_agent',
  };
}

async function finishShootingPlanExecution(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
  backendFilePort?: SocialContentBackendFilePort;
}, artifactId: string): Promise<void> {
  await writeExecutionStage({
    ...input,
    stage: 'review_ready',
    status: 'completed',
    message: '逐镜代拍清单已生成，等待用户审核。',
    extra: { artifactId, artifactKind: 'shooting_plan' },
  });
  // Do not call the video finalizer here: an approved checklist must never be
  // scheduled for media delivery or publication. A checklist has no render
  // evidence to review, so its worker run completes when the artifact exists.
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
  if (run) await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
    status: 'completed',
    current_controller: 'system',
    pause_reason: '',
    completed_at: new Date().toISOString(),
  });
}

export async function runSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
  now?: Date;
  /** Optional providers are explicitly registered by the deployment. Missing
   * digital-human/stock/AI providers remain visible fallback attempts. */
  assetSupplyAdapters?: SocialAssetSupplyProviderAdapter[];
  /** Server-only recovery: never append submitting provider adapters. */
  assetSupplyRecoveryOnly?: boolean;
  /** Deterministic ports for worker-level tests and alternate local runtimes. */
  runtime?: SocialContentAutoProductionRuntime;
  /** Server-only canonical material storage ports; never client approval flags. */
  materialEvidencePorts?: import('../runtime/weeklyOwnedProductIdentityDemand.js').WeeklyOwnedProductIdentityPorts;
  /** Server-only phase boundary; hydration requires verified domain checkpoints. */
  graphPhase?: SocialProductionGraphPhase;
  graphApprovedContext?: SocialGraphApprovedContext;
  /** Trusted current correction grant; old artifacts cannot satisfy this execution. */
  graphCorrectionHash?: string;
}): Promise<void> {
  await assertWeeklyProductionMaterialAdmission(input,input.materialEvidencePorts?.materialPorts,input.materialEvidencePorts);
  const admissionRow=await requireSocialTask(input),admissionAuthority=socialObject(socialObject(socialJson(admissionRow.brief))?._weeklyAuthority);
  if(socialObject(socialObject(socialJson(admissionRow.brief))?._productionRevision)&&socialText(admissionRow.run_id)!==input.runId)throw new SocialContentWorkflowError('social_revision_run_superseded',409);
  if(admissionAuthority||String(admissionRow.create_idempotency_key??'').startsWith('weekly-production:')){if(!admissionAuthority)throw new SocialContentWorkflowError('weekly_production_start_authority_invalid',409);if(!input.repository.dataStore)throw new SocialContentWorkflowError('weekly_production_planning_missing',409);const pkg=socialObject(admissionAuthority.weeklyPackage) as unknown as import('../../shared/contracts/socialProgram.js').WeeklyOperatingPackage,publication=socialObject(admissionAuthority.publicationTask);if(!pkg||!publication?.publicationTaskId)throw new SocialContentWorkflowError('weekly_production_start_authority_invalid',409);await assertStoredWeeklyProductionCoverage({store:input.repository.dataStore,tenantId:input.tenantId,package:pkg,publicationTaskId:String(publication.publicationTaskId),frozenPlanning:pkg.agentPlanning});}
  let detail = await readSocialTaskDetail(input);
  if (!detail) throw new Error('社媒内容任务不存在');
  // The planner authors per-material routing only for ai_enhanced. Other
  // approaches carry the policy version for lineage but use their own
  // existing material/shooting-plan strategies and have no such contracts.
  const usesTypeAwareRouting=['type-aware.v1','type-aware.v2'].includes(detail.brief.materialRoutingPolicyVersion??'')
    &&(detail.brief.productionApproach??'ai_enhanced')==='ai_enhanced';
  const canonicalTypeAwareSupplyPlan=usesTypeAwareRouting?detail.assetSupplyPlan:null;
  if (input.graphPhase && input.graphApprovedContext) {
    detail = { ...detail, ...structuredClone(input.graphApprovedContext) };
  }
  const originalReplication=await readWeeklyReplicationAuthority(input.repository,admissionRow);
  const replicationContext=originalReplication?.context;
  if(originalReplication&&detail.agentWorkflow)detail.agentWorkflow.replicationJob=originalReplication.job;
  const frozenSchedulerPlan=await readWeeklySchedulerMaterialPlan(input.repository,admissionRow,detail);
  if(frozenSchedulerPlan)detail.assetSupplyPlan=frozenSchedulerPlan;
  else if(input.repository.dataStore){const originalRun=await input.repository.dataStore.getById<Record<string,unknown>>('workflow_runs',input.runId);if(socialObject(socialObject(socialJson(originalRun?.starter_context))?.weeklyMaterialPlan))throw new SocialContentWorkflowError('weekly_scheduler_material_plan_changed',409);}
  // Graph and weekly scheduler snapshots are applied above. Bind authoritative
  // type-aware routing last so neither older snapshot can erase the planner's
  // per-shot route/product contract before reviewedSupplyPlan is created.
  if(usesTypeAwareRouting){
    if(!detail.assetSupplyPlan||!canonicalTypeAwareSupplyPlan)throw Error('type_aware_frozen_plan_missing');
    detail.assetSupplyPlan=bindCanonicalTypeAwareRouting(detail.assetSupplyPlan,canonicalTypeAwareSupplyPlan);
  }
  const productionApproach = detail.brief.productionApproach ?? 'ai_enhanced';
  if (detail.brief.creationMode === 'viral_replication' && productionApproach !== 'shooting_plan') {
    const gaps = replicationExecutionGaps(detail);
    if (gaps.length) {
      await writeExecutionStage({ ...input, stage: 'replication_handoff_gate',
        message: '编导交接物缺少逐镜可执行证据，已停止成片制作和付费供应商调用。',
        extra: { gateVersion: '1', gaps },
      });
      throw new Error(`user_input_required:replication_handoff_blocked:${gaps
        .map(gap => `${gap.sceneId}:${gap.reasonCodes.join(',')}`).join(';')}`);
    }
  }
  const targetArtifactKind = productionApproach === 'shooting_plan' ? 'shooting_plan' : 'short_video';
  const targetWorkflowSchema = productionApproach === 'shooting_plan' ? SOCIAL_SHOOTING_PLAN_SCHEMA : AUTO_SCHEMA;
  let revisionParent = productionApproach === 'shooting_plan' ? undefined : [...detail.artifacts].reverse().find(artifact => artifact.kind === 'short_video'
    && artifact.status === 'changes_requested');
  const existing = detail.artifacts.find(artifact => artifact.origin === 'agent'
    && artifact.kind === targetArtifactKind
    && socialText(artifact.content?.workflowSchema) === targetWorkflowSchema
    && !['superseded', 'changes_requested'].includes(artifact.status)
    && (!input.graphPhase || socialObject(artifact.content?.productionWorkspaceSource)?.runId === input.runId)
    && (!input.graphCorrectionHash || socialObject(artifact.content?.productionWorkspaceSource)?.correctionHash === input.graphCorrectionHash));
  if(input.graphCorrectionHash&&!existing&&!revisionParent)revisionParent=[...detail.artifacts].reverse().find(artifact=>artifact.kind==='short_video'&&socialObject(artifact.content?.productionWorkspaceSource)?.runId===input.runId);
  if (!revisionParent && existing) {
    if (input.graphPhase) return;
    if (productionApproach === 'shooting_plan') {
      await finishShootingPlanExecution({ ...input, backendFilePort: input.runtime?.backendFilePort }, existing.artifactId);
    } else {
      await finishExecution({ ...input, backendFilePort: input.runtime?.backendFilePort, artifactId: existing.artifactId });
    }
    return;
  }
  const agentWorkflow = detail.agentWorkflow;
  if (!agentWorkflow || !socialContentReviewAdmissionAllowed({
    approved: agentWorkflow.executionPlanReview.approved,
    reasonCodes: agentWorkflow.executionPlanReview.reasonCodes,
  })) {
    const required = agentWorkflow?.executionPlanReview.requiredRevision.join('；')
      || '内容执行方案尚未通过编导逐镜审核';
    throw new Error(`user_input_required:${required}`);
  }
  let presenterExecutions: PresenterExecutionSelection[] = [];
  if (detail.brief.creationMode === 'viral_replication') {
    if (agentWorkflow.directorBrief.scenes.some(scene => scene.productionRouting?.needsPreciseLipSync
      || scene.productionRouting?.presenterIdentityReplacementRequired)) {
      const namedPresenter = await verifyNamedPresenterLock({
        store: input.repository.dataStore ?? null,
        tenantId: input.tenantId,
        name: detail.brief.requestedPresenterName,
        requestedPresenterAssetId: detail.brief.requestedPresenterAssetId,
        selectedEnterprisePresenterAssetId: detail.brief.presenterAssetId,
        provider:agentWorkflow.directorBrief.scenes.some(scene=>scene.productionRouting?.needsPreciseLipSync)?'heygen':'volcengine_ark',
        lock: agentWorkflow.directorBrief.accountPresenterLock,
      });
      if (!namedPresenter.ok) {
        await writeExecutionStage({ ...input, stage: 'presenter_stack_selection',
          message: '指定人物未能与已发布的账号人物版本唯一匹配，已停止自动付费调用。',
          extra: { policyVersion: '1', reason: namedPresenter.reason },
        });
        throw new Error(`user_input_required:presenter_identity_blocked:${namedPresenter.reason}`);
      }
    }
    const heygenBridge = input.repository.dataStore
      ? createEnvironmentSocialHeyGenBridge(input.repository.dataStore, input.tenantId)
      : null;
    const wholeFilmPresenterConfigured=['type-aware.v1','type-aware.v2'].includes(detail.brief.materialRoutingPolicyVersion||'')
      && process.env.SOCIAL_CONTENT_HEYGEN_ENABLED==='true' && process.env.HEYGEN_GENERATION_ENABLED==='true'
      && Boolean(process.env.HEYGEN_API_KEY?.trim()) && objectStorageEnabled();
    presenterExecutions = selectPresenterExecutions({
      detail,
      heygenReady: productionApproach === 'ai_enhanced' && (wholeFilmPresenterConfigured || Boolean(heygenBridge?.readiness.ready && heygenBridge.ports)),
      // Dynamic presenter I2V is registered separately from product generation.
      // Exact speech+motion remains blocked by the measured capability policy.
      seedancePresenterReady: productionApproach==='ai_enhanced'&&process.env.SEEDANCE_VIDEO_ENABLED==='true'
        &&Boolean(process.env.SEEDANCE_API_KEY?.trim())&&objectStorageEnabled(),
      // New whole-film plans authorize actual fees in preflight; the old
      // independent Studio reservation must not block this admission preview.
      budgetReady: productionApproach === 'ai_enhanced' && (wholeFilmPresenterConfigured || Boolean(heygenBridge?.readiness.ready)
        ||process.env.SEEDANCE_VIDEO_ENABLED==='true'&&Boolean(process.env.SEEDANCE_API_KEY?.trim())&&objectStorageEnabled()),
    });
    if (presenterExecutions.length) {
      await writeExecutionStage({
        ...input,
        stage: 'presenter_stack_selection',
        message: presenterExecutions.every(item => item.executionStatus === 'ready')
          ? '内容 Agent 已依据逐镜测量证据锁定人物技术栈。'
          : '逐镜人物技术栈缺少可执行证据或能力，已停止自动付费调用。',
        extra: { policyVersion: '1', presenterExecutions },
      });
      if (presenterExecutions.some(item => item.executionStatus === 'blocked')) {
        throw new Error(`user_input_required:presenter_stack_blocked:${presenterExecutions
          .filter(item => item.executionStatus === 'blocked')
          .map(item => `${item.sceneId}:${item.reasonCodes.join(',')}`).join(';')}`);
      }
    }
  }
  await writeExecutionStage({
    ...input,
    stage: 'execution_plan_approved',
    message: '内容 Agent 已提交逐镜执行方案，编导 Agent 自动审核通过，开始锁定并执行。',
    extra: {
      agentWorkflowSchema: agentWorkflow.schemaVersion,
      directorBriefId: agentWorkflow.directorBrief.directorBriefId,
      directorBriefVersion: agentWorkflow.directorBrief.version,
      executionPlanId: agentWorkflow.executionPlan.executionPlanId,
      executionPlanVersion: agentWorkflow.executionPlan.version,
      executionPlanReviewId: agentWorkflow.executionPlanReview.reviewId,
      reviewRound: agentWorkflow.executionPlan.reviewRound,
      maxReviewRounds: agentWorkflow.executionPlan.maxReviewRounds,
      plannedCostCny: socialExecutionExternalCost(agentWorkflow.executionPlan, agentWorkflow.directorBrief),
      plannedSeconds: agentWorkflow.executionPlan.scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0),
    },
  });
  const taskRecord = await requireSocialTask(input);
  if (productionApproach === 'shooting_plan') {
    await writeExecutionStage({
      ...input,
      stage: 'shooting_plan',
      message: '内容 Agent 正在把编导方案整理为逐镜代拍清单，不调用配音、数字人、IAIGC 或渲染服务。',
      extra: {
        directorBriefId: agentWorkflow.directorBrief.directorBriefId,
        sceneCount: agentWorkflow.directorBrief.scenes.length,
      },
    });
    const artifactResult = await createSocialContentArtifact({
      repository: input.repository,
      tenantId: input.tenantId,
      userId: input.userId,
      taskId: input.taskId,
      idempotencyKey: `social-shooting-plan:${input.runId}`,
      trustedAgentOrigin: true,
      now: input.now,
      backendFilePort: input.runtime?.backendFilePort,
      value: {
        kind: 'shooting_plan',
        platform: detail.brief.platforms[0] ?? null,
        language: detail.brief.languages[0] ?? null,
        origin: 'agent',
        resourceRef: null,
        content: buildSocialShootingPlanArtifactContent(detail),
      },
    });
    await finishShootingPlanExecution({ ...input, backendFilePort: input.runtime?.backendFilePort },
      artifactResult.artifact.artifactId);
    return;
  }
  let revisionNote = '';
  if (revisionParent) {
    const revisionRows = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, {
      where: { task_id: input.taskId, artifact_id: revisionParent.artifactId }, perPage: 2,
    });
    if (revisionRows.totalItems !== 1 || revisionRows.items.length !== 1) {
      throw new Error('退回成品的修订记录不完整，已停止自动重制');
    }
    revisionNote = socialText(revisionRows.items[0]?.decision_note);
  }
  const reviewDirective = revisionParent ? socialReviewRevisionDirective(revisionNote) : null;
  const profile = await readTenantEnterpriseProfile(input.tenantId).catch(() => null);
  const verifiedContext = verifiedSocialScriptContext(profile, detail.brief.productRef);
  const weeklyAuthority=socialObject(socialObject(socialJson(taskRecord.brief))?._weeklyAuthority),weeklyPackage=socialObject(weeklyAuthority?.weeklyPackage),weeklyPublication=socialObject(weeklyAuthority?.publicationTask);
  const templateBindingRef=socialObject(weeklyPublication?.contentTemplateBindingRef);
  const contentTemplateStructure=templateBindingRef?await (async()=>{if(!input.repository.dataStore)throw new SocialContentWorkflowError('content_template_storage_unavailable',409);return readWeeklyTemplateStructure(input.repository.dataStore,{tenantId:input.tenantId,programId:String(weeklyPackage?.programId),packageId:String(weeklyPackage?.packageId),packageVersion:Number(weeklyPackage?.version),publicationTaskId:String(weeklyPublication?.publicationTaskId)},templateBindingRef as unknown as import('../../shared/contracts/socialProgram.js').VersionedSocialRef);})():undefined;
  // A resumed weekly run must execute the baseline already sealed into its
  // pre-supply handoff. Re-grounding after the asset card is claimed changes
  // the evidence that authorized continuation of the original job.
  const weeklyExecutionGraphVersion=Number(weeklyPackage?.executionGraphVersion??1);
  const existingWeeklyPreSupply = weeklyExecutionGraphVersion>=2
    ? await readWeeklyPreSupplyHandoff(input.repository,input.tenantId,input.taskId)
    : null;
  let baseline = existingWeeklyPreSupply?.baseline ?? parseStoredSocialScriptBaseline(taskRecord.script_baseline);
  let initialAuthorityBaselineVersion:number|null=null;
  if(baseline&&originalReplication?.context.verifiedAccountPlaybook&&weeklyExecutionGraphVersion>=2&&!baseline.accountPlaybookConstraints){
    // Creation precedes the weekly authority binding. Such an initial script
    // cannot be a production lock until the original scheduler rules are captured.
    const {readContentExecutionJob}=await import('../contentExecution/durableQueue.js');
    const originalJob=input.repository.dataStore?await readContentExecutionJob(input.repository.dataStore,input.tenantId,input.taskId,input.runId):null;
    if(!originalJob||originalJob.providerReceipts.length||detail.artifacts.length)throw new SocialContentWorkflowError('account_playbook_baseline_revision_required',409);
    const scriptRows=await input.repository.dataStore!.list<Record<string,unknown>>('social_weekly_execution_tasks',{where:{tenant_id:input.tenantId,program_id:originalReplication.programId,package_id:originalReplication.packageId,package_version:originalReplication.packageVersion},perPage:500});
    if(scriptRows.totalItems!==scriptRows.items.length||scriptRows.items.some(row=>{const value=socialObject(socialJson(row.payload));return value?.publicationTaskId===originalReplication.publicationTaskId&&socialObject(value.schedule)?.stepKind==='script'&&value.status==='succeeded';}))throw new SocialContentWorkflowError('account_playbook_baseline_revision_required',409);
    const prior=Number(baseline.version);if(!Number.isSafeInteger(prior)||prior<1)throw new SocialContentWorkflowError('account_playbook_baseline_revision_required',409);
    initialAuthorityBaselineVersion=prior+1;baseline=null;
  }
  const factVersionKey = (value: { id: string; revision: number; contentHash: string } | null | undefined): string => (
    value ? `${value.id}\0${value.revision}\0${value.contentHash}` : ''
  );
  let executionVerifiedContext = verifiedContext;
  if (baseline?.verifiedContextSnapshot) {
    // A durable retry is the same production run. Keep the admitted enterprise
    // facts even if the user saved a newer profile while a provider was busy.
    executionVerifiedContext = structuredClone(baseline.verifiedContextSnapshot);
  } else if (baseline
    && factVersionKey(baseline.enterpriseFactVersion) !== factVersionKey(verifiedContext.factVersion)) {
    // Historic baselines without a value snapshot cannot be truthfully
    // replayed against a different fact generation. Require a new plan instead
    // of silently relabelling the old script with current enterprise facts.
    throw new SocialContentWorkflowError('social_content_enterprise_fact_replan_required', 409);
  }
  if(baseline)assertAccountPlaybookBaselineCurrent(baseline,replicationContext,detail.brief.callToAction);
  if(baseline?.contentTemplateStructure&&socialRequestHash(baseline.contentTemplateStructure)!==socialRequestHash(contentTemplateStructure))throw new SocialContentWorkflowError('content_template_structure_changed_during_production',409);
  let directorFormula: InternalSocialContentFormula | null = null;
  let staleFormulaReference = false;
  if (baseline?.formulaReference) {
    try {
      directorFormula = await resolveSocialContentFormulaReference({
        repository: input.repository,
        formulaId: baseline.formulaReference.formulaId,
        version: baseline.formulaReference.version,
      });
    } catch (error) {
      // Bundled formulas were intentionally removed. Re-ground older tasks
      // through the governed inspiration -> enterprise knowledge fallback.
      if (!(error instanceof SocialContentWorkflowError)
        || error.code !== 'social_content_formula_reference_invalid') throw error;
      baseline = null;
      staleFormulaReference = true;
    }
  }
  if (baseline?.source === 'knowledge_fallback'
    && baseline.match?.verifiedKnowledgeSource === 'none'
    && !baseline.formulaReference
    && !baseline.match?.inspirationReference
    && !baseline.match?.userProductAssociation) {
    // Older v3 baselines treated an empty tenant as a knowledge fallback and
    // then blocked on missing evidence. Re-freeze them into the governed
    // system-theme baseline so first-content tasks gain the new safe fallback.
    baseline = null;
  }
  const replicationBaselineOutdated = !existingWeeklyPreSupply && Boolean(detail.replicationScript?.shots.length
    && (baseline?.scenes.length !== detail.replicationScript.shots.length
      || detail.replicationScript.shots.some((shot, index) => (
        socialText(baseline?.scenes[index]?.voiceover) !== socialText(shot.spokenText || shot.captionText)
        || socialText(baseline?.scenes[index]?.caption) !== socialText(shot.captionText || shot.spokenText)
      ))));
  if (!baseline
    || Boolean(contentTemplateStructure && !baseline.contentTemplateStructure)
    || baseline.groundingVersion !== SOCIAL_SCRIPT_GROUNDING_VERSION
    || replicationBaselineOutdated) {
    // Compatibility path for older tasks: discard any baseline that directly
    // interpolated title/objective/product free text and re-freeze it from
    // governed formula/inspiration structure plus verified enterprise facts.
    const storedReference = socialObject(socialJson(taskRecord.formula_reference));
    const formulaId = staleFormulaReference ? '' : baseline?.formulaReference?.formulaId || socialText(storedReference?.formulaId);
    const formulaVersion = staleFormulaReference ? '' : baseline?.formulaReference?.version || socialText(storedReference?.version);
    directorFormula = formulaId && formulaVersion
      ? await resolveSocialContentFormulaReference({
          repository: input.repository,
          formulaId,
          version: formulaVersion,
        })
      : null;
    const themeId=detail.theme?.themeId;
    const inspiration = themeId
      ? detail.brief.referenceReuse ? await (async () => {
          const resolved = await resolveSocialTaskReferenceScript({tenantId: input.tenantId, themeId,
            verifiedContext: executionVerifiedContext, referenceReuse: detail.brief.referenceReuse, referenceStore: input.repository.dataStore,
            referenceSources: detail.sources.filter(source => source.status === 'active' && source.kind === 'reference_link')});
          if (!resolved) throw new SocialContentWorkflowError('social_reference_reuse_source_missing', 409);
          return resolved.match;
        })() : originalReplication?await (async()=>{
          if(!input.repository.dataStore)throw new SocialContentWorkflowError('weekly_replication_authority_unverified',409);
          const authority=socialObject(socialObject(socialJson(taskRecord.brief))?._weeklyAuthority) as unknown as Awaited<ReturnType<typeof import('../runtime/socialWeeklyProductionAuthority.js').bindWeeklyProductionAuthority>>;
          const pkg=authority.weeklyPackage,item=pkg.agentPlanning?.dispatch?.scheduleItems.find(item=>item.publicationTaskId===originalReplication.publicationTaskId),analysis=pkg.agentPlanning?.directorAnalyses.find(analysis=>analysis.analysisId===item?.directorAnalysisRef.id);
          if(!analysis)throw new SocialContentWorkflowError('weekly_production_planning_missing',409);
          const {readWeeklyReferenceSources,weeklyReferenceResolver}=await import('../runtime/socialWeeklyReferenceSource.js');
          const references=await readWeeklyReferenceSources(input.repository.dataStore,input.tenantId,authority,analysis);
          const resolved=await weeklyReferenceResolver(references)({tenantId:input.tenantId,themeId,verifiedContext:executionVerifiedContext,referenceSources:detail.sources.filter(source=>source.status==='active'&&source.kind==='reference_link')});
          if(!resolved)throw new SocialContentWorkflowError('weekly_reference_source_missing',409);return resolved.match;
        })():await resolveSocialInspirationScript({
          tenantId: input.tenantId,
          themeId,
          verifiedContext: executionVerifiedContext,
        })
      : null;
    baseline = freezeSocialScriptBaseline({
      replicationContext,
      contentTemplateStructure,
      brief: detail.brief,
      theme: detail.theme ?? null,
      formula: directorFormula,
      inspiration,
      replicationScript: detail.replicationScript ?? null,
      verifiedContext: executionVerifiedContext,
      lockedAt: new Date().toISOString(),
      previous: baseline,
    });
    if(initialAuthorityBaselineVersion!==null)baseline={...baseline,version:String(initialAuthorityBaselineVersion)};
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
      script_baseline: baseline,
      formula_reference: baseline.formulaReference ?? '',
      updated_at: new Date().toISOString(),
    });
  }
  if (!baseline) throw new Error('脚本基线生成失败，已停止自动制作');
  const initialBaseline = baseline;
  await writeExecutionStage({
    ...input,
    stage: 'director_planning',
    message: '编导 Agent 已锁定表达要求，内容 Agent 正在分析真实素材并提交逐镜执行选择。',
    extra: {
      baselineOrigin: initialBaseline.source,
      baselineVersion: initialBaseline.version,
      scriptMatchConfidence: initialBaseline.match?.confidence ?? null,
      userTextUsage: initialBaseline.match?.userTextUsage ?? 'intent_only',
    },
  });
  const weeklyPreSupply=await freezeWeeklyPreSupplyHandoff({...input,detail,baseline:initialBaseline});
  if(weeklyPreSupply&&await pauseWeeklyPreSupplyStage(input.repository,weeklyPreSupply,{ownedProductIdentity:input.materialEvidencePorts}))return;
	  await withSocialContentRenderWorkspace(async outputDir => {
	  let activeBaseline = initialBaseline;
	  const productionMode = detail.brief.productionMode ?? 'concept_preview';
	  const paidVisualProvidersAllowed = productionApproach === 'ai_enhanced';
	  const zeroAssetRoute = detail.assetSupplyPlan?.productionRoute === 'zero_asset_generation';
	  const selectedSupplyPlan = detail.assetSupplyPlan
	    ? assetSupplyPlanWithExecutionSelections(detail.assetSupplyPlan, agentWorkflow)
	    : null;
	  let reviewedSupplyPlan = selectedSupplyPlan && detail.brief.materialRoutingPolicyVersion==='type-aware.v1'
	    && !isInternalBudgetExemptTenant(input.tenantId)
	    ? applyPresenterFirstBudgetDegradation({plan:selectedSupplyPlan,workflow:agentWorkflow,
	      maximumCny:Math.min(10,Number(detail.brief.perItemBudgetCny)||10)})
	    : selectedSupplyPlan;
    if(reviewedSupplyPlan){
      reviewedSupplyPlan={...reviewedSupplyPlan,shots:reviewedSupplyPlan.shots.map(shot=>{
        const selected=presenterExecutions.find(item=>item.sceneId===shot.shotId&&item.providerId==='seedance'&&item.executionStatus==='ready');
        if(!selected)return shot;
        if(!shot.digitalHumanPlan||selected.decision.measurements.lipSyncRequired!==false
          ||typeof selected.decision.measurements.visibleSpeechSeconds!=='number'
          ||selected.decision.measurements.visibleSpeechSeconds>=.5)throw Error(`seedance_presenter_speech_contract_not_supported:${shot.shotId}`);
        return {...shot,digitalHumanPlan:{...shot.digitalHumanPlan,method:'reenact' as const,silentMotion:true}};
      })};
    }
	  const rawAssets = await (input.runtime?.loadProductionAssets ?? taskProductionAssets)({
	    tenantId: input.tenantId,
	    sources: detail.sources,
	    productRef: detail.brief.productRef,
	    themeId: detail.theme?.themeId ?? null,
	    productionMode,
	    outputDirectory: outputDir,
	    allowAuthorizedSharedLibrary: paidVisualProvidersAllowed,
	    materialLibrary: input.repository.materialLibrary,
	    requiredMaterialIds: usesTypeAwareRouting
	      ? [...new Set([...typeAwareRequiredMaterialIds(reviewedSupplyPlan),
	          ...(input.graphApprovedContext?.version===detail.version?typeAwareRequiredMaterialIds(input.graphApprovedContext.assetSupplyPlan??null):[])])] : undefined,
	  }).catch(error => {
	    if (zeroAssetRoute) return [];
	    throw error;
	  });
    if(detail.brief.materialRoutingPolicyVersion!=='type-aware.v2'&&reviewedSupplyPlan&&input.graphApprovedContext?.version===detail.version&&input.graphApprovedContext.assetSupplyPlan){
      const rebound=rebindDivergentLocalRoutesFromApprovedContext({plan:reviewedSupplyPlan,approved:input.graphApprovedContext.assetSupplyPlan,assets:rawAssets});
      reviewedSupplyPlan=rebound.plan;
      if(rebound.rebindings.length){
        const evidence={schemaVersion:'social-local-route-rebinding.v1',tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,
          approvedVersion:detail.version,rebindings:rebound.rebindings,planHash:socialRequestHash(rebound.plan)};
        const evidenceRoot=path.resolve('data/social-content-material-rebindings');
        await fsp.mkdir(evidenceRoot,{recursive:true,mode:0o700});
        await fsp.writeFile(path.join(evidenceRoot,`${socialRequestHash([input.tenantId,input.taskId,input.runId])}.json`),
          JSON.stringify({...evidence,evidenceHash:socialRequestHash(evidence)},null,2),{mode:0o600});
      }
    }
    if(usesTypeAwareRouting&&detail.brief.materialRoutingPolicyVersion!=='type-aware.v2'){
      if(!reviewedSupplyPlan)throw Error('type_aware_execution_plan_missing');
      assertCompleteTypeAwareExecutionPlan(reviewedSupplyPlan,canonicalTypeAwareSupplyPlan?.shots.map(shot=>shot.shotId));
    }
	  // Budget preparation and later alignment may project or normalize the plan.
	  // Product generation must retain the exact reviewed routing/spec snapshot
	  // that admitted this run, rather than closing over an object that another
	  // stage can mutate while the adapters execute.
	  // Analyze only assets that the reviewed execution can consume. Scanning an
	  // unrelated tenant video can add minutes, provider cost, and make a bad
	  // legacy timeline block a production that never selected that material.
	  let materialInputs = socialContentMaterialAnalysisInputs({assets: rawAssets, plan: reviewedSupplyPlan,
      policyVersion: detail.brief.materialRoutingPolicyVersion});
	  let productionAssetsToAnalyze = materialInputs.analyze;
	  const budgetRoutes = createProductionBudgetRouteReaders();
  const selectedPresenterIds = [...new Set(reviewedSupplyPlan?.shots.filter(shot => shot.sourceStrategy === 'authorized_digital_presenter'&&shot.digitalHumanPlan?.silentMotion!==true).flatMap(shot => shot.digitalHumanPlan?.presenterAssetIds?.length ? shot.digitalHumanPlan.presenterAssetIds : shot.sourceRefs || []) || [])];
  const readSelectedVoice = async () => {
    if (!selectedPresenterIds.length) return null;
    if (!input.repository.dataStore) throw Error('selected_presenter_voice_registry_missing');
    return readBoundPresenterVoice(input.repository.dataStore, input.tenantId, selectedPresenterIds);
  };
  const selectedVoice = await readSelectedVoice();
  const assertSelectedVoiceCurrent = async () => {
    await assertCurrentContentExecutionActive();
    if (socialRequestHash(await readSelectedVoice()) !== socialRequestHash(selectedVoice)) throw Error('selected_presenter_voice_changed_requires_budget_replan');
  };
  const budgetRuntimeReaders = createProductionBudgetRuntimeReaders({tenantId:input.tenantId,formula:directorFormula,readPresenterVoice:readSelectedVoice,
    frozenTrackSeconds:agentWorkflow.directorBrief.scenes.reduce((total,scene)=>total+scene.duration.endSeconds-scene.duration.startSeconds,0),
    requiresMeasuredAlignment:reviewedSupplyPlan?.shots.some(shot=>shot.sourceStrategy==='authorized_digital_presenter')});
  if(usesTypeAwareRouting&&detail.brief.materialRoutingPolicyVersion==='type-aware.v2'&&reviewedSupplyPlan){
    const allocationHash=socialRequestHash({runId:input.runId,baseline:activeBaseline,plan:reviewedSupplyPlan,
      executionPlan:agentWorkflow.executionPlan,maximumCny:detail.brief.perItemBudgetCny??15});
    const saved=readCurrentContentExecutionCheckpoint<{plan:SocialAssetSupplyPlan;planHash:string}>({
      stage:'social.budget_material_routing',version:'1',inputHash:allocationHash});
    if(saved){
      if(socialRequestHash(saved.plan)!==saved.planHash)throw Error('budget_material_routing_checkpoint_invalid');
      reviewedSupplyPlan=structuredClone(saved.plan);
    }else{
      if(input.assetSupplyRecoveryOnly)throw Error('budget_material_routing_recovery_snapshot_missing');
      reviewedSupplyPlan=await applyPresenterFirstBudgetRouting({plan:reviewedSupplyPlan,workflow:agentWorkflow,
        maximumCny:Math.min(15,detail.brief.perItemBudgetCny??15),quote:async candidate=>{
          const candidateInputs=socialContentMaterialAnalysisInputs({assets:rawAssets,plan:candidate,policyVersion:'type-aware.v2'});
          const quote=await prepareSocialContentProductionBudget({repository:input.repository,tenantId:input.tenantId,
            taskId:input.taskId,runId:input.runId,baseline:activeBaseline,assets:candidateInputs.analyze,
            localSupplyAssets:candidateInputs.productReferences,supplyPlan:candidate,graphApprovedContext:input.graphApprovedContext,
            quoteOnly:true,ports:{...budgetRuntimeReaders,...budgetRoutes,
              resolveBoundRoute:requirement=>['tts','tts_fallback','voice_clone','voice_asr','voice_alignment'].includes(requirement.stage)
                ?budgetRuntimeReaders.resolveBoundRoute!(requirement):budgetRoutes.resolveBoundRoute(requirement),
              ...input.runtime?.productionBudgetReadPorts}});
          if(quote.status!=='quoted')throw Error('whole_film_readonly_quote_required');
          return quote;
        }});
      await recordCurrentContentExecutionCheckpoint({stage:'social.budget_material_routing',version:'1',inputHash:allocationHash,
        payload:{plan:reviewedSupplyPlan,planHash:socialRequestHash(reviewedSupplyPlan)}});
    }
    assertCompleteTypeAwareExecutionPlan(reviewedSupplyPlan,canonicalTypeAwareSupplyPlan?.shots.map(shot=>shot.shotId));
    materialInputs=socialContentMaterialAnalysisInputs({assets:rawAssets,plan:reviewedSupplyPlan,policyVersion:'type-aware.v2'});
    productionAssetsToAnalyze=materialInputs.analyze;
  }
	  const frozenReviewedSupplyPlan = reviewedSupplyPlan ? structuredClone(reviewedSupplyPlan) : null;
	  const productionBudget = await prepareSocialContentProductionBudget({repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,baseline:activeBaseline,assets:productionAssetsToAnalyze,localSupplyAssets:materialInputs.productReferences,supplyPlan:reviewedSupplyPlan,graphApprovedContext:input.graphApprovedContext,recoveryOnly:input.assetSupplyRecoveryOnly,ports:{...budgetRuntimeReaders,...budgetRoutes,resolveBoundRoute: requirement => ['tts','tts_fallback','voice_clone','voice_asr','voice_alignment'].includes(requirement.stage) ? budgetRuntimeReaders.resolveBoundRoute!(requirement) : budgetRoutes.resolveBoundRoute(requirement),...input.runtime?.productionBudgetReadPorts,
      preparePresenterFirstFrameReviews:async({scope,groups,requirements,intents,paidPermit})=>{
        if(!groups.length)return;
        const referenceAnalysis=detail.referenceVideoAnalysis;
        if(!referenceAnalysis)throw Error('presenter_first_frame_reference_analysis_missing');
        if(!input.runtime?.preparePresenterMotherFirstFrames)throw Error('presenter_first_frame_preparation_port_missing');
        const directorById=new Map(agentWorkflow.directorBrief.scenes.map(scene=>[scene.sceneId,scene]));
        const baselineById=new Map(activeBaseline.scenes.map(scene=>[scene.sceneId,scene]));
        const speechGroups=groups.filter(group=>group.executionKind!=='seedance_motion');
        const emptyGrouping={schemaVersion:'presenter-mother-segments.v1' as const,taskId:input.taskId,referenceAnalysisHash:socialRequestHash(referenceAnalysis),sourceSlotCount:agentWorkflow.directorBrief.scenes.length,groups:[]};
        const grouping=speechGroups.length?freezePresenterMotherSegments({taskId:input.taskId,referenceAnalysisHash:socialRequestHash(referenceAnalysis),slots:agentWorkflow.directorBrief.scenes.map(scene=>{const frozen=speechGroups.find(group=>group.shotIds.includes(scene.sceneId));return{slotId:scene.sceneId,referenceShotId:scene.referenceShotId||scene.sceneId,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds,spokenText:baselineById.get(scene.sceneId)?.voiceover||baselineById.get(scene.sceneId)?.narration||'',materialType:frozen?'talking_head':'unknown',frontFacing:Boolean(frozen),lipSyncRequired:Boolean(frozen)};})}):{...emptyGrouping,recordHash:socialRequestHash(emptyGrouping)};
        const referenceById=new Map(referenceAnalysis.shots.map(shot=>[shot.shotId,shot]));
        const approvalGroups=groups.map(frozen=>({groupId:frozen.groupId,presenterGroupContractHash:frozen.contractHash,presenterAssetId:frozen.presenterAssetId,executionKind:frozen.executionKind,compositions:frozen.shotIds.map(shotId=>{const director=directorById.get(shotId),reference=director?.referenceShotId?referenceById.get(director.referenceShotId):null;if(!director||!reference?.materialEvidence?.firstFrameRef)throw Error(`presenter_first_frame_reference_composition_missing:${shotId}`);return{referenceShotId:reference.shotId,referenceFirstFrameUrl:reference.materialEvidence.firstFrameRef,background:reference.visualDescription,framing:reference.shotLanguage?.shotSize||'未确认景别',camera:reference.shotLanguage?.movement||'未确认机位',composition:reference.shotLanguage?.composition||'未确认构图'};})}));
        const reviewNodes=await input.runtime.preparePresenterMotherFirstFrames({scope,grouping,groups:approvalGroups,paidStatic:{requirements,intents,permit:paidPermit}});
        if(!input.repository.dataStore)throw Error('presenter_first_frame_automatic_confirmation_store_missing');
        const decisions=await Promise.all(reviewNodes.map(node=>automaticallyConfirmPresenterFirstFrameApproval(input.repository.dataStore!,{scope,groupId:node.groupId,expectedRecordHash:node.recordHash})));
        const reviewHash=socialRequestHash({scope,groupingHash:grouping.recordHash,nodes:reviewNodes.map(node=>node.recordHash)});
        await recordCurrentContentExecutionCheckpoint({stage:'social.presenter_first_frames',version:'2',inputHash:reviewHash,payload:{status:'automatically_confirmed_after_static_qa',groupingHash:grouping.recordHash,reviewNodes,decisionRecordHashes:decisions.map(node=>node.recordHash)}});
        await writeExecutionStage({...input,stage:'presenter_first_frames_automatically_confirmed',message:'人物母段首帧静态质检通过，系统已自动确认并继续动态生成。',extra:{groupIds:groups.map(group=>group.groupId),approvalRecordHashes:reviewNodes.map(node=>node.recordHash),decisionRecordHashes:decisions.map(node=>node.recordHash)}});
      }}});
	  const defaultPaidRuntime = productionBudget.status === 'reserved' ? createSocialContentPaidRuntimePorts({scope:productionBudget.scope,routes:budgetRoutes,assertCurrent:assertCurrentContentExecutionActive}) : undefined;
	  const materialPaidContext = productionBudget.status === 'reserved'
      && productionBudget.reserved.intents.some(operation => operation.stage.startsWith('material_'))
      ? (() => {
          return createSocialContentMaterialPaidContext({scope: productionBudget.scope,
            requirements: productionBudget.requirements, intents: productionBudget.reserved.intents,
            permit: productionBudget.paidPermit, ports: input.runtime?.materialPaidRuntimePorts ?? defaultPaidRuntime!.material});
        })() : undefined;
	  const productPaidContext: ProductPaidContext | undefined = productionBudget.status === 'reserved'
      && productionBudget.reserved.intents.some(operation => ['first_frame', 'first_frame_qa', 'video', 'video_qa'].includes(operation.stage))
      ? (() => {
          const ports = input.runtime?.productPaidRuntimePorts ?? defaultPaidRuntime?.product;
          if (!ports) throw Error('whole_film_budget_product_runtime_ports_missing');
          const video = productionBudget.reserved.intents.filter(operation => operation.stage === 'video');
          if (video.some(operation => 'outputTokens' in operation.maximumUnits) && !ports.measureVideoOutputTokens) {
            throw Error('whole_film_budget_video_usage_reader_missing');
          }
          return {scope: productionBudget.scope, requirements: productionBudget.requirements,
            routeBindings: productionBudget.routeBindings, intents: productionBudget.reserved.intents,
            permit: productionBudget.paidPermit, ...ports,
            readReservedCny(operationId) {
              const entry = productionBudget.reserved.ledger.status(productionBudget.scope)?.entries.find(row =>
                row.operationId === operationId && row.runId === productionBudget.scope.runId
                && row.planHash === productionBudget.scope.planHash && row.status !== 'rejected');
              if (!entry) throw Error('whole_film_budget_product_reservation_missing');
              return entry.reservedMicros / 1e6;
            },
            async assertRecovery(operationId) {await productionBudget.paidPermit.assertRecovery(operationId);},
          };
        })() : undefined;
	  const analyzed = await analyzeSocialProductionAssetsWithCheckpoint({
      tenantId: input.tenantId,
      assets: productionAssetsToAnalyze,
      analyze: value => (input.runtime?.analyzeAssets ?? (input.assetSupplyRecoveryOnly ? async value => {
        if (value.assets.some(asset => !asset.visualObservations.length && !asset.segments.length)) throw new Error('user_input_required:canonical_material_analysis_missing_no_paid_fallback');
        return { assets: value.assets, failures: [] };
      } : analyzeProductionAssets))({...value, paidOperationContext: materialPaidContext}),
    });
	  let assets = [...analyzed.assets, ...materialInputs.productReferences];
  let preparedWholeVoice: PreparedWholeVoice | null = null;
  let preparedWholeVoiceInput: Parameters<typeof synthesizeStudioVoiceForAutomation>[0] | null = null;
  if (productionBudget.status === 'reserved' && productionBudget.requirements.some(requirement => requirement.stage === 'voice_alignment')) {
    const direction = socialDirectorFrozenDirection({baseline: activeBaseline, formula: directorFormula, duration: 0});
    const text = socialDirectorSpokenNarration(activeBaseline.scenes.map(scene => ({voiceover:scene.voiceover || scene.narration})),activeBaseline.language);
    preparedWholeVoiceInput = {tenantId:input.tenantId,text,language:activeBaseline.language,voice:selectedVoice?.logicalVoice || direction.voiceover.voice,
      style:{preset:direction.voiceover.preset,speed:direction.voiceover.speed,pauseStyle:direction.voiceover.pauseStyle}};
    preparedWholeVoice = await prepareSocialContentWholeVoice({
      funding:{scope:productionBudget.scope,requirements:productionBudget.requirements,routeBindings:productionBudget.routeBindings,
        intents:productionBudget.reserved.intents,permit:productionBudget.paidPermit,assertCurrent:assertSelectedVoiceCurrent,voiceInput:preparedWholeVoiceInput},
      targetDuration:agentWorkflow.directorBrief.scenes.reduce((total,scene)=>total+scene.duration.endSeconds-scene.duration.startSeconds,0),
      scenes:agentWorkflow.directorBrief.scenes.map(scene=>({shotId:scene.sceneId,spokenText:activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.voiceover || activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.narration || '',durationSeconds:scene.duration.endSeconds-scene.duration.startSeconds,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds})),
      synthesize:input.runtime?.synthesizeVoice,
    });
  }

	  let assetSupplyExecution: SocialAssetSupplyExecution | null = null;
      let presenterMotherExecution:PresenterMotherExecutionResult|null=null;
      let executedSupplyPlan:SocialAssetSupplyPlan|null=null;
	  if (detail.assetSupplyPlan) {
      const originalAssetSupplyInputHash = socialAssetSupplyCheckpointInputHash({
        materialAnalysisInputHash: analyzed.inputHash,
        baselineVersion: activeBaseline.version,
        assetSupplyPlan: detail.brief.materialRoutingPolicyVersion==='type-aware.v2' ? frozenReviewedSupplyPlan! : detail.assetSupplyPlan,
        executionPlanId: agentWorkflow.executionPlan.executionPlanId,
        executionPlanVersion: agentWorkflow.executionPlan.version,
      });
      const assetSupplyInputHash=selectedVoice?socialRequestHash({originalAssetSupplyInputHash,presenterVoiceBinding:selectedVoice,wholeTrackSha256:preparedWholeVoice?.wholeTrackSha256 || null,presenterOperations:productionBudget.status==='reserved'?productionBudget.reserved.intents.filter(intent=>intent.stage==='presenter_video').map(intent=>intent.operationId).sort():[],approvedIntroPolicy:'strict-first-frame-v1'}):originalAssetSupplyInputHash;
      const supplyCheckpoint = readCurrentContentExecutionCheckpoint<{
        assetSupplyExecution: SocialAssetSupplyExecution;
        executedSupplyPlan?: SocialAssetSupplyPlan;
        selectedAssets: Array<{
          assetId: string;
          sourceId: string;
          contentHash: string | null;
          asset?: ProductionAsset;
        }>;
      }>({ stage: 'social.asset_supply', version: '1', inputHash: assetSupplyInputHash });
      const restoredAssets = supplyCheckpoint ? restoreSocialAssetSupplyCheckpointAssets({
        availableAssets: assets,
        selectedAssets: supplyCheckpoint.selectedAssets,
      }) : null;
      const assetSupplyCheckpointReused = Boolean(supplyCheckpoint && restoredAssets);
      if (assetSupplyCheckpointReused && supplyCheckpoint) {
        assets = restoredAssets as ProductionAsset[];
        assetSupplyExecution = structuredClone(supplyCheckpoint.assetSupplyExecution);
        executedSupplyPlan = supplyCheckpoint.executedSupplyPlan
          ? structuredClone(supplyCheckpoint.executedSupplyPlan)
          : null;
        presenterMotherExecution=(supplyCheckpoint as typeof supplyCheckpoint&{presenterMotherExecution?:PresenterMotherExecutionResult}).presenterMotherExecution??null;
      } else {
        await assertWeeklyProductionMaterialAdmission(input,input.materialEvidencePorts?.materialPorts,input.materialEvidencePorts);
        // Whole-track scenes require an explicitly frozen audio-driven video consumer.
        // The legacy environment bridge submits text and its separate budget.
        const environmentPresenter = paidVisualProvidersAllowed && input.repository.dataStore
          ? preparedWholeVoice && productionBudget.status==='reserved'
            ? {ports:createWholeTrackSocialHeyGenBridge({store:input.repository.dataStore,prepared:preparedWholeVoice,
                taskVersion:String(taskRecord.version),apiKey:process.env.HEYGEN_API_KEY||'',
                funding:{scope:productionBudget.scope,requirements:productionBudget.requirements,routeBindings:productionBudget.routeBindings,
                  intents:productionBudget.reserved.intents,permit:productionBudget.paidPermit,assertCurrent:assertCurrentContentExecutionActive,
                  readReservedCny(operationId){
                    const entry=productionBudget.reserved.ledger.status(productionBudget.scope)?.entries.find(row=>row.operationId===operationId&&row.runId===productionBudget.scope.runId&&row.planHash===productionBudget.scope.planHash&&row.status!=='rejected');
                    if(!entry)throw Error('whole_track_heygen_reservation_missing');return entry.reservedMicros/1e6;
                  },
                  async assertLivePresenter(route,request,credentialSha256){
                    const binding=await readTrustedHeyGenRuntimeBinding({tenantId:input.tenantId,presenterAssetId:request.presenter.presenterAssetId,expectedVersion:request.presenter.assetVersion},{store:input.repository.dataStore!,assertCurrent:assertCurrentContentExecutionActive});
                    if(!binding||binding.credentialSha256!==credentialSha256||binding.avatarId!==request.presenter.providerPresenterId||binding.voiceId!==request.presenter.providerVoiceId||binding.authorizationRef!==request.presenter.authorizationRef||binding.consentRef!==request.presenter.consentRef||binding.model!==route.model||binding.accountRef!==route.accountRef||route.routeEvidenceRef!==heyGenRuntimeRouteEvidence(binding))throw Error('whole_track_heygen_approved_person_changed');
                  },
                }})}
            : createEnvironmentSocialHeyGenBridge(input.repository.dataStore, input.tenantId)
          : null;
        const existingAdapters = existingAssetSupplyAdapters().filter(adapter => (
          paidVisualProvidersAllowed
            || adapter.adapterId === 'existing_customer_asset.v1'
            || (productionApproach === 'material_polish' && adapter.adapterId === 'system_safe_motion_graphics.v1')
        ));
        const motionSelections=presenterExecutions.filter(selection=>selection.providerId==='seedance');
        const motionAdapters=[] as ReturnType<typeof createSocialDigitalPresenterAdapter>[];
        if(motionSelections.length){
          if(productionBudget.status!=='reserved'||!input.repository.dataStore||!defaultPaidRuntime)throw Error('seedance_presenter_whole_film_funding_missing');
          const funding=createSeedancePresenterFunding({scope:productionBudget.scope,requirements:productionBudget.requirements,
            routes:productionBudget.routeBindings,intents:productionBudget.reserved.intents,permit:productionBudget.paidPermit,
            ports:input.runtime?.productPaidRuntimePorts??defaultPaidRuntime.product,
            readReservedCny(operationId){const row=productionBudget.reserved.ledger.status(productionBudget.scope)?.entries.find(entry=>entry.operationId===operationId&&entry.runId===productionBudget.scope.runId&&entry.planHash===productionBudget.scope.planHash&&entry.status!=='rejected');if(!row)throw Error('seedance_presenter_reserved_charge_missing');return row.reservedMicros/1e6;},
            persistReceipt:defaultPaidRuntime.material.persistProviderReceipt,
          });
          for(const selection of motionSelections){
            if(selection.decision.measurements.lipSyncRequired!==false)throw Error('seedance_presenter_precise_speech_unverified');
            const groupId=`presenter-motion:${selection.sceneId}`;
            const requirement=productionBudget.requirements.find(r=>r.presenterGroupId===groupId&&r.stage==='presenter_video');
            const qa=funding.bound(selection.sceneId,'video_qa');
            if(!requirement?.presenterAssetId||!requirement.presenterGroupContractHash)throw Error('seedance_presenter_frozen_group_missing');
            const confirmation=await readConfirmedPresenterFirstFrameApproval(input.repository.dataStore,{scope:productionBudget.scope,groupId,presenterGroupContractHash:requirement.presenterGroupContractHash,presenterAssetId:requirement.presenterAssetId});
            if(!confirmation)throw Error('seedance_presenter_first_frame_confirmation_missing');
            const localPath=path.resolve(MEDIA_ROOT,decodeURIComponent(confirmation.approval.compositeFirstFrameUrl.replace(/^\/media\//,'')));
            if(!localPath.startsWith(path.resolve(MEDIA_ROOT,'tenants',input.tenantId)+path.sep))throw Error('seedance_presenter_first_frame_not_owned');
            const approvedFirstFrame={approvalRecordId:`social-presenter-first-frame-approval:${confirmation.approval.recordHash}`,approvalRecordHash:confirmation.approval.recordHash,presenterGroupContractHash:requirement.presenterGroupContractHash,url:confirmation.approval.compositeFirstFrameUrl,localPath,sha256:confirmation.approval.compositeFirstFrameSha256};
            const bridge=createEnvironmentSocialSeedancePresenterBridge({store:input.repository.dataStore,scope:productionBudget.scope,
              maximumCostCny:Math.min(15,detail.brief.perItemBudgetCny??15),qaModel:qa.route.model,
              authorizeBudget:request=>funding.authorize(request.shotId,request.maximumCostCny),assertCurrent:assertCurrentContentExecutionActive,
              beforePaidSubmit:(stage,request,body)=>funding.beforeSubmit(request.shotId,stage,body),
              recordPaidReceipt:(stage,request,receipt)=>funding.receipt(request.shotId,stage,receipt),
            });
            if(!bridge.ports)throw Error('seedance_presenter_runtime_unavailable');
            const adapter=createSocialDigitalPresenterAdapter(bridge.ports);
            motionAdapters.push({...adapter,adapterId:`seedance-presenter:${selection.sceneId}`,async execute(context){
              if(context.shot.shotId!==selection.sceneId)return null;
              if(context.shot.digitalHumanPlan?.method!=='reenact'||(context.shot.digitalHumanPlan as typeof context.shot.digitalHumanPlan&{silentMotion?:boolean}).silentMotion!==true)throw Error('seedance_presenter_frozen_motion_plan_changed');
              return adapter.execute({...context,shot:{...context.shot,approvedFirstFrame} as typeof context.shot});
            }});
          }
        }
        const presenterGroupRequirements=productionBudget.status==='reserved'?productionBudget.requirements.filter(requirement=>requirement.stage==='presenter_video'&&requirement.presenterGroupId&&!requirement.presenterGroupId.startsWith('presenter-motion:')):[];
        let motherSupply:Awaited<ReturnType<typeof preparePresenterMotherSupply>>|null=null;
        if(environmentPresenter?.ports&&presenterGroupRequirements.length&&reviewedSupplyPlan){
          const referenceAnalysis=detail.referenceVideoAnalysis,budgetScope=productionBudget.scope;
          if(!referenceAnalysis||!budgetScope)throw Error('presenter_first_frame_scope_missing');
          const directorById=new Map(agentWorkflow.directorBrief.scenes.map(scene=>[scene.sceneId,scene]));
          const baselineById=new Map(activeBaseline.scenes.map(scene=>[scene.sceneId,scene]));
          const grouping=freezePresenterMotherSegments({taskId:input.taskId,referenceAnalysisHash:socialRequestHash(referenceAnalysis),slots:agentWorkflow.directorBrief.scenes.map(scene=>{const shot=reviewedSupplyPlan.shots.find(item=>item.shotId===scene.sceneId),selected=presenterGroupRequirements.some(requirement=>requirement.presenterGroupShotIds?.includes(scene.sceneId));return{slotId:scene.sceneId,referenceShotId:scene.referenceShotId||scene.sceneId,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds,spokenText:baselineById.get(scene.sceneId)?.voiceover||baselineById.get(scene.sceneId)?.narration||'',materialType:selected?'talking_head':'unknown',frontFacing:selected,lipSyncRequired:selected};})});
          const referenceById=new Map(referenceAnalysis.shots.map(shot=>[shot.shotId,shot]));
          const approvalGroups=grouping.groups.map(group=>{const requirement=presenterGroupRequirements.find(item=>item.presenterGroupId===group.segmentId);if(!requirement?.presenterGroupContractHash||!requirement.presenterAssetId)throw Error(`presenter_first_frame_group_requirement_missing:${group.segmentId}`);return{groupId:group.segmentId,presenterGroupContractHash:requirement.presenterGroupContractHash,presenterAssetId:requirement.presenterAssetId,compositions:group.members.map(member=>{const director=directorById.get(member.slotId),reference=referenceById.get(member.referenceShotId);if(!director||!reference?.materialEvidence?.firstFrameRef)throw Error(`presenter_first_frame_reference_composition_missing:${member.slotId}`);return{referenceShotId:member.referenceShotId,referenceFirstFrameUrl:reference.materialEvidence.firstFrameRef,background:reference.visualDescription,framing:reference.shotLanguage?.shotSize||'未确认景别',camera:reference.shotLanguage?.movement||'未确认机位',composition:reference.shotLanguage?.composition||'未确认构图'};})};});
          const confirmed=await Promise.all(approvalGroups.map(group=>input.repository.dataStore?readConfirmedPresenterFirstFrameApproval(input.repository.dataStore,{scope:budgetScope,groupId:group.groupId,presenterGroupContractHash:group.presenterGroupContractHash,presenterAssetId:group.presenterAssetId}):Promise.resolve(null)));
          if(confirmed.some(item=>!item)){
            throw Error(`presenter_first_frame_confirmation_lost_after_budget_reservation:${approvalGroups.filter((_,index)=>!confirmed[index]).map(group=>group.groupId).join(',')}`);
          }
          const confirmedByGroup=new Map(confirmed.map(item=>[item!.approval.groupId,item!]));
          const underlying=createSocialDigitalPresenterAdapter(environmentPresenter.ports);
          if(!input.runtime?.evaluatePresenterMotherDynamicQa)throw Error('presenter_mother_dynamic_qa_port_missing');
          motherSupply=await preparePresenterMotherSupply({grouping,outputDirectory:path.join(outputDir,'presenter-mother'),provider:async request=>{
            const frozenRequirement=presenterGroupRequirements.find(requirement=>requirement.presenterGroupId===request.segmentId);
            if(!frozenRequirement||socialRequestHash(frozenRequirement.presenterGroupShotIds)!==socialRequestHash(request.memberSlotIds))throw Error('presenter_mother_budget_group_changed');
            const firstId=request.memberSlotIds[0]!,originalShot=reviewedSupplyPlan.shots.find(shot=>shot.shotId===firstId),originalScene=baselineById.get(firstId),director=directorById.get(firstId);
            if(!originalShot||!originalScene||!director)throw Error('presenter_mother_scene_missing');
            const visualContract=originalShot.visualContract?structuredClone(originalShot.visualContract):undefined;
            const confirmation=confirmedByGroup.get(request.segmentId);
            if(!confirmation)throw Error(`presenter_mother_confirmed_first_frame_missing:${request.segmentId}`);
            const approvedRelative=decodeURIComponent(confirmation.approval.compositeFirstFrameUrl.replace(/^\/media\//,''));
            const approvedLocalPath=path.resolve(MEDIA_ROOT,approvedRelative),approvedTenantRoot=path.resolve(MEDIA_ROOT,'tenants',input.tenantId);
            if(!approvedLocalPath.startsWith(approvedTenantRoot+path.sep))throw Error('presenter_mother_confirmed_first_frame_not_owned');
            const approvedFirstFrame={approvalRecordId:`social-presenter-first-frame-approval:${confirmation.approval.recordHash}`,approvalRecordHash:confirmation.approval.recordHash,presenterGroupContractHash:confirmation.approval.presenterGroupContractHash,url:confirmation.approval.compositeFirstFrameUrl,localPath:approvedLocalPath,sha256:confirmation.approval.compositeFirstFrameSha256};
            if(visualContract){visualContract.action.startSeconds=0;visualContract.action.endSeconds=request.durationSeconds;visualContract.action.peakSeconds=request.durationSeconds*.58;}
            const executionShot={...originalShot,shotId:request.segmentId,approvedFirstFrame,...(visualContract?{visualContract}: {})} as typeof originalShot&{approvedFirstFrame:typeof approvedFirstFrame};
            const retryIntent=productionBudget.status==='reserved'?productionBudget.reserved.intents.find(intent=>intent.stage==='presenter_video'&&intent.correction?.presenterGroupId===request.segmentId&&intent.correction.attempt===2):null;
            const result=await underlying.execute({tenantId:input.tenantId,taskId:input.taskId,...(retryIntent?{operationId:retryIntent.operationId}:{}),outputDirectory:path.join(outputDir,'presenter-mother-source'),availableAssets:assets,shot:executionShot,baselineScene:{...originalScene,sceneId:request.segmentId,voiceover:request.spokenText,narration:request.spokenText,referenceStructure:originalScene.referenceStructure?{...originalScene.referenceStructure,sourceTiming:{startSeconds:0,endSeconds:request.durationSeconds,durationSeconds:request.durationSeconds}}:undefined}});
            if(!result?.asset.localPath||!result.asset.contentHash||!result.asset.providerTaskId)throw Error('presenter_mother_provider_output_missing');
            const approvedIntro=await ensureStrictPresenterFirstFrames({tenantId:input.tenantId,runId:budgetScope.runId,groupId:request.segmentId,
              sourcePath:result.asset.localPath,sourceSha256:result.asset.contentHash,approvedPath:approvedFirstFrame.localPath,approvedSha256:approvedFirstFrame.sha256});
            const dynamicQa=await input.runtime!.evaluatePresenterMotherDynamicQa!({tenantId:input.tenantId,taskId:input.taskId,runId:budgetScope.runId,segmentId:request.segmentId,segmentHash:request.segmentHash,presenterAssetId:frozenRequirement.presenterAssetId!,outputPath:approvedIntro.outputPath,outputSha256:approvedIntro.outputSha256,spokenText:request.spokenText});
            return{providerId:result.providerId,providerReceiptRef:result.asset.providerTaskId,outputRef:approvedIntro.outputPath,outputSha256:approvedIntro.outputSha256,durationSeconds:result.asset.duration,dynamicQa};
          }});
          presenterMotherExecution=motherSupply.presenterMotherExecution;
        }
        const supplied = await executeSocialAssetSupplyPlan({
          tenantId: input.tenantId,
          taskId: input.taskId,
          outputDirectory: outputDir,
          plan: (() => {
            if (!reviewedSupplyPlan) throw Error('asset_supply_reviewed_plan_missing');
            const selected = structuredClone(reviewedSupplyPlan);
            const heygenScenes = new Set(presenterExecutions.filter(item => item.providerId === 'heygen').map(item => item.sceneId));
            return { ...selected, shots: selected.shots.map(shot => heygenScenes.has(shot.shotId)
              ? { ...shot, sourceStrategy: 'authorized_digital_presenter' as const, fallbackSourceStrategy: null }
              : shot) };
          })(),
          baseline: activeBaseline,
          availableAssets: assets,
          adapters: paidVisualProvidersAllowed ? socialProductionSupplyAdapters({
            recoveryOnly: input.assetSupplyRecoveryOnly, hasPresenterExecution: Boolean(presenterExecutions.length),
            custom: [...(input.assetSupplyRecoveryOnly?motionAdapters:[]),...(motherSupply?[motherSupply.adapter]:[]),...(input.assetSupplyAdapters ?? [])], free: existingAdapters,
            paid: () => [...motionAdapters,createSocialProductSceneAdapter(createEnvironmentSeedanceProductScenePorts({
              maximumCostCny: detail.brief.materialRoutingPolicyVersion === 'type-aware.v1' ? Math.min(10, detail.brief.perItemBudgetCny ?? 10) : undefined,
              replacementEnvironment: {
                paidContext: productPaidContext,
                dataStore: input.repository.dataStore,
                materials: input.repository.materialLibrary,
                // Bind the product executor to the same reviewed snapshot that
                // is passed into asset-supply execution. Re-reading/projecting
                // the task plan here can diverge after budget/review state is
                // persisted even though the 37-shot production input is fixed.
                frozenSupplyPlan: frozenReviewedSupplyPlan!,
                frozenSupplyPlanBinding: {planVersion:String(frozenReviewedSupplyPlan!.planVersion),planHash:socialRequestHash(frozenReviewedSupplyPlan)},
                assertCurrent: async () => {
                  const current = await requireSocialTask(input);
                  if (socialText(current.run_id) !== input.runId) throw new Error('product_replacement_run_superseded');
                },
              },
            })),
              ...(!motherSupply&&environmentPresenter?.ports ? [createSocialDigitalPresenterAdapter(environmentPresenter.ports)] : []),
              createConfiguredSocialAiVisualAdapter()],
          }) : existingAdapters,
        });
        // Only assets selected by the Director's per-shot router enter the edit.
        assets = supplied.assets;
        assetSupplyExecution = supplied.execution;
        executedSupplyPlan = supplied.plan;
        await archiveSocialGeneratedShots({
          tenantId: input.tenantId,
          taskId: input.taskId,
          assets,
          execution: assetSupplyExecution,
          now: input.now,
          archiveMedia: input.runtime?.archiveGeneratedMedia,
        });
      }
      for (const selection of presenterExecutions) {
        const receipt = assetSupplyExecution.shots.find(shot => shot.sceneId === selection.sceneId);
        const motherCrop=presenterMotherExecution?.slotCropReceipts.find(crop=>crop.slotId===selection.sceneId);
        if(motherCrop){
          if(!receipt||receipt.providerId!=='presenter_mother_segment.v1'||receipt.sourceStrategy!=='authorized_digital_presenter'||receipt.fallbackApplied||receipt.sourceRef!==`presenter-mother-crop:${motherCrop.receiptHash}`)throw new Error(`presenter_mother_receipt_mismatch:${selection.sceneId}`);
          continue;
        }
        if ((selection.providerId === 'heygen'||selection.providerId==='seedance') && (!receipt || receipt.providerId !== selection.providerId
          || receipt.sourceStrategy !== 'authorized_digital_presenter' || receipt.fallbackApplied)) {
          throw new Error(`presenter_provider_receipt_mismatch:${selection.sceneId}`);
        }
      }
      await recordCurrentContentExecutionCheckpoint({
        stage: 'social.asset_supply',
        version: '1',
        inputHash: assetSupplyInputHash,
        payload: {
          assetSupplyExecution,
          ...(executedSupplyPlan ? { executedSupplyPlan } : {}),
          presenterExecutions: presenterExecutions.map(selection => ({
            ...selection,
            receipt: assetSupplyExecution?.shots.find(shot => shot.sceneId === selection.sceneId) ?? null,
          })),
          ...(presenterMotherExecution?{presenterMotherExecution}:{}),
          selectedAssets: assets.map(asset => ({
            assetId: asset.id,
            sourceId: asset.sourceId,
            contentHash: asset.contentHash ?? null,
            asset: structuredClone(asset),
            providerId: asset.providerId ?? null,
            providerTaskId: asset.providerTaskId ?? null,
            idempotencyKey: asset.idempotencyKey ?? null,
          })),
        },
      });
	    await writeExecutionStage({
	      ...input,
	      stage: 'asset_supply_completed',
	      message: paidVisualProvidersAllowed
	        ? '内容 Agent 已逐镜完成素材库与高质量生成能力路由。'
	        : '内容 Agent 已按逐句口播完成“我的素材”片段路由，未调用 Seedance 或数字人。',
	      extra: { materialAnalysisCheckpointReused: analyzed.checkpointReused, assetSupplyCheckpointReused, assetSupplyExecution, presenterExecutions: presenterExecutions.map(selection => ({
          ...selection,
          receipt: assetSupplyExecution?.shots.find(shot => shot.sceneId === selection.sceneId) ?? null,
        })) },
	    });
	  }
  if (input.graphPhase === 'assets') return;
  if (['knowledge_fallback', 'system_theme_baseline'].includes(activeBaseline.source)
    && !activeBaseline.formulaReference
    && !activeBaseline.match?.inspirationReference) {
    const associationIdentities = new Set(assets
      .filter(asset => asset.explicitProductAssociation?.exactTaskProductMatch)
      .map(asset => asset.contentHash || asset.localPath || asset.objectKey || asset.url || asset.id));
    const requiresAssociationOnlySafety = activeBaseline.match?.verifiedKnowledgeSource === 'none';
    const materialCategoryHint = assets.flatMap(asset => asset.visualObservations).map(socialText).filter(Boolean).join(' ');
    // Exact tenant-authored product linkage is also a safe visual fallback
    // when enterprise product facts exist but no vision provider is available.
    // It authorizes using the files in an edit; it never turns filenames,
    // labels or enterprise facts into claims about what the camera saw.
    if (associationIdentities.size >= 1 && requiresAssociationOnlySafety) {
      activeBaseline = freezeSocialScriptBaseline({
        replicationContext,
        contentTemplateStructure,
        brief: detail.brief,
        theme: detail.theme ?? null,
        formula: null,
        inspiration: null,
        verifiedContext: executionVerifiedContext,
        // This is confidence in the exact tenant-authored linkage only. Visual
        // confidence remains 0 on every association-only production clip.
        userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
        materialCategoryHint,
        lockedAt: new Date().toISOString(),
        previous: activeBaseline,
      });
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
        script_baseline: activeBaseline,
        formula_reference: '',
        updated_at: activeBaseline.lockedAt,
      });
    }
  }
  let plan = buildSocialProductionPlan({ baseline: activeBaseline, assets, themeId: detail.theme?.themeId ?? null,
    ...(assetSupplyExecution?{routedSceneAssets:assetSupplyExecution.shots.map(shot=>{
      const scene=agentWorkflow.directorBrief.scenes.find(scene=>scene.sceneId===shot.sceneId);
      return {sceneId:shot.sceneId,assetId:shot.assetId,durationSeconds:scene?scene.duration.endSeconds-scene.duration.startSeconds:undefined};
    })}:{}), });
  if(!plan.ok&&assetSupplyExecution)throw new Error(`asset_supply_scene_binding_invalid:${plan.reasonCode}:${plan.message}`);
  if (!plan.ok && productionApproach !== 'material_cut') {
    if (productionMode === 'social_ready' && rawAssets.length === 0 && !assetSupplyExecution) {
      throw new Error('production_input_required:当前没有可用于正式成片的客户画面。请上传至少一段产品视频或三张产品图片；系统不会把说明卡片冒充正式成片。');
    }
    const systemAssets = await systemThemeGraphicAssets({ outputDirectory: outputDir, baseline: activeBaseline });
    assets = [...assets, ...systemAssets];
    plan = buildSocialProductionPlan({ baseline: activeBaseline, assets, themeId: detail.theme?.themeId ?? null });
    if (plan.ok) {
      plan.notes.push(productionMode === 'social_ready'
        ? '客户素材不足，内容 Agent 按已审核的零素材路线使用可追溯系统图形、口播和字幕完成正式制作。'
        : '现有素材覆盖不足，内容 Agent 按编导真实性边界使用平台安全主题图形完成预览版。');
    }
  }
  if (!plan.ok && productionApproach === 'material_cut') {
    throw new Error(`production_input_required:纯素材方案没有找到足够的逐句匹配片段。${plan.message}`);
  }
  plan.unusedAssets.push(...analyzed.failures.map(item => ({
    assetId: item.assetId,
    assetName: item.assetName,
    reason: `素材分析未通过：${item.reason}`,
  })));
  if (!plan.ok) {
    const failureSummary = analyzed.failures.length
      ? ` 未通过分析：${analyzed.failures.map(item => `${item.assetName}（${item.reason}）`).join('；')}`
      : '';
    throw new Error(`production_input_required:系统无法建立安全的零素材画面方案，请稍后自动重试。${failureSummary}`);
  }
  const explanationOnlyRoute = assetSupplyExecution?.shots.length
    && assetSupplyExecution.shots.every(shot => ['motion_graphics', 'verified_fact_card'].includes(shot.sourceStrategy));
  if (productionMode === 'social_ready'
    && detail.brief.creationMode === 'viral_replication'
    && explanationOnlyRoute) {
    throw new Error('production_input_required:当前方案只能生成说明卡片，无法达到爆款裂变的画面预期。请补充客户产品视频/图片，或明确改为“概念样片”后再生成。');
  }
  if (explanationOnlyRoute) plan = applyZeroAssetTruthSafeNarration(plan);
  if (reviewDirective) plan = applySocialReviewRevision(plan, reviewDirective);
  const adaptation = productionAdaptation(plan, assets.length);
  const directorCheckpointInputHash = socialRequestHash({
    taskId: input.taskId,
    taskVersion: detail.version,
    baselineVersion: activeBaseline.version,
    baselineLockedAt: activeBaseline.lockedAt,
    enterpriseFactVersion: activeBaseline.enterpriseFactVersion ?? null,
    executionPlanId: agentWorkflow.executionPlan.executionPlanId,
    executionPlanVersion: agentWorkflow.executionPlan.version,
    productionPlan: plan,
    assets: assets.map(asset => ({
      id: asset.id,
      sourceId: asset.sourceId,
      contentHash: asset.contentHash ?? null,
      providerTaskId: asset.providerTaskId ?? null,
    })),
    sourceVersions: Object.fromEntries(detail.sources.map(source => [source.sourceId, source.sourceVersion ?? ''])),
  });
  const directorCheckpoint = readCurrentContentExecutionCheckpoint<{
    directorPlan: unknown;
  }>({ stage: 'social.director_storyboard', version: '1', inputHash: directorCheckpointInputHash });
  const checkpointDirectorPlan = parseStoredSocialDirectorPlan(directorCheckpoint?.directorPlan);
  const taskDirectorPlan = parseStoredSocialDirectorPlan(taskRecord.director_plan);
  const recoveredDirectorVersion = taskDirectorPlan || checkpointDirectorPlan ? null : await latestSocialDirectorPlanVersion({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
  });
  const previousDirectorPlan = taskDirectorPlan ?? checkpointDirectorPlan ?? recoveredDirectorVersion?.plan ?? null;
  if (previousDirectorPlan) {
    // One-time compatibility backfill for tasks created before the immutable
    // version collection existed. A mismatched historic baseline is recorded
    // honestly as legacy_plan_only rather than attaching current facts to it.
    await persistSocialDirectorPlanVersion({
      repository: input.repository,
      tenantId: input.tenantId,
      taskId: input.taskId,
      plan: previousDirectorPlan,
    });
  }
  const defaultDirectorMood = detail.theme?.themeId === 'supplier_capability'
    ? '稳重、可信、商务'
    : detail.theme?.themeId === 'customer_case'
      ? '温暖、克制、可信'
      : '清晰、轻快、专业';
	  let directorPlan = checkpointDirectorPlan;
  if (!directorPlan) {
    const bgmSelection = await (input.runtime?.selectDirectorBgm ?? selectDirectorBgm)({
      tenantId: input.tenantId,
      themeId: detail.theme?.themeId ?? null,
      directorMood: reviewDirective?.musicMood
        || socialText(directorFormula?.direction?.music?.mood)
        || defaultDirectorMood,
      volume: Number(directorFormula?.direction?.music?.volume ?? 18),
    });
    directorPlan = buildSocialDirectorPlan({
      taskId: input.taskId,
      baseline: activeBaseline,
      productionPlan: plan,
      productionAssets: assets,
      sourceVersions: Object.fromEntries(detail.sources.map(source => [source.sourceId, source.sourceVersion ?? ''])),
      outputSpec: {
        aspectRatio: detail.brief.aspectRatio,
        resolution: '720p',
        platform: detail.brief.platforms[0] ?? 'douyin',
      },
      bgmSelection,
      formula: directorFormula,
      createdAt: new Date().toISOString(),
      previous: previousDirectorPlan,
      collaboration: {
        schemaVersion: 'social-agent-collaboration.v1',
        directorBrief: { id: agentWorkflow.directorBrief.directorBriefId, version: agentWorkflow.directorBrief.version },
        contentExecutionPlan: { id: agentWorkflow.executionPlan.executionPlanId, version: agentWorkflow.executionPlan.version, selectedBy: 'content_agent' },
        directorReview: { id: agentWorkflow.executionPlanReview.reviewId, version: agentWorkflow.executionPlanReview.version, approvedBy: 'director_agent' },
      },
    });
  }
  if(contentTemplateStructure&&!contentTemplateOutputMatches(contentTemplateStructure,activeBaseline,directorPlan))throw new SocialContentWorkflowError('content_template_output_mismatch',409);
  let persistedDirectorPlan = await persistSocialDirectorPlanVersion({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
    plan: directorPlan,
    baseline: activeBaseline,
    verifiedContext: executionVerifiedContext,
  });
  let directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
  await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
    director_plan: directorPlan,
    updated_at: directorPlan.createdAt,
  });
  let contentHandoff = socialDirectorContentHandoff(directorPlan);
  if (selectedVoice) contentHandoff = socialDirectorHandoffWithBoundVoice(contentHandoff,selectedVoice.logicalVoice);
  await recordCurrentContentExecutionCheckpoint({
    stage: 'social.director_storyboard',
    version: '1',
    inputHash: directorCheckpointInputHash,
    payload: {
      directorPlan,
      directorPlanReference: persistedDirectorPlan.reference,
      narration: contentHandoff.narration,
      scenes: contentHandoff.scenes.map(scene => ({
        sceneId: scene.sceneId,
        source: structuredClone(scene.source),
        voiceover: scene.voiceover,
        caption: scene.caption,
      })),
    },
  });
  await writeExecutionStage({
    ...input,
    stage: 'content_production',
    message: '编导方案已锁定并交给内容 Agent，正在生成配音、配乐并制作视频。',
    extra: {
      directorPlanVersion: directorPlan.version,
      directorPlanHash: directorPlan.lineageHash,
      directorPlanSummary: directorSummary,
      adaptationNotes: adaptation.notes,
      narrationChanged: adaptation.narrationChanged,
      selectedAssetCount: plan.selectedAssetIds.length,
      unusedAssetCount: plan.unusedAssets.length,
      sourceClipSeconds: plan.sourceClipSeconds,
	  directorCheckpointReused: Boolean(checkpointDirectorPlan),
	  ...(assetSupplyExecution ? { assetSupplyExecution } : {}),
      ...(revisionParent && reviewDirective ? {
        reviewRevision: {
          parentArtifactId: revisionParent.artifactId,
          feedbackHash: reviewDirective.feedbackHash,
          categories: reviewDirective.categories,
        },
      } : {}),
    },
  });
    const referenceFidelityFailures = socialProductionReferenceFidelityFailures(agentWorkflow, contentHandoff, {
      referenceAnalysis: detail.referenceVideoAnalysis,
    });
    if (referenceFidelityFailures.length) throw new Error(`director_revision_required:${referenceFidelityFailures.join(';')}`);
    let transientVoicePath = '';
    let retainVoiceForRecovery = false;
    try {
      let voice: Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>> | null = null;
      let duration = 0;
      let voiceDuration = 0;
      const preserveReferenceTimeline = (agentWorkflow.replicationJob?.referenceMode ?? agentWorkflow.directorBrief.referenceMode ?? detail.brief.referenceMode) === 'single_source_fidelity';
      let narrationCheckpointInputHash = '';
      let narrationCheckpointReused = false;
      for (let revisionAttempt = 0; revisionAttempt <= 2; revisionAttempt += 1) {
        narrationCheckpointInputHash = socialRequestHash({
          directorPlanHash: directorPlan.lineageHash,
          narration: contentHandoff.narration,
          language: contentHandoff.outputSpec.language,
          voice: selectedVoice?.logicalVoice || contentHandoff.direction.voiceover.voice,
          targetDuration: contentHandoff.outputSpec.targetDurationSeconds,
          preset: contentHandoff.direction.voiceover.preset,
          speed: contentHandoff.direction.voiceover.speed,
          pauseStyle: contentHandoff.direction.voiceover.pauseStyle,
        });
        const recoveredVoice = await readNarrationAudioCheckpoint({
          inputHash: narrationCheckpointInputHash,
          narration: contentHandoff.narration,
        });
        narrationCheckpointReused = Boolean(recoveredVoice);
        if (preparedWholeVoice && preparedWholeVoiceInput) {
          const actualInput={tenantId:input.tenantId,text:contentHandoff.narration,language:contentHandoff.outputSpec.language,voice:selectedVoice?.logicalVoice || contentHandoff.direction.voiceover.voice,
            style:{preset:contentHandoff.direction.voiceover.preset,speed:contentHandoff.direction.voiceover.speed,pauseStyle:contentHandoff.direction.voiceover.pauseStyle}};
          if(socialRequestHash(actualInput)!==socialRequestHash(preparedWholeVoiceInput))throw Error('director_voice_text_changed_requires_budget_replan');
          voice=preparedWholeVoice.voice;
          retainVoiceForRecovery=true;
          narrationCheckpointReused=true;
        } else if (recoveredVoice) {
          voice = recoveredVoice;
          retainVoiceForRecovery = true;
        } else {
          await assertCurrentContentExecutionActive();
          if (input.assetSupplyRecoveryOnly && !input.runtime?.synthesizeVoice) throw new Error('user_input_required:canonical_voice_tracks_missing_no_paid_tts');
          const ttsRequestId = `social-tts:${narrationCheckpointInputHash}`;
          const priorTtsReceipt = currentContentProviderReceipt({
            provider: 'studio_tts', requestId: ttsRequestId,
          });
          if (narrationReceiptRequiresRecovery(priorTtsReceipt?.state)) {
            // The provider has no task-status API. Failing closed is safer than
            // silently charging a second TTS request after a crash between the
            // response and the audio checkpoint.
            throw new Error('provider_submission_unknown:studio_tts');
          }
          await recordCurrentContentProviderReceipt({
            provider: 'studio_tts', requestId: ttsRequestId, state: 'submitting',
            metadata: { narrationCheckpointInputHash },
          });
          try {
            voice = await (input.runtime?.synthesizeVoice ?? synthesizeStudioVoiceForAutomation)({
              tenantId: input.tenantId,
              paidContext: productionBudget.status === 'reserved' ? createNativeStudioVoicePaidContext({
                scope: productionBudget.scope, requirements: productionBudget.requirements,
                routeBindings: productionBudget.routeBindings, intents: productionBudget.reserved.intents,
                permit: productionBudget.paidPermit, assertCurrent: assertCurrentContentExecutionActive,
                voiceInput: {tenantId: input.tenantId, text: contentHandoff.narration,
                  language: contentHandoff.outputSpec.language, voice: selectedVoice?.logicalVoice || contentHandoff.direction.voiceover.voice,
                  style: {preset: contentHandoff.direction.voiceover.preset,
                    speed: contentHandoff.direction.voiceover.speed, pauseStyle: contentHandoff.direction.voiceover.pauseStyle}},
              }) : undefined,
              text: contentHandoff.narration,
              language: contentHandoff.outputSpec.language,
              voice: selectedVoice?.logicalVoice || contentHandoff.direction.voiceover.voice,
              targetDuration: contentHandoff.outputSpec.targetDurationSeconds,
              style: {
                preset: contentHandoff.direction.voiceover.preset,
                speed: contentHandoff.direction.voiceover.speed,
                pauseStyle: contentHandoff.direction.voiceover.pauseStyle,
              },
            });
          } catch (error) {
            await recordCurrentContentProviderReceipt({
              provider: 'studio_tts', requestId: ttsRequestId, state: 'unknown',
              metadata: { narrationCheckpointInputHash },
            });
            throw error;
          }
        }
        transientVoicePath = voice.localPath || '';
        if (!voice.ok || !voice.localPath || !existsSync(voice.localPath) || !voice.cues?.length) {
          if (!voice.ok) {
            await recordCurrentContentProviderReceipt({
              provider: 'studio_tts', requestId: `social-tts:${narrationCheckpointInputHash}`,
              state: 'failed', metadata: { narrationCheckpointInputHash },
            });
          }
          throw new Error(voice.error || '口播服务未返回可用音频和字幕时间轴');
        }
        if (socialText(voice.text) !== contentHandoff.narration) {
          throw new Error('内容 Agent 返回的口播与编导方案不一致，已停止生成');
        }
        voiceDuration = Math.max(1, Number(voice.duration || voice.cues.at(-1)?.end
          || contentHandoff.outputSpec.targetDurationSeconds));
        duration = preserveReferenceTimeline ? contentHandoff.outputSpec.targetDurationSeconds : voiceDuration;
        retainVoiceForRecovery = await recordNarrationAudioCheckpoint({
          inputHash: narrationCheckpointInputHash,
          narration: contentHandoff.narration,
          voice: {
            ok: true,
            source: voice.source,
            localPath: voice.localPath,
            duration: voiceDuration,
            text: voice.text || contentHandoff.narration,
            cues: voice.cues,
            alignmentSource: voice.alignmentSource,
            qualityReport: voice.qualityReport,
          },
        }) || retainVoiceForRecovery;
        await recordCurrentContentProviderReceipt({
          provider: 'studio_tts', requestId: `social-tts:${narrationCheckpointInputHash}`,
          state: 'completed',
          metadata: { narrationCheckpointInputHash, duration: voiceDuration, filmDuration: duration },
        });
        if (voiceDuration <= contentHandoff.outputSpec.maximumDurationSeconds + 0.25) break;
        if(preparedWholeVoice)throw Error('director_revision_required:whole_track_speech_exceeds_frozen_film_requires_formal_replan');
        if (revisionAttempt >= 2) {
          throw new Error(`director_revision_required:口播经过 2 次编导内部压缩仍为 ${voiceDuration.toFixed(1)} 秒，超过锁定素材 ${contentHandoff.outputSpec.maximumDurationSeconds.toFixed(1)} 秒`);
        }
        await writeExecutionStage({
          ...input,
          stage: 'director_revision_required',
          message: '实际口播超过素材时长，已退回编导 Agent 内部压缩；无需用户补填。',
          extra: {
            directorPlanId: directorPlan.directorPlanId,
            previousDirectorPlanVersion: directorPlan.version,
            measuredVoiceoverSeconds: voiceDuration,
            maximumMaterialSeconds: contentHandoff.outputSpec.maximumDurationSeconds,
            revisionAttempt: revisionAttempt + 1,
          },
        });
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
        transientVoicePath = '';
        retainVoiceForRecovery = false;
        directorPlan = reviseSocialDirectorPlanForVoiceoverFit({
          previous: directorPlan,
          measuredDurationSeconds: voiceDuration,
          createdAt: new Date().toISOString(),
        });
        persistedDirectorPlan = await persistSocialDirectorPlanVersion({
          repository: input.repository,
          tenantId: input.tenantId,
          taskId: input.taskId,
          plan: directorPlan,
          baseline: activeBaseline,
          verifiedContext: executionVerifiedContext,
        });
        directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
        await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
          director_plan: directorPlan,
          updated_at: directorPlan.createdAt,
        });
        contentHandoff = socialDirectorContentHandoff(directorPlan);
        if(selectedVoice)contentHandoff=socialDirectorHandoffWithBoundVoice(contentHandoff,selectedVoice.logicalVoice);
        await recordCurrentContentExecutionCheckpoint({
          stage: 'social.director_storyboard',
          version: '1',
          inputHash: directorCheckpointInputHash,
          payload: {
            directorPlan,
            directorPlanReference: persistedDirectorPlan.reference,
            narration: contentHandoff.narration,
            scenes: contentHandoff.scenes.map(scene => ({
              sceneId: scene.sceneId,
              source: structuredClone(scene.source),
              voiceover: scene.voiceover,
              caption: scene.caption,
            })),
          },
        });
        await writeExecutionStage({
          ...input,
          stage: 'content_production',
          message: `编导 Agent 已锁定第 ${directorPlan.version} 版执行方案，内容 Agent 自动重试配音。`,
          extra: {
            directorPlanId: directorPlan.directorPlanId,
            directorPlanVersion: directorPlan.version,
            directorPlanHash: directorPlan.lineageHash,
            directorPlanSummary: directorSummary,
          },
        });
      }
      if (!voice || !voice.localPath || !voice.cues?.length) throw new Error('口播执行状态异常');
  const adaptedScript = socialDirectorScriptText(contentHandoff, duration, preserveReferenceTimeline);
  const bgm = await (input.runtime?.resolveBgm ?? resolveLockedBgm)(input.tenantId, contentHandoff);
  const bgmQualitySource = await (async () => {
    const match = String(bgm.url).match(/^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return { source: bgm.url, sourceHash: createHash('sha256').update(bgm.url).digest('hex') };
    const bytes = Buffer.from(match[1]!, 'base64');
    if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('编导方案锁定的配乐文件无效');
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const source = path.join(outputDir, `.bgm-quality-${sourceHash}.mp3`);
    await fsp.writeFile(source, bytes);
    return { source, sourceHash };
  })();
  const captionCues = socialDirectorVoiceAlignedCaptionCues(contentHandoff, voice.cues, duration);
  const captionTiming=preparedWholeVoice?assertMeasuredCaptionTiming({measured:preparedWholeVoice.voice.cues,captions:captionCues,duration}):null;
  if(preparedWholeVoice&&captionTiming)await recordCurrentContentExecutionCheckpoint({stage:'social.measured_caption_timing',version:'1',inputHash:captionTiming.cueTimelineHash,payload:{...captionTiming,audioSha256:preparedWholeVoice.wholeTrackSha256,alignmentReceiptRef:preparedWholeVoice.alignmentReceiptRef,alignmentReceiptSha256:createHash('sha256').update(await fsp.readFile(preparedWholeVoice.alignmentReceiptRef)).digest('hex')}});
  if (input.graphPhase) contentHandoff = await rebindSocialGraphRenderSources(contentHandoff, assets);
  const timeline = socialDirectorRenderTimeline(contentHandoff, duration, captionCues, preserveReferenceTimeline)
    .map((clip,index)=>({...clip,sceneId:contentHandoff.scenes[index]!.sceneId}));
  retainVoiceForRecovery = await recordNarrationAudioCheckpoint({
    inputHash: narrationCheckpointInputHash,
    narration: contentHandoff.narration,
    voice: {
      ok: true,
      source: voice.source,
      localPath: voice.localPath,
      duration: voiceDuration,
      text: voice.text || contentHandoff.narration,
      cues: voice.cues,
      alignmentSource: voice.alignmentSource,
      qualityReport: voice.qualityReport,
    },
    captionCues,
    renderTimeline: timeline,
  }) || retainVoiceForRecovery;
  await writeExecutionStage({
    ...input,
    stage: 'rendering',
    message: '内容 Agent 正在自动剪辑、混音并烧录字幕。',
    extra: { duration, voiceDuration, sceneCount: timeline.length, voiceQuality: voice.qualityReport ?? null, narrationCheckpointReused },
  });
  if (selectedVoice) {
    await assertSelectedVoiceCurrent();
    if (!preparedWholeVoice || !voice.localPath) throw Error('selected_presenter_voice_render_proof_missing');
    assertBoundPresenterAudio(selectedVoice.voiceId, preparedWholeVoice.nativeVoice);
    if (createHash('sha256').update(await fsp.readFile(voice.localPath)).digest('hex') !== preparedWholeVoice.wholeTrackSha256) throw Error('selected_presenter_voice_render_audio_changed');
    await recordCurrentContentExecutionCheckpoint({stage:'social.selected_presenter_voice_acceptance',version:'1',inputHash:socialRequestHash({binding:selectedVoice,wholeVoiceInputHash:preparedWholeVoice.inputHash,audioSha256:preparedWholeVoice.wholeTrackSha256}),payload:{binding:selectedVoice,audioSha256:preparedWholeVoice.wholeTrackSha256,sourceReceiptRefs:preparedWholeVoice.sourceReceiptRefs,alignmentReceiptRef:preparedWholeVoice.alignmentReceiptRef}});
  }
  const compositeManifest = {
    jobId: `social-${input.taskId}-${createHash('sha256').update(input.runId).digest('hex').slice(0, 12)}`,
    requireVisualAssets: true,
    spec: {
      ratio: contentHandoff.outputSpec.aspectRatio,
      resolution: contentHandoff.outputSpec.resolution,
      duration,
      platform: contentHandoff.outputSpec.platform,
      language: contentHandoff.outputSpec.language,
      bgmVol: contentHandoff.bgmSelection.volume,
      voiceVol: contentHandoff.outputSpec.voiceVolume,
    },
    timeline,
    ...(contentHandoff.effectPlan ? { effectPlan: contentHandoff.effectPlan } : {}),
    voiceover: { url: voice.localPath },
    bgm,
    subtitles: {
      mode: 'target',
      cues: captionCues,
      style: {
        // Automated social films use a mobile-first minimum even when an older
        // frozen Director plan predates the larger caption default.
        fontScale: Math.max(1.45, contentHandoff.direction.subtitles.fontScale),
        bottomRatio: contentHandoff.direction.subtitles.bottomRatio,
        productNames: executionVerifiedContext.productName ? [executionVerifiedContext.productName] : [],
      },
    },
  };
  const result = await executeSocialRenderStage({ tenantId: input.tenantId, taskId: input.taskId, runId: input.runId,
    manifest: compositeManifest, outputDirectory: outputDir, render: input.runtime?.renderComposite ?? composite,
    checkpointEnabled: Boolean(input.graphPhase) });
  if (input.graphPhase === 'render') return;
  await writeExecutionStage({
    ...input,
    stage: 'quality_check',
    message: '内容 Agent 正在检查成片画面、音轨和字幕。',
  });
  const { quality, sceneQuality, audio, measuredDurationSeconds } = await executeSocialQualityStage({ outputPath: result.outputPath,
    duration, scenes: timeline.map(clip => ({ start: clip.targetStart, end: clip.targetEnd })), expectedUniqueScenes: contentHandoff.scenes.length,
    inspectVisuals: input.runtime?.inspectVisuals ?? inspectRenderedVisuals,
    inspectScenes: input.runtime?.inspectScenes ?? inspectRenderedScenes,
    runFfmpeg: input.runtime?.runFfmpeg ?? runVisualFfmpeg, checkpointEnabled: Boolean(input.graphPhase), verifyDuration: preserveReferenceTimeline,
    expectedBgm: { ...bgmQualitySource, volume: contentHandoff.bgmSelection.volume } });
  const finalFidelityFailures = socialProductionReferenceFidelityFailures(agentWorkflow, contentHandoff, {
    referenceAnalysis: detail.referenceVideoAnalysis, renderedDurationSeconds: measuredDurationSeconds ?? duration,
    renderedTimeline: timeline.map(clip => ({ sceneId: clip.sceneId, startSeconds: clip.targetStart, endSeconds: clip.targetEnd })),
  });
  const technicalFailures=[...quality.failures,...sceneQuality.issues.map(issue=>issue.reason),...(!audio.ok?['成片音轨无法解码']:[]), ...finalFidelityFailures];
  const technicalApproved=quality.passed&&sceneQuality.passed&&audio.ok&&(!audio.bgm||audio.bgm.passed)&&!finalFidelityFailures.length;
  const technicalQualityReport:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:quality,scenes:sceneQuality,audio:{ok:audio.ok&&(!audio.bgm||audio.bgm.passed),error:!audio.ok?'成片音轨无法解码':audio.bgm?.failure??null,...(audio.bgm?{bgm:audio.bgm}:{})}};
  const coverPath = await (input.runtime?.createCover ?? createVideoCover)({
    videoPath: result.outputPath,
    outputDirectory: outputDir,
    timestamp: socialDirectorCoverTimestamp(contentHandoff, duration, captionCues, preserveReferenceTimeline),
  });
  await assertCurrentContentExecutionActive();
  const stored = await storeTransientSocialContentFile({
    filePath: result.outputPath,
    tenantId: input.tenantId,
    name: `${detail.brief.title || '社媒内容'}-成品.mp4`,
    mimeType: 'video/mp4',
  });
  const file = await registerSocialContentFile({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    usage: 'artifact_media',
    idempotencyKey: `social-auto-file:v2:${input.taskId}:${stored.sha256}:${stored.storageKind}`,
    stored,
	...(stored.storageKind === 'backend_file' ? { transientPath: result.outputPath } : {}),
	backendFilePort: input.runtime?.backendFilePort,
  });
  const storedCover = await storeTransientSocialContentFile({
    filePath: coverPath,
    tenantId: input.tenantId,
    name: `${detail.brief.title || '社媒内容'}-封面.jpg`,
    mimeType: 'image/jpeg',
  });
  const coverFile = await registerSocialContentFile({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    usage: 'artifact_media',
    idempotencyKey: `social-auto-cover:v2:${input.taskId}:${storedCover.sha256}:${storedCover.storageKind}`,
    stored: storedCover,
	...(storedCover.storageKind === 'backend_file' ? { transientPath: coverPath } : {}),
	backendFilePort: input.runtime?.backendFilePort,
  });
  await resolveSocialDirectorArtifactLineage({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
    reference: persistedDirectorPlan.reference,
  });
  const productionResultId = `production_result_${socialRequestHash({ taskId: input.taskId, runId: input.runId, executionPlanId: agentWorkflow.executionPlan.executionPlanId }).slice(0, 20)}`;
  let replicationEvaluation = null;
  if (agentWorkflow.replicationJob) {
    const referenceSourceId = detail.referenceVideoAnalysis?.referenceSourceId;
    const referenceAsset = referenceSourceId
      ? rawAssets.find(asset => asset.sourceId === referenceSourceId || asset.id === referenceSourceId)
      : undefined;
    let referenceVideoPath = referenceAsset?.localPath && existsSync(referenceAsset.localPath)
      ? referenceAsset.localPath
      : null;
    // The original viral video is reference-only and is intentionally absent
    // from the production material pool. Resolve its tenant-owned cached bytes
    // independently for post-render evaluation, with both path and content
    // hash checks, so exclusion from editing does not erase QA evidence.
    if (!referenceVideoPath) {
      const reuse = detail.brief.referenceReuse;
      const recordId = socialText(reuse?.recordId);
      const expectedSha = socialText(reuse?.contentSha256).toLowerCase();
      if (/^trend_videos_[a-zA-Z0-9_-]{8,100}$/.test(recordId) && /^[a-f0-9]{64}$/.test(expectedSha)) {
        const record = await input.repository.dataStore?.getById<Record<string, unknown>>('trend_videos', recordId);
        const relative = socialText(record?.videoFileId).replace(/\\/g, '/');
        const expectedRelative = `tenants/${input.tenantId}/reference-videos/${recordId}.mp4`;
        const mediaRoot = path.resolve(process.env.SOCIAL_CONTENT_MEDIA_ROOT || path.join(process.cwd(), 'data/media'));
        const candidate = path.resolve(mediaRoot, relative);
        const tenantRoot = path.resolve(mediaRoot, 'tenants', input.tenantId);
        if (record && [record.tenantId, record.tenant_id].includes(input.tenantId)
          && relative === expectedRelative && candidate.startsWith(`${tenantRoot}${path.sep}`) && existsSync(candidate)) {
          const actualSha = createHash('sha256').update(await fsp.readFile(candidate)).digest('hex');
          if (actualSha === expectedSha) referenceVideoPath = candidate;
        }
      }
    }
    const referenceText = (detail.replicationScript?.shots ?? [])
      .map(shot => shot.spokenText || shot.captionText || shot.visualInstruction)
      .map(socialText).filter(Boolean).join('\n') || null;
    await writeExecutionStage({
      ...input,
      stage: 'media_evaluation',
      message: '独立媒体评估 Worker 正在核对爆点保真、身份替换、原创差异、复用风险和账号适配。',
      extra: {
        replicationJobId: agentWorkflow.replicationJob.replicationJobId,
        factorSpecVersion: agentWorkflow.replicationJob.factorSpecVersion,
      },
    });
    const evaluated = await (input.runtime?.evaluateReplication ?? evaluateSocialReplicationResult)({
      workflow: agentWorkflow,
      referenceAnalysis: detail.referenceVideoAnalysis ?? null,
      replicationScript: detail.replicationScript ?? null,
      productionResultId,
      outputVideoPath: result.outputPath,
      evidence: {
        referenceVideoPath,
        referenceText,
        outputText: adaptedScript,
      },
    });
    replicationEvaluation = evaluated.evaluation;
  }
  const creativeReviewFailures = socialProductionCollaborationFailures(agentWorkflow, contentHandoff, {
    referenceAnalysis: detail.referenceVideoAnalysis, renderedDurationSeconds: measuredDurationSeconds ?? duration,
    renderedTimeline: timeline.map(clip => ({ sceneId: clip.sceneId, startSeconds: clip.targetStart, endSeconds: clip.targetEnd })),
  });
  await writeExecutionStage({
    ...input,
    stage: 'creative_review',
    message: creativeReviewFailures.length
      ? '编导 Agent 的结构与表达验收未通过，正在停止提交并保留当前结果。'
      : !technicalApproved||creativeReviewFailures.length||replicationEvaluation && replicationEvaluation.status !== 'passed'
        ? '成片已保留为候选；独立媒体检测尚未自动放行，等待编导逐镜复核或局部返工。'
        : '技术质检和独立媒体检测通过，编导 Agent 已按 DirectorBrief 完成结构与表达验收。',
    extra: {
      directorBriefId: agentWorkflow.directorBrief.directorBriefId,
      checkedSceneCount: contentHandoff.scenes.length,
      failedCriteria: creativeReviewFailures,
      replicationEvaluationId: replicationEvaluation?.evaluationId ?? null,
      replicationEvaluationStatus: replicationEvaluation?.status ?? null,
    },
  });

  const evaluationFailures = [...creativeReviewFailures,...(replicationEvaluation?.status === 'passed'?[]:replicationEvaluation?.directorDecision.failedCriteria??[])];
  const plannedCostCny = socialExecutionExternalCost(agentWorkflow.executionPlan, agentWorkflow.directorBrief);
  const selectedAssetIds = new Set(contentHandoff.scenes.map(scene => scene.source.assetId));
  const archivedMaterialIdByAssetId = new Map((assetSupplyExecution?.shots ?? [])
    .filter(shot => shot.archivedMaterial)
    .map(shot => [shot.assetId, shot.archivedMaterial!.materialId]));
  const finalInputMaterialIds = [...selectedAssetIds]
    .map(assetId => archivedMaterialIdByAssetId.get(assetId) || assetId);
  const recordedProviderEstimatedCostCny = +assets
    .filter(asset => selectedAssetIds.has(asset.id))
    .flatMap(asset => asset.segments ?? [])
    .reduce((sum, segment) => sum + Math.max(0, Number(segment.estimatedCostCny || 0)), 0)
    .toFixed(2);
  const deliverableStatus = productionMode === 'concept_preview'
    ? 'concept_preview'
    : !technicalApproved || creativeReviewFailures.length > 0 || (replicationEvaluation && replicationEvaluation.status !== 'passed')
      ? 'requires_revision'
      : 'publish_candidate';
  const finalQualityAccepted = technicalApproved&&!creativeReviewFailures.length&&(!replicationEvaluation || replicationEvaluation.status === 'passed');
  const finalGeneratedMaterial = await archiveGeneratedSocialContentFile({
    file,
    stored,
    archiveMedia: input.runtime?.archiveGeneratedMedia,
    archive: {
      tenantId: input.tenantId,
      name: `${detail.brief.title || '社媒内容'}-成品.mp4`,
      media: {
      type: 'video',
      localPath: result.outputPath,
      ...(stored.storageKind === 'object' ? { objectKey: stored.storageKey } : {}),
      duration,
      },
      generation: {
      pipelineId: 'non_person_generation',
      assetGenerationKind: 'final_video',
      pipelineVersion: AUTO_SCHEMA,
      executionId: productionResultId,
      provider: 'local_compositor',
      model: 'desktop/render.cjs',
      idempotencyKey: `social-auto-final:${input.taskId}:${stored.sha256}`,
      inputFingerprint: socialRequestHash({
        taskId: input.taskId,
        directorPlanHash: directorPlan.lineageHash,
        selectedAssetIds: finalInputMaterialIds,
      }),
      promptOrSpecHash: directorPlan.lineageHash,
      inputMaterialIds: finalInputMaterialIds,
      estimatedCostCny: plannedCostCny,
      // Visual reservations omit audio, QA and unknown invoices; never label them actual cost.
      actualCostCny: undefined,
      },
      lineage: { sourceTaskId: input.taskId, sourceAssemblyId: productionResultId },
      quality: {
      state: finalQualityAccepted ? 'accepted' : 'repair_required',
      policyVersion: 'social-final-video.v1',
      checkedAt: new Date().toISOString(),
      checks: [
        { key: 'visual_decode', status: quality.passed&&sceneQuality.passed?'passed':'failed', evidence: `checked_scenes:${sceneQuality.checkedScenes}` },
        { key: 'audio_decode', status: audio.ok?'passed':'failed', evidence: audio.ok?'ffmpeg_audio_decode_passed':'ffmpeg_audio_decode_failed' },
        { key: 'director_review', status: creativeReviewFailures.length?'failed':'passed', evidence: agentWorkflow.directorBrief.directorBriefId },
        ...(replicationEvaluation ? [{
          key: 'replication_evaluation',
          status: replicationEvaluation.status === 'passed' ? 'passed' as const : 'failed' as const,
          evidence: replicationEvaluation.evaluationId,
        }] : []),
      ],
      rawReport: { visual: quality, scenes: sceneQuality, replicationEvaluation },
      },
      rightsScope: 'tenant_generated_reusable',
    },
  });
  const productionResult: SocialProductionResult = {
    productionResultId,
    version: detail.version,
    executionPlanId: agentWorkflow.executionPlan.executionPlanId,
    executionPlanVersion: agentWorkflow.executionPlan.version,
    executionPlanReviewId: agentWorkflow.executionPlanReview.reviewId,
    artifactId: null,
    creativeReviewId: `creative_review_${socialRequestHash({ taskId: input.taskId, runId: input.runId, directorBriefId: agentWorkflow.directorBrief.directorBriefId }).slice(0, 20)}`,
    publishAssignmentId: null,
    status: 'asset_review',
    sceneResults: contentHandoff.scenes.map(finalScene => {
      const scene = socialProductionExecutionSceneForFinal(agentWorkflow, finalScene.sceneId)!;
      return {
        sceneId: scene.sceneId,
        idempotencyKey: scene.idempotencyKey,
        sourceStrategy: scene.selectedSourceStrategy,
        feasibility: scene.feasibility,
        provenanceCandidateIds: scene.recommendedCandidateIds,
      };
    }),
    technicalReview: { approved: technicalApproved, checkedScenes: sceneQuality.checkedScenes, failures: technicalFailures },
    creativeReview: {
      approved: !creativeReviewFailures.length&&(!replicationEvaluation || replicationEvaluation.status === 'passed'),
      failedCriteria: evaluationFailures,
      reviewedBy: 'director_agent',
    },
    artifactResourceRef: file.fileRef,
    createdAt: new Date().toISOString(),
  };
  let initialSceneSourceEvidence:Awaited<ReturnType<typeof initialSceneSourceHashes>>|null=null;
  if(assetSupplyExecution){try{initialSceneSourceEvidence=await initialSceneSourceHashes({assets,execution:assetSupplyExecution,voicePath:voice.localPath,bgmUrl:bgm.url||null});}catch{/* Actual output remains reviewable; missing source bytes cannot create a cache. */}}
  await assertCurrentContentExecutionActive();
  const artifactResult = await createSocialContentArtifact({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    // A failed local render may be rebuilt within the same durable run after
    // QA identifies a deterministic compositor defect. Bind artifact creation
    // to the actual media bytes so the corrected render is reviewable while
    // provider work and the run identity remain unchanged.
    idempotencyKey: `social-auto-artifact:${input.runId}:${stored.sha256}`,
    trustedAgentOrigin: true,
    requireHumanReview: Boolean(input.graphPhase),
    now: input.now,
	backendFilePort: input.runtime?.backendFilePort,
    value: {
      kind: 'short_video',
      platform: contentHandoff.outputSpec.platform,
      language: contentHandoff.outputSpec.language,
      origin: 'agent',
      parentArtifactId: (input.graphPhase && input.graphApprovedContext?.revisionPlanHash ? socialText(socialObject(socialObject(socialJson(taskRecord.brief))?._productionRevision)?.parentArtifactId) : '') || revisionParent?.artifactId,
      resourceRef: file.fileRef,
      content: {
        workflowSchema: AUTO_SCHEMA,
        productionWorkspaceSource: {type:'actual_social_render',creationMode:detail.brief.creationMode||'material_processing',runId:input.runId,...(input.graphCorrectionHash?{correctionHash:input.graphCorrectionHash}:{}),baselineHash:socialRequestHash(activeBaseline),manifestHash:socialRequestHash(compositeManifest),outputSha256:file.sha256},
        technicalQualityReport,
        initialSceneSourceHashes:initialSceneSourceEvidence,
        ...(executedSupplyPlan&&assetSupplyExecution?{initialSceneCacheInput:initialSceneCacheInputFingerprint({plan:executedSupplyPlan,baseline:activeBaseline,execution:assetSupplyExecution,manifest:compositeManifest as unknown as Record<string,unknown>,productionSceneIds:contentHandoff.scenes.map(scene=>socialProductionExecutionSceneForFinal(agentWorkflow,scene.sceneId)!.sceneId)})}:{}),
        sourceKey: `social_task_auto:${input.taskId}`,
        contentType: 'short_video',
        mediaStorage: {
          provider: stored.storageKind === 'object' ? 'object_storage' : 'pocketbase_file',
          video: {
            fileRef: file.fileRef,
            fileId: file.fileId,
            sha256: file.sha256,
            url: file.downloadUrl || socialContentFileDownloadUrl(file.fileId),
          },
          cover: {
            fileRef: coverFile.fileRef,
            fileId: coverFile.fileId,
            sha256: coverFile.sha256,
            url: coverFile.downloadUrl || socialContentFileDownloadUrl(coverFile.fileId),
          },
        },
        generatedMaterial: {
          materialId: finalGeneratedMaterial.id,
          materialRevision: stored.sha256,
          generationExecutionId: productionResultId,
          adoptedAt: new Date().toISOString(),
        },
        // G5 compares the rendered artifact against the exact frozen baseline
        // used to build the scene cache. A lossy summary cannot prove that
        // account constraints, fact keys, template structure, or timing stayed
        // unchanged through rendering.
        scriptBaseline: structuredClone(activeBaseline),
        directorPlan: directorSummary,
        directorPlanReference: persistedDirectorPlan.reference,
        productionResult,
        ...(replicationEvaluation ? { replicationEvaluation } : {}),
        costSummary: {
          currency: 'CNY',
          estimatedBeforeGenerationCny: plannedCostCny,
          recordedProviderCostCny: null,
          recordedProviderEstimatedCostCny,
          settlementStatus: 'recorded',
          note: '实际费用只统计本次已记录的媒体供应商调用；存储、带宽和人工审核未计入。',
        },
        delivery: {
          status: deliverableStatus,
          label: deliverableStatus === 'publish_candidate'
            ? '可进入人工发布确认'
            : deliverableStatus === 'concept_preview'
              ? '概念样片，不可直接发布'
              : '需要修改后再发布',
        },
        adaptedScript,
        scriptAdaptation: adaptation,
	    ...(assetSupplyExecution ? { assetSupplyExecution } : {}),
        narration: {
          changedFromBaseline: adaptation.narrationChanged,
          source: voice.source || 'unknown',
          duration: voiceDuration,
          cueCount: captionCues.length,
          ...(captionTiming&&preparedWholeVoice?{timingProof:{...captionTiming,audioSha256:preparedWholeVoice.wholeTrackSha256,alignmentReceiptRef:preparedWholeVoice.alignmentReceiptRef}}:{}),
          alignmentSource: voice.alignmentSource || 'unknown',
          qualityReport: voice.qualityReport ?? null,
          learningReadiness: voiceLearningReadiness({ technicalPassed: voice.qualityReport?.passed === true }),
        },
        agentCollaboration: socialProductionCollaborationTrace(agentWorkflow, contentHandoff),
        materialLearning: plan.materialLearning ?? null,
        effectPlan: contentHandoff.effectPlan,
        render: {
          completed: true,
          materialSourceIds: [...new Set(contentHandoff.scenes.map(scene => scene.source.sourceId))],
          selectedAssetIds: [...new Set(contentHandoff.scenes.map(scene => scene.source.assetId))],
          unusedAssets: directorPlan.unusedAssets,
          sourceClipSeconds: contentHandoff.scenes.reduce((sum, scene) => (
            sum + Math.max(0, scene.source.sourceEnd - scene.source.sourceStart)
          ), 0),
          materialAnalysisConfidence: directorPlan.scenes.reduce((sum, scene) => (
            sum + scene.shotPlan.confidence
          ), 0) / Math.max(1, directorPlan.scenes.length),
          materialMatchScore: directorPlan.scenes.reduce((sum, scene) => (
            sum + scene.shotPlan.semanticScore
          ), 0) / Math.max(1, directorPlan.scenes.length),
          qualityPassed: technicalApproved,
          qualityMetrics: quality.metrics,
          checkedScenes: sceneQuality.checkedScenes,
          audioDecoded: audio.ok,
          bgm: {
            id: bgm.id,
            volume: contentHandoff.bgmSelection.volume,
            mood: [contentHandoff.bgmSelection.primary, ...contentHandoff.bgmSelection.fallbacks]
              .find(track => track.trackId === bgm.id)?.mood ?? contentHandoff.direction.music.mood,
            authorization: [contentHandoff.bgmSelection.primary, ...contentHandoff.bgmSelection.fallbacks]
              .find(track => track.trackId === bgm.id)?.authorization ?? null,
          },
          coverIntent: contentHandoff.coverIntent,
          degradation: adaptation.limitedMaterialFallback ? adaptation.notes : [],
        },
        review: {
          state: deliverableStatus === 'publish_candidate' ? 'requires_user_approval' : 'requires_revision',
          deliverableStatus,
          technicalChecksPassed: technicalApproved,
          creativeChecksPassed: !creativeReviewFailures.length&&(!replicationEvaluation || replicationEvaluation.status === 'passed'),
          automatedChecksPassed: finalQualityAccepted,
        },
        ...(revisionParent && reviewDirective ? {
          reviewRevision: {
            parentArtifactId: revisionParent.artifactId,
            feedbackHash: reviewDirective.feedbackHash,
            categories: reviewDirective.categories,
          },
        } : {}),
        productionHash: socialRequestHash({
          directorPlan,
          adaptation,
          videoSha256: stored.sha256,
          coverSha256: storedCover.sha256,
        }),
      },
    },
  });
  if(executedSupplyPlan&&assetSupplyExecution&&detail.referenceVideoAnalysis){try{const surface=(value:unknown)=>({baseline:null,current:socialRequestHash(value)});const handoff=buildSocialProductionHandoff({taskId:input.taskId,version:agentWorkflow.executionPlan.version,sourceAnalysis:detail.referenceVideoAnalysis,directorBrief:agentWorkflow.directorBrief,executionPlan:agentWorkflow.executionPlan,executionPlanReview:agentWorkflow.executionPlanReview,variantDifference:{variantId:productionResultId,baselineVariantId:null,changedSceneIds:[],dimensions:[],hypothesis:'按已锁定编导执行方案建立首次成片基线，尚无对照变体和提升结论。',unchangedConstraints:['已锁定事实','逐镜真实供给','来源和权利边界'],surfaceHashes:{firstThreeSeconds:surface(timeline[0]),caption:surface(captionCues),cover:surface(storedCover.sha256),cta:surface(contentHandoff.scenes.at(-1)),copy:surface(adaptedScript),render:surface(stored.sha256)}}});await persistInitialSocialSceneCache({repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,artifactId:artifactResult.artifact.artifactId,handoff,plan:executedSupplyPlan,baseline:activeBaseline,execution:assetSupplyExecution,assets,productionSceneIds:contentHandoff.scenes.map(scene=>socialProductionExecutionSceneForFinal(agentWorkflow,scene.sceneId)!.sceneId),manifest:compositeManifest as unknown as Record<string,unknown>,voicePath:voice.localPath,bgmUrl:bgm.url||null,report:technicalQualityReport,...(presenterMotherExecution?{presenterMotherExecution}:{})});await writeExecutionStage({...input,stage:'scene_media_cache',message:'首次逐镜真实媒体和检测报告已封存；未检测项目仍待核验。',extra:{handoffId:handoff.handoffId,handoffVersion:handoff.version}});}catch(error){await writeExecutionStage({...input,stage:'scene_media_cache_pending',message:'原成片已保留，真实逐镜缓存尚未通过来源或存储核验，不能从最终视频推造镜头缓存。',extra:{reason:error instanceof Error?error.message:'scene_cache_unavailable'}});}}else{await writeExecutionStage({...input,stage:'scene_media_cache_pending',message:'原成片已保留；缺少真实逐镜供给或完整参考分析，不能创建局部重制缓存。'});}
  try { await persistSocialProductionWorkspace({repository:input.repository,tenantId:input.tenantId,userId:input.userId,taskId:input.taskId,runId:input.runId,artifactId:artifactResult.artifact.artifactId,baseline:activeBaseline,manifest:compositeManifest as unknown as Record<string,unknown>,backendFilePort:input.runtime?.backendFilePort}); } catch(error) { await writeExecutionStage({...input,stage:'production_workspace_pending',message:'真实成片已保留；逐镜制作工作台快照尚未通过媒体或身份核验，不能推断项目关联。',extra:{reason:error instanceof Error&&/^(?:social_workspace_|social_content_)[a-z_]+$/.test(error.message)?error.message:'social_workspace_unavailable'}}); }
  if (!input.graphPhase) await finishExecution({ ...input, backendFilePort: input.runtime?.backendFilePort, artifactId: artifactResult.artifact.artifactId });
    } finally {
      if (transientVoicePath && !retainVoiceForRecovery) {
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
      }
    }
  });
}

import {prepareMeasuredMaterialForExecution} from './socialContentMeasuredMaterialExecution.js';
import {createSocialProductionFirstFramePreparation} from './socialContentProductionFirstFramePreparation.js';
import {projectMeasuredDirectorScenes} from './socialContentMeasuredSupplyTimeline.js';
import {canReusePresenterMotherCheckpoint,assertPresenterMotherRecoveryReadOnly} from './presenterMotherCheckpointRecovery.js';
import {buildSocialPresenterMotherSceneSources,type SocialPresenterSceneComposition} from './socialContentPresenterSceneSource.js';
import { readCurrentConfirmedPresenterFirstFrame } from './socialContentPresenterFirstFrameCurrent.js';
import {readSocialBudgetMaterialAllocation} from './socialContentBudgetMaterialRecovery.js';
import {productionBudgetDuration,productionBudgetLimitCny,productionBudgetMaximumCny} from '../../shared/contracts/productionBudgetPolicy.js';
import { prepareSocialCacheFinalization, finishSocialCacheFinalization } from './socialContentCacheFinalization.js';
import {assertMeasuredCaptionTiming} from './socialContentCaptionTiming.js';
import {applyPresenterFirstBudgetRouting} from './socialContentBudgetRouting.js';
import { readBoundPresenterVoice, readWeeklyProductionVoice, weeklyProductionPresenterIds } from './socialContentBoundPresenterVoice.js';
import { prepareSocialContentProductionBudget, paidBaselineContractHash, type ProductionBudgetReadPorts } from './socialContentProductionBudgetPreflight.js';
import type {PaidStageRequirement} from './socialContentPaidOperationPlan.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import { admitExternalSupplyAdapters, socialProductionSupplyAdapters } from './socialContentRecoveryAdapters.js';
import {
  assertCurrentContentExecutionActive,
  readCurrentContentExecutionCheckpoint,
  recordCurrentContentExecutionCheckpoint,
  recordCurrentContentProviderReceipt,
} from '../contentExecution/context.js';
import {assertWeeklyProductionMaterialAdmission} from './socialWeeklyProductionMaterialGate.js';
import {freezeWeeklyPreSupplyHandoff,pauseWeeklyPreSupplyStage,readWeeklyPreSupplyHandoff} from './socialWeeklyPreSupplyHandoff.js';
import { persistSocialProductionWorkspace } from './socialContentProductionWorkspace.js';
import { buildInitialSocialSceneCacheInput, type InitialSocialSceneCacheInput } from './socialContentInitialSceneCacheInput.js';
import { createProductionBudgetRuntimeReaders } from './socialContentProductionBudgetRuntimeReaders.js';
import { createSocialContentMaterialPaidContext, type SocialMaterialPaidRuntimePorts } from './socialContentMaterialPaidContext.js';
import { socialContentMaterialAnalysisInputs } from './socialContentMaterialAnalysisInputs.js';
import {prepareSocialProductionMaterialRouting} from './socialContentProductionMaterialPreparation.js';
import {prepareSocialContentProductionPlanAndDirector} from './socialContentProductionPlanAndDirector.js';
import {prepareSocialContentProductionRenderManifest} from './socialContentProductionRenderManifest.js';
import {admitSocialContentProduction} from './socialContentProductionAdmission.js';
import {prepareSocialContentFinalDelivery} from './socialContentProductionFinalDelivery.js';
import {createSocialContentProductionArtifact} from './socialContentProductionArtifact.js';
import {inspectSocialContentProductionTechnicalQuality} from './socialContentProductionTechnicalQuality.js';
import {prepareSocialContentProductionVoice} from './socialContentProductionVoicePreparation.js';
import {ensureStrictPresenterFirstFrames} from './socialContentPresenterFirstFrameRuntime.js';
import { createProductionBudgetRouteReaders } from './socialContentProductionBudgetRoutes.js';
import { createSocialContentPaidRuntimePorts } from './socialContentPaidRuntimePorts.js';
import { prepareSocialContentWholeVoice,readPreparedWholeVoiceScene, type PreparedWholeVoice } from './socialContentPreparedWholeVoice.js';
import { socialDirectorSpokenNarration } from './socialContentDirectorHandoff.js';
import type { ProductPaidContext } from './socialContentProductPaidContext.js';
import {assertWeeklyCreativeRepairCtaAdmission} from '../runtime/weeklyCreativeRepairCtaAdmission.js';
import {readWeeklyTemplateStructure} from '../socialPrograms/weeklyTemplateStructure.js';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SocialAssetSupplyPlan, SocialContentThemeId, SocialTaskSource } from '../../shared/contracts/socialContentWorkflow.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { type MaterialRecord } from '../lib/materialLibrary.js';
import { alignStudioVoiceForAutomation, automationBgmAudio, automationBgmCatalog, readTenantEnterpriseProfile, synthesizeStudioVoiceForAutomation } from '../lib/socialContentLegacyPorts.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import { objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { type SocialContentBackendFilePort } from './socialContentFiles.js';
import { type SocialContentCloudMaterialPort } from './socialContentMaterialAccess.js';
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
import {verifiedSocialScriptContext} from './socialContentScriptBaseline.js';
import {prepareSocialProductionScriptBaseline} from './socialContentProductionScriptBaseline.js';
import { runOutsideSocialContentMutationScope } from './socialContentMutation.js';
import {
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
import {assertSocialReferenceBackgroundAssetCurrent} from './socialContentReferenceBackgroundLock.js';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {preparePresenterMotherSupply} from './presenterMotherSupplyBridge.js';
import {assertPresenterMotherSpeechQaReady,inspectPresenterMotherSpeechQa} from './presenterMotherSpeechQa.js';
import {assertRestoredPresenterMotherExecution,type PresenterMotherExecutionResult} from './presenterMotherSegmentExecution.js';
import {type PresenterFirstFrameApprovalContract} from './socialContentPresenterFirstFrameApproval.js';
import type {FrozenPresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {heyGenRuntimeRouteEvidence,readTrustedHeyGenRuntimeBinding} from './socialContentHeyGenRuntimeBinding.js';
import { socialDirectorFrozenDirection, socialDirectorCoverTimestamp, socialDirectorRenderTimeline, socialDirectorVoiceAlignedCaptionCues, socialDirectorScriptText, type SocialDirectorBgmSelection, type SocialDirectorBgmTrack, type SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import {
  analyzeSocialProductionAssetsWithCheckpoint,
  recordNarrationAudioCheckpoint,
  restoreSocialAssetSupplyCheckpointAssets,
  socialAssetSupplyCheckpointInputHash,
} from './socialContentProductionCheckpoints.js';
import { archiveSocialGeneratedShots } from './socialContentGeneratedShotArchive.js';
import {BACKGROUND_FIRST_GRAPH_VERSION,type ContentGraphVersion} from '../contentExecution/langgraphIdentity.js';
import {finishV4AssetSupplyPhase,recordV4WholeVoiceCheckpoint,restoreV4SourceAssets,socialAssetSupplyPhaseInputHash,socialAssetSupplyPhaseShotIds,type SocialAssetSupplyPhase} from './socialContentAssetSupplyPhases.js';
export { archiveSocialGeneratedShots, socialGeneratedShotArchiveCandidates } from './socialContentGeneratedShotArchive.js';
import { generatedAssetArchive } from '../lib/generatedAssetArchive.js';
const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as { composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }> };
import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, socialReviewRevisionDirective, createVideoCover } from './socialContentAutoProduction.js';
import { analyzeProductionAssets, existingAssetSupplyAdapters, finishExecution, resolveLockedBgm, selectDirectorBgm, writeExecutionStage } from './socialContentAutoProduction.js';
export interface SocialContentAutoProductionRuntime {
  /** Trusted worker-only label completion test/runtime ports. */
  benchmarkLabelCompletionPorts?: Parameters<typeof import('./socialContentMissingLabelCompletion.js').autoCompleteMissingBenchmarkLabels>[0]['ports'];
  productionBudgetReadPorts?: ProductionBudgetReadPorts;
  materialPaidRuntimePorts?: SocialMaterialPaidRuntimePorts;
  productPaidRuntimePorts?: Pick<ProductPaidContext, 'assertProviderBinding' | 'measureInputTokens' | 'measureVideoOutputTokens'>;
  loadProductionAssets?: typeof taskProductionAssets;
  analyzeAssets?: typeof analyzeProductionAssets;
  selectDirectorBgm?: typeof selectDirectorBgm;
  synthesizeVoice?: typeof synthesizeStudioVoiceForAutomation;
  alignVoice?: typeof alignStudioVoiceForAutomation;
  resolveBgm?: typeof resolveLockedBgm;
  renderComposite?: typeof composite; inspectSubtitleStyleFrame?: import('./socialVideoSubtitleStyleSampling.js').SubtitleStyleFrameInspector; measureVideoTimeline?: import('./socialVideoQualityReview.js').VideoTimelineMeasurementPort;
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
    targetAspectRatio?: string;
    groups:Array<{groupId:string;presenterGroupContractHash:string;presenterAssetId:string;executionKind?:'seedance_motion';firstFramePipeline?:'background-first.v2';productAssetBinding?:{productId:string;enterpriseFactRef:string;enterpriseFactVersion:string;referenceImageIds:string[]};compositions:Array<Extract<SocialPresenterSceneComposition,{source:{kind:'original_scene'}}> | {source?:{kind:'reference_scene'};referenceSourceId:string;referenceShotId:string;startSeconds:number;endSeconds:number;referenceFirstFrameUrl:string;background:string;framing:string;camera:string;composition:string}>}>;
    paidStatic:{requirements:PaidStageRequirement[];intents:SocialPaidOperationIntent[];permit:ReturnType<typeof createSocialContentPaidOperationPermit>};
  })=>Promise<PresenterFirstFrameApprovalContract[]>;
  evaluatePresenterMotherDynamicQa?: (input:{tenantId:string;taskId:string;runId:string;segmentId:string;segmentHash:string;presenterAssetId:string;outputPath:string;outputSha256:string;spokenText:string;durationSeconds:number})=>Promise<{identitySimilarity:number;identityThreshold:number;segmentHash?:string;outputVideoSha256?:string;frozenAudioSha256?:string;outputAudioSha256?:string;audioTrackMatchesFrozen?:boolean;audioTrackReceiptRef?:string;audioTrackReportHash?:string;lipSyncScore?:number|null;lipSyncThreshold?:number|null;lipSyncStatus?:'passed'|'skipped_unconfigured';lipSyncModelSha256?:string;lipSyncReceiptRef?:string;receiptRef:string;reportHash:string}>;
}
type SupplyCheckpoint={assetSupplyExecution:SocialAssetSupplyExecution;executedSupplyPlan?:SocialAssetSupplyPlan;selectedAssets:Array<{assetId:string;sourceId:string;contentHash:string|null;asset?:ProductionAsset}>};
type ProductionTaskDetail = NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;
export type SocialGraphApprovedContext = Pick<ProductionTaskDetail, 'version' | 'agentWorkflow' | 'assetSupplyPlan'> & { revisionPlanHash?: string; footageRevisionPlanHash?: string };
import { executeSocialRenderStage, rebindSocialGraphRenderSources, type SocialProductionGraphPhase } from './socialContentProductionStages.js';
export {bindCanonicalTypeAwareRouting, assertCompleteTypeAwareExecutionPlan, assetSupplyPlanWithExecutionSelections} from './socialContentExecutionPlan.js';
import {assertCompleteTypeAwareExecutionPlan} from './socialContentExecutionPlan.js';
import { createShootingPlanExecution } from './socialContentShootingPlanExecution.js';
export { SOCIAL_SHOOTING_PLAN_SCHEMA, buildSocialShootingPlanArtifactContent } from './socialContentShootingPlan.js';
export { assetSupplyPlanWithDynamicPresenterBackgroundLocks, typeAwareRequiredMaterialIds, rebindDivergentLocalRoutesFromApprovedContext } from './socialContentProductionRouting.js';
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
  graphVersion?: ContentGraphVersion;
  graphApprovedContext?: SocialGraphApprovedContext;
  /** Trusted current correction grant; old artifacts cannot satisfy this execution. */
  graphCorrectionHash?: string;
}): Promise<void> {
  const splitSupplyGraph=input.graphVersion===BACKGROUND_FIRST_GRAPH_VERSION;
  const admission = await admitSocialContentProduction(input);
  if (admission.completed) return;
  let { detail } = admission;
  const { productionApproach, originalReplication, replicationContext, usesTypeAwareRouting,
    canonicalTypeAwareSupplyPlan, revisionParent, agentWorkflow, presenterExecutions } = admission;
  const taskRecord = await requireSocialTask(input);
  if (productionApproach === 'shooting_plan') {
    await createShootingPlanExecution({ ...input, backendFilePort: input.runtime?.backendFilePort }, detail);
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
  const assertWeeklyCtaNewSubmit = async () => {
    if (!weeklyPackage) return;
    if (!input.repository.dataStore) throw new SocialContentWorkflowError('weekly_production_cta_evidence_required',409);
    await assertWeeklyCreativeRepairCtaAdmission({store:input.repository.dataStore,tenantId:input.tenantId,
      programId:String(weeklyPackage.programId),packageId:String(weeklyPackage.packageId),
      packageVersion:Number(weeklyPackage.version),publicationTaskId:String(weeklyPublication?.publicationTaskId??''),inheritedCallToAction:detail.brief.callToAction});
  };
  // The injected asset-supply adapter API offers no enforced per-provider-POST
  // hook. Its recoveryOnly flag cannot certify GET-only behavior. The default
  // weekly worker and built-in known-operation recovery do not use this port.
  admitExternalSupplyAdapters({adapters:input.assetSupplyAdapters??[],weekly:Boolean(weeklyPackage)});
  const templateBindingRef=socialObject(weeklyPublication?.contentTemplateBindingRef);
  const contentTemplateStructure=templateBindingRef?await (async()=>{if(!input.repository.dataStore)throw new SocialContentWorkflowError('content_template_storage_unavailable',409);return readWeeklyTemplateStructure(input.repository.dataStore,{tenantId:input.tenantId,programId:String(weeklyPackage?.programId),packageId:String(weeklyPackage?.packageId),packageVersion:Number(weeklyPackage?.version),publicationTaskId:String(weeklyPublication?.publicationTaskId)},templateBindingRef as unknown as import('../../shared/contracts/socialProgram.js').VersionedSocialRef);})():undefined;
  // A resumed weekly run must execute the baseline already sealed into its
  // pre-supply handoff. Re-grounding after the asset card is claimed changes
  // the evidence that authorized continuation of the original job.
  const weeklyExecutionGraphVersion=Number(weeklyPackage?.executionGraphVersion??1);
  const existingWeeklyPreSupply = weeklyExecutionGraphVersion>=2
    ? await readWeeklyPreSupplyHandoff(input.repository,input.tenantId,input.taskId)
    : null;
  const {baseline:initialBaseline,directorFormula,executionVerifiedContext}=await prepareSocialProductionScriptBaseline({
    repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,
    taskRecord,detail,originalReplication,replicationContext,contentTemplateStructure,verifiedContext,
    weeklyExecutionGraphVersion,existingWeeklyPreSupply,
  });
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
  const preparedMaterial=await prepareSocialProductionMaterialRouting({
    repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,
    runtime:input.runtime,graphApprovedContext:input.graphApprovedContext,detail,agentWorkflow,
    presenterExecutions,productionApproach,usesTypeAwareRouting,canonicalTypeAwareSupplyPlan,
    outputDir,
  });
  const {productionMode,paidVisualProvidersAllowed,rawAssets}=preparedMaterial;
  let {reviewedSupplyPlan,materialInputs}=preparedMaterial;
	  let productionAssetsToAnalyze = materialInputs.analyze;
	  const budgetRoutes = createProductionBudgetRouteReaders();
  const selectedPresenterIds = weeklyProductionPresenterIds(reviewedSupplyPlan);
  const readSelectedVoice = async () => {
    if (weeklyAuthority?.weeklyPackage) {
      if (!input.repository.dataStore) throw Error('user_input_required:weekly_default_voice_registry_missing');
      try { return await readWeeklyProductionVoice(input.repository.dataStore, input.tenantId, selectedPresenterIds); }
      catch (error) { throw Error(`user_input_required:${error instanceof Error ? error.message : 'weekly_default_voice_identity_missing'}`); }
    }
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
    frozenTrackSeconds:detail.brief.materialRoutingPolicyVersion==='type-aware.v3'?30:agentWorkflow.directorBrief.scenes.reduce((total,scene)=>total+scene.duration.endSeconds-scene.duration.startSeconds,0),
    requiresMeasuredAlignment:detail.brief.materialRoutingPolicyVersion==='type-aware.v3'||Boolean(selectedVoice)
      || reviewedSupplyPlan?.shots.some(shot=>shot.sourceStrategy==='authorized_digital_presenter')});
  if(usesTypeAwareRouting&&(detail.brief.materialRoutingPolicyVersion==='type-aware.v2'||detail.brief.materialRoutingPolicyVersion==='type-aware.v3')&&reviewedSupplyPlan){
    const allocationHash=socialRequestHash({runId:input.runId,baseline:activeBaseline,plan:reviewedSupplyPlan,
      executionPlan:agentWorkflow.executionPlan,maximumCny:productionBudgetMaximumCny({...detail.brief,scenes:agentWorkflow.directorBrief.scenes})});
    const saved=await readSocialBudgetMaterialAllocation({repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,allocationHash,baselineHash:socialRequestHash(activeBaseline),baselineContractHash:paidBaselineContractHash(activeBaseline),plan:reviewedSupplyPlan});
    if(saved){
      if(socialRequestHash(saved.plan)!==saved.planHash)throw Error('budget_material_routing_checkpoint_invalid');
      reviewedSupplyPlan=structuredClone(saved.plan);
    }else{
      if(input.assetSupplyRecoveryOnly)throw Error('budget_material_routing_recovery_snapshot_missing');
      reviewedSupplyPlan=await applyPresenterFirstBudgetRouting({plan:reviewedSupplyPlan,workflow:agentWorkflow,
        maximumCny:productionBudgetMaximumCny({...detail.brief,scenes:agentWorkflow.directorBrief.scenes}),quote:async candidate=>{
          const candidateInputs=socialContentMaterialAnalysisInputs({assets:rawAssets,plan:candidate,policyVersion:detail.brief.materialRoutingPolicyVersion});
          const quote=await prepareSocialContentProductionBudget({repository:input.repository,tenantId:input.tenantId,
            taskId:input.taskId,runId:input.runId,baseline:activeBaseline,assets:candidateInputs.analyze,
            localSupplyAssets:rawAssets,supplyPlan:candidate,graphApprovedContext:input.graphApprovedContext,
            initialVoiceExecutionMode:detail.brief.presenterSpeechReviewPolicy==='heygen_native_human_review'?'native_video':undefined,
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
    materialInputs=socialContentMaterialAnalysisInputs({assets:rawAssets,plan:reviewedSupplyPlan,policyVersion:detail.brief.materialRoutingPolicyVersion});
    productionAssetsToAnalyze=materialInputs.analyze;
  }
	  const frozenReviewedSupplyPlan = reviewedSupplyPlan ? structuredClone(reviewedSupplyPlan) : null;
	  let executionScenes=agentWorkflow.directorBrief.scenes;
  const prepareBudget=(measuredVoice?:PreparedWholeVoice)=>prepareSocialContentProductionBudget({measuredVoice,measuredDirectorScenes:measuredVoice?executionScenes:undefined,repository:input.repository,tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,baseline:activeBaseline,assets:productionAssetsToAnalyze,localSupplyAssets:rawAssets,supplyPlan:reviewedSupplyPlan,graphApprovedContext:input.graphApprovedContext,recoveryOnly:input.assetSupplyRecoveryOnly,initialVoiceExecutionMode:detail.brief.presenterSpeechReviewPolicy==='heygen_native_human_review'?'native_video':undefined,ports:{...budgetRuntimeReaders,...budgetRoutes,resolveBoundRoute: requirement => ['tts','tts_fallback','voice_clone','voice_asr','voice_alignment'].includes(requirement.stage) ? budgetRuntimeReaders.resolveBoundRoute!(requirement) : budgetRoutes.resolveBoundRoute(requirement),...input.runtime?.productionBudgetReadPorts,
      assertNewSubmit:assertWeeklyCtaNewSubmit,
      preparePresenterFirstFrameReviews:createSocialProductionFirstFramePreparation({execution:input,detail,baseline:activeBaseline,supplyPlan:reviewedSupplyPlan,directorScenes:()=>executionScenes,assertNewSubmit:assertWeeklyCtaNewSubmit})}});
  let productionBudget=await prepareBudget();
	  const defaultPaidRuntime = productionBudget.status === 'reserved' ? createSocialContentPaidRuntimePorts({scope:productionBudget.scope,routes:budgetRoutes,assertCurrent:assertCurrentContentExecutionActive}) : undefined;
	  const materialPaidContext = productionBudget.status === 'reserved'
      && productionBudget.reserved.intents.some(operation => operation.stage.startsWith('material_'))
      ? (() => {
          return createSocialContentMaterialPaidContext({scope: productionBudget.scope,
            requirements: productionBudget.requirements, intents: productionBudget.reserved.intents,
            permit: productionBudget.paidPermit, ports: input.runtime?.materialPaidRuntimePorts ?? defaultPaidRuntime!.material});
        })() : undefined;
  const sourceProductionBudget=productionBudget;
	  const productPaidContext: ProductPaidContext | undefined = sourceProductionBudget.status === 'reserved'
      && sourceProductionBudget.reserved.intents.some(operation => ['first_frame', 'first_frame_qa', 'video', 'video_qa', 'concept_video'].includes(operation.stage))
      ? (() => {
          const ports = input.runtime?.productPaidRuntimePorts ?? defaultPaidRuntime?.product;
          if (!ports) throw Error('whole_film_budget_product_runtime_ports_missing');
          const video = sourceProductionBudget.reserved.intents.filter(operation => operation.stage === 'video'||operation.stage==='concept_video');
          if (video.some(operation => 'outputTokens' in operation.maximumUnits) && !ports.measureVideoOutputTokens) {
            throw Error('whole_film_budget_video_usage_reader_missing');
          }
          return {scope: sourceProductionBudget.scope, requirements: sourceProductionBudget.requirements,
            routeBindings: sourceProductionBudget.routeBindings, intents: sourceProductionBudget.reserved.intents,
            permit: sourceProductionBudget.paidPermit, ...ports,
            readReservedCny(operationId) {
              const entry = sourceProductionBudget.reserved.ledger.status(sourceProductionBudget.scope)?.entries.find(row =>
                row.operationId === operationId && row.runId === sourceProductionBudget.scope.runId
                && row.planHash === sourceProductionBudget.scope.planHash && row.status !== 'rejected');
              if (!entry) throw Error('whole_film_budget_product_reservation_missing');
              return entry.reservedMicros / 1e6;
            },
            async assertRecovery(operationId) {await sourceProductionBudget.paidPermit.assertRecovery(operationId);},
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
		  let assets = [...analyzed.assets, ...materialInputs.productReferences];const splitSupplyPlan=frozenReviewedSupplyPlan??detail.assetSupplyPlan??null,splitPresenterShotIds=splitSupplyPlan?socialAssetSupplyPhaseShotIds(splitSupplyPlan).presenter_assets:[];
  const sourceContext=restoreV4SourceAssets({enabled:splitSupplyGraph,phase:input.graphPhase,tenantId:input.tenantId,plan:splitSupplyPlan,materialAnalysisInputHash:analyzed.inputHash,baselineVersion:activeBaseline.version,availableAssets:assets});let sourcePhaseResult=sourceContext.result;
  assets=sourceContext.assets;const sourceAssetsInputHash=sourceContext.inputHash;
  let preparedWholeVoice: PreparedWholeVoice | null = null;
  let preparedWholeVoiceInput: Parameters<typeof synthesizeStudioVoiceForAutomation>[0] | null = null;
  if (input.graphPhase!=='source_assets'&&productionBudget.status === 'reserved' && productionBudget.requirements.some(requirement => requirement.stage === 'voice_alignment')) {
    const direction = socialDirectorFrozenDirection({baseline: activeBaseline, formula: directorFormula, duration: 0});
    const text = socialDirectorSpokenNarration(activeBaseline.scenes.map(scene => ({voiceover:scene.voiceover || scene.narration})),activeBaseline.language);
    preparedWholeVoiceInput = {tenantId:input.tenantId,text,language:activeBaseline.language,voice:selectedVoice?.logicalVoice || direction.voiceover.voice,
      style:{preset:direction.voiceover.preset,speed:direction.voiceover.speed,pauseStyle:direction.voiceover.pauseStyle}};
    preparedWholeVoice = await prepareSocialContentWholeVoice({
      funding:{scope:productionBudget.scope,requirements:productionBudget.requirements,routeBindings:productionBudget.routeBindings,
        intents:productionBudget.reserved.intents,permit:productionBudget.paidPermit,assertCurrent:assertSelectedVoiceCurrent,voiceInput:preparedWholeVoiceInput,presenterBinding:selectedVoice},
      voiceDriven:detail.brief.materialRoutingPolicyVersion==='type-aware.v3',targetDuration:agentWorkflow.directorBrief.scenes.reduce((total,scene)=>total+scene.duration.endSeconds-scene.duration.startSeconds,0),
      scenes:agentWorkflow.directorBrief.scenes.map(scene=>({shotId:scene.sceneId,spokenText:activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.voiceover || activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.narration || '',durationSeconds:scene.duration.endSeconds-scene.duration.startSeconds,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds})),
      sentenceScenes:detail.brief.materialRoutingPolicyVersion==='type-aware.v3' ? agentWorkflow.directorBrief.scenes.map(scene=>({shotId:scene.sceneId,spokenText:activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.voiceover || activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId)?.narration || '',lines:scene.voiceoverLines})) : undefined,
      synthesize:input.runtime?.synthesizeVoice,
      align:input.runtime?.alignVoice,
    });
  }
  if(preparedWholeVoice&&productionBudget.status==='reserved'&&productionBudget.voiceDrivenBudgetStage){
    executionScenes=projectMeasuredDirectorScenes({scenes:agentWorkflow.directorBrief.scenes,timeline:preparedWholeVoice.measuredSceneTimeline!});
  }
  if(splitSupplyGraph&&input.graphPhase==='voice'&&splitPresenterShotIds.length){await recordV4WholeVoiceCheckpoint({sourceAssetsInputHash,prepared:preparedWholeVoice,voiceInput:preparedWholeVoiceInput});return;}
  const measuredMaterials=await prepareMeasuredMaterialForExecution({execution:input,detail,plan:frozenReviewedSupplyPlan,
    baseline:activeBaseline,scenes:agentWorkflow.directorBrief.scenes,prepared:preparedWholeVoice,budget:productionBudget,
    assets,sourceResult:sourcePhaseResult,outputDirectory:outputDir});
  if(measuredMaterials){assets=measuredMaterials.assets;sourcePhaseResult=measuredMaterials.sourceResult;}
  if(preparedWholeVoice&&productionBudget.status==='reserved'&&productionBudget.voiceDrivenBudgetStage)productionBudget=await prepareBudget(preparedWholeVoice);
	  let assetSupplyExecution: SocialAssetSupplyExecution | null = null;
      let presenterMotherExecution:PresenterMotherExecutionResult|null=null;
      let executedSupplyPlan:SocialAssetSupplyPlan|null=null;
	  if (detail.assetSupplyPlan) {
      const originalAssetSupplyInputHash = socialAssetSupplyCheckpointInputHash({
        materialAnalysisInputHash: analyzed.inputHash,
        baselineVersion: activeBaseline.version,
        assetSupplyPlan: (detail.brief.materialRoutingPolicyVersion==='type-aware.v2'||detail.brief.materialRoutingPolicyVersion==='type-aware.v3') ? frozenReviewedSupplyPlan! : detail.assetSupplyPlan,
        executionPlanId: agentWorkflow.executionPlan.executionPlanId,
        executionPlanVersion: agentWorkflow.executionPlan.version,
      });
	      const presenterAssetsInputHash=splitSupplyGraph&&!splitPresenterShotIds.length?sourceAssetsInputHash:splitSupplyGraph?socialAssetSupplyPhaseInputHash({phase:'presenter_assets',plan:splitSupplyPlan!,materialAnalysisInputHash:analyzed.inputHash,baselineVersion:activeBaseline.version,voiceOutputSha256:preparedWholeVoice?.wholeTrackSha256??null}):'';
	      const originalSupplyInputHash=splitSupplyGraph&&input.graphPhase==='source_assets'?sourceAssetsInputHash:splitSupplyGraph?presenterAssetsInputHash
        :selectedVoice?socialRequestHash({originalAssetSupplyInputHash,presenterVoiceBinding:selectedVoice,wholeTrackSha256:preparedWholeVoice?.wholeTrackSha256 || null,presenterOperations:productionBudget.status==='reserved'?productionBudget.reserved.intents.filter(intent=>intent.stage==='presenter_video').map(intent=>intent.operationId).sort():[],approvedIntroPolicy:'strict-first-frame-v1'}):originalAssetSupplyInputHash;
      const assetSupplyInputHash=measuredMaterials?socialRequestHash({originalSupplyInputHash,measuredMaterialBinding:measuredMaterials.executionBindingHash}):originalSupplyInputHash;
      const presenterGroupRequirements=productionBudget.status==='reserved'?productionBudget.requirements.filter(requirement=>requirement.stage==='presenter_video'&&requirement.presenterGroupId&&!requirement.presenterGroupId.startsWith('presenter-motion:')):[];
      if(input.graphPhase!=='source_assets'&&selectedVoice&&presenterExecutions.some(selection=>selection.providerId==='heygen')&&!presenterGroupRequirements.length)throw Error('presenter_mother_budget_group_missing');
      const frozenMotherGrouping=presenterGroupRequirements.length&&reviewedSupplyPlan
        ? freezePresenterMotherSegments({taskId:input.taskId,referenceAnalysisHash:socialRequestHash(detail.referenceVideoAnalysis??null),slots:executionScenes.map(scene=>{const frozen=presenterGroupRequirements.find(requirement=>requirement.presenterGroupShotIds?.includes(scene.sceneId));const selected=Boolean(frozen);const baseline=activeBaseline.scenes.find(item=>item.sceneId===scene.sceneId);return{slotId:scene.sceneId,referenceShotId:scene.referenceShotId||scene.sceneId,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds,spokenText:baseline?.voiceover||baseline?.narration||'',materialType:selected?'talking_head':'unknown',frontFacing:selected,lipSyncRequired:selected,...(frozen?.presenterVisualCompatibilityHash?{visualCompatibilityHash:frozen.presenterVisualCompatibilityHash}:{})};})})
        : null;
	      const supplyCheckpoint=splitSupplyGraph&&['source_assets','presenter_assets'].includes(String(input.graphPhase))?null:readCurrentContentExecutionCheckpoint<SupplyCheckpoint>({stage:'social.asset_supply',version:'1',inputHash:assetSupplyInputHash});
      const restoredAssets = supplyCheckpoint ? restoreSocialAssetSupplyCheckpointAssets({
	        tenantId:input.tenantId,availableAssets: assets,
        selectedAssets: supplyCheckpoint.selectedAssets,
      }) : null;
      let assetSupplyCheckpointReused = Boolean(supplyCheckpoint && restoredAssets);
      let motherParentRecovery=false;
      if (assetSupplyCheckpointReused && supplyCheckpoint) {
        if(presenterGroupRequirements.length){
          const mother=(supplyCheckpoint as typeof supplyCheckpoint&{presenterMotherExecution?:PresenterMotherExecutionResult}).presenterMotherExecution;
          if(!frozenMotherGrouping||!preparedWholeVoice||productionBudget.status!=='reserved')throw Error('presenter_mother_cached_qa_unverified');
          const audioShaBySegment=new Map<string,string>();
          for(const group of frozenMotherGrouping.groups){
            const clip=await readPreparedWholeVoiceScene({prepared:preparedWholeVoice,scope:productionBudget.scope,shotId:group.segmentId,
              memberShotIds:group.memberSlotIds,spokenText:group.mergedSpokenText,assertCurrent:assertCurrentContentExecutionActive});
            if(clip.clipSha256!==createHash('sha256').update(await fsp.readFile(clip.filePath)).digest('hex'))throw Error('presenter_mother_cached_frozen_audio_bytes_changed');
            audioShaBySegment.set(group.segmentId,clip.clipSha256);
          }
          assetSupplyCheckpointReused=await canReusePresenterMotherCheckpoint(()=>assertRestoredPresenterMotherExecution({speechReviewPolicy:detail.brief.presenterSpeechReviewPolicy,grouping:frozenMotherGrouping,execution:mother,frozenAudioSha256BySegment:audioShaBySegment,assets:restoredAssets!}));
          motherParentRecovery=!assetSupplyCheckpointReused;
        }
      }
      if(assetSupplyCheckpointReused&&supplyCheckpoint){
        assets = restoredAssets as ProductionAsset[];
        assetSupplyExecution = structuredClone(supplyCheckpoint.assetSupplyExecution);
        executedSupplyPlan = supplyCheckpoint.executedSupplyPlan
          ? structuredClone(supplyCheckpoint.executedSupplyPlan)
          : null;
        presenterMotherExecution=(supplyCheckpoint as typeof supplyCheckpoint&{presenterMotherExecution?:PresenterMotherExecutionResult}).presenterMotherExecution??null;
      } else {
        if(motherParentRecovery)assets=restoredAssets!.filter(asset=>!asset.id.startsWith('presenter-mother-crop-')) as ProductionAsset[];
        await assertWeeklyProductionMaterialAdmission(input,input.materialEvidencePorts?.materialPorts,input.materialEvidencePorts);
        // Whole-track scenes require an explicitly frozen audio-driven video consumer.
        // The legacy environment bridge submits text and its separate budget.
        const environmentPresenter = input.graphPhase!=='source_assets' && paidVisualProvidersAllowed && input.repository.dataStore
          ? preparedWholeVoice && productionBudget.status==='reserved'
            ? {ports:createWholeTrackSocialHeyGenBridge({store:input.repository.dataStore,prepared:preparedWholeVoice,
                taskVersion:String(taskRecord.version),apiKey:process.env.HEYGEN_API_KEY||'',
                funding:{scope:productionBudget.scope,requirements:productionBudget.requirements,routeBindings:productionBudget.routeBindings,
                  intents:productionBudget.reserved.intents,permit:productionBudget.paidPermit,assertCurrent:assertCurrentContentExecutionActive,
                  assertNewSubmit:motherParentRecovery?async()=>assertPresenterMotherRecoveryReadOnly():assertWeeklyCtaNewSubmit,
                  readReservedCny(operationId){
                    const entry=productionBudget.reserved.ledger.status(productionBudget.scope)?.entries.find(row=>row.operationId===operationId&&row.runId===productionBudget.scope.runId&&row.planHash===productionBudget.scope.planHash&&row.status!=='rejected');
                    if(!entry)throw Error('whole_track_heygen_reservation_missing');return entry.reservedMicros/1e6;
                  },
                  async assertLivePresenter(route,request,credentialSha256){
                    // The provider look/wallet GETs cannot prove that the
                    // enterprise's retained private import and voice source
                    // are still valid. Re-read those original records before
                    // every new weekly upload or provider submission.
                    if (weeklyAuthority?.weeklyPackage) await assertSelectedVoiceCurrent();
                    const binding=await readTrustedHeyGenRuntimeBinding({tenantId:input.tenantId,presenterAssetId:request.presenter.presenterAssetId,expectedVersion:request.presenter.assetVersion},{store:input.repository.dataStore!,assertCurrent:assertCurrentContentExecutionActive});
                    if(!binding||binding.credentialSha256!==credentialSha256||binding.avatarId!==request.presenter.providerPresenterId||binding.voiceId!==request.presenter.providerVoiceId||binding.authorizationRef!==request.presenter.authorizationRef||binding.consentRef!==request.presenter.consentRef||binding.model!==route.model||binding.accountRef!==route.accountRef||route.routeEvidenceRef!==heyGenRuntimeRouteEvidence(binding))throw Error('whole_track_heygen_approved_person_changed');
                  },
                }})}
            : weeklyPackage ? null : createEnvironmentSocialHeyGenBridge(input.repository.dataStore, input.tenantId)
          : null;
        const existingAdapters = existingAssetSupplyAdapters().filter(adapter => (
          paidVisualProvidersAllowed
            || adapter.adapterId === 'existing_customer_asset.v1'
            || (productionApproach === 'material_polish' && adapter.adapterId === 'system_safe_motion_graphics.v1')
        ));
        const motionSelections=input.graphPhase==='source_assets'?[]:presenterExecutions.filter(selection=>selection.providerId==='seedance');
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
            const confirmation=await readCurrentConfirmedPresenterFirstFrame(input.repository.dataStore,{scope:productionBudget.scope,groupId,presenterGroupContractHash:requirement.presenterGroupContractHash,presenterAssetId:requirement.presenterAssetId});
            if(!confirmation)throw Error('seedance_presenter_first_frame_confirmation_missing');
            const localPath=path.resolve(MEDIA_ROOT,decodeURIComponent(confirmation.approval.compositeFirstFrameUrl.replace(/^\/media\//,'')));
            if(!localPath.startsWith(path.resolve(MEDIA_ROOT,'tenants',input.tenantId)+path.sep))throw Error('seedance_presenter_first_frame_not_owned');
            const approvedFirstFrame={approvalRecordId:`social-presenter-first-frame-approval:${confirmation.approval.recordHash}`,approvalRecordHash:confirmation.approval.recordHash,presenterGroupContractHash:requirement.presenterGroupContractHash,url:confirmation.approval.compositeFirstFrameUrl,localPath,sha256:confirmation.approval.compositeFirstFrameSha256,
              targetAspectRatio:confirmation.approval.targetAspectRatio??'9:16',
              ...(confirmation.approval.assetProvenance?{assetProvenance:structuredClone(confirmation.approval.assetProvenance)}:{}),...(confirmation.approval.schemaVersion==='social-presenter-first-frame-approval.v3'?{originalSceneApproval:structuredClone(confirmation.approval)}:{})};
            const bridge=createEnvironmentSocialSeedancePresenterBridge({store:input.repository.dataStore,scope:productionBudget.scope,
              maximumCostCny:productionBudgetMaximumCny({...detail.brief,scenes:executionScenes}),qaModel:qa.route.model,
              authorizeBudget:request=>funding.authorize(request.shotId,request.maximumCostCny),assertCurrent:assertCurrentContentExecutionActive,
              beforePaidSubmit:(stage,request,body)=>funding.beforeSubmit(request.shotId,stage,body),
              recordPaidReceipt:(stage,request,receipt)=>funding.receipt(request.shotId,stage,receipt),
            });
            if(!bridge.ports)throw Error('seedance_presenter_runtime_unavailable');
            const adapter=createSocialDigitalPresenterAdapter(bridge.ports);
            motionAdapters.push({...adapter,adapterId:`seedance-presenter:${selection.sceneId}`,async execute(context){
              if(context.shot.shotId!==selection.sceneId)return null;
              if(context.shot.digitalHumanPlan?.method!=='reenact'||(context.shot.digitalHumanPlan as typeof context.shot.digitalHumanPlan&{silentMotion?:boolean}).silentMotion!==true)throw Error('seedance_presenter_frozen_motion_plan_changed');
              const director=executionScenes.find(scene=>scene.sceneId===selection.sceneId);
              assertSocialReferenceBackgroundAssetCurrent({lock:context.shot.referenceBackgroundAssetLock,
                referenceReuse:detail.brief.referenceReuse,referenceAnalysis:detail.referenceVideoAnalysis,
                expectedReferenceShotId:director?.referenceShotId});
              return adapter.execute({...context,shot:{...context.shot,approvedFirstFrame} as typeof context.shot});
            }});
          }
        }
        let motherSupply:Awaited<ReturnType<typeof preparePresenterMotherSupply>>|null=null;
        if(environmentPresenter?.ports&&presenterGroupRequirements.length&&reviewedSupplyPlan){
          const referenceAnalysis=detail.referenceVideoAnalysis,budgetScope=productionBudget.scope;
          if(!budgetScope)throw Error('presenter_first_frame_scope_missing');
          const directorById=new Map(executionScenes.map(scene=>[scene.sceneId,scene]));
          const baselineById=new Map(activeBaseline.scenes.map(scene=>[scene.sceneId,scene]));
          const grouping=frozenMotherGrouping;
          if(!grouping)throw Error('presenter_mother_grouping_missing');
          const frozenGroups=readCurrentContentExecutionCheckpoint<{plan:{presenterGroups?:import('./socialContentPaidOperationPlan.js').FrozenPresenterGroup[]}}>({stage:'social.whole_film_budget',version:'1',inputHash:budgetScope.planHash})?.plan.presenterGroups;
          const approvalGroups=buildSocialPresenterMotherSceneSources({groups:grouping.groups,requirements:presenterGroupRequirements,frozenGroups,directorScenes:executionScenes,reference:referenceAnalysis,aspectRatio:detail.brief.aspectRatio||'9:16'});
          const confirmed=await Promise.all(approvalGroups.map(group=>input.repository.dataStore?readCurrentConfirmedPresenterFirstFrame(input.repository.dataStore,{scope:budgetScope,groupId:group.groupId,presenterGroupContractHash:group.presenterGroupContractHash,presenterAssetId:group.presenterAssetId}):Promise.resolve(null)));
          if(confirmed.some(item=>!item)){
            throw Error(`presenter_first_frame_confirmation_lost_after_budget_reservation:${approvalGroups.filter((_,index)=>!confirmed[index]).map(group=>group.groupId).join(',')}`);
          }
          const confirmedByGroup=new Map(confirmed.map(item=>[item!.approval.groupId,item!]));
          const underlying=createSocialDigitalPresenterAdapter(environmentPresenter.ports);
          if(!input.runtime?.evaluatePresenterMotherDynamicQa||!preparedWholeVoice)throw Error('presenter_mother_frozen_audio_and_lip_sync_qa_unavailable');
          if(detail.brief.presenterSpeechReviewPolicy!=='heygen_native_human_review')assertPresenterMotherSpeechQaReady();
          motherSupply=await preparePresenterMotherSupply({speechReviewPolicy:detail.brief.presenterSpeechReviewPolicy==='heygen_native_human_review'?'heygen_native_human_review':undefined,grouping,outputDirectory:path.join(outputDir,'presenter-mother'),provider:async request=>{
            const frozenRequirement=presenterGroupRequirements.find(requirement=>requirement.presenterGroupId===request.segmentId);
            if(!frozenRequirement||socialRequestHash(frozenRequirement.presenterGroupShotIds)!==socialRequestHash(request.memberSlotIds))throw Error('presenter_mother_budget_group_changed');
            const frozenAudio=await readPreparedWholeVoiceScene({prepared:preparedWholeVoice!,scope:budgetScope,shotId:request.segmentId,
              memberShotIds:request.memberSlotIds,spokenText:request.spokenText,assertCurrent:assertCurrentContentExecutionActive});
            if(frozenAudio.clipSha256!==createHash('sha256').update(await fsp.readFile(frozenAudio.filePath)).digest('hex'))throw Error('presenter_mother_frozen_audio_bytes_changed');
            const firstId=request.memberSlotIds[0]!,originalShot=reviewedSupplyPlan.shots.find(shot=>shot.shotId===firstId),originalScene=baselineById.get(firstId),director=directorById.get(firstId);
            if(!originalShot||!originalScene||!director)throw Error('presenter_mother_scene_missing');
            const visualContract=originalShot.visualContract?structuredClone(originalShot.visualContract):undefined;
            const confirmation=confirmedByGroup.get(request.segmentId);
            if(!confirmation)throw Error(`presenter_mother_confirmed_first_frame_missing:${request.segmentId}`);
            const approvedRelative=decodeURIComponent(confirmation.approval.compositeFirstFrameUrl.replace(/^\/media\//,''));
            const approvedLocalPath=path.resolve(MEDIA_ROOT,approvedRelative),approvedTenantRoot=path.resolve(MEDIA_ROOT,'tenants',input.tenantId);
            if(!approvedLocalPath.startsWith(approvedTenantRoot+path.sep))throw Error('presenter_mother_confirmed_first_frame_not_owned');
            const approvedFirstFrame={approvalRecordId:`social-presenter-first-frame-approval:${confirmation.approval.recordHash}`,approvalRecordHash:confirmation.approval.recordHash,presenterGroupContractHash:confirmation.approval.presenterGroupContractHash,url:confirmation.approval.compositeFirstFrameUrl,localPath:approvedLocalPath,sha256:confirmation.approval.compositeFirstFrameSha256,
              targetAspectRatio:confirmation.approval.targetAspectRatio??'9:16',
              ...(confirmation.approval.assetProvenance?{assetProvenance:structuredClone(confirmation.approval.assetProvenance)}:{}),...(confirmation.approval.schemaVersion==='social-presenter-first-frame-approval.v3'?{originalSceneApproval:structuredClone(confirmation.approval)}:{})};
            if(visualContract){visualContract.action.startSeconds=0;visualContract.action.endSeconds=request.durationSeconds;visualContract.action.peakSeconds=request.durationSeconds*.58;}
            const executionShot={...originalShot,shotId:request.segmentId,approvedFirstFrame,...(visualContract?{visualContract}: {})} as typeof originalShot&{approvedFirstFrame:typeof approvedFirstFrame};
            const retryIntent=productionBudget.status==='reserved'?productionBudget.reserved.intents.find(intent=>intent.stage==='presenter_video'&&intent.correction?.presenterGroupId===request.segmentId&&intent.correction.attempt===2):null;
            const result=await underlying.execute({tenantId:input.tenantId,taskId:input.taskId,...(retryIntent?{operationId:retryIntent.operationId}:{}),outputDirectory:path.join(outputDir,'presenter-mother-source'),availableAssets:assets,shot:executionShot,baselineScene:{...originalScene,sceneId:request.segmentId,voiceover:request.spokenText,narration:request.spokenText,referenceStructure:originalScene.referenceStructure?{...originalScene.referenceStructure,sourceTiming:{startSeconds:0,endSeconds:request.durationSeconds,durationSeconds:request.durationSeconds}}:undefined}});
            if(!result?.asset.localPath||!result.asset.contentHash||!result.asset.providerTaskId||(detail.brief.presenterSpeechReviewPolicy==='heygen_native_human_review'&&result.providerId!=='heygen'))throw Error('presenter_mother_provider_output_missing');
            const approvedIntro=await ensureStrictPresenterFirstFrames({tenantId:input.tenantId,runId:budgetScope.runId,groupId:request.segmentId,
              sourcePath:result.asset.localPath,sourceSha256:result.asset.contentHash,approvedPath:approvedFirstFrame.localPath,approvedSha256:approvedFirstFrame.sha256});
            const visualQa=await input.runtime!.evaluatePresenterMotherDynamicQa!({tenantId:input.tenantId,taskId:input.taskId,runId:budgetScope.runId,segmentId:request.segmentId,segmentHash:request.segmentHash,presenterAssetId:frozenRequirement.presenterAssetId!,outputPath:approvedIntro.outputPath,outputSha256:approvedIntro.outputSha256,spokenText:request.spokenText,durationSeconds:request.durationSeconds});
            const speechQa=await inspectPresenterMotherSpeechQa({segmentHash:request.segmentHash,outputPath:approvedIntro.outputPath,
              outputSha256:approvedIntro.outputSha256,frozenAudioPath:frozenAudio.filePath,frozenAudioSha256:frozenAudio.clipSha256,
              reviewPolicy:detail.brief.presenterSpeechReviewPolicy,workDir:path.join(outputDir,'presenter-mother-qa',request.segmentId)});
            const dynamicQa={...visualQa,...speechQa,reportHash:socialRequestHash({visual:visualQa,speech:speechQa}),
              receiptRef:`presenter-mother-qa:${visualQa.reportHash}:${speechQa.audioTrackReportHash}`};
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
            const selected = structuredClone(measuredMaterials?.effectivePlan??reviewedSupplyPlan);
            const heygenScenes = new Set(presenterExecutions.filter(item => item.providerId === 'heygen').map(item => item.sceneId));
            return { ...selected, shots: selected.shots.map(shot => heygenScenes.has(shot.shotId)
              ? { ...shot, sourceStrategy: 'authorized_digital_presenter' as const, fallbackSourceStrategy: null }
              : shot) };
          })(),
          baseline: activeBaseline,
          availableAssets: assets,
	          ...(splitSupplyGraph&&['source_assets','presenter_assets'].includes(String(input.graphPhase))?{selectedShotIds:socialAssetSupplyPhaseShotIds(splitSupplyPlan!)[input.graphPhase as SocialAssetSupplyPhase]}:{}),
          adapters: paidVisualProvidersAllowed ? socialProductionSupplyAdapters({
            recoveryOnly: input.assetSupplyRecoveryOnly||motherParentRecovery, hasPresenterExecution: Boolean(presenterExecutions.length),
            custom: [...(input.assetSupplyRecoveryOnly?motionAdapters:[]),...(motherSupply?[motherSupply.adapter]:[]),...(!motherParentRecovery?(input.assetSupplyAdapters??[]):[])], free: existingAdapters,
            paid: () => [...motionAdapters,createSocialProductSceneAdapter(createEnvironmentSeedanceProductScenePorts({
              maximumCostCny: detail.brief.materialRoutingPolicyVersion === 'type-aware.v1' ? productionBudgetMaximumCny({...detail.brief,scenes:executionScenes}) : undefined,
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
              // The generic visual adapter has its own budget path, not this
              // weekly run's immutable paid permit or claim recheck. Never
              // offer it as a fallback for a frozen weekly production.
              ...(!weeklyPackage?[createConfiguredSocialAiVisualAdapter({paidContext:productPaidContext,requireVideo:reviewedSupplyPlan!.shots.some(shot=>shot.materialRouting?.materialType==='general'&&shot.sourceStrategy==='non_evidentiary_ai_visual')})]:[])],
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
	        if(splitSupplyGraph&&['source_assets','presenter_assets'].includes(String(input.graphPhase))){const phase=input.graphPhase as SocialAssetSupplyPhase,finished=await finishV4AssetSupplyPhase({phase,inputHash:phase==='source_assets'?sourceAssetsInputHash:presenterAssetsInputHash,plan:splitSupplyPlan!,supplied,source:sourcePhaseResult});if(phase==='source_assets')sourcePhaseResult=finished;assets=finished.assets;assetSupplyExecution=finished.execution;executedSupplyPlan=measuredMaterials?.effectivePlan??finished.plan;}
      }
	  if(splitSupplyGraph&&input.graphPhase==='source_assets'&&splitPresenterShotIds.length)return;
      for (const selection of presenterExecutions) {
        const receipt = assetSupplyExecution.shots.find(shot => shot.sceneId === selection.sceneId);
        const motherCrop=presenterMotherExecution?.slotCropReceipts.find(crop=>crop.slotId===selection.sceneId);
        if(motherCrop){
          const cropAsset=assets.find(asset=>asset.id===receipt?.assetId);
          if(!receipt||receipt.providerId!=='presenter_mother_segment.v1'||receipt.sourceStrategy!=='authorized_digital_presenter'||receipt.fallbackApplied||receipt.sourceRef!==`presenter-mother-crop:${motherCrop.receiptHash}`
            ||cropAsset?.id!==`presenter-mother-crop-${motherCrop.receiptHash.slice(0,24)}`||cropAsset.sourceId!==selection.sceneId
            ||!cropAsset.segments?.some(segment=>segment.slotCropReceiptHash===motherCrop.receiptHash))throw new Error(`presenter_mother_receipt_mismatch:${selection.sceneId}`);
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
	  if(splitSupplyGraph&&['source_assets','presenter_assets'].includes(String(input.graphPhase)))return;
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
  const planAndDirector = await prepareSocialContentProductionPlanAndDirector({
    execution: input, detail, taskRecord, agentWorkflow, baseline: activeBaseline, assets,
    rawAssets, assetSupplyExecution, productionApproach, productionMode, measuredSceneTimeline:preparedWholeVoice?.measuredSceneTimeline,
    analysisFailures: analyzed.failures, replicationContext, contentTemplateStructure,
    verifiedContext: executionVerifiedContext, formula: directorFormula, outputDir,
    selectedVoice, revisionParent, reviewDirective,
  });
  activeBaseline = planAndDirector.baseline;
  assets = planAndDirector.assets;
  const { plan, adaptation, preparedDirector } = planAndDirector;
  let { directorPlan, persistedDirectorPlan, directorSummary, contentHandoff } = preparedDirector;
  const directorCheckpointInputHash = preparedDirector.checkpointInputHash;
    let transientVoicePath = '';
    let retainVoiceForRecovery = false;
    try {
      const preparedVoice = await prepareSocialContentProductionVoice({
        execution: input, detail, agentWorkflow,
        director: { directorPlan, persistedDirectorPlan, directorSummary, contentHandoff },
        directorCheckpointInputHash, taskRecord, baseline: activeBaseline,
        verifiedContext: executionVerifiedContext, productionBudget, selectedVoice,
        preparedWholeVoice, preparedWholeVoiceInput, assertWeeklyCtaNewSubmit,recordGraphCheckpoint:!splitSupplyGraph||!splitPresenterShotIds.length,
      });
      ({ directorPlan, persistedDirectorPlan, directorSummary, contentHandoff } = preparedVoice);
      const { voice, duration, voiceDuration, preserveReferenceTimeline,
        narrationCheckpointInputHash, narrationCheckpointReused, voiceOutputSha256 } = preparedVoice;
      ({ transientVoicePath, retainVoiceForRecovery } = preparedVoice);
      if (input.graphPhase === 'voice') return;
  const adaptedScript = socialDirectorScriptText(contentHandoff, duration, preserveReferenceTimeline,detail.brief.materialRoutingPolicyVersion==='type-aware.v3'?voice.cues:undefined);
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
  const captionTiming=preparedWholeVoice&&detail.brief.materialRoutingPolicyVersion!=='type-aware.v3'?assertMeasuredCaptionTiming({measured:preparedWholeVoice.voice.cues,captions:captionCues,duration}):null;
  if(preparedWholeVoice&&captionTiming)await recordCurrentContentExecutionCheckpoint({stage:'social.measured_caption_timing',version:'1',inputHash:captionTiming.cueTimelineHash,payload:{...captionTiming,audioSha256:preparedWholeVoice.wholeTrackSha256,alignmentReceiptRef:preparedWholeVoice.alignmentReceiptRef,alignmentReceiptSha256:createHash('sha256').update(await fsp.readFile(preparedWholeVoice.alignmentReceiptRef)).digest('hex')}});
  if (input.graphPhase) contentHandoff = await rebindSocialGraphRenderSources(contentHandoff, assets);
  const timeline = socialDirectorRenderTimeline(contentHandoff, duration, captionCues, preserveReferenceTimeline,detail.brief.materialRoutingPolicyVersion==='type-aware.v3')
    .map((clip,index)=>({...clip,sceneId:contentHandoff.scenes[index]!.sceneId}));
  const trimCheckpointInputHash = socialRequestHash({
    directorPlanHash: directorPlan.lineageHash,
    voiceSha256: voiceOutputSha256,
    timeline: timeline.map(clip => ({
      sceneId: clip.sceneId, type: clip.type, sourceAssetId: contentHandoff.scenes.find(scene => scene.sceneId === clip.sceneId)?.source.assetId,
      trimStart: clip.trimStart, trimEnd: clip.trimEnd, targetStart: clip.targetStart, targetEnd: clip.targetEnd, speed: clip.speed,
    })),
  });
  await recordCurrentContentExecutionCheckpoint({
    stage: 'social.graph_trim', version: '1', inputHash: trimCheckpointInputHash,
    payload: { sceneCount: timeline.length, durationSeconds: duration, timelineHash: socialRequestHash(timeline), directorPlanHash: directorPlan.lineageHash, voiceOutputSha256 },
  });
  if (input.graphPhase === 'trim') return;
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
  const compositeManifest = await prepareSocialContentProductionRenderManifest({
    execution: input, contentHandoff, voice, duration, voiceDuration, narrationCheckpointReused,
    selectedVoice, assertSelectedVoiceCurrent, preparedWholeVoice, timeline, bgm, captionCues,
    verifiedContext: executionVerifiedContext, trimCheckpointInputHash, assets,
  }); if(detail.brief.materialRoutingPolicyVersion==='type-aware.v3')Object.assign(compositeManifest,{videoWorkflowPolicy:'voice-driven-slots.v1'});
  if (input.graphPhase === 'effects') return;
  const result = await executeSocialRenderStage({ tenantId: input.tenantId, taskId: input.taskId, runId: input.runId,
    manifest: compositeManifest, outputDirectory: outputDir, render: input.runtime?.renderComposite ?? composite,
    checkpointEnabled: Boolean(input.graphPhase) });
  if (input.graphPhase === 'render') return;
  const { quality, sceneQuality, audio, measuredDurationSeconds, technicalFailures,
    technicalApproved, technicalQualityReport } = await inspectSocialContentProductionTechnicalQuality({
    execution: input, detail, agentWorkflow, contentHandoff, assets, renderResult: result,
    manifest: compositeManifest as unknown as Record<string, unknown>, duration, timeline,
    preserveReferenceTimeline, bgmQualitySource, frozenVoiceCues: voice.cues,
  });
  if (input.graphPhase === 'technical_quality') return;
  const finalDelivery = await prepareSocialContentFinalDelivery({
    execution: input, detail, agentWorkflow, outputDir, outputPath: result.outputPath,
    duration, coverTimestamp: socialDirectorCoverTimestamp(contentHandoff, duration, captionCues, preserveReferenceTimeline,detail.brief.materialRoutingPolicyVersion==='type-aware.v3'),
    createCover: input.runtime?.createCover ?? createVideoCover,
    directorPlan, directorPlanReference: persistedDirectorPlan.reference,
    contentHandoff, rawAssets, assets, assetSupplyExecution, adaptedScript, timeline,
    measuredDurationSeconds, technicalApproved, technicalFailures, quality, sceneQuality, audio,
    productionMode,
  });
  const { stored, storedCover, productionResultId } = finalDelivery;
  let cacheInput: InitialSocialSceneCacheInput | null = null;if (executedSupplyPlan && assetSupplyExecution) {cacheInput = buildInitialSocialSceneCacheInput({
      tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,productionResultId,workflow:agentWorkflow,referenceAnalysis: detail.referenceVideoAnalysis ?? null,
      plan:executedSupplyPlan,baseline:activeBaseline,execution:assetSupplyExecution,assets,contentHandoff,manifest:compositeManifest as unknown as Record<string,unknown>,voicePath:voice.localPath,bgmUrl:bgm.url||null,report:technicalQualityReport,coverSha256:storedCover.sha256,renderSha256:stored.sha256,captionCues,adaptedScript,timeline,
      ...(presenterMotherExecution ? { presenterMotherExecution } : {}),
      ...(preparedWholeVoice && productionBudget.status === 'reserved' && productionBudget.voiceDrivenBudgetStage
        ? { measuredVoiceProof: {prepared:preparedWholeVoice,scope:productionBudget.scope,scenes:agentWorkflow.directorBrief.scenes} } : {}) });if (weeklyAuthority) await prepareSocialCacheFinalization(cacheInput);
  }
  const artifactResult = await createSocialContentProductionArtifact({
    execution: input, detail, taskRecord, revisionParent, reviewDirective, agentWorkflow,
    baseline: activeBaseline, manifest: compositeManifest as unknown as Record<string, unknown>,
    contentHandoff, directorPlan, directorSummary,
    directorPlanReference: persistedDirectorPlan.reference, delivery: finalDelivery,
    technical: { quality, sceneQuality, audio, measuredDurationSeconds, technicalFailures,
      technicalApproved, technicalQualityReport },
    voice, voiceDuration, captionCues, captionTiming, preparedWholeVoice, adaptation, plan,
    executedSupplyPlan, assetSupplyExecution, assets, bgm, adaptedScript,
  });
  await finishSocialCacheFinalization(cacheInput, { repository: input.repository, tenantId: input.tenantId,
    taskId: input.taskId, runId: input.runId, artifactId: artifactResult.artifact.artifactId }, Boolean(weeklyAuthority));
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

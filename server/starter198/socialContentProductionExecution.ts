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
import { registerSocialContentFile, socialContentFileDownloadUrl, storeTransientSocialContentFile, type SocialContentBackendFilePort } from './socialContentFiles.js';
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
import { resolveSocialInspirationScript } from './socialContentScriptSources.js';
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
import { createEnvironmentSocialHeyGenBridge } from './socialContentHeyGenBridge.js';
import { replicationExecutionGaps, selectPresenterExecutions, verifyNamedPresenterLock, type PresenterExecutionSelection } from './socialContentPresenterExecutionPolicy.js';
import { buildSocialDirectorPlan, parseStoredSocialDirectorPlan, publicSocialDirectorPlanSummary, reviseSocialDirectorPlanForVoiceoverFit, socialDirectorContentHandoff, socialDirectorCoverTimestamp, socialDirectorRenderTimeline, socialDirectorVoiceAlignedCaptionCues, socialDirectorScriptText, type SocialDirectorBgmSelection, type SocialDirectorBgmTrack, type SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import { latestSocialDirectorPlanVersion, persistSocialDirectorPlanVersion, resolveSocialDirectorArtifactLineage } from './socialContentDirectorPlanVersions.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { socialProductionCollaborationFailures, socialProductionCollaborationTrace, socialProductionExecutionSceneForFinal } from './socialContentProductionCollaboration.js';
import { socialContentReviewAdmissionAllowed } from './socialContentTestBypass.js';
import { voiceLearningReadiness } from '../videoProduction/voiceQualityLearning.js';
const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as { composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }> };
import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, systemThemeGraphicAssets, applyZeroAssetTruthSafeNarration, socialReviewRevisionDirective, applySocialReviewRevision, createVideoCover } from './socialContentAutoProduction.js';
import { AUTO_SCHEMA, analyzeProductionAssets, existingAssetSupplyAdapters, finishExecution, productionAdaptation, resolveLockedBgm, selectDirectorBgm, writeExecutionStage } from './socialContentAutoProduction.js';
export interface SocialContentAutoProductionRuntime {
  selectDirectorBgm?: typeof selectDirectorBgm;
  synthesizeVoice?: typeof synthesizeStudioVoiceForAutomation;
  resolveBgm?: typeof resolveLockedBgm;
  renderComposite?: typeof composite;
  inspectVisuals?: typeof inspectRenderedVisuals;
  inspectScenes?: typeof inspectRenderedScenes;
  runFfmpeg?: typeof runVisualFfmpeg;
  createCover?: typeof createVideoCover;
  evaluateReplication?: typeof evaluateSocialReplicationResult;
  backendFilePort?: SocialContentBackendFilePort;
}

export const SOCIAL_SHOOTING_PLAN_SCHEMA = 'social-content.shooting-plan.v1';

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
  /** Optional providers are explicitly registered by the deployment. Missing
   * digital-human/stock/AI providers remain visible fallback attempts. */
  assetSupplyAdapters?: SocialAssetSupplyProviderAdapter[];
  /** Deterministic ports for worker-level tests and alternate local runtimes. */
  runtime?: SocialContentAutoProductionRuntime;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input);
  if (!detail) throw new Error('社媒内容任务不存在');
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
  const revisionParent = productionApproach === 'shooting_plan' ? undefined : [...detail.artifacts].reverse().find(artifact => artifact.kind === 'short_video'
    && artifact.status === 'changes_requested');
  const existing = detail.artifacts.find(artifact => artifact.origin === 'agent'
    && artifact.kind === targetArtifactKind
    && socialText(artifact.content?.workflowSchema) === targetWorkflowSchema
    && !['superseded', 'changes_requested'].includes(artifact.status));
  if (!revisionParent && existing) {
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
    if (agentWorkflow.directorBrief.scenes.some(scene => scene.productionRouting?.presenterVisible)) {
      const namedPresenter = await verifyNamedPresenterLock({
        store: input.repository.dataStore ?? null,
        tenantId: input.tenantId,
        name: detail.brief.requestedPresenterName,
        requestedPresenterAssetId: detail.brief.requestedPresenterAssetId,
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
      ? createEnvironmentSocialHeyGenBridge(input.repository.dataStore)
      : null;
    presenterExecutions = selectPresenterExecutions({
      detail,
      heygenReady: productionApproach === 'ai_enhanced' && Boolean(heygenBridge?.readiness.ready && heygenBridge.ports),
      // The currently registered social Seedance executor handles product
      // scenes, not enterprise-presenter first-frame reenactment.
      seedancePresenterReady: false,
      budgetReady: productionApproach === 'ai_enhanced' && Boolean(heygenBridge?.readiness.ready),
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
      plannedCostCny: agentWorkflow.executionPlan.scenes.reduce((sum, scene) => sum + scene.estimatedCostCny, 0),
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
  let baseline = parseStoredSocialScriptBaseline(taskRecord.script_baseline);
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
  const replicationBaselineOutdated = Boolean(detail.replicationScript?.shots.length
    && (baseline?.scenes.length !== detail.replicationScript.shots.length
      || detail.replicationScript.shots.some((shot, index) => (
        socialText(baseline?.scenes[index]?.voiceover) !== socialText(shot.spokenText || shot.captionText)
        || socialText(baseline?.scenes[index]?.caption) !== socialText(shot.captionText || shot.spokenText)
      ))));
  if (!baseline || baseline.groundingVersion !== SOCIAL_SCRIPT_GROUNDING_VERSION || replicationBaselineOutdated) {
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
    const inspiration = detail.theme?.themeId
      ? await resolveSocialInspirationScript({
          tenantId: input.tenantId,
          themeId: detail.theme.themeId,
          verifiedContext,
        })
      : null;
    baseline = freezeSocialScriptBaseline({
      brief: detail.brief,
      theme: detail.theme ?? null,
      formula: directorFormula,
      inspiration,
      replicationScript: detail.replicationScript ?? null,
      verifiedContext,
      lockedAt: new Date().toISOString(),
      previous: baseline,
    });
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
	  await withSocialContentRenderWorkspace(async outputDir => {
	  let activeBaseline = initialBaseline;
	  const productionMode = detail.brief.productionMode ?? 'concept_preview';
	  const paidVisualProvidersAllowed = productionApproach === 'ai_enhanced';
	  const zeroAssetRoute = detail.assetSupplyPlan?.productionRoute === 'zero_asset_generation';
	  const rawAssets = await taskProductionAssets({
	    tenantId: input.tenantId,
	    sources: detail.sources,
	    productRef: detail.brief.productRef,
	    themeId: detail.theme?.themeId ?? null,
	    productionMode,
	    outputDirectory: outputDir,
	    allowAuthorizedSharedLibrary: paidVisualProvidersAllowed,
	  }).catch(error => {
	    if (zeroAssetRoute) return [];
	    throw error;
	  });
	  const analyzed = await analyzeProductionAssets({ tenantId: input.tenantId, assets: rawAssets });
	  let assets = analyzed.assets;
	  let assetSupplyExecution: SocialAssetSupplyExecution | null = null;
	  if (detail.assetSupplyPlan) {
	    const environmentPresenter = paidVisualProvidersAllowed && input.repository.dataStore
	      ? createEnvironmentSocialHeyGenBridge(input.repository.dataStore)
	      : null;
	    const existingAdapters = existingAssetSupplyAdapters().filter(adapter => (
	      paidVisualProvidersAllowed
	        || adapter.adapterId === 'existing_customer_asset.v1'
	        || (productionApproach === 'material_polish' && adapter.adapterId === 'system_safe_motion_graphics.v1')
	    ));
	    const supplied = await executeSocialAssetSupplyPlan({
	      tenantId: input.tenantId,
	      taskId: input.taskId,
	      outputDirectory: outputDir,
        plan: (() => {
          const selected = assetSupplyPlanWithExecutionSelections(detail.assetSupplyPlan, agentWorkflow);
          const heygenScenes = new Set(presenterExecutions.filter(item => item.providerId === 'heygen').map(item => item.sceneId));
          return { ...selected, shots: selected.shots.map(shot => heygenScenes.has(shot.shotId)
            ? { ...shot, sourceStrategy: 'authorized_digital_presenter' as const, fallbackSourceStrategy: null }
            : shot) };
        })(),
	      baseline: activeBaseline,
	      availableAssets: assets,
	      adapters: paidVisualProvidersAllowed ? [
	        ...(input.assetSupplyAdapters ?? []).filter(adapter => !presenterExecutions.length
            || !adapter.sourceStrategies.includes('authorized_digital_presenter')),
	        createSocialProductSceneAdapter(createEnvironmentSeedanceProductScenePorts()),
	        ...(environmentPresenter?.ports ? [createSocialDigitalPresenterAdapter(environmentPresenter.ports)] : []),
	        createConfiguredSocialAiVisualAdapter(),
	        ...existingAdapters,
	      ] : existingAdapters,
	    });
	    // Only assets selected by the Director's per-shot router enter the edit.
	    assets = supplied.assets;
	    assetSupplyExecution = supplied.execution;
	    for (const selection of presenterExecutions) {
        const receipt = assetSupplyExecution.shots.find(shot => shot.sceneId === selection.sceneId);
        if (selection.providerId === 'heygen' && (!receipt || receipt.providerId !== 'heygen'
          || receipt.sourceStrategy !== 'authorized_digital_presenter' || receipt.fallbackApplied)) {
          throw new Error(`presenter_provider_receipt_mismatch:${selection.sceneId}`);
        }
      }
	    await writeExecutionStage({
	      ...input,
	      stage: 'asset_supply_completed',
	      message: paidVisualProvidersAllowed
	        ? '内容 Agent 已逐镜完成素材库与高质量生成能力路由。'
	        : '内容 Agent 已按逐句口播完成“我的素材”片段路由，未调用 Seedance 或数字人。',
	      extra: { assetSupplyExecution, presenterExecutions: presenterExecutions.map(selection => ({
          ...selection,
          receipt: assetSupplyExecution?.shots.find(shot => shot.sceneId === selection.sceneId) ?? null,
        })) },
	    });
	  }
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
        brief: detail.brief,
        theme: detail.theme ?? null,
        formula: null,
        inspiration: null,
        verifiedContext,
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
  let plan = buildSocialProductionPlan({ baseline: activeBaseline, assets, themeId: detail.theme?.themeId ?? null });
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
  if (assetSupplyExecution) plan = applyZeroAssetTruthSafeNarration(plan);
  if (reviewDirective) plan = applySocialReviewRevision(plan, reviewDirective);
  const adaptation = productionAdaptation(plan, assets.length);
  const taskDirectorPlan = parseStoredSocialDirectorPlan(taskRecord.director_plan);
  const recoveredDirectorVersion = taskDirectorPlan ? null : await latestSocialDirectorPlanVersion({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
  });
  const previousDirectorPlan = taskDirectorPlan ?? recoveredDirectorVersion?.plan ?? null;
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
	  const bgmSelection = await (input.runtime?.selectDirectorBgm ?? selectDirectorBgm)({
    tenantId: input.tenantId,
    themeId: detail.theme?.themeId ?? null,
    directorMood: reviewDirective?.musicMood
      || socialText(directorFormula?.direction?.music?.mood)
      || defaultDirectorMood,
    volume: Number(directorFormula?.direction?.music?.volume ?? 18),
  });
  let directorPlan = buildSocialDirectorPlan({
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
  let persistedDirectorPlan = await persistSocialDirectorPlanVersion({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
    plan: directorPlan,
    baseline: activeBaseline,
    verifiedContext,
  });
  let directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
  await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
    director_plan: directorPlan,
    updated_at: directorPlan.createdAt,
  });
  let contentHandoff = socialDirectorContentHandoff(directorPlan);
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
    let transientVoicePath = '';
    try {
      let voice: Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>> | null = null;
      let duration = 0;
      for (let revisionAttempt = 0; revisionAttempt <= 2; revisionAttempt += 1) {
        voice = await (input.runtime?.synthesizeVoice ?? synthesizeStudioVoiceForAutomation)({
          tenantId: input.tenantId,
          text: contentHandoff.narration,
          language: contentHandoff.outputSpec.language,
          voice: contentHandoff.direction.voiceover.voice,
          targetDuration: contentHandoff.outputSpec.targetDurationSeconds,
          style: {
            preset: contentHandoff.direction.voiceover.preset,
            speed: contentHandoff.direction.voiceover.speed,
            pauseStyle: contentHandoff.direction.voiceover.pauseStyle,
          },
        });
        transientVoicePath = voice.localPath || '';
        if (!voice.ok || !voice.localPath || !existsSync(voice.localPath) || !voice.cues?.length) {
          throw new Error(voice.error || '口播服务未返回可用音频和字幕时间轴');
        }
        if (socialText(voice.text) !== contentHandoff.narration) {
          throw new Error('内容 Agent 返回的口播与编导方案不一致，已停止生成');
        }
        duration = Math.max(1, Number(voice.duration || voice.cues.at(-1)?.end
          || contentHandoff.outputSpec.targetDurationSeconds));
        if (duration <= contentHandoff.outputSpec.maximumDurationSeconds + 0.25) break;
        if (revisionAttempt >= 2) {
          throw new Error(`director_revision_required:口播经过 2 次编导内部压缩仍为 ${duration.toFixed(1)} 秒，超过锁定素材 ${contentHandoff.outputSpec.maximumDurationSeconds.toFixed(1)} 秒`);
        }
        await writeExecutionStage({
          ...input,
          stage: 'director_revision_required',
          message: '实际口播超过素材时长，已退回编导 Agent 内部压缩；无需用户补填。',
          extra: {
            directorPlanId: directorPlan.directorPlanId,
            previousDirectorPlanVersion: directorPlan.version,
            measuredVoiceoverSeconds: duration,
            maximumMaterialSeconds: contentHandoff.outputSpec.maximumDurationSeconds,
            revisionAttempt: revisionAttempt + 1,
          },
        });
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
        transientVoicePath = '';
        directorPlan = reviseSocialDirectorPlanForVoiceoverFit({
          previous: directorPlan,
          measuredDurationSeconds: duration,
          createdAt: new Date().toISOString(),
        });
        persistedDirectorPlan = await persistSocialDirectorPlanVersion({
          repository: input.repository,
          tenantId: input.tenantId,
          taskId: input.taskId,
          plan: directorPlan,
          baseline: activeBaseline,
          verifiedContext,
        });
        directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
        await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
          director_plan: directorPlan,
          updated_at: directorPlan.createdAt,
        });
        contentHandoff = socialDirectorContentHandoff(directorPlan);
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
  const adaptedScript = socialDirectorScriptText(contentHandoff, duration);
  const bgm = await (input.runtime?.resolveBgm ?? resolveLockedBgm)(input.tenantId, contentHandoff);
  const captionCues = socialDirectorVoiceAlignedCaptionCues(contentHandoff, voice.cues, duration);
  const timeline = socialDirectorRenderTimeline(contentHandoff, duration, captionCues);
  await writeExecutionStage({
    ...input,
    stage: 'rendering',
    message: '内容 Agent 正在自动剪辑、混音并烧录字幕。',
    extra: { duration, sceneCount: timeline.length, voiceQuality: voice.qualityReport ?? null },
  });
  const result = await (input.runtime?.renderComposite ?? composite)({
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
        fontScale: contentHandoff.direction.subtitles.fontScale,
        bottomRatio: contentHandoff.direction.subtitles.bottomRatio,
        productNames: verifiedContext.productName ? [verifiedContext.productName] : [],
      },
    },
  }, undefined, outputDir);
  if (!result.ok || !result.outputPath || !existsSync(result.outputPath)) {
    throw new Error(result.error || '视频渲染没有生成输出文件');
  }
  await writeExecutionStage({
    ...input,
    stage: 'quality_check',
    message: '内容 Agent 正在检查成片画面、音轨和字幕。',
  });
  const quality = await (input.runtime?.inspectVisuals ?? inspectRenderedVisuals)({
    outputPath: result.outputPath,
    expectedDuration: duration,
    expectedUniqueScenes: contentHandoff.scenes.length,
  });
  if (!quality.passed) throw new Error(`成片画面质检未通过：${quality.failures.join('；')}`);
  const sceneQuality = await (input.runtime?.inspectScenes ?? inspectRenderedScenes)({
    outputPath: result.outputPath,
    scenes: captionCues,
    requireDistinct: true,
  });
  if (!sceneQuality.passed) {
    throw new Error(`成片逐镜质检未通过：${sceneQuality.issues.map(issue => issue.reason).join('；')}`);
  }
  const audio = await (input.runtime?.runFfmpeg ?? runVisualFfmpeg)([
    '-i', result.outputPath, '-map', '0:a:0', '-t', String(Math.min(2, duration)), '-f', 'null', '-',
  ]);
  if (!audio.ok) throw new Error('成片音轨无法解码，已停止提交验收');
  const coverPath = await (input.runtime?.createCover ?? createVideoCover)({
    videoPath: result.outputPath,
    outputDirectory: outputDir,
    timestamp: socialDirectorCoverTimestamp(contentHandoff, duration, captionCues),
  });
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
    const referenceVideoPath = referenceAsset?.localPath && existsSync(referenceAsset.localPath)
      ? referenceAsset.localPath
      : null;
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
  const creativeReviewFailures = socialProductionCollaborationFailures(agentWorkflow, contentHandoff);
  await writeExecutionStage({
    ...input,
    stage: 'creative_review',
    message: creativeReviewFailures.length
      ? '编导 Agent 的结构与表达验收未通过，正在停止提交并保留当前结果。'
      : replicationEvaluation && replicationEvaluation.status !== 'passed'
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
  if (creativeReviewFailures.length) {
    throw new Error(`director_revision_required:${creativeReviewFailures.join('；')}`);
  }
  const evaluationFailures = replicationEvaluation?.status === 'passed'
    ? []
    : replicationEvaluation?.directorDecision.failedCriteria ?? [];
  const plannedCostCny = +agentWorkflow.executionPlan.scenes
    .reduce((sum, scene) => sum + scene.estimatedCostCny, 0).toFixed(2);
  const selectedAssetIds = new Set(contentHandoff.scenes.map(scene => scene.source.assetId));
  const recordedProviderCostCny = +assets
    .filter(asset => selectedAssetIds.has(asset.id))
    .flatMap(asset => asset.segments ?? [])
    .reduce((sum, segment) => sum + Math.max(0, Number(segment.estimatedCostCny || 0)), 0)
    .toFixed(2);
  const deliverableStatus = productionMode === 'concept_preview'
    ? 'concept_preview'
    : replicationEvaluation && replicationEvaluation.status !== 'passed'
      ? 'requires_revision'
      : 'publish_candidate';
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
    technicalReview: { approved: true, checkedScenes: sceneQuality.checkedScenes, failures: [] },
    creativeReview: {
      approved: !replicationEvaluation || replicationEvaluation.status === 'passed',
      failedCriteria: evaluationFailures,
      reviewedBy: 'director_agent',
    },
    artifactResourceRef: file.fileRef,
    createdAt: new Date().toISOString(),
  };
  const artifactResult = await createSocialContentArtifact({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    idempotencyKey: `social-auto-artifact:${input.runId}`,
    trustedAgentOrigin: true,
	backendFilePort: input.runtime?.backendFilePort,
    value: {
      kind: 'short_video',
      platform: contentHandoff.outputSpec.platform,
      language: contentHandoff.outputSpec.language,
      origin: 'agent',
      parentArtifactId: revisionParent?.artifactId,
      resourceRef: file.fileRef,
      content: {
        workflowSchema: AUTO_SCHEMA,
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
        scriptBaseline: {
          version: activeBaseline.version,
          source: activeBaseline.source,
          matchConfidence: activeBaseline.match?.confidence ?? null,
          groundingVersion: activeBaseline.groundingVersion ?? null,
          language: activeBaseline.language,
          lockedAt: activeBaseline.lockedAt,
          scenes: activeBaseline.scenes.map(scene => ({
            sceneId: scene.sceneId,
            shotFunction: scene.shotFunction,
            subject: scene.subject,
            action: scene.action,
            script: scene.script,
            voiceover: scene.voiceover,
            caption: scene.caption,
            narration: scene.narration,
          })),
        },
        directorPlan: directorSummary,
        directorPlanReference: persistedDirectorPlan.reference,
        productionResult,
        ...(replicationEvaluation ? { replicationEvaluation } : {}),
        costSummary: {
          currency: 'CNY',
          estimatedBeforeGenerationCny: plannedCostCny,
          recordedProviderCostCny,
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
          duration,
          cueCount: captionCues.length,
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
          qualityPassed: true,
          qualityMetrics: quality.metrics,
          checkedScenes: sceneQuality.checkedScenes,
          audioDecoded: true,
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
          technicalChecksPassed: true,
          creativeChecksPassed: !replicationEvaluation || replicationEvaluation.status === 'passed',
          automatedChecksPassed: !replicationEvaluation || replicationEvaluation.status === 'passed',
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
  await finishExecution({ ...input, backendFilePort: input.runtime?.backendFilePort, artifactId: artifactResult.artifact.artifactId });
    } finally {
      if (transientVoicePath) {
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
      }
    }
  });
}
export const activeProductions = new Map<string, { runId: string; promise: Promise<void> }>();

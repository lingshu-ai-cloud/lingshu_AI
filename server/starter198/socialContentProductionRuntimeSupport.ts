import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type {
  SocialContentTaskBrief,
  SocialContentThemeId,
  SocialProductionResult,
  SocialTaskSource,
} from '../../shared/contracts/socialContentWorkflow.js';
import {
  advanceVideoProductionGraph,
  parseVideoProductionGraph,
  productionNodeForRuntimeStage,
} from '../../shared/contracts/videoProductionGraph.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { analyzeAudioBeatGrid } from '../lib/audioBeatAnalysis.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';
import {
  automationBgmAudio,
  automationBgmCatalog,
  readTenantEnterpriseProfile,
  synthesizeStudioVoiceForAutomation,
} from '../lib/socialContentLegacyPorts.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import { objectStorageEnabled, objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { createSocialContentArtifact, createSocialDeliveryPackage } from './socialContentOutputs.js';
import { scheduleManagedSocialArtifact } from './socialContentManagedPublishing.js';
import {
  inspectTransientSocialContentFile,
  registerSocialContentFile,
  socialContentFileDownloadUrl,
  type SocialContentBackendFilePort,
} from './socialContentFiles.js';
import {
  materializeSocialContentCloudMaterial,
  socialContentCloudMaterialRecordId,
  type SocialContentCloudMaterialPort,
} from './socialContentMaterialAccess.js';
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
import { runOutsideSocialContentMutationScope, withSocialContentSubjectLease } from './socialContentMutation.js';
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
import { createSocialDigitalPresenterAdapter } from './socialContentDigitalPresenterAdapter.js';
import { createEnvironmentSocialHeyGenBridge } from './socialContentHeyGenBridge.js';
import {
  buildSocialDirectorPlan,
  parseStoredSocialDirectorPlan,
  publicSocialDirectorPlanSummary,
  reviseSocialDirectorPlanForVoiceoverFit,
  socialDirectorContentHandoff,
  socialDirectorCoverTimestamp,
  socialDirectorRenderTimeline,
  socialDirectorSceneTimingCues,
  socialDirectorScriptText,
  type SocialDirectorBgmSelection,
  type SocialDirectorBgmTrack,
  type SocialDirectorContentHandoff,
} from './socialContentDirectorPlan.js';
import {
  persistSocialDirectorPlanVersion,
  resolveSocialDirectorArtifactLineage,
} from './socialContentDirectorPlanVersions.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';

const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (
    manifest: unknown,
    onProgress?: (progress: number) => void,
    outputDir?: string,
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, systemThemeGraphicAssets, applyZeroAssetTruthSafeNarration, socialReviewRevisionDirective, applySocialReviewRevision } from './socialContentAutoProduction.js';
import { AUTO_SCHEMA, AUTO_TASK_KEY, safeNextVersion } from './socialContentAutoProduction.js';
export async function createVideoCover(input: {
  videoPath: string;
  outputDirectory: string;
  timestamp: number;
}): Promise<string> {
  const outputPath = path.join(input.outputDirectory, 'cover.jpg');
  const result = await runVisualFfmpeg([
    '-ss', String(Math.max(0.05, input.timestamp)),
    '-i', input.videoPath,
    '-frames:v', '1',
    '-vf', 'scale=720:-2:flags=lanczos',
    '-q:v', '3',
    '-y', outputPath,
  ]);
  if (!result.ok || !existsSync(outputPath)) throw new Error('成品封面生成失败');
  return outputPath;
}

export function bgmAuthorization(trackId: string): SocialDirectorBgmTrack['authorization'] {
  if (trackId.startsWith('builtin-mixkit-')) return {
    status: 'authorized',
    basis: 'mixkit_free_license',
    license: 'Mixkit Free License',
    evidence: 'https://mixkit.co/license/#musicFree',
  };
  if (trackId.startsWith('builtin-')) return {
    status: 'authorized',
    basis: 'lingshu_builtin_library',
    license: '灵枢内置商用曲库授权',
    evidence: `authenticated_catalog:${trackId}`,
  };
  return {
    status: 'authorized',
    basis: 'tenant_uploaded_warranty',
    license: '企业上传时确认拥有使用权',
    evidence: `tenant_authenticated_catalog:${trackId}`,
  };
}

export async function selectDirectorBgm(input: {
  tenantId: string;
  themeId: string | null;
  directorMood: string;
  volume: number;
}): Promise<SocialDirectorBgmSelection> {
  const catalog = automationBgmCatalog(input.tenantId);
  if (!catalog.length) throw new Error('自动配乐曲库暂时不可用，请稍后重试');
  const moodTerms = input.directorMood.toLocaleLowerCase().split(/[\s,，、/;；]+/).filter(term => term.length >= 2);
  const desired = input.themeId === 'supplier_capability' ? /稳重|商务|科技|corporate|technology/i
    : input.themeId === 'customer_case' ? /温暖|信任|情感|warm|trust/i
      : /轻快|清新|活力|商务|upbeat|fresh|business/i;
  const ranked = [...catalog].sort((left, right) => {
    const score = (track: typeof catalog[number]) => {
      const searchable = `${track.name} ${track.mood}`.toLocaleLowerCase();
      return (moodTerms.some(term => searchable.includes(term)) ? 2 : 0)
        + (desired.test(`${track.name} ${track.mood}`) ? 1 : 0);
    };
    return score(right) - score(left) || left.id.localeCompare(right.id);
  });
  let primaryIndex = -1;
  for (const [index, track] of ranked.entries()) {
    try {
      await automationBgmAudio(input.tenantId, track.id);
      primaryIndex = index;
      break;
    } catch { /* Director Agent tries the next authorized catalog track. */ }
  }
  if (primaryIndex < 0) throw new Error('自动配乐曲库中的授权文件均不可用，请稍后重试');
  const ordered = [ranked[primaryIndex]!, ...ranked.filter((_, index) => index !== primaryIndex)].slice(0, 3);
  const primaryAudio = await automationBgmAudio(input.tenantId, ordered[0]!.id);
  const beatEvidence = await analyzeAudioBeatGrid(primaryAudio).catch(() => null);
  const locked = ordered.map((track, index) => ({
    trackId: track.id,
    name: track.name,
    mood: track.mood,
    authorization: bgmAuthorization(track.id),
    ...(index === 0 && beatEvidence ? { beatEvidence } : {}),
  }));
  return {
    primary: locked[0]!,
    fallbacks: locked.slice(1),
    fallbackPolicy: 'ordered_preapproved_tracks_only',
    volume: Math.max(0, Math.min(100, input.volume)),
  };
}

export async function resolveLockedBgm(
  tenantId: string,
  handoff: SocialDirectorContentHandoff,
): Promise<{ id: string; url: string }> {
  const ordered = [handoff.bgmSelection.primary, ...handoff.bgmSelection.fallbacks];
  for (const track of ordered) {
    if (track.authorization.status !== 'authorized') continue;
    try {
      if (handoff.effectPlan?.beatSync && track.trackId !== handoff.bgmSelection.primary.trackId) {
        throw new Error('beat_synced_primary_bgm_unavailable');
      }
      return { id: track.trackId, url: await automationBgmAudio(tenantId, track.trackId) };
    } catch { /* Execute the Director Agent's pre-authorized fallback order. */ }
  }
  throw new Error('编导方案锁定的主配乐和备用配乐均不可用，请重新生成编导方案');
}

export async function executionTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.tasks, input.tenantId, {
    where: { run_id: input.runId, task_key: AUTO_TASK_KEY }, perPage: 2,
  });
  return result.items.length === 1 ? result.items[0]! : null;
}

export async function writeExecutionStage(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  stage: string;
  status?: string;
  message: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const task = await executionTask(input);
  if (!task) return;
  const output = socialObject(socialJson(task.output)) ?? {};
  const previousProduction = socialObject(socialJson(output.production)) ?? {};
  const previousHistory = Array.isArray(socialJson(previousProduction.stageHistory))
    ? (socialJson(previousProduction.stageHistory) as unknown[])
      .map(item => socialObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .slice(-11)
    : [];
  const updatedAt = new Date().toISOString();
  const terminal = input.stage === 'review_ready' && input.status === 'completed';
  const blocked = input.status === 'waiting_external';
  const previousGraph = parseVideoProductionGraph(previousProduction.productionGraph);
  const productionGraph = advanceVideoProductionGraph({
    graph: previousGraph,
    graphId: `starter198:${input.runId}`,
    runtimeOrigin: 'starter198',
    activeNode: blocked && ['waiting_for_user_input', 'automatic_recovery_exhausted'].includes(input.stage)
      ? previousGraph?.activeNode ?? 'brief' : productionNodeForRuntimeStage('starter198', input.stage),
    status: terminal ? 'completed' : blocked ? 'blocked' : 'running',
    blocker: blocked ? input.message : null,
    evidenceRefs: [socialText(input.extra?.artifactId), socialText(input.extra?.directorPlanHash)].filter(Boolean),
    now: updatedAt,
  });
  await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, task.id, {
    status: input.status ?? 'running',
    output: {
      ...output,
      production: {
        ...previousProduction,
        schemaVersion: AUTO_SCHEMA,
        stage: input.stage,
        message: input.message,
        updatedAt,
        productionGraph,
        stageHistory: [
          ...previousHistory,
          { stage: input.stage, message: input.message, at: updatedAt },
        ],
        ...(input.extra ?? {}),
      },
    },
    blocked_reason: input.status === 'waiting_external' ? input.message : '',
    updated_at: updatedAt,
  });
}

export async function finishExecution(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  artifactId: string;
  backendFilePort?: SocialContentBackendFilePort;
  taskId: string;
  userId: string;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input);
  const artifact = detail?.artifacts.find(item => item.artifactId === input.artifactId);
  const managed = detail?.brief.managementMode === 'one_click_managed';
  const accepted = managed && artifact?.status === 'approved';
  if (detail && ['paused', 'attention'].includes(detail.status)) return;
  if (accepted && detail && !detail.deliveryPackages.some(item => item.artifactIds.includes(input.artifactId))) {
    await createSocialDeliveryPackage({
      ...input,
      idempotencyKey: `social-auto-delivery:${input.artifactId}`,
      value: { expectedTaskVersion: detail.version, artifactIds: [input.artifactId] },
    });
  }
  const publication = accepted ? await scheduleManagedSocialArtifact(input).catch(error => ({
    status: 'blocked' as const, reason: error instanceof Error ? error.message : 'managed_publishing_unavailable',
  })) : null;
  if (publication) await withSocialContentSubjectLease({
    repository: input.repository, tenantId: input.tenantId, subjectId: input.taskId, action: async () => {
      const current = await requireSocialTask(input);
      const brief = socialObject(socialJson(current.brief)) || {};
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, current.id, {
        brief: { ...brief, _managedPublishing: { artifactId: input.artifactId,
          status: publication.status, attempts: 1,
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          ...(publication.status === 'blocked' ? { reason: publication.reason } : { postIds: publication.postIds }),
        } }, version: safeNextVersion(current), updated_at: new Date().toISOString(),
      });
    },
  });
  await writeExecutionStage({
    ...input,
    stage: accepted ? 'ready_to_distribute' : managed ? 'automatic_review_blocked' : 'review_ready',
    status: managed && !accepted ? 'waiting_external' : 'completed',
    message: accepted
      ? '内容 Agent 技术质检与编导 Agent 表达验收通过，成品已交回经营 Agent；发布仍需有效账号与发布授权。'
      : managed ? '成品已保留，自动验收证据未满足，等待系统恢复检查。' : '成品视频已生成，等待用户验收。',
    extra: { artifactId: input.artifactId, ...(publication ? { managedPublishing: publication } : {}) },
  });
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
  if (run) await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
    status: managed && !accepted ? 'waiting_external' : 'completed',
    current_controller: managed ? 'agent' : 'system',
    pause_reason: managed && !accepted ? 'automatic_acceptance_evidence_incomplete' : '',
    completed_at: managed && !accepted ? '' : new Date().toISOString(),
  });
}

export async function failExecution(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  runId: string;
  userId: string;
  error: unknown;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input).catch(() => null);
  const pendingRevision = detail?.artifacts.some(artifact => artifact.kind === 'short_video'
    && artifact.status === 'changes_requested');
  const completedArtifact = detail?.artifacts.some(artifact => artifact.origin === 'agent'
    && artifact.kind === 'short_video'
    && !['superseded', 'changes_requested'].includes(artifact.status));
  if (completedArtifact && !pendingRevision) return;
  const rawMessage = String(input.error instanceof Error ? input.error.message : input.error || '自动成片失败').slice(0, 800);
  const needsMaterial = rawMessage.startsWith('production_input_required:');
  const needsUserInput = rawMessage.startsWith('user_input_required:');
  const directorRevisionFailed = rawMessage.startsWith('director_revision_required:');
  const message = rawMessage.replace(/^(?:production_input_required|user_input_required|director_revision_required):/, '').trim();
  await writeExecutionStage({
    ...input,
    stage: needsUserInput ? 'waiting_for_user_input' : 'automatic_recovery_exhausted',
    status: 'waiting_external',
    message: needsUserInput
      ? message
      : `系统已保留导演方案和现有结果，稍后可继续自动处理：${message}`,
    extra: {
      reasonCode: needsUserInput
        ? 'social_content_user_input_required'
        : needsMaterial
          ? 'social_content_system_material_fallback_exhausted'
        : directorRevisionFailed
          ? 'social_content_director_revision_retryable'
          : 'social_content_auto_production_failed',
    },
  }).catch(() => undefined);
  const record = await requireSocialTask(input).catch(() => null);
  if (record && socialText(record.status) === 'producing') {
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
      // Missing personalization data is handled by the library/system fallback.
      // Only an explicit governed user-input requirement may surface attention.
      status: needsUserInput ? 'attention' : 'paused',
      version: safeNextVersion(record),
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    }).catch(() => undefined);
  }
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId).catch(() => null);
  if (run) await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
    status: 'waiting_external', current_controller: 'agent', pause_reason: message,
  }).catch(() => undefined);
}

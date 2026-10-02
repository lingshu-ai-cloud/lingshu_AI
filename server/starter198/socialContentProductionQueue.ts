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
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
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
import { store } from '../storage/index.js';
import { enqueueBullJob, selectedQueueBackend, startBullWorker } from '../queues/bullmq.js';
import { createSocialContentArtifact } from './socialContentOutputs.js';
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
import { createStarter198Repository, STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
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

import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, systemThemeGraphicAssets, applyZeroAssetTruthSafeNarration, socialReviewRevisionDirective, applySocialReviewRevision, createVideoCover, type SocialContentAutoProductionRuntime, runSocialContentAutoProduction } from './socialContentAutoProduction.js';
import { activeProductions, failExecution, writeExecutionStage } from './socialContentAutoProduction.js';
export async function runSocialContentAutoProductionWithRetry(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  let lastError: unknown = new Error('自动成片失败');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await runSocialContentAutoProduction(input);
      return;
    } catch (error) {
      lastError = error;
      const raw = String(error instanceof Error ? error.message : error || '自动成片失败');
      if (raw.startsWith('user_input_required:')) break;
      // Paid model failures and quality-gate rejections are deterministic for
      // the same inputs. Repeating them silently can charge the user three
      // times without improving the result; preserve the reason for review.
      if (raw.includes('asset_supply_provider_exhausted:') || raw.includes('product_scene_')) break;
      if (attempt >= 3) break;
      await writeExecutionStage({
        ...input,
        stage: 'automatic_recovery',
        status: 'running',
        message: raw.startsWith('production_input_required:')
          ? '现有素材未通过自动检查，正在切换素材库与安全基础方案。'
          : '本次生成暂未完成，正在自动切换备用方案。',
        extra: { automaticRetryAttempt: attempt + 1, automaticRetryLimit: 3 },
      }).catch(() => undefined);
      await new Promise<void>(resolve => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

/** Fire-and-observe entry point: API admission returns immediately while the worker renders in-process. */
export function enqueueSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): void {
  if (selectedQueueBackend() === 'bullmq') {
    const data = { tenantId: input.tenantId, userId: input.userId, taskId: input.taskId, runId: input.runId };
    const jobId = createHash('sha256').update(`${data.tenantId}\0${data.taskId}\0${data.runId}`).digest('hex');
    void enqueueBullJob({
      queue: 'social-content-production',
      name: 'render',
      data,
      jobId,
    }).catch(error => failExecution({ ...input, error }));
    return;
  }
  const key = `${input.tenantId}\u0000${input.taskId}`;
  const current = activeProductions.get(key);
  if (current?.runId === input.runId) return;
  let pending!: Promise<void>;
  pending = runOutsideSocialContentMutationScope(() => (
    (current?.promise.catch(() => undefined) ?? Promise.resolve())
      .then(() => new Promise<void>(resolve => setImmediate(resolve)))
      .then(() => runSocialContentAutoProductionWithRetry(input))
      .catch(error => failExecution({ ...input, error }))
      .finally(() => {
        if (activeProductions.get(key)?.promise === pending) activeProductions.delete(key);
      })
  ));
  activeProductions.set(key, { runId: input.runId, promise: pending });
}

export function initSocialContentProductionBullWorker(): void {
  startBullWorker<{
    tenantId: string;
    userId: string;
    taskId: string;
    runId: string;
  }>({
    queue: 'social-content-production',
    concurrency: Number(process.env.SOCIAL_CONTENT_PRODUCTION_CONCURRENCY || 1),
    processor: async job => {
      const repository = createStarter198Repository(store);
      const input = { repository, ...job.data };
      try {
        await runSocialContentAutoProductionWithRetry(input);
      } catch (error) {
        await failExecution({ ...input, error });
        throw error;
      }
    },
  });
}

export function socialContentAutoProductionActive(tenantId: string, taskId: string): boolean {
  return activeProductions.has(`${tenantId}\u0000${taskId}`);
}

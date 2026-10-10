import {readWeeklyReplicationAuthority} from './socialWeeklyReplicationAuthority.js';
import {assertWeeklyProductionMaterialAdmission} from './socialWeeklyProductionMaterialGate.js';
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
import { store, dataBackend } from '../storage/index.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { createAgentNotification } from '../notifications/agentNotifications.js';
import { enqueueBullJob, selectedQueueBackend, startBullWorker } from '../queues/bullmq.js';
import {
  admitContentExecutionJob,
  DurableContentExecutionWorker,
  type ContentExecutionJob,
} from '../contentExecution/durableQueue.js';
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
import { readSocialTaskDetail, requireSocialTask, socialTaskSummary } from './socialContentRecords.js';
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

import { MEDIA_ROOT, type ProductionAsset, type SocialProductionBaseline, type SocialProductionAdaptation, type SocialReviewRevisionDirective, automaticSocialMaterialEligible, detectDistinctTaskVideoSegments, hasExactTaskProductAssociation, resolveTaskProductionMaterialLocation, taskProductionAssets, systemThemeGraphicAssets, applyZeroAssetTruthSafeNarration, socialReviewRevisionDirective, applySocialReviewRevision, createVideoCover, type SocialContentAutoProductionRuntime } from './socialContentAutoProduction.js';
import { runSocialContentAutoProduction } from './socialContentProductionExecution.js';
import { failExecution, writeExecutionStage } from './socialContentProductionRuntimeSupport.js';
import { executeSocialSceneReworkJob, completeSocialSceneReworkRun, isSocialSceneReworkJob } from './socialContentSceneReworkExecution.js';
export async function runSocialContentAutoProductionWithRetry(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  // The durable queue owns retry classification and delay. Keeping retries in
  // one layer prevents one paid failure from multiplying across nested loops.
  await runSocialContentAutoProduction(input);
}

let productionWorker: DurableContentExecutionWorker | null = null;
const dedicatedExecutors = new Map<string, (repository: Starter198Repository, job: ContentExecutionJob) => Promise<void>>([
  ['social_scene_rework', executeSocialSceneReworkJob],
]);

export async function assertSocialSceneReworkQueueRegistered(): Promise<void> {
  if (dedicatedExecutors.get('social_scene_rework') !== executeSocialSceneReworkJob) {
    throw new Error('scene_rework_worker_not_registered');
  }
}

export async function wakeSocialSceneReworkJob(jobId: string): Promise<void> {
  await assertSocialSceneReworkQueueRegistered();
  if (selectedQueueBackend() === 'bullmq') {
    await enqueueBullJob({ queue: 'social-content-production', name: 'wake-durable-job', data: { jobId }, jobId });
  }
  await productionWorker?.drain();
}

async function executePersistedProduction(job: ContentExecutionJob): Promise<void> {
  const repository = createStarter198Repository(store);
  if (job.taskType.startsWith('social_scene_rework:')) {
    if (!isSocialSceneReworkJob(job)) throw new Error('scene_rework_job_type_invalid');
    await assertSocialSceneReworkQueueRegistered();
    await dedicatedExecutors.get('social_scene_rework')!(repository, job);
    return;
  }
  const record = await requireSocialTask({ repository, tenantId: job.tenantId, taskId: job.taskId });
  const task = socialTaskSummary(record);
  if (['asset_review', 'packaging', 'delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(task.status)) return;
  if (task.status !== 'producing') throw new Error(`user_input_required:content_task_${task.status}`);
  await runOutsideSocialContentMutationScope(() => runSocialContentAutoProductionWithRetry({
    repository,
    tenantId: job.tenantId,
    userId: job.userId,
    taskId: job.taskId,
    runId: job.runId,
  }));
}

function ensureProductionWorker(): DurableContentExecutionWorker {
  if (productionWorker) return productionWorker;
  productionWorker = new DurableContentExecutionWorker({
    ...(process.env.LINGSHU_LOCAL_PREVIEW === '1' && localFallbacksEnabled() && dataBackend === 'pocketbase'
      ? { dataAuthority: 'local' as const } : {}),
    dataStore: store,
    execute: executePersistedProduction,
    async onSucceeded(job) {
      if (isSocialSceneReworkJob(job)) await completeSocialSceneReworkRun(createStarter198Repository(store), job);
      await createAgentNotification({
        tenantId: job.tenantId,
        eventKey: `content-execution:${job.id}:review-ready`,
        type: 'content_task_review_ready',
        severity: 'info',
        title: '一条内容已经完成制作',
        summary: '成片和质检结果已保存，等待你验收；验收后再进入发布确认。',
        sourceAgent: '内容 Agent',
        entityType: 'social_content_task',
        entityId: job.taskId,
        action: {
          label: '验收内容',
          page: 'smartAssets',
          href: `/?page=smartAssets&taskId=${encodeURIComponent(job.taskId)}`,
        },
      }, store).catch(notificationError => console.warn('[content-execution] review notification failed', {
        jobId: job.id,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      }));
    },
    async onRetry(job, error, decision) {
      const repository = createStarter198Repository(store);
      await writeExecutionStage({
        repository, tenantId: job.tenantId, runId: job.runId,
        stage: decision.failureClass === 'provider_reconciliation' ? 'provider_reconciliation' : 'automatic_recovery',
        status: 'running',
        message: decision.publicReason,
        extra: {
          retryClass: decision.failureClass,
          retryAttempt: job.attempt,
          retryLimit: decision.maxAttempts,
          failure: String(error instanceof Error ? error.message : error || '').slice(0, 400),
        },
      }).catch(() => undefined);
    },
    async onBlocked(job, error, decision) {
      const repository = createStarter198Repository(store);
      if (isSocialSceneReworkJob(job)) {
        // Repair failures belong to the independent run. The original reviewed
        // content task and its passed scenes must remain intact.
        const run = await store.getById<Record<string, unknown>>('workflow_runs', job.runId);
        if (run?.tenant_id === job.tenantId && run.status === 'running') await store.update('workflow_runs', job.runId, {
          current_controller: 'human', pause_reason: decision.publicReason,
        });
      } else await failExecution({
        repository, tenantId: job.tenantId, userId: job.userId, taskId: job.taskId, runId: job.runId,
        error: new Error(`${decision.failureClass}:${decision.publicReason}:${String(error instanceof Error ? error.message : error || '').slice(0, 800)}`),
      }).catch(() => undefined);
      await createAgentNotification({
        tenantId: job.tenantId,
        eventKey: `content-execution:${job.id}:blocked:${decision.failureClass}:${job.attempt}`,
        type: 'content_task_blocked',
        severity: decision.failureClass === 'insufficient_balance' ? 'critical' : 'warning',
        title: '一条内容任务需要处理',
        summary: `${decision.publicReason}。已完成结果会保留，处理后可从当前任务继续。`,
        sourceAgent: '内容 Agent',
        entityType: 'social_content_task',
        entityId: job.taskId,
        action: {
          label: '进入内容制作',
          page: 'smartAssets',
          href: `/?page=smartAssets&taskId=${encodeURIComponent(job.taskId)}`,
        },
      }, store).catch(notificationError => console.warn('[content-execution] blocked notification failed', {
        jobId: job.id,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      }));
    },
  });
  return productionWorker;
}

/** Admission returns only after the database row exists; execution remains asynchronous. */
export async function enqueueSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  const dataStore = input.repository.dataStore ?? store;
  // Admission gaps precede all execution writes; an unqueued owned run has not failed production.
  await assertWeeklyProductionMaterialAdmission(input);
  await readWeeklyReplicationAuthority(input.repository,await requireSocialTask(input));
  try {
    const record = await requireSocialTask(input);
    const task = socialTaskSummary(record);
    const job = await admitContentExecutionJob({
      dataStore,
      tenantId: input.tenantId,
      userId: input.userId,
      taskId: input.taskId,
      runId: input.runId,
      accountId: task.brief.targetAccountRef?.id,
      taskType: `social_content_${task.mode}`,
    });
    if (job.status === 'queued' && !job.lastStartedAt) {
      await writeExecutionStage({
        repository: input.repository,
        tenantId: input.tenantId,
        runId: input.runId,
        stage: 'queued',
        status: 'running',
        message: '任务已进入后台制作队列，关闭或刷新网页不会中断。',
        extra: { queueJobId: job.id, queueStatus: job.status, accountId: job.accountId, taskType: job.taskType },
      }).catch(() => undefined);
    }
    if (dataStore === store && selectedQueueBackend() === 'bullmq') {
      void enqueueBullJob({
        queue: 'social-content-production',
        name: 'wake-durable-job',
        data: { jobId: job.id },
        jobId: job.id,
      }).catch(error => {
        // Redis is a latency optimization only. The database scanner remains
        // authoritative and will claim this queued row after a Redis outage.
        console.warn('[content-execution] BullMQ wake-up failed; durable scan will recover', {
          jobId: job.id, error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    // Only a background process initializes this worker. On a web-only
    // process the database row remains queued until a worker claims it.
    if (dataStore === store) await productionWorker?.drain();
  } catch (error) {
    await failExecution({ ...input, error }).catch(failure => {
      console.error('[content-execution] durable admission failed', {
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
        reportingError: failure instanceof Error ? failure.message : String(failure),
      });
    });
    throw error;
  }
}

export function initSocialContentProductionBullWorker(): void {
  const durableWorker = ensureProductionWorker();
  durableWorker.start();
  startBullWorker<{ jobId: string }>({
    queue: 'social-content-production',
    concurrency: Number(process.env.SOCIAL_CONTENT_PRODUCTION_CONCURRENCY || 4),
    processor: async () => durableWorker.drain(),
  });
}

export function socialContentAutoProductionActive(tenantId: string, taskId: string): boolean {
  return productionWorker?.isLocallyActive(tenantId, taskId) ?? false;
}

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { SocialAssetSupplyProviderAdapter } from './socialContentAssetSupplyExecution.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';

export interface AuthorizedDigitalPresenter {
  presenterAssetId: string;
  providerId: string;
  providerPresenterId: string;
  providerVoiceId: string;
  authorizationRef: string;
  consentRef: string;
  assetVersion: number;
  authorized: true;
}

export interface DigitalPresenterExecutionRequest {
  tenantId: string;
  taskId: string;
  shotId: string;
  idempotencyKey: string;
  presenter: AuthorizedDigitalPresenter;
  script: string;
  aspectRatio: '9:16';
  outputDirectory: string;
  maximumCostCny: number;
}

export interface CompletedDigitalPresenterExecution {
  status: 'completed';
  providerTaskId: string;
  localPath: string;
  url?: string;
  contentHash: string;
  duration: number;
  actualCostCny?: number;
}

export interface FailedDigitalPresenterExecution {
  status: 'failed' | 'pending' | 'uncertain';
  providerTaskId?: string;
  error: string;
}

export interface SocialDigitalPresenterBridgePorts {
  resolvePresenter(input: {
    tenantId: string;
    presenterAssetId: string;
  }): Promise<AuthorizedDigitalPresenter | null>;
  authorizeBudget(input: {
    tenantId: string;
    taskId: string;
    shotId: string;
    idempotencyKey: string;
    providerId: string;
    maximumCostCny: number;
  }): Promise<{ allowed: true; reservationRef: string } | { allowed: false; reason: string }>;
  execute(input: DigitalPresenterExecutionRequest & { reservationRef: string }): Promise<CompletedDigitalPresenterExecution | FailedDigitalPresenterExecution>;
  reconcileBudget?(input: {
    reservationRef: string;
    providerTaskId: string;
    actualCostCny?: number;
  }): Promise<void>;
  maximumCostCny?: number;
}

function stableKey(input: {
  tenantId: string;
  taskId: string;
  shotId: string;
  presenter: AuthorizedDigitalPresenter;
  script: string;
}) {
  return `social-presenter:${createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    taskId: input.taskId,
    shotId: input.shotId,
    presenterAssetId: input.presenter.presenterAssetId,
    assetVersion: input.presenter.assetVersion,
    providerId: input.presenter.providerId,
    script: input.script,
    aspectRatio: '9:16',
  })).digest('hex')}`;
}

function outputAsset(input: {
  taskId: string;
  shotId: string;
  presenter: AuthorizedDigitalPresenter;
  execution: CompletedDigitalPresenterExecution;
  idempotencyKey: string;
}): SocialProductionAsset {
  return {
    id: `digital-presenter-${input.taskId}-${input.shotId}`,
    name: `授权数字人口播 · ${input.shotId}`,
    type: 'video',
    sourceId: input.presenter.presenterAssetId,
    url: input.execution.url || input.execution.localPath,
    localPath: input.execution.localPath,
    contentHash: input.execution.contentHash,
    authorizationRef: input.presenter.authorizationRef,
    providerId: input.presenter.providerId,
    providerTaskId: input.execution.providerTaskId,
    idempotencyKey: input.idempotencyKey,
    duration: input.execution.duration,
    visualObservations: ['已授权数字人根据本镜头已确认口播生成', '合成媒体，不作为客户真实人员或客户证言'],
    segments: [{
      providerId: input.presenter.providerId,
      providerTaskId: input.execution.providerTaskId,
      presenterAssetId: input.presenter.presenterAssetId,
      presenterAssetVersion: input.presenter.assetVersion,
      consentRef: input.presenter.consentRef,
      authorizationRef: input.presenter.authorizationRef,
      idempotencyKey: input.idempotencyKey,
      actualCostCny: input.execution.actualCostCny ?? null,
    }],
  };
}

/** Bridges the social per-shot router to a deployment's governed presenter
 * executor (for example the existing HeyGen production service). The executor
 * must be idempotent and must not report completion until its output has been
 * downloaded and validated. */
export function createSocialDigitalPresenterAdapter(
  ports: SocialDigitalPresenterBridgePorts,
): SocialAssetSupplyProviderAdapter {
  const maximumCostCny = Math.max(0, ports.maximumCostCny ?? 2);
  return {
    adapterId: 'controlled_digital_presenter.v1',
    sourceStrategies: ['authorized_digital_presenter'],
    async execute(context) {
      const plan = context.shot.digitalHumanPlan;
      if (!plan || plan.method !== 'talking' || plan.executionState !== 'ready_for_capability_check') return null;
      const presenterAssetId = context.shot.sourceRefs.find(ref => plan.presenterAssetIds.includes(ref));
      if (!presenterAssetId) return null;
      const presenter = await ports.resolvePresenter({ tenantId: context.tenantId, presenterAssetId });
      if (!presenter || presenter.authorized !== true || !presenter.authorizationRef || !presenter.consentRef
        || !presenter.providerPresenterId || !presenter.providerVoiceId) return null;
      const script = String(context.baselineScene.narration || context.baselineScene.voiceover
        || context.baselineScene.script || context.baselineScene.caption || '').trim();
      if (!script) return null;
      const idempotencyKey = stableKey({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, presenter, script });
      const budget = await ports.authorizeBudget({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, idempotencyKey, providerId: presenter.providerId, maximumCostCny });
      if (!budget.allowed) throw new Error(`digital_presenter_budget_denied:${budget.reason}`);
      const execution = await ports.execute({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, idempotencyKey, presenter, script, aspectRatio: '9:16',
        outputDirectory: context.outputDirectory, maximumCostCny, reservationRef: budget.reservationRef });
      if (execution.status !== 'completed') {
        throw new Error(`digital_presenter_not_completed:${execution.status}:${execution.providerTaskId || 'no_task'}:${execution.error}`);
      }
      if (!execution.providerTaskId || !execution.localPath || !execution.contentHash || !(execution.duration > 0)) {
        throw new Error('digital_presenter_invalid_completed_output');
      }
      const output = await stat(execution.localPath).catch(() => null);
      if (!output?.isFile() || output.size < 1) throw new Error('digital_presenter_output_file_missing');
      await ports.reconcileBudget?.({ reservationRef: budget.reservationRef,
        providerTaskId: execution.providerTaskId, actualCostCny: execution.actualCostCny });
      return {
        asset: outputAsset({ taskId: context.taskId, shotId: context.shot.shotId, presenter,
          execution, idempotencyKey }),
        sourceStrategy: 'authorized_digital_presenter',
        providerId: presenter.providerId,
        sourceRef: presenter.presenterAssetId,
        synthetic: true,
        representation: 'non_evidentiary_visual',
        authorizationRef: presenter.authorizationRef,
        disclosure: '数字人合成画面 · 非客户真实人员或客户证言',
      };
    },
  };
}

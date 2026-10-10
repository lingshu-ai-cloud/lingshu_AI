import {assertSocialAccountProductionConstraints,type SocialAccountProductionConstraints} from './socialAccountProductionConstraints.js';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
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
  socialAccountId?: string;
  presenterProfileId?: string;
  presenterProfileVersion?: string;
  consistencyKey?: string;
  authorized: true;
}

export interface DigitalPresenterExecutionRequest {
  accountPlaybookConstraints?:SocialAccountProductionConstraints;
  tenantId: string;
  taskId: string;
  shotId: string;
  idempotencyKey: string;
  presenter: AuthorizedDigitalPresenter;
  script: string;
  aspectRatio: '9:16';
  outputDirectory: string;
  maximumCostCny: number;
  visualControl: DigitalPresenterVisualControl;
}

export type DigitalPresenterControlCapability =
  | 'scripted_speech'
  | 'reference_motion'
  | 'guided_action'
  | 'product_interaction'
  | 'environment_control'
  | 'camera_control'
  | 'timing_control';

/** Provider-neutral control contract. A provider must advertise every
 * required capability before it receives a paid request; unsupported product
 * interaction or reenactment is reported as unavailable, never as a talking
 * head success. */
export interface DigitalPresenterVisualControl {
  precision: 'hook_high' | 'standard';
  interaction: 'talking' | 'person_holds_product' | 'person_uses_product' | 'product_applied_to_face' | 'person_in_environment';
  action: {
    startState: string;
    path: string;
    peak: string;
    endState: string;
  };
  product: {
    required: boolean;
    usage: string | null;
    productRefs: string[];
    referenceAssetIds: string[];
  };
  environment: string;
  camera: {
    shotSize: string;
    angle: string;
    movement: string;
    composition: string;
  };
  timing: {
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    actionPeakSeconds: number;
  };
  requiredCapabilities: DigitalPresenterControlCapability[];
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
  capabilities?: {
    methods: Array<'talking' | 'replace' | 'reenact'>;
    controls: DigitalPresenterControlCapability[];
  };
  resolvePresenter(input: {
    tenantId: string;
    presenterAssetId: string;
    socialAccountId?: string;
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
  operationId?: string;
  accountConstraintHash?:string;
  shotId: string;
  presenter: AuthorizedDigitalPresenter;
  script: string;
  visualControl: DigitalPresenterVisualControl;
}) {
  return `social-presenter:${createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    taskId: input.taskId,
    operationId: input.operationId,
    ...(input.accountConstraintHash?{accountConstraintHash:input.accountConstraintHash}:{}),
    shotId: input.shotId,
    presenterAssetId: input.presenter.presenterAssetId,
    assetVersion: input.presenter.assetVersion,
    presenterProfileId: input.presenter.presenterProfileId || null,
    presenterProfileVersion: input.presenter.presenterProfileVersion || null,
    consistencyKey: input.presenter.consistencyKey || null,
    providerId: input.presenter.providerId,
    script: input.script,
    visualControl: input.visualControl,
    aspectRatio: '9:16',
  })).digest('hex')}`;
}

function compact(value: unknown, fallback: string): string {
  const output = String(value || '').replace(/\s+/g, ' ').trim();
  return output || fallback;
}

function visualControl(context: Parameters<SocialAssetSupplyProviderAdapter['execute']>[0]): DigitalPresenterVisualControl {
  const scene = context.baselineScene;
  const requested = compact(context.shot.requestedDescription, '人物自然完成本镜头口播');
  const text = `${requested} ${scene.shotFunction} ${scene.subject} ${scene.action}`.toLocaleLowerCase();
  const storedContract = (context.shot as typeof context.shot & { visualContract?: unknown }).visualContract;
  const contract = normalizeSceneVisualContract(storedContract ?? {
    subjects: scene.subject,
    interaction: requested,
    action: scene.action,
    shotLanguage: scene.referenceStructure ? {
      shotSize: scene.referenceStructure.shotScale,
      movement: scene.referenceStructure.cameraMovement,
    } : undefined,
  });
  const applyFace = /上脸|涂.{0,4}(脸|面部)|面部.{0,4}(涂|抹|使用)|apply.{0,12}(face|skin)/.test(text);
  const usesProduct = applyFace || /(人物|真人|人像|主播|模特|员工|工人|person|human|presenter|model).{0,24}(产品|商品|包装|瓶|罐|精华|面霜|使用|试用|涂|抹|拿|握|开盖|挤|product|bottle|use|apply|hold|squeeze)/.test(text)
    || /(使用|试用|涂|抹|上脸|拿|握|手持|开盖|挤|按压|apply|use|hold|open|squeeze).{0,20}(产品|商品|包装|瓶|罐|精华|面霜|product|bottle)/.test(text);
  const holdsProduct = !usesProduct && /手持|拿着|举起|展示产品|hold.{0,10}product/.test(text);
  const environment = /工厂|车间|产线|生产基地|factory|workshop|production line/.test(text)
    ? '工厂或生产环境'
    : /浴室|洗手间|bathroom/.test(text)
      ? '浴室使用环境'
      : /办公室|office/.test(text) ? '办公室环境' : '与导演镜头要求一致的稳定环境';
  const reference = scene.referenceStructure;
  const startSeconds = Math.max(0, Number(contract.action.startSeconds
    ?? reference?.sourceTiming.startSeconds ?? 0));
  const durationSeconds = Math.max(0.5, Number(reference?.sourceTiming.durationSeconds ?? 3));
  const endSeconds = Math.max(startSeconds + 0.5, Number(contract.action.endSeconds
    ?? reference?.sourceTiming.endSeconds ?? startSeconds + durationSeconds));
  const inferredInteraction: DigitalPresenterVisualControl['interaction'] = contract.interaction.kind === 'apply_product_to_face' || applyFace
    ? 'product_applied_to_face'
    : contract.interaction.kind === 'person_using_product' || usesProduct ? 'person_uses_product'
      : contract.interaction.kind === 'person_holding_product' || holdsProduct ? 'person_holds_product'
        : contract.interaction.kind === 'person_factory_interaction'
          || /工厂|车间|环境|factory|workshop|environment/.test(text) ? 'person_in_environment' : 'talking';
  // In viral replication the talking-avatar route is deliberately a speech
  // layer. Reference action/product/camera requirements remain assigned to
  // their visual scenes and must not be falsely submitted as HeyGen controls.
  const talkingReplication = context.shot.digitalHumanPlan?.workflow === 'viral_replication'
    && context.shot.digitalHumanPlan.method === 'talking';
  const interaction: DigitalPresenterVisualControl['interaction'] = talkingReplication ? 'talking' : inferredInteraction;
  const productGroups = context.shot.productSceneReplication?.productIdentity.groups ?? [];
  const controls = new Set<DigitalPresenterControlCapability>(['scripted_speech', 'timing_control']);
  if (context.shot.digitalHumanPlan?.method !== 'talking') controls.add('reference_motion');
  if (!talkingReplication && interaction !== 'talking') controls.add('guided_action');
  if (!talkingReplication && ['person_holds_product', 'person_uses_product', 'product_applied_to_face'].includes(interaction)) controls.add('product_interaction');
  if (!talkingReplication && (interaction === 'person_in_environment' || contract.environment.kind !== 'unknown'
    || environment !== '与导演镜头要求一致的稳定环境')) controls.add('environment_control');
  if (!talkingReplication && (contract.camera.shotSize || contract.camera.angle || contract.camera.movement || contract.camera.composition
    || (reference?.cameraMovement && reference.cameraMovement !== '通用运镜'))) controls.add('camera_control');
  return {
    precision: contract.precision === 'hook_high' || startSeconds < 3 ? 'hook_high' : 'standard',
    interaction,
    action: {
      startState: compact(contract.action.startState, startSeconds < 3 ? '第一帧人物与关键交互主体清楚可见' : '承接上一镜人物姿态'),
      path: compact(contract.action.path || scene.action, requested),
      peak: compact(contract.action.peakState, applyFace ? '产品准确接触面部指定区域' : usesProduct ? '人物与产品交互动作达到最清楚状态' : '口播重点与主要手势同步'),
      endState: compact(contract.action.endState, '动作完整结束并保持人物、产品与环境连续'),
    },
    product: {
      required: ['person_holds_product', 'person_uses_product', 'product_applied_to_face'].includes(interaction),
      usage: contract.productUsage.kind !== 'none' ? contract.productUsage.kind
        : applyFace ? 'apply_to_face' : usesProduct ? 'use_or_demonstrate' : holdsProduct ? 'hold_and_display' : null,
      productRefs: [...new Set([
        ...productGroups.map(group => group.productRef),
        contract.product.requestedProductRef,
        contract.productUsage.productRef,
      ].filter((value): value is string => Boolean(value)))],
      referenceAssetIds: productGroups.flatMap(group => group.referenceImageIds),
    },
    environment: compact(contract.environment.description, contract.environment.kind !== 'unknown' ? contract.environment.kind : environment),
    camera: {
      shotSize: compact(contract.camera.shotSize, reference?.shotScale || '人物中近景'),
      angle: compact(contract.camera.angle, '保持人物、手部与产品接触位置可观察'),
      movement: compact(contract.camera.movement, reference?.cameraMovement || '稳定镜头'),
      composition: compact(contract.camera.composition, '人物、手部、产品和字幕安全区互不遮挡'),
    },
    timing: {
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
      actionPeakSeconds: Math.max(startSeconds, Math.min(endSeconds,
        contract.action.peakSeconds ?? startSeconds + (endSeconds - startSeconds) * 0.58)),
    },
    requiredCapabilities: [...controls],
  };
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
      socialAccountId: input.presenter.socialAccountId || null,
      presenterProfileId: input.presenter.presenterProfileId || null,
      presenterProfileVersion: input.presenter.presenterProfileVersion || null,
      presenterConsistencyKey: input.presenter.consistencyKey || null,
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
      if(context.accountPlaybookConstraints)assertSocialAccountProductionConstraints(context.accountPlaybookConstraints);
      const plan = context.shot.digitalHumanPlan;
      if (!plan || !['preview_only', 'ready_for_capability_check'].includes(plan.executionState)) return null;
      const control = visualControl(context);
      const supportedMethods = new Set(ports.capabilities?.methods ?? ['talking']);
      const supportedControls = new Set<DigitalPresenterControlCapability>(ports.capabilities?.controls ?? ['scripted_speech', 'timing_control']);
      if (!supportedMethods.has(plan.method)) {
        throw new Error(`digital_presenter_capability_unsupported:method:${plan.method}`);
      }
      const missingControls = control.requiredCapabilities.filter(required => !supportedControls.has(required));
      if (missingControls.length) {
        throw new Error(`digital_presenter_capability_unsupported:controls:${missingControls.join(',')}`);
      }
      const presenterAssetId = context.shot.sourceRefs.find(ref => plan.presenterAssetIds.includes(ref));
      if (!presenterAssetId) return null;
      const presenter = await ports.resolvePresenter({
        tenantId: context.tenantId,
        presenterAssetId,
        socialAccountId: plan.accountPresenterLock?.socialAccountId,
      });
      if (!presenter || presenter.authorized !== true || !presenter.authorizationRef || !presenter.consentRef
        || !presenter.providerPresenterId || !presenter.providerVoiceId) return null;
      const lock = plan.accountPresenterLock;
      if (lock && (
        presenter.presenterAssetId !== lock.presenterAssetId
        || presenter.socialAccountId !== lock.socialAccountId
        || presenter.presenterProfileId !== lock.presenterProfileId
        || presenter.presenterProfileVersion !== lock.presenterProfileVersion
        || presenter.providerPresenterId !== lock.avatarId
        || presenter.providerVoiceId !== lock.voiceProfileId
        || presenter.consentRef !== lock.consentRef
        || presenter.consistencyKey !== lock.consistencyKey
      )) return null;
      const script = String(context.baselineScene.narration || context.baselineScene.voiceover
        || context.baselineScene.script || context.baselineScene.caption || '').trim();
      if (!script) return null;
      const idempotencyKey = stableKey({ tenantId: context.tenantId, taskId: context.taskId,
        operationId: context.operationId,accountConstraintHash:context.accountPlaybookConstraints?.constraintHash, shotId: context.shot.shotId, presenter, script, visualControl: control });
      const budget = await ports.authorizeBudget({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, idempotencyKey, providerId: presenter.providerId, maximumCostCny });
      if (!budget.allowed) throw new Error(`digital_presenter_budget_denied:${budget.reason}`);
      const execution = await ports.execute({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, idempotencyKey, presenter, script, aspectRatio: '9:16',
        outputDirectory: context.outputDirectory, maximumCostCny, reservationRef: budget.reservationRef,
        visualControl: control,
        ...(context.accountPlaybookConstraints?{accountPlaybookConstraints:structuredClone(context.accountPlaybookConstraints)}:{}) });
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

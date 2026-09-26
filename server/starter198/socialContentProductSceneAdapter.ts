import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { SocialProductSceneReplicationSpec } from '../../shared/contracts/socialContentWorkflow.js';
import type {
  SocialAssetSupplyAdapterContext,
  SocialAssetSupplyProviderAdapter,
} from './socialContentAssetSupplyExecution.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';

export interface ProductSceneReferenceImage {
  assetId: string;
  productRef: string;
  url: string;
  contentHash: string | null;
}

export interface ProductSceneQualityReport {
  productIdentitySimilarity: Record<string, number>;
  labelOcrExactMatch: boolean;
  sceneTopologyScore: number;
  productSlotLayoutScore: number;
  cameraTrajectoryScore: number;
  evidenceRefs: string[];
}

export interface CompletedProductSceneExecution {
  status: 'completed';
  providerId: string;
  providerTaskId: string;
  model: string;
  localPath: string;
  url?: string;
  contentHash: string;
  duration: number;
  actualCostCny: number;
  quality: ProductSceneQualityReport;
}

export interface ProductSceneExecutionPorts {
  maximumCostCny: number;
  execute(input: {
    tenantId: string;
    taskId: string;
    shotId: string;
    idempotencyKey: string;
    spec: SocialProductSceneReplicationSpec;
    referenceImages: ProductSceneReferenceImage[];
    outputDirectory: string;
    maximumCostCny: number;
  }): Promise<CompletedProductSceneExecution | { status: 'failed' | 'pending' | 'uncertain'; providerTaskId?: string; error: string }>;
}

function stableKey(input: {
  tenantId: string;
  taskId: string;
  shotId: string;
  spec: SocialProductSceneReplicationSpec;
  references: ProductSceneReferenceImage[];
}): string {
  return `social-product-scene:${createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    taskId: input.taskId,
    shotId: input.shotId,
    spec: input.spec,
    references: input.references.map(item => ({
      assetId: item.assetId,
      productRef: item.productRef,
      contentHash: item.contentHash,
      url: item.contentHash ? null : item.url,
    })),
  })).digest('hex')}`;
}

function references(context: SocialAssetSupplyAdapterContext, spec: SocialProductSceneReplicationSpec): ProductSceneReferenceImage[] | null {
  const rows: ProductSceneReferenceImage[] = [];
  for (const group of spec.productIdentity.groups) {
    for (const referenceImageId of group.referenceImageIds) {
      const asset = context.availableAssets.find(item => item.id === referenceImageId || item.sourceId === referenceImageId);
      if (!asset || asset.type !== 'image' || !asset.url) return null;
      rows.push({
        assetId: asset.id,
        productRef: group.productRef,
        url: asset.url,
        contentHash: asset.contentHash || null,
      });
    }
  }
  return rows.length ? rows : null;
}

function score(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function qualityFailure(spec: SocialProductSceneReplicationSpec, quality: ProductSceneQualityReport): string | null {
  const missingIdentity = spec.productIdentity.groups
    .filter(group => score(quality.productIdentitySimilarity[group.productRef]) < spec.productIdentity.identitySimilarityMinimum)
    .map(group => group.productRef);
  if (missingIdentity.length) return `product_identity_failed:${missingIdentity.join(',')}`;
  if (spec.productIdentity.ocrExactMatchRequired && !quality.labelOcrExactMatch) return 'label_ocr_failed';
  if (score(quality.sceneTopologyScore) < 0.9) return 'scene_topology_failed';
  if (score(quality.productSlotLayoutScore) < 0.9) return 'product_slot_layout_failed';
  if (score(quality.cameraTrajectoryScore) < 0.9) return 'camera_trajectory_failed';
  if (!quality.evidenceRefs.length) return 'quality_evidence_missing';
  return null;
}

function outputAsset(input: {
  context: SocialAssetSupplyAdapterContext;
  spec: SocialProductSceneReplicationSpec;
  execution: CompletedProductSceneExecution;
  idempotencyKey: string;
}): SocialProductionAsset {
  const disclosure = 'AIGC 产品场景·真实产品身份锁定·非客户实拍场景';
  return {
    id: `product-scene-${input.context.taskId}-${input.context.shot.shotId}`,
    name: `AIGC 产品场景复刻·${input.context.shot.shotId}`,
    type: 'video',
    sourceId: `${input.execution.providerId}:${input.execution.providerTaskId}`,
    url: input.execution.url || input.execution.localPath,
    localPath: input.execution.localPath,
    contentHash: input.execution.contentHash,
    providerId: input.execution.providerId,
    providerTaskId: input.execution.providerTaskId,
    idempotencyKey: input.idempotencyKey,
    duration: input.execution.duration,
    visualObservations: [
      disclosure,
      `场景模板 ${input.spec.sceneTemplateKey}`,
      `产品槽位 ${input.spec.sceneLock.productSlots.length} 个`,
      `镜头轨迹 ${input.spec.cameraLock.movementPath}`,
    ],
    segments: [{
      providerId: input.execution.providerId,
      providerTaskId: input.execution.providerTaskId,
      model: input.execution.model,
      sceneTemplateKey: input.spec.sceneTemplateKey,
      productSceneSpecVersion: input.spec.schemaVersion,
      productIdentityRefs: input.spec.productIdentity.groups.flatMap(group => group.referenceImageIds),
      validationEvidenceRefs: input.execution.quality.evidenceRefs,
      quality: input.execution.quality,
      actualCostCny: input.execution.actualCostCny,
      idempotencyKey: input.idempotencyKey,
      disclosure,
    }],
    selectionOrigin: 'system_graphic',
  };
}

/**
 * Provider-neutral execution gate. A deployment can register Seedance, Veo or
 * another image-conditioned video provider, but completion is accepted only
 * when product identity, scene topology, slot layout and camera path all pass.
 */
export function createSocialProductSceneAdapter(ports: ProductSceneExecutionPorts): SocialAssetSupplyProviderAdapter {
  const maximumCostCny = Math.max(0, ports.maximumCostCny);
  return {
    adapterId: 'controlled_product_scene_replication.v1',
    sourceStrategies: ['aigc_product_scene_replication'],
    async execute(context) {
      const spec = context.shot.productSceneReplication;
      if (!spec || !context.shot.truthBoundary.syntheticVisualAllowed || context.shot.truthBoundary.customerEvidenceRequired) return null;
      const productReferences = references(context, spec);
      if (!productReferences) return null;
      const idempotencyKey = stableKey({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, spec, references: productReferences });
      const execution = await ports.execute({ tenantId: context.tenantId, taskId: context.taskId,
        shotId: context.shot.shotId, idempotencyKey, spec: structuredClone(spec),
        referenceImages: productReferences, outputDirectory: context.outputDirectory, maximumCostCny });
      if (execution.status !== 'completed') {
        throw new Error(`product_scene_not_completed:${execution.status}:${execution.providerTaskId || 'no_task'}:${execution.error}`);
      }
      if (execution.actualCostCny > maximumCostCny) throw new Error('product_scene_cost_exceeds_shot_budget');
      const expectedDuration = spec.cameraLock.durationSeconds;
      if (Math.abs(execution.duration - expectedDuration) > spec.tolerance.durationSeconds) {
        throw new Error('product_scene_duration_out_of_tolerance');
      }
      const failed = qualityFailure(spec, execution.quality);
      if (failed) throw new Error(`product_scene_quality_failed:${failed}`);
      const output = await stat(execution.localPath).catch(() => null);
      if (!output?.isFile() || output.size < 1 || !execution.contentHash || !execution.providerTaskId) {
        throw new Error('product_scene_output_invalid');
      }
      const asset = outputAsset({ context, spec, execution, idempotencyKey });
      return {
        asset,
        sourceStrategy: 'aigc_product_scene_replication',
        providerId: execution.providerId,
        sourceRef: execution.providerTaskId,
        synthetic: true,
        representation: 'non_evidentiary_visual',
        authorizationRef: null,
        disclosure: 'AIGC 产品场景·真实产品身份锁定·非客户实拍场景',
      };
    },
  };
}

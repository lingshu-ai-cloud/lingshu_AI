import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask, type SocialImageOutputNode } from '../../shared/contracts/socialImageCreation.js';
import { composeFixedSocialLayers } from './fixedOverlayComposer.js';
import { createSocialImageGif } from './gifEncoder.js';
import { socialImageCanvasFromBenchmark } from './referenceCanvas.js';
import { requireSocialImageAtomicStore, SocialImagePaidJobError } from './socialImagePaidJob.js';
import { socialImagePlanSourceHash } from './socialImageDurablePlan.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

type PersistedGifAsset = { materialId: string; mediaUrl: string; contentSha256: string };

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function currentDelivery(task: SocialImageCreationTask): boolean {
  const plan = task.renderPlan;
  const delivery = task.gifDelivery;
  return Boolean(plan && delivery && delivery.planVersion === plan.version && delivery.sourceHash === plan.sourceHash
    && delivery.frameOutputIds.length === plan.units.length
    && plan.units.every(unit => task.outputs.some(output => output.id === delivery.frameOutputIds[unit.index]
      && output.role === 'gif_frame' && output.sourceJobId === unit.jobId
      && output.materialId && output.mediaUrl && output.state !== 'superseded'))
    && task.outputs.some(output => output.id === delivery.finalOutputId && output.role === 'gif_output'
      && output.materialId && output.mediaUrl && output.state !== 'superseded'));
}

/** Only already-durable paid plates are consumed; this operation never calls an image provider. */
export async function finalizeSocialImageGif(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  readPlate: (output: SocialImageOutputNode) => Promise<Buffer | null>;
  readProduct: (productId: string) => Promise<Buffer | null>;
  readBenchmark?: (url: string) => Promise<Buffer | null>;
  persist: (asset: { kind: 'frame' | 'gif'; bytes: Buffer; stableKey: string; index?: number; sourceJobId?: string }) => Promise<PersistedGifAsset>;
}): Promise<SocialImageCreationTask> {
  await requireSocialImageAtomicStore(input.store);
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImagePaidJobError('social_image_task_missing');
  if (task.imageType !== 'gif_poster') throw new SocialImagePaidJobError('social_image_gif_type_required');
  if (currentDelivery(task)) return task;
  if (task.version !== input.expectedVersion) throw new SocialImagePaidJobError('social_image_gif_version_conflict');
  const plan = task.renderPlan;
  if (!plan || plan.sourceHash !== socialImagePlanSourceHash(task) || plan.units.length < 2
    || plan.units.length !== task.deliverySpec.outputCount || plan.units.some(unit => unit.role !== 'gif_plate')) {
    throw new SocialImagePaidJobError('social_image_frozen_plan_invalid');
  }
  if (!task.renderBrief?.headline || task.deliverySpec.motion?.mechanism !== 'background_switch') {
    throw new SocialImagePaidJobError('social_image_gif_composition_contract_invalid');
  }
  const products: Buffer[] = [];
  if (task.contentBrief.productRefs.length < 1 || task.contentBrief.productRefs.length > 2) {
    throw new SocialImagePaidJobError('social_image_gif_product_count_invalid');
  }
  for (const productId of task.contentBrief.productRefs) {
    const bytes = await input.readProduct(productId);
    if (!bytes?.length) throw new SocialImagePaidJobError('social_image_gif_product_unavailable');
    const binding = task.enterpriseAssets.find(asset => asset.role === 'product' && asset.assetId === productId);
    if (!binding || !/^[a-f0-9]{64}$/i.test(binding.contentHash || '')
      || binding.contentHash!.toLowerCase() !== digest(bytes)) {
      throw new SocialImagePaidJobError('social_image_gif_product_identity_changed');
    }
    products.push(bytes);
  }
  const plates: Array<{ bytes: Buffer; jobId: string; index: number }> = [];
  for (const unit of [...plan.units].sort((left, right) => left.index - right.index)) {
    const job = task.generationJobs.find(item => item.id === unit.jobId && item.planVersion === plan.version
      && item.unitIndex === unit.index && item.plannedInputHash === unit.plannedInputHash);
    if (!job || !['quality_checking', 'completed'].includes(job.status) || job.outputNodeIds.length !== 1) {
      throw new SocialImagePaidJobError('social_image_gif_plate_unresolved');
    }
    const output = task.outputs.find(item => item.id === job.outputNodeIds[0] && item.role === 'gif_plate'
      && item.label === unit.label && item.materialId && item.mediaUrl && item.state !== 'superseded');
    if (!output) throw new SocialImagePaidJobError('social_image_gif_plate_not_durable');
    const bytes = await input.readPlate(output);
    if (!bytes?.length) throw new SocialImagePaidJobError('social_image_gif_plate_unreadable');
    plates.push({ bytes, jobId: job.id, index: unit.index });
  }
  if (new Set(plates.map(plate => digest(plate.bytes))).size < 2) {
    throw new SocialImagePaidJobError('social_image_gif_backgrounds_not_distinct');
  }
  const benchmarkUrl = task.referenceSnapshot?.imageUrls[0];
  const benchmark = benchmarkUrl ? await input.readBenchmark?.(benchmarkUrl) : null;
  if (benchmarkUrl && !benchmark?.length) throw new SocialImagePaidJobError('social_image_gif_benchmark_unreadable');
  const benchmarkCanvas = benchmark ? await socialImageCanvasFromBenchmark(benchmark) : null;
  if (benchmark && !benchmarkCanvas) throw new SocialImagePaidJobError('social_image_gif_benchmark_canvas_invalid');
  const plateCanvas = await socialImageCanvasFromBenchmark(plates[0]!.bytes);
  const width = benchmarkCanvas?.width || plateCanvas?.width || 0;
  const height = benchmarkCanvas?.height || plateCanvas?.height || 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || width * height > 16_000_000) {
    throw new SocialImagePaidJobError('social_image_gif_canvas_invalid');
  }
  const stablePrefix = `${task.id}:gif-plan:${plan.version}:${plan.sourceHash}`;
  const frameOutputs: SocialImageOutputNode[] = [];
  const frameBytes: Buffer[] = [];
  for (const plate of plates) {
    const composed = await composeFixedSocialLayers({
      background: plate.bytes, products, poster: task.renderBrief,
      width, height, recipe: task.replicationRecipe,
    });
    frameBytes.push(composed);
    const material = await input.persist({ kind: 'frame', bytes: composed,
      stableKey: `${stablePrefix}:frame:${plate.index}`, index: plate.index, sourceJobId: plate.jobId });
    if (!material.materialId || !material.mediaUrl || material.contentSha256 !== digest(composed)) {
      throw new SocialImagePaidJobError('social_image_gif_frame_not_durable');
    }
    frameOutputs.push({
      id: randomUUID(), role: 'gif_frame', label: `GIF 画面 ${plate.index + 1}`,
      sourceJobId: plate.jobId, state: 'quality_checking', mediaUrl: material.mediaUrl,
      materialId: material.materialId,
      version: Math.max(0, ...task.outputs.filter(item => item.role === 'gif_frame' && item.label === `GIF 画面 ${plate.index + 1}`)
        .map(item => item.version)) + 1,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '等待合成帧质检' })),
    });
  }
  const gifBytes = await createSocialImageGif(frameBytes, width, height, task.deliverySpec.motion.loopDurationMs);
  const finalMaterial = await input.persist({ kind: 'gif', bytes: gifBytes, stableKey: `${stablePrefix}:delivery` });
  if (!finalMaterial.materialId || !finalMaterial.mediaUrl || finalMaterial.contentSha256 !== digest(gifBytes)) {
    throw new SocialImagePaidJobError('social_image_gif_delivery_not_durable');
  }
  const finalOutput: SocialImageOutputNode = {
    id: randomUUID(), role: 'gif_output', label: 'GIF 成片', state: 'quality_checking',
    mediaUrl: finalMaterial.mediaUrl, materialId: finalMaterial.materialId,
    version: Math.max(0, ...task.outputs.filter(item => item.role === 'gif_output').map(item => item.version)) + 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '等待 GIF 成片质检' })),
  };
  const outputs = [...task.outputs.map(output => output.role === 'gif_frame' || output.role === 'gif_output'
    ? { ...output, state: 'superseded' as const } : output), ...frameOutputs, finalOutput];
  const saved = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    outputs, status: 'review_required', step: 'review',
    gifDelivery: { planVersion: plan.version, sourceHash: plan.sourceHash,
      frameOutputIds: frameOutputs.map(output => output.id), finalOutputId: finalOutput.id },
  });
  if (saved.kind === 'updated') return saved.task;
  const current = await readSocialImageTask(input.store, input.tenantId, task.id);
  if (current && currentDelivery(current)) return current;
  throw new SocialImagePaidJobError('social_image_gif_delivery_write_conflict');
}

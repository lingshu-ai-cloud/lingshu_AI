import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { generatePosterImage, type ImageGenerationQuality, type ReferenceImage } from '../lib/imageGen.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { requestMaterialAnalysis } from '../lib/materialLibraryAnalysis.js';
import { conformSocialImageToCanvas, socialImageCanvasForAspectRatio, type SocialImageAspectRatio } from './referenceCanvas.js';
import { completeSocialImagePaidJob, socialImageOwnedMaterialUrl } from './socialImagePaidJob.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { composeFixedSocialLayers } from './fixedOverlayComposer.js';
import { isSocialImageBuyerPoster } from './socialImageBuyerOverlay.js';

/** Shared provider/material/receipt path for the workbench and durable image worker. */
export async function submitClaimedSocialImageSingleRender(input: {
  store: DataStore; tenantId: string; task: SocialImageCreationTask; jobId: string; inputHash: string;
  prompt: string; ratio: SocialImageAspectRatio; quality: ImageGenerationQuality;
  references: ReferenceImage[]; idempotencyKey: string; productId: string;
  materialIds: string[]; benchmarkReferenceCount: number;
  composition?: { productBytes: Buffer; productCutoutId: string; poster: NonNullable<SocialImageCreationTask['renderBrief']>;
    recipe?: SocialImageCreationTask['replicationRecipe']; referenceTextRegion?: 'top_left'; sceneVariant?: number };
}) {
  const generated = await generatePosterImage({ prompt: input.prompt, ratio: input.ratio,
    references: input.references, provider: 'openai', quality: input.quality, idempotencyKey: input.idempotencyKey });
  const canvas = socialImageCanvasForAspectRatio(input.ratio);
  const plate = await conformSocialImageToCanvas(generated.bytes, canvas);
  const plateMaterial = input.composition ? await createGeneratedImageMaterial({
    title: `图文任务背景底图 · ${input.task.id}`,
    bytes: plate, mimeType: 'image/png', source: generated.source, tenantId: input.tenantId,
    sourceType: 'ai_generated_background_plate', stableKey: `${input.jobId}:background-plate`,
    provenance: { socialImageTaskId: input.task.id, socialImageJobId: input.jobId,
      socialImageInputHash: input.inputHash, model: generated.model, qualityStatus: 'intermediate',
      promptSha256: createHash('sha256').update(input.prompt).digest('hex') },
  }) : null;
  const bytes = input.composition ? await composeFixedSocialLayers({ background: plate,
    products: [input.composition.productBytes], poster: input.composition.poster,
    width: canvas.width, height: canvas.height, recipe: input.composition.recipe,
    productTreatment: 'cutout', referenceTextRegion: input.composition.referenceTextRegion,
    sceneVariant: input.composition.sceneVariant }) : plate;
  const material = await createGeneratedImageMaterial({
    title: `AI 图文海报 · ${input.task.renderBrief?.headline || 'Product overview'}`.slice(0, 120),
    bytes, mimeType: 'image/png', source: generated.source, tenantId: input.tenantId,
    ...(input.composition ? { stableKey: `${input.jobId}:composed-poster` } : {}),
    sourceType: 'ai_generated_marketing_image', productId: input.productId,
    provenance: { deliverableType: 'social_poster', productionStrategy: 'reference_generate',
      inputMaterialIds: input.materialIds, inputProductIds: [input.productId],
      benchmarkReferenceCount: input.benchmarkReferenceCount,
      promptSha256: createHash('sha256').update(input.prompt).digest('hex'),
      socialImageTaskId: input.task.id, socialImageJobId: input.jobId,
      socialImageInputHash: input.inputHash, model: generated.model, qualityStatus: 'needs_review',
      ...(input.composition ? { localComposition: isSocialImageBuyerPoster(input.composition.poster)
        ? 'identity-locked-b2b-v1' : 'fixed-product-and-copy-v1',
        backgroundMaterialId: plateMaterial?.id,
        plateSha256: createHash('sha256').update(plate).digest('hex'),
        productSha256: createHash('sha256').update(input.composition.productBytes).digest('hex'),
        productCutoutMaterialId: input.composition.productCutoutId } : {}) },
  });
  const task = await completeSocialImagePaidJob({ store: input.store, tenantId: input.tenantId,
    taskId: input.task.id, jobId: input.jobId, inputHash: input.inputHash, provider: generated.source,
    output: { id: randomUUID(), role: 'single', label: '主视觉', state: 'quality_checking',
      mediaUrl: socialImageOwnedMaterialUrl(material, input.tenantId), materialId: material.id,
      contentHash: material.contentSha256, version: Math.max(0, ...input.task.outputs
        .filter(item => item.role === 'single' && item.label === '主视觉').map(item => item.version)) + 1,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '等待人工复核' })) } });
  void requestMaterialAnalysis(input.tenantId, material.id).catch(error => {
    console.warn('[studio] generated poster material analysis could not start', error instanceof Error ? error.message : error);
  });
  return { task, material, generated };
}

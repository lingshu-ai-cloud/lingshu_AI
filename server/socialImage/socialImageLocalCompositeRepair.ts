import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask, type SocialImageOutputNode } from '../../shared/contracts/socialImageCreation.js';
import { composeFixedSocialLayers } from './fixedOverlayComposer.js';
import { socialImageOwnedMaterialUrl } from './socialImagePaidJob.js';
import { assertSocialImageCurrentContentTask } from './socialImageProductionRun.js';
import { socialImageCanvasForAspectRatio } from './referenceCanvas.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Only a failed deterministic text check can spend the one local repair slot. */
export function localCompositeRepairCandidate(task: SocialImageCreationTask): SocialImageOutputNode | null {
  if (task.schemaVersion !== 'social-image-creation.v3' || task.creationPath !== 'viral_replication'
    || task.imageType !== 'product_poster' || task.status === 'approved' || task.approvedArtifact
    || !task.renderBrief || !task.replicationRecipe) return null;
  const current = task.outputs.filter(output => output.state !== 'superseded');
  if (current.length !== 1) return null;
  const output = current[0]!;
  if (output.role !== 'single' || output.state !== 'repair_required' || !output.materialId
    || (output.qualityPreflight && output.qualityPreflight.status !== 'completed')) return null;
  const instruction = task.repairInstructions.find(item => item.outputNodeId === output.id && item.status === 'pending'
    && item.targetLayer === 'typography' && item.fromVersion === output.version
    && item.failedChecks.length > 0 && item.failedChecks.every(key => key === 'label_ocr'));
  if (!instruction || !output.qualityChecks.some(check => check.key === 'label_ocr' && check.severity === 'hard'
    && check.verdict === 'fail')
    || task.repairInstructions.some(item => item.status === 'completed' && item.outputNodeId !== output.id)) return null;
  return output;
}

function ownedMaterial(items: MaterialRecord[], tenantId: string, id: string): MaterialRecord {
  const material = items.find(item => item.id === id && item.type === 'image'
    && item.scope === 'own' && String(item.tenantId || item.tenant_id || '') === tenantId);
  if (!material) throw new Error('social_image_local_repair_material_missing');
  return material;
}

/** Recompose the saved plate and frozen product/copy. This function never contacts an image provider. */
export async function repairSocialImageLocalComposite(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
  enterpriseProductAsset: (tenantId: string, id: string) => Promise<{ name: string; bytes: Buffer } | null>;
  materials?: MaterialRecord[];
  readBytes?: typeof readTenantMaterialBytes;
  writeMaterial?: typeof createGeneratedImageMaterial;
}): Promise<{ task: SocialImageCreationTask; additionalPaidQualityRequired: boolean }> {
  const { store, tenantId } = input;
  const task = await readSocialImageTask(store, tenantId, input.taskId);
  if (!task || task.version !== input.expectedVersion) throw new Error('social_image_local_repair_version_conflict');
  await assertSocialImageCurrentContentTask(store, tenantId, task, 'review_original_output');
  const old = localCompositeRepairCandidate(task);
  if (!old) throw new Error('social_image_local_repair_not_eligible');
  const items = input.materials || (await readMaterialLibrary(tenantId)).items;
  const original = ownedMaterial(items, tenantId, old.materialId!);
  const provenance = original.provenance as Record<string, unknown> | undefined;
  const plateId = String(provenance?.backgroundMaterialId || '');
  const jobId = String(provenance?.socialImageJobId || '');
  const inputHash = String(provenance?.socialImageInputHash || '');
  const productId = task.contentBrief.productRefs[0] || '';
  const job = task.generationJobs.find(item => item.id === jobId && item.status === 'completed' && item.inputHash === inputHash);
  if (!plateId || !job || !job.outputNodeIds.includes(old.id) || !productId
    || original.sourceType !== 'ai_generated_marketing_image' || provenance?.socialImageTaskId !== task.id
    || !['fixed-product-and-copy-v1', 'fixed-product-and-copy-v2', 'integrated-scene-and-copy-v1', 'integrated-scene-b2b-v2'].includes(String(provenance?.localComposition || ''))
    || !validHash(original.contentSha256) || old.contentHash !== original.contentSha256
    || !validHash(provenance?.plateSha256) || !validHash(provenance?.productSha256)) {
    throw new Error('social_image_local_repair_lineage_invalid');
  }
  const plate = ownedMaterial(items, tenantId, plateId);
  const plateProvenance = plate.provenance as Record<string, unknown> | undefined;
  if (plate.sourceType !== 'ai_generated_background_plate' || plateProvenance?.socialImageTaskId !== task.id
    || plateProvenance?.socialImageJobId !== jobId || plateProvenance?.socialImageInputHash !== inputHash
    || plate.contentSha256 !== provenance.plateSha256) throw new Error('social_image_local_repair_plate_mismatch');
  const readBytes = input.readBytes || readTenantMaterialBytes;
  const background = (await readBytes(plate, tenantId)).bytes;
  const priorImage = (await readBytes(original, tenantId)).bytes;
  const product = await input.enterpriseProductAsset(tenantId, productId);
  if (!product || hash(background) !== provenance.plateSha256 || hash(priorImage) !== original.contentSha256
    || hash(product.bytes) !== provenance.productSha256) throw new Error('social_image_local_repair_bytes_changed');
  const canvas = socialImageCanvasForAspectRatio(task.deliverySpec.aspectRatio);
  const oldVersion = String(provenance.localComposition);
  const bytes = await composeFixedSocialLayers({ background, products: [product.bytes], poster: task.renderBrief!,
    width: canvas.width, height: canvas.height, recipe: task.replicationRecipe,
    productTreatment: oldVersion === 'integrated-scene-and-copy-v1' || oldVersion === 'integrated-scene-b2b-v2'
      ? 'integrated_scene' : 'framed_source',
    referenceTextRegion: task.hookFactorSpec?.factors.some(factor => factor.factorId === 'reference-text-hierarchy'
      && factor.validator.observableTarget === 'top_left') ? 'top_left' : undefined,
    repairContrast: oldVersion === 'fixed-product-and-copy-v2' || oldVersion === 'integrated-scene-and-copy-v1'
      || oldVersion === 'integrated-scene-b2b-v2' });
  const digest = hash(bytes);
  if (digest === original.contentSha256) throw new Error('social_image_local_repair_no_pixel_change');
  const material = await (input.writeMaterial || createGeneratedImageMaterial)({
    title: `本地排版修复 · ${task.id}`, bytes, mimeType: 'image/png', source: 'deterministic-compositor',
    tenantId, sourceType: 'ai_generated_marketing_image', productId,
    stableKey: `${jobId}:composed-poster:${oldVersion === 'fixed-product-and-copy-v1' ? 'local-repair-v2' : 'contrast-repair-v3'}`,
    provenance: { socialImageTaskId: task.id, socialImageJobId: jobId, socialImageInputHash: inputHash,
      backgroundMaterialId: plateId, plateSha256: hash(background), productSha256: hash(product.bytes),
      originalOutputId: old.id, originalMaterialId: original.id,
      localComposition: oldVersion === 'integrated-scene-b2b-v2' ? 'integrated-scene-b2b-v3-contrast'
        : oldVersion === 'integrated-scene-and-copy-v1' ? 'integrated-scene-and-copy-v2-contrast'
        : oldVersion === 'fixed-product-and-copy-v1' ? 'fixed-product-and-copy-v2' : 'fixed-product-and-copy-v3-contrast',
      qualityStatus: 'needs_review', model: plateProvenance?.model },
  });
  const version = old.version + 1;
  const next = await updateSocialImageTask(store, tenantId, task.id, task.version, {
    status: 'review_required', step: 'review',
    outputs: [...task.outputs.map(output => output.id === old.id ? { ...output, state: 'superseded' as const } : output), {
      id: randomUUID(), role: 'single', label: old.label, state: 'quality_checking', version,
      mediaUrl: socialImageOwnedMaterialUrl(material, tenantId), materialId: material.id, contentHash: digest,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const,
        severity: 'hard' as const, checker: 'deterministic' as const, note: '等待修复版质检' })),
    }],
    repairInstructions: task.repairInstructions.map(item => item.outputNodeId === old.id && item.status === 'pending'
      ? { ...item, status: 'completed' as const, toVersion: version } : item),
  });
  if (next.kind !== 'updated') throw new Error(next.kind === 'conflict'
    ? 'social_image_local_repair_version_conflict' : 'social_image_local_repair_save_failed');
  return { task: next.task, additionalPaidQualityRequired: old.qualityPreflight?.status === 'completed' };
}

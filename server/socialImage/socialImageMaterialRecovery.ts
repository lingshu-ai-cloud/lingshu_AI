import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore } from '../storage/datastore.js';
import type { MaterialRecord } from '../lib/materialLibrary.js';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../shared/contracts/socialImageCreation.js';
import { completeSocialImagePaidJob, socialImageOwnedMaterialUrl, SocialImagePaidJobError } from './socialImagePaidJob.js';
import { readSocialImageTask } from './socialImageTask.js';

function matchingMaterial(material: MaterialRecord, tenantId: string, taskId: string, jobId: string, inputHash: string): boolean {
  const provenance = material.provenance;
  let locatorValid = false;
  try { locatorValid = Boolean(socialImageOwnedMaterialUrl(material, tenantId)); } catch { /* foreign or malformed locator */ }
  return material.scope === 'own' && String(material.tenantId || material.tenant_id || '') === tenantId
    && material.type === 'image' && material.sourceType === 'ai_generated_marketing_image'
    && locatorValid
    && provenance && typeof provenance === 'object'
    && provenance.socialImageTaskId === taskId && provenance.socialImageJobId === jobId
    && provenance.socialImageInputHash === inputHash;
}

/** Match an already-persisted tenant material. This function never submits a provider request. */
export async function recoverSocialImagePaidMaterial(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  jobId: string;
  materials: MaterialRecord[];
  readBytes: (material: MaterialRecord, tenantId: string) => Promise<{ bytes: Buffer; mimeType: string }>;
  materialUrl: (material: MaterialRecord, tenantId: string) => string;
}) {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImagePaidJobError('social_image_task_missing');
  const job = task.generationJobs.find(item => item.id === input.jobId);
  if (!job?.inputHash || !['running', 'outcome_unknown', 'quality_checking'].includes(job.status)) {
    throw new SocialImagePaidJobError('social_image_paid_job_not_recoverable');
  }
  const multiOutput = task.imageType === 'carousel' || task.imageType === 'gif_poster';
  const unit = multiOutput ? task.renderPlan?.units.find(item => item.jobId === job.id) : undefined;
  if (multiOutput && (!unit || task.renderPlan?.version !== job.planVersion
    || unit.index !== job.unitIndex || unit.plannedInputHash !== job.plannedInputHash
    || unit.idempotencyKey !== job.idempotencyKey
    || unit.role !== (task.imageType === 'carousel' ? 'carousel_page' : 'gif_plate'))) {
    throw new SocialImagePaidJobError('social_image_planned_unit_identity_invalid');
  }
  const matches = input.materials.filter(item => matchingMaterial(item, input.tenantId, input.taskId, input.jobId, job.inputHash!));
  if (!matches.length) throw new SocialImagePaidJobError('social_image_material_not_found');
  if (matches.length !== 1) throw new SocialImagePaidJobError('social_image_material_ambiguous');
  const material = matches[0]!;
  const expectedSha = String(material.contentSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new SocialImagePaidJobError('social_image_material_hash_missing');
  const { bytes, mimeType } = await input.readBytes(material, input.tenantId);
  if (!mimeType.startsWith('image/') || !bytes.length || createHash('sha256').update(bytes).digest('hex') !== expectedSha) {
    throw new SocialImagePaidJobError('social_image_material_hash_mismatch');
  }
  const metadata = await sharp(bytes).metadata().catch(() => null);
  if (!metadata?.width || !metadata.height) throw new SocialImagePaidJobError('social_image_material_not_decodable');
  const mediaUrl = input.materialUrl(material, input.tenantId);
  if (!mediaUrl.startsWith('/')) throw new SocialImagePaidJobError('social_image_material_url_invalid');
  const recovered = await completeSocialImagePaidJob({
    store: input.store, tenantId: input.tenantId, taskId: input.taskId, jobId: input.jobId,
    inputHash: job.inputHash, provider: String(material.sourceProvider || 'openai'),
    output: {
      id: randomUUID(), role: unit?.role || 'single', label: unit?.label || '主视觉', state: 'quality_checking',
      mediaUrl, materialId: material.id,
      version: Math.max(0, ...task.outputs.filter(item => item.role === (unit?.role || 'single') && item.label === (unit?.label || '主视觉')).map(item => item.version)) + 1,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '等待人工复核' })),
    },
  });
  return { task: recovered, materialId: material.id, url: mediaUrl };
}

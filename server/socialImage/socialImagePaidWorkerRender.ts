import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore } from '../storage/datastore.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { auditCommercialClaims, hasConfirmedEnterpriseFacts, userFacingPosterText } from '../lib/studioGenerationTruthfulness.js';
import { ImageProviderRejectedError, normalizeImageGenerationQuality, type ReferenceImage } from '../lib/imageGen.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { buildStudioSocialImagePaidPrompt, socialImageReferenceRoleText } from './socialImagePaidRenderAdmission.js';
import { admitSocialImageV3QueuedJob, claimSocialImagePaidJob, markSocialImagePaidJobNotSubmitted,
  recordSocialImagePaidJobFailure } from './socialImagePaidJob.js';
import { socialImageFrozenCommercialIssue, socialImageV3PaidPrerequisiteIssue,
  socialImageV3PaidEvidenceHash, socialImageV3ReferencePermitted, socialImageV3RenderSpecInputHash,
  socialImageV3ResolvedAssetIssue, socialImageV3SingleRenderInput } from './socialImagePaidPrerequisites.js';
import { readSocialImageReferenceBytes } from './socialImageReferenceBytes.js';
import { submitClaimedSocialImageSingleRender } from './socialImagePaidSingleRender.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageAspectRatio } from './referenceCanvas.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function referenceImage(bytes: Buffer): Promise<ReferenceImage> {
  const format = (await sharp(bytes).metadata()).format;
  return { mimeType: format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
    base64: bytes.toString('base64') };
}

/** The durable worker uses the same paid provider/material writer as the Studio route. */
export async function renderSocialImagePaidWorker(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
  enterpriseProductAsset: (tenantId: string, id: string) => Promise<{ name: string; bytes: Buffer } | null>;
  allowPaidCall: () => Promise<boolean>;
  ports?: {
    enterpriseContext?: (tenantId: string) => Promise<string>;
    referenceBytes?: typeof readSocialImageReferenceBytes;
    submit?: (request: Parameters<typeof submitClaimedSocialImageSingleRender>[0]) => Promise<{ task: SocialImageCreationTask }>;
  };
}): Promise<SocialImageCreationTask> {
  const { store, tenantId } = input;
  const found = await readSocialImageTask(store, tenantId, input.taskId);
  if (!found || found.version !== input.expectedVersion) throw new Error('social_image_version_conflict');
  let task: SocialImageCreationTask = found;
  const issue = socialImageV3PaidPrerequisiteIssue(task, 'execute');
  if (issue) throw new Error(issue);
  if (task.creationPath !== 'viral_replication' || task.imageType !== 'product_poster'
    || task.deliverySpec.imageGeneration?.provider !== 'openai'
    || task.deliverySpec.imageGeneration.model !== 'gpt-image-2') throw new Error('social_image_paid_render_route_not_authorized');
  const productId = task.contentBrief.productRefs[0]!;
  const product = await input.enterpriseProductAsset(tenantId, productId);
  if (!product) throw new Error('social_image_product_asset_unavailable');
  const library = await readMaterialLibrary(tenantId);
  const materialImages: ReferenceImage[] = [];
  const materialHashes: Record<string, string> = {};
  const materialRoles: Array<{ role: string; materialId: string }> = [];
  for (const id of task.materialIds) {
    const record = library.items.find(item => item.id === id && item.type === 'image');
    const loaded = record ? await readTenantMaterialBytes(record, tenantId) : null;
    if (!loaded) throw new Error('social_image_required_asset_bytes_changed');
    materialHashes[id] = hash(loaded.bytes);
    materialImages.push(await referenceImage(loaded.bytes));
    materialRoles.push({ materialId: id, role: task.enterpriseAssets.find(asset => asset.assetId === id)?.role || 'scene' });
  }
  const referenceUrl = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || '';
  const reference = referenceUrl ? await (input.ports?.referenceBytes || readSocialImageReferenceBytes)(tenantId, referenceUrl) : null;
  const referenceHash = reference?.bytes.length ? hash(reference.bytes) : null;
  const assetIssue = socialImageV3ResolvedAssetIssue(task, {
    productHashes: { [productId]: hash(product.bytes) }, materialHashes, referenceHash });
  if (assetIssue) throw new Error(assetIssue);
  const benchmark = reference && socialImageV3ReferencePermitted(task) ? [await referenceImage(reference.bytes)] : [];
  const owned = [await referenceImage(product.bytes), ...materialImages].slice(0, benchmark.length ? 2 : 3);
  const references = [...owned, ...benchmark].slice(0, 3);
  const enterprise = await (input.ports?.enterpriseContext || (async (id: string) =>
    buildEnterpriseContext(await readTenantEnterpriseProfile(id))))(tenantId);
  if (!hasConfirmedEnterpriseFacts(enterprise)) throw new Error('social_image_enterprise_profile_required');
  const renderSpec = task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'render_spec'
    && node.status === 'completed').at(-1)?.value as { idempotencyKey?: string } | undefined;
  const idempotencyKey = String(renderSpec?.idempotencyKey || '');
  if (!idempotencyKey) throw new Error('social_image_render_spec_stale');
  let job = task.generationJobs.find(item => item.idempotencyKey === idempotencyKey && item.status === 'queued'
    && item.attempt === 0 && !item.inputHash && !item.outputNodeIds.length);
  if (!job) {
    if (task.generationJobs.some(item => item.idempotencyKey === idempotencyKey)) {
      throw new Error('social_image_prior_paid_job_unresolved');
    }
    const now = new Date().toISOString();
    job = { id: randomUUID(), idempotencyKey, status: 'queued', outputNodeIds: [], attempt: 0,
      plannedInputHash: socialImageV3PaidEvidenceHash(task), createdAt: now, updatedAt: now };
  }
  // Derive and audit the exact frozen request before appending a paid job.
  // A local validation failure must not leave a misleading queued receipt.
  const frozen = socialImageV3SingleRenderInput({ ...task,
    generationJobs: [...task.generationJobs.filter(item => item.id !== job.id), job] }, job.id);
  if (!frozen?.poster || !frozen.imagePrompt) throw new Error('social_image_frozen_render_input_incomplete');
  const audit = auditCommercialClaims(userFacingPosterText({ poster: frozen.poster,
    imagePrompt: frozen.imagePrompt }), enterprise);
  const commercialIssue = socialImageFrozenCommercialIssue({ ...audit,
    headline: frozen.poster.headline, imagePrompt: frozen.imagePrompt });
  if (commercialIssue) throw new Error(commercialIssue);
  const prompt = buildStudioSocialImagePaidPrompt({ sceneIntent: frozen.imagePrompt, ratio: frozen.ratio,
    language: task.deliverySpec.language, poster: frozen.poster, deliverableType: frozen.deliverableType,
    productionStrategy: frozen.productionStrategy,
    referenceRoleText: socialImageReferenceRoleText({ productIds: [productId], materialReferences: materialRoles,
      benchmarkCount: benchmark.length, ownedReferenceCount: owned.length }),
    benchmarkCount: benchmark.length, ownedReferenceCount: owned.length });
  const ratio = frozen.ratio as SocialImageAspectRatio;
  const quality = normalizeImageGenerationQuality(frozen.imageQuality);
  const inputHash = createHash('sha256').update(JSON.stringify({ prompt, ratio, quality,
    references: references.map(ref => hash(Buffer.from(ref.base64, 'base64'))),
    requestedProductIds: [productId], materialIds: task.materialIds,
    imageTaskId: task.id, imageJobId: job.id, plannedInputHash: null,
    renderSpecInputHash: socialImageV3RenderSpecInputHash(task) })).digest('hex');
  if (!task.generationJobs.some(item => item.id === job.id)) {
    const patch = await admitSocialImageV3QueuedJob(store, tenantId, task, { status: 'generating', step: 'generate',
      generationJobs: [...task.generationJobs, { id: job.id, idempotencyKey, status: 'queued', outputNodeIds: [],
        attempt: 0, createdAt: job.createdAt, updatedAt: job.updatedAt }] });
    const saved = await updateSocialImageTask(store, tenantId, task.id, task.version, patch);
    if (saved.kind !== 'updated') throw new Error('social_image_paid_job_queue_conflict');
    task = saved.task;
  }
  task = await claimSocialImagePaidJob({ store, tenantId, taskId: task.id, jobId: job.id,
    idempotencyKey, inputHash });
  let providerMayHaveStarted = false;
  try {
    if (!await input.allowPaidCall()) throw new Error('social_image_paid_execution_disabled');
    providerMayHaveStarted = true;
    return (await (input.ports?.submit || submitClaimedSocialImageSingleRender)({ store, tenantId, task, jobId: job.id, inputHash,
      prompt, ratio, quality, references, idempotencyKey, productId,
      materialIds: task.materialIds, benchmarkReferenceCount: benchmark.length })).task;
  } catch (error) {
    if (providerMayHaveStarted) {
      await recordSocialImagePaidJobFailure({ store, tenantId, taskId: task.id, jobId: job.id,
        inputHash, error: error instanceof Error ? error.message : String(error),
        definitiveRejection: error instanceof ImageProviderRejectedError });
    } else {
      await markSocialImagePaidJobNotSubmitted({ store, tenantId, taskId: task.id, jobId: job.id,
        inputHash, reason: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }
}

import type {
  CreateSocialArtifactInput,
  CreateSocialDeliveryPackageInput,
  DecideSocialArtifactInput,
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentTaskDetail,
  SocialDeliveryPackage,
  SocialMetricSubmission,
  SocialPublicationRecord,
  SubmitSocialMetricsInput,
} from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import {
  findSocialRecord,
  readSocialTaskDetail,
  requireSocialTask,
  socialArtifact,
  socialDeliveryPackage,
  socialMetricSubmission,
  socialPublication,
  socialTaskReadiness,
  socialTaskSummary,
} from './socialContentRecords.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialPublicId,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import { requireOwnedSocialFileRef } from './socialContentFiles.js';
import { assertSocialTaskChildCapacity } from './socialContentLimits.js';
import {
  readSocialContentSourceCoverage,
  reconcileSocialContentTask,
} from './socialContentProjection.js';
import {
  parseSocialDeliveryManifest,
  type SocialDeliveryManifest,
} from './socialDeliveryArchive.js';
import { resolveSelectedPackages } from './socialWorkPackages.js';
import {
  resolveSocialArtifactMedia,
  socialArtifactMediaDescriptor,
  socialArtifactMediaFamily,
} from './socialArtifactMedia.js';

const OUTPUT_EDITABLE_STATES = new Set(['producing', 'asset_review', 'attention']);
const MAX_SOCIAL_DELIVERY_MANIFEST_BYTES = 2 * 1024 * 1024;

function nextVersion(value: unknown, code: string): string {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new SocialContentWorkflowError(code, 503);
  return String(parsed + 1);
}

function assertTaskVersion(record: StarterRecord, expected: string): void {
  if (socialText(record.version) !== expected) {
    throw new SocialContentWorkflowError('social_content_task_version_conflict', 409);
  }
}

async function byOperation(input: {
  repository: Starter198Repository;
  collection: Parameters<Starter198Repository['list']>[0];
  tenantId: string;
  operationId: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(input.collection, input.tenantId, {
    where: { created_operation_id: input.operationId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError('social_content_output_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

export async function createSocialContentArtifact(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: CreateSocialArtifactInput;
  trustedAgentOrigin?: boolean;
  now?: Date;
}): Promise<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }> {
  if (input.value.origin === 'agent' && !input.trustedAgentOrigin) {
    throw new SocialContentWorkflowError('social_artifact_agent_origin_forbidden', 403);
  }
  const mutation = await executeSocialContentMutation<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'create_social_content_artifact',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialContentArtifacts, operationId });
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
      return { artifact: socialArtifact(existing), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialContentArtifacts, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
        return { artifact: socialArtifact(existing), task: (await readSocialTaskDetail(input))! };
      }
      const taskStatus = socialText(task.status);
      if (taskStatus === 'plan_review') {
        if (input.value.origin !== 'manual') {
          throw new SocialContentWorkflowError('social_content_artifact_not_allowed', 409);
        }
        const summary = socialTaskSummary(task);
        const readiness = socialTaskReadiness(summary.brief, await readSocialContentSourceCoverage(input));
        if (!readiness.complete) {
          throw new SocialContentWorkflowError('social_content_task_inputs_incomplete', 409);
        }
        await resolveSelectedPackages({
          repository: input.repository,
          selections: summary.packageSelection,
          now: input.now,
        });
      } else if (!OUTPUT_EDITABLE_STATES.has(taskStatus)) {
        throw new SocialContentWorkflowError('social_content_artifact_not_allowed', 409);
      }
      await assertSocialTaskChildCapacity({ ...input, kind: 'artifact' });
      const media = await resolveSocialArtifactMedia(input);
      let parent: StarterRecord | null = null;
      if (input.value.parentArtifactId) {
        parent = await findSocialRecord({
          ...input,
          collection: STARTER_COLLECTIONS.socialContentArtifacts,
          where: { artifact_id: input.value.parentArtifactId, task_id: input.taskId },
          notFoundCode: 'social_artifact_parent_not_found',
        });
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      const artifactId = socialPublicId('socialart');
      const content = {
        ...(input.value.content ?? {}),
        ...(media ? { media: socialArtifactMediaDescriptor(artifactId, media.file) } : {}),
      };
      const created = await input.repository.create(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, {
        artifact_id: artifactId,
        task_id: input.taskId,
        artifact_kind: input.value.kind,
        platform: input.value.platform ?? '',
        language: input.value.language ?? '',
        version: '1',
        status: 'review_required',
        origin: input.value.origin,
        resource_ref: media?.file.fileRef ?? input.value.resourceRef ?? '',
        content,
        content_hash: socialRequestHash({ resourceRef: media?.file.fileRef ?? input.value.resourceRef, content }),
        parent_artifact_id: input.value.parentArtifactId ?? '',
        decision_note: '',
        created_operation_id: operationId,
        last_operation_id: operationId,
        created_by: input.userId,
        updated_by: input.userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      if (parent && socialText(parent.status) !== 'superseded') {
        await input.repository.update(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, parent.id, {
          status: 'superseded',
          updated_by: input.userId,
          updated_at: timestamp,
        });
      }
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
      return { artifact: socialArtifact(created), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function decideSocialContentArtifact(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  artifactId: string;
  idempotencyKey: string;
  value: DecideSocialArtifactInput;
  now?: Date;
}): Promise<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }> {
  const mutation = await executeSocialContentMutation<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'decide_social_content_artifact',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      const artifact = await findSocialRecord({
        ...input,
        collection: STARTER_COLLECTIONS.socialContentArtifacts,
        where: { artifact_id: input.artifactId, task_id: input.taskId },
        notFoundCode: 'social_artifact_not_found',
      });
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
      return { artifact: socialArtifact(artifact), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const artifact = await findSocialRecord({
        ...input,
        collection: STARTER_COLLECTIONS.socialContentArtifacts,
        where: { artifact_id: input.artifactId, task_id: input.taskId },
        notFoundCode: 'social_artifact_not_found',
      });
      if (socialText(artifact.last_operation_id) === operationId) {
        await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
        return { artifact: socialArtifact(artifact), task: (await readSocialTaskDetail(input))! };
      }
      if (socialText(artifact.version) !== input.value.expectedVersion) {
        throw new SocialContentWorkflowError('social_artifact_version_conflict', 409);
      }
      if (!['review_required', 'changes_requested'].includes(socialText(artifact.status))) {
        throw new SocialContentWorkflowError('social_artifact_not_decidable', 409);
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      await input.repository.update(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, artifact.id, {
        status: input.value.decision,
        version: nextVersion(artifact.version, 'social_artifact_record_invalid'),
        decision_note: input.value.note ?? '',
        last_operation_id: operationId,
        updated_by: input.userId,
        updated_at: timestamp,
      });
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'asset_review' });
      const updated = await findSocialRecord({
        ...input,
        collection: STARTER_COLLECTIONS.socialContentArtifacts,
        where: { artifact_id: input.artifactId, task_id: input.taskId },
        notFoundCode: 'social_artifact_not_found',
      });
      return { artifact: socialArtifact(updated), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function createSocialDeliveryPackage(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: CreateSocialDeliveryPackageInput;
  now?: Date;
}): Promise<{ deliveryPackage: SocialDeliveryPackage; task: SocialContentTaskDetail }> {
  const mutation = await executeSocialContentMutation<{ deliveryPackage: SocialDeliveryPackage; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'create_social_delivery_package',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialDeliveryPackages, operationId });
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'delivered' });
      return { deliveryPackage: socialDeliveryPackage(existing), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialDeliveryPackages, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'delivered' });
        return { deliveryPackage: socialDeliveryPackage(existing), task: (await readSocialTaskDetail(input))! };
      }
      assertTaskVersion(task, input.value.expectedTaskVersion);
      if (!['asset_review', 'packaging'].includes(socialText(task.status))) {
        throw new SocialContentWorkflowError('social_delivery_package_not_allowed', 409);
      }
      await assertSocialTaskChildCapacity({ ...input, kind: 'delivery_package' });
      const artifacts: SocialContentArtifact[] = [];
      const media: SocialDeliveryManifest['media'] = [];
      for (const artifactId of input.value.artifactIds) {
        const record = await findSocialRecord({
          ...input,
          collection: STARTER_COLLECTIONS.socialContentArtifacts,
          where: { artifact_id: artifactId, task_id: input.taskId },
          notFoundCode: 'social_delivery_artifact_not_found',
        });
        const artifact = socialArtifact(record);
        if (artifact.status !== 'approved') throw new SocialContentWorkflowError('social_delivery_artifact_not_approved', 409);
        const resolvedMedia = await resolveSocialArtifactMedia({
          repository: input.repository,
          tenantId: input.tenantId,
          taskId: input.taskId,
          value: {
            kind: artifact.kind,
            platform: artifact.platform,
            language: artifact.language,
            origin: artifact.origin,
            resourceRef: artifact.resourceRef,
            content: artifact.content,
            parentArtifactId: artifact.parentArtifactId,
          },
        });
        if (socialArtifactMediaFamily(artifact.kind, artifact.content) && !resolvedMedia) {
          throw new SocialContentWorkflowError('social_delivery_media_required', 409);
        }
        if (resolvedMedia) media.push(socialArtifactMediaDescriptor(artifact.artifactId, resolvedMedia.file));
        artifacts.push(artifact);
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      const packageId = socialPublicId('socialpkg');
      const manifest: SocialDeliveryManifest = {
        schemaVersion: 'social-content.delivery.v1', taskId: input.taskId, packageId, artifacts, media,
      };
      if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_SOCIAL_DELIVERY_MANIFEST_BYTES) {
        throw new SocialContentWorkflowError('social_delivery_package_too_large', 413);
      }
      const packageHash = socialRequestHash(manifest);
      const taskDetail = await readSocialTaskDetail(input);
      if (!taskDetail) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
      const created = await input.repository.create(STARTER_COLLECTIONS.socialDeliveryPackages, input.tenantId, {
        package_id: packageId,
        task_id: input.taskId,
        version: String(taskDetail.deliveryPackages.length + 1),
        status: 'ready',
        artifact_ids: artifacts.map(item => item.artifactId),
        manifest,
        package_hash: packageHash,
        created_operation_id: operationId,
        last_operation_id: operationId,
        created_by: input.userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'delivered' });
      return { deliveryPackage: socialDeliveryPackage(created), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function readSocialDeliveryPackage(input: {
  repository: Starter198Repository;
  tenantId: string;
  packageId: string;
}): Promise<{ view: SocialDeliveryPackage; manifest: SocialDeliveryManifest }> {
  const record = await findSocialRecord({
    ...input,
    collection: STARTER_COLLECTIONS.socialDeliveryPackages,
    where: { package_id: input.packageId },
    notFoundCode: 'social_delivery_package_not_found',
  });
  const view = socialDeliveryPackage(record);
  if (!['ready', 'confirmed'].includes(view.status)) {
    throw new SocialContentWorkflowError('social_delivery_package_not_ready', 409);
  }
  const rawManifest = socialJson(record.manifest);
  const manifestRecord = socialObject(rawManifest);
  if (!manifestRecord || socialRequestHash(manifestRecord) !== socialText(record.package_hash)) {
    throw new SocialContentWorkflowError('social_delivery_package_integrity_violation', 503);
  }
  const manifest = parseSocialDeliveryManifest(manifestRecord, {
    taskId: view.taskId,
    packageId: view.packageId,
    artifactIds: view.artifactIds,
  });
  return { view, manifest };
}

export async function registerSocialPublication(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: RegisterSocialPublicationInput;
  now?: Date;
}): Promise<{ publication: SocialPublicationRecord; task: SocialContentTaskDetail }> {
  const mutation = await executeSocialContentMutation<{ publication: SocialPublicationRecord; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'register_social_publication',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialPublications, operationId });
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'awaiting_metrics' });
      return { publication: socialPublication(existing), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialPublications, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'awaiting_metrics' });
        return { publication: socialPublication(existing), task: (await readSocialTaskDetail(input))! };
      }
      assertTaskVersion(task, input.value.expectedTaskVersion);
      if (!['delivered', 'awaiting_publish', 'awaiting_metrics'].includes(socialText(task.status))) {
        throw new SocialContentWorkflowError('social_publication_not_allowed', 409);
      }
      await assertSocialTaskChildCapacity({ ...input, kind: 'publication' });
      const delivery = await findSocialRecord({
        ...input,
        collection: STARTER_COLLECTIONS.socialDeliveryPackages,
        where: { package_id: input.value.packageId, task_id: input.taskId },
        notFoundCode: 'social_delivery_package_not_found',
      });
      if (!['ready', 'confirmed'].includes(socialText(delivery.status))) {
        throw new SocialContentWorkflowError('social_delivery_package_not_ready', 409);
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      const created = await input.repository.create(STARTER_COLLECTIONS.socialPublications, input.tenantId, {
        publication_id: socialPublicId('socialpub'),
        task_id: input.taskId,
        package_id: input.value.packageId,
        platform: input.value.platform,
        account_label: input.value.accountLabel ?? '',
        public_url: input.value.publicUrl ?? '',
        platform_post_id: input.value.platformPostId ?? '',
        published_at: input.value.publishedAt,
        notes: input.value.notes ?? '',
        status: 'registered',
        created_operation_id: operationId,
        last_operation_id: operationId,
        created_by: input.userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'awaiting_metrics' });
      return { publication: socialPublication(created), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function submitSocialMetrics(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  publicationId: string;
  idempotencyKey: string;
  value: SubmitSocialMetricsInput;
  now?: Date;
}): Promise<{ metricSubmission: SocialMetricSubmission; task: SocialContentTaskDetail }> {
  const publication = await findSocialRecord({
    ...input,
    collection: STARTER_COLLECTIONS.socialPublications,
    where: { publication_id: input.publicationId },
    notFoundCode: 'social_publication_not_found',
  });
  const taskId = socialText(publication.task_id);
  if (['table', 'screenshot'].includes(input.value.method) && !input.value.evidenceRefs?.length) {
    throw new SocialContentWorkflowError('social_metrics_evidence_required', 400);
  }
  for (const fileRef of input.value.evidenceRefs ?? []) {
    await requireOwnedSocialFileRef({
      repository: input.repository,
      tenantId: input.tenantId,
      taskId,
      fileRef,
      usage: 'metric_evidence',
    });
  }
  const mutation = await executeSocialContentMutation<{ metricSubmission: SocialMetricSubmission; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'submit_social_metrics',
    targetId: taskId,
    now: input.now,
    replay: async operationId => {
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialMetricSubmissions, operationId });
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      await reconcileSocialContentTask({ ...input, taskId, operationId, preferredStatus: 'awaiting_metrics' });
      return { metricSubmission: socialMetricSubmission(existing), task: (await readSocialTaskDetail({ ...input, taskId }))! };
    },
    action: async operationId => {
      await requireSocialTask({ ...input, taskId });
      const existing = await byOperation({ ...input, collection: STARTER_COLLECTIONS.socialMetricSubmissions, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, taskId, operationId, preferredStatus: 'awaiting_metrics' });
        return { metricSubmission: socialMetricSubmission(existing), task: (await readSocialTaskDetail({ ...input, taskId }))! };
      }
      await assertSocialTaskChildCapacity({
        ...input,
        taskId,
        kind: 'metric_submission',
        publicationId: input.publicationId,
      });
      const previous = await input.repository.list(STARTER_COLLECTIONS.socialMetricSubmissions, input.tenantId, {
        where: { publication_id: input.publicationId }, perPage: 500,
      });
      const timestamp = (input.now ?? new Date()).toISOString();
      const created = await input.repository.create(STARTER_COLLECTIONS.socialMetricSubmissions, input.tenantId, {
        submission_id: socialPublicId('socialmetric'),
        task_id: taskId,
        publication_id: input.publicationId,
        method: input.value.method,
        captured_at: input.value.capturedAt,
        metrics: input.value.metrics,
        evidence_refs: input.value.evidenceRefs ?? [],
        notes: input.value.notes ?? '',
        status: 'received',
        version: String(previous.totalItems + 1),
        created_operation_id: operationId,
        last_operation_id: operationId,
        created_by: input.userId,
        created_at: timestamp,
      });
      await reconcileSocialContentTask({ ...input, taskId, operationId, preferredStatus: 'awaiting_metrics' });
      return { metricSubmission: socialMetricSubmission(created), task: (await readSocialTaskDetail({ ...input, taskId }))! };
    },
  });
  return mutation.value;
}

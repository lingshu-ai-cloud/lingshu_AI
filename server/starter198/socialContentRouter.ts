import {createWeeklyOwnedProductIdentityRouter} from './weeklyOwnedProductIdentityRouter.js';
import {createWeeklyOwnedProductIdentityUI} from './weeklyOwnedProductIdentityUI.js';
import {createSocialInstagramDeliveryRouter} from './socialInstagramDeliveryRouter.js';import {createSocialInstagramDeliveryService} from './socialInstagramDeliveryService.js';
import {createSocialWeeklyG6ReviewRouter} from './socialWeeklyG6ReviewRouter.js';import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import {createSocialDirectorG5ReviewRouter} from './socialDirectorG5ReviewRouter.js';
import {createSocialDirectorG5ReviewService} from './socialDirectorG5ReviewService.js';
import {createSocialSceneG4ReviewRouter} from './socialSceneG4ReviewRouter.js';
import {createSocialSceneG4ReviewService} from './socialSceneG4ReviewService.js';
import { readReferencePreparation } from './socialContentScriptSources.js';
import { createSocialSceneReworkRouter } from './socialContentSceneReworkRouter.js';
import { assertSocialSceneReworkQueueRegistered, wakeSocialSceneReworkJob } from './socialContentProductionQueue.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { SOCIAL_CONTENT_TASK_STATUSES, SOCIAL_WORK_PACKAGE_STATUSES } from '../../shared/contracts/socialContentWorkflow.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { starter198OrgRole } from './profile.js';
import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import {
  addSocialTaskSource,
  createSocialContentTask,
  createSocialWeeklyPlan,
  listSocialContentTasks,
  listSocialWeeklyPlans,
  readSocialContentWorkspace,
  removeSocialTaskSource,
  selectSocialWorkPackages,
  startSocialContentTask,
  updateSocialContentTask,
} from './socialContentTasks.js';
import {
  createSocialContentArtifact,
  createSocialDeliveryPackage,
  decideSocialContentArtifactBatch,
  decideSocialContentArtifact,
  readSocialDeliveryPackage,
  registerSocialPublication,
  submitSocialMetrics,
} from './socialContentOutputs.js';
import {
  cleanupTransientSocialContentUpload,
  durableSocialContentFileDescriptor,
  readSocialContentFile,
  registerSocialContentFile,
  registerSocialTaskCreativeMaterial,
  storeSocialContentFile,
  withSocialContentUploadAdmission,
  type SocialContentBackendFilePort,
  type SocialTaskMaterialPort,
} from './socialContentFiles.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialTaskFileCapacity } from './socialContentLimits.js';
import {
  SocialContentWorkflowError,
  parseArtifactDecision,
  parseArtifactBatchDecision,
  parseCreateSocialTask,
  parseCreateSocialWeeklyPlan,
  parseDeliveryPackage,
  parseMetrics,
  parsePackageSelection,
  parsePublication,
  parseSocialArtifact,
  parseSocialSource,
  parseUpdateSocialTask,
  requireIdempotencyKey,
  requireSocialId,
  socialObject,
  socialText,
} from './socialContentValidation.js';
import {
  SOCIAL_THEME_CATALOG,
  classifySocialCustomTopic,
} from './socialContentThemes.js';
import {
  changeSocialWorkPackageStatus,
  createSocialWorkPackageVersion,
  listActiveSocialWorkPackageCards,
  listSocialWorkPackageDetails,
  parseCreateWorkPackage,
  parseUpdateWorkPackage,
  updateSocialWorkPackageVersion,
} from './socialWorkPackages.js';
import {
  socialContentSourceOptions,
  type SocialContentSourceOptionsPort,
} from './socialContentSourceOptions.js';
import {
  socialDeliveryArchiveContentLength,
  streamSocialDeliveryArchive,
  verifySocialDeliveryArchiveMedia,
} from './socialDeliveryArchiveStream.js';
import { openSocialArtifactMedia, openSocialArtifactPreviewMedia } from './socialArtifactMedia.js';
import {
  SocialContentAccessError,
  socialContentAccessResolver,
  type SocialContentAccessResolver,
} from './socialContentAccess.js';
import { readSocialProductionState } from './socialContentProductionHandoff.js';
import { refreshSocialTaskReferenceOutputs } from './socialContentTaskSupport.js';

type AccessLevel = 'read' | 'write' | 'start';

export interface SocialContentRouterDependencies {
  repository?: Starter198Repository;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  resolveRole?: (request: Request, userId: string) => Promise<unknown>;
  platformAdmin?: (request: Request) => Promise<{ userId: string } | null>;
  sourceOptions?: SocialContentSourceOptionsPort;
  accessResolver?: SocialContentAccessResolver;
  backendFilePort?: SocialContentBackendFilePort;
  socialTaskMaterialPort?: SocialTaskMaterialPort;
  now?: () => Date;
}

function sendFailure(res: Response, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof SocialContentWorkflowError) {
    res.status(error.status).json({ error: error.code, message: error.code });
    return;
  }
  if (error instanceof Starter198RepositoryError) {
    const code = error.code === 'starter_198_not_provisioned' ? 'profile_not_enabled' : error.code;
    res.status(error.code === 'starter_198_not_provisioned' ? 403 : 503).json({ error: code, message: code });
    return;
  }
  res.status(503).json({ error: 'social_content_unavailable', message: 'social_content_unavailable' });
}

function bodyWithinLimit(req: Request, maximum = 256 * 1_024): void {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > maximum) {
    throw new SocialContentWorkflowError('social_content_request_too_large', 413);
  }
}

function integerQuery(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function createSocialContentRouter(dependencies: SocialContentRouterDependencies = {}): Router {
  const router = Router();
  const repository = dependencies.repository ?? starter198Repository;
  const now = dependencies.now ?? (() => new Date());
  const resolveRole = dependencies.resolveRole
    ?? ((request: Request, userId: string) => requestOrganizationRoleStrict(request.headers.authorization, userId));
  const platformAdmin = dependencies.platformAdmin ?? (async request => requireAdminUser(request));
  const sourceOptions = dependencies.sourceOptions ?? socialContentSourceOptions;
  const accessResolver = dependencies.accessResolver ?? socialContentAccessResolver;
  const backendFilePort = dependencies.backendFilePort;
  const socialTaskMaterialPort = dependencies.socialTaskMaterialPort;

  router.use(requireAuth);
  if(repository.dataStore)router.use('/tasks/:taskId/weekly-owned-product-identity',createWeeklyOwnedProductIdentityRouter(createWeeklyOwnedProductIdentityUI(repository.dataStore,{repository,sourceOptions})));
  if(repository.dataStore) router.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/weekly-quality-recovery',createWeeklyContentQualityRecoveryRouter(createWeeklyContentQualityRecoveryService(repository.dataStore)));
  router.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/g5-reviews',createSocialDirectorG5ReviewRouter(createSocialDirectorG5ReviewService(repository)));
router.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/instagram-delivery',createSocialInstagramDeliveryRouter(createSocialInstagramDeliveryService(repository)));
router.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/g6-reviews',createSocialWeeklyG6ReviewRouter(createSocialWeeklyG6ReviewService(repository)));
  router.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/g4-reviews',createSocialSceneG4ReviewRouter(createSocialSceneG4ReviewService(repository)));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  async function authorize(req: Request, res: Response, level: AccessLevel): Promise<{ tenantId: string; userId: string }> {
    const { tenantId, userId } = res.locals as AuthLocals;
    const role = starter198OrgRole(await resolveRole(req, userId));
    if (!role) throw new SocialContentWorkflowError('starter_198_role_required', 403);
    if (level !== 'read' && !['owner', 'admin', 'operator'].includes(role)) {
      throw new SocialContentWorkflowError('social_content_write_forbidden', 403);
    }
    const required = level === 'read'
      ? ['workspace.read', 'production_site.read'] as const
      : level === 'start'
        ? ['orchestrator.command.submit', 'workflow.standard.run'] as const
        : ['orchestrator.command.submit'] as const;
    try {
      await accessResolver.resolve({ repository, tenantId, requiredCapabilities: required, now: now() });
    } catch (error) {
      if (error instanceof SocialContentAccessError) {
        throw new SocialContentWorkflowError(error.code, error.status);
      }
      throw error;
    }
    return { tenantId, userId };
  }

  function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, _next: NextFunction) => {
      handler(req, res).catch(error => sendFailure(res, error));
    };
  }

  async function requirePlatformAdmin(req: Request): Promise<{ userId: string }> {
    const admin = await platformAdmin(req);
    if (!admin) throw new SocialContentWorkflowError('platform_admin_required', 403);
    return admin;
  }

  router.use('/tasks/:taskId/scene-rework', createSocialSceneReworkRouter({ repository, authorize,
    assertWorkerRegistered: assertSocialSceneReworkQueueRegistered, wake: wakeSocialSceneReworkJob }));

  router.get('/internal/work-packages', asyncRoute(async (req, res) => {
    await requirePlatformAdmin(req);
    res.json({ items: await listSocialWorkPackageDetails({ repository, now: now() }) });
  }));

  router.post('/internal/work-packages', asyncRoute(async (req, res) => {
    const admin = await requirePlatformAdmin(req);
    bodyWithinLimit(req);
    const workPackage = await createSocialWorkPackageVersion({
      repository,
      userId: admin.userId,
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseCreateWorkPackage(req.body),
      now: now(),
    });
    res.status(201).json({ workPackage });
  }));

  router.patch('/internal/work-packages/:packageKey/:version', asyncRoute(async (req, res) => {
    const admin = await requirePlatformAdmin(req);
    bodyWithinLimit(req);
    const workPackage = await updateSocialWorkPackageVersion({
      repository,
      userId: admin.userId,
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      packageKey: requireSocialId(req.params.packageKey, 'social_package_key_invalid'),
      version: requireSocialId(req.params.version, 'social_package_version_invalid'),
      value: parseUpdateWorkPackage(req.body),
      now: now(),
    });
    res.json({ workPackage });
  }));

  router.post('/internal/work-packages/:packageKey/:version/status', asyncRoute(async (req, res) => {
    const admin = await requirePlatformAdmin(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => !['expectedVersion', 'status'].includes(key))) {
      throw new SocialContentWorkflowError('social_package_status_input_invalid', 400);
    }
    const status = socialText(source.status) as typeof SOCIAL_WORK_PACKAGE_STATUSES[number];
    if (!SOCIAL_WORK_PACKAGE_STATUSES.includes(status)) throw new SocialContentWorkflowError('social_package_status_invalid', 400);
    const workPackage = await changeSocialWorkPackageStatus({
      repository,
      userId: admin.userId,
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      packageKey: requireSocialId(req.params.packageKey, 'social_package_key_invalid'),
      version: requireSocialId(req.params.version, 'social_package_version_invalid'),
      expectedVersion: socialText(source.expectedVersion),
      status,
      now: now(),
    });
    res.json({ workPackage });
  }));

  router.get('/', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    res.json(await readSocialContentWorkspace({ repository, tenantId: identity.tenantId, now: now() }));
  }));

  router.get('/catalog', asyncRoute(async (req, res) => {
    await authorize(req, res, 'read');
    res.json({ items: await listActiveSocialWorkPackageCards({ repository, now: now() }) });
  }));

  router.get('/themes', asyncRoute(async (req, res) => {
    await authorize(req, res, 'read');
    res.json({ items: SOCIAL_THEME_CATALOG });
  }));

  router.post('/themes/classify', asyncRoute(async (req, res) => {
    await authorize(req, res, 'read');
    bodyWithinLimit(req, 8 * 1_024);
    const body = socialObject(req.body);
    if (!body || Object.keys(body).some(key => key !== 'customTopic')) {
      throw new SocialContentWorkflowError('social_content_theme_classification_invalid', 400);
    }
    const customTopic = socialText(body.customTopic);
    if (!customTopic || customTopic.length > 300) {
      throw new SocialContentWorkflowError('social_content_custom_topic_invalid', 400);
    }
    res.json({ theme: classifySocialCustomTopic(customTopic) });
  }));

  router.get('/weekly-plans', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    res.json({ items: await listSocialWeeklyPlans({ repository, tenantId: identity.tenantId }) });
  }));

  router.post('/weekly-plans', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await createSocialWeeklyPlan({
      repository,
      ...identity,
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseCreateSocialWeeklyPlan(req.body),
      now: now(),
    });
    res.status(201).json(result);
  }));

  router.get('/source-options', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const kind = socialText(req.query.kind);
    if (kind && !['knowledge', 'material'].includes(kind)) {
      throw new SocialContentWorkflowError('social_content_source_option_kind_invalid', 400);
    }
    const query = socialText(req.query.query);
    if (query.length > 100) throw new SocialContentWorkflowError('social_content_source_option_query_invalid', 400);
    res.json(await sourceOptions.list({
      tenantId: identity.tenantId,
      ...(kind ? { kind: kind as 'knowledge' | 'material' } : {}),
      query,
      page: integerQuery(req.query.page, 1, 10_000),
      perPage: integerQuery(req.query.perPage, 20, 50),
    }));
  }));

  router.get('/tasks', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const status = socialText(req.query.status);
    if (status && !SOCIAL_CONTENT_TASK_STATUSES.includes(status as typeof SOCIAL_CONTENT_TASK_STATUSES[number])) {
      throw new SocialContentWorkflowError('social_content_status_invalid', 400);
    }
    res.json(await listSocialContentTasks({
      repository,
      tenantId: identity.tenantId,
      ...(status ? { status } : {}),
      page: integerQuery(req.query.page, 1, 10_000),
      perPage: integerQuery(req.query.perPage, 50, 100),
    }));
  }));

  router.post('/tasks', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const task = await createSocialContentTask({
      repository,
      ...identity,
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseCreateSocialTask(req.body),
      now: now(),
    });
    res.status(201).json({ task });
  }));

  router.get('/tasks/:taskId', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const taskId = requireSocialId(req.params.taskId);
    const task = await readSocialTaskDetail({ repository, tenantId: identity.tenantId, taskId });
    if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    if (task.brief.creationMode === 'viral_replication' && task.referenceVideoAnalysis?.status !== 'ready') {
      task.referencePreparation = await readReferencePreparation(identity.tenantId, task.sources).catch(() => ({ status: 'blocked' as const, reason: 'reference_status_unavailable' }));
    }
    res.json({ task });
  }));

  router.post('/tasks/:taskId/refresh-reference', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    const taskId = requireSocialId(req.params.taskId);
    const current = await readSocialTaskDetail({ repository, tenantId: identity.tenantId, taskId });
    if (!current) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    if (current.brief.creationMode !== 'viral_replication') throw new SocialContentWorkflowError('social_content_reference_invalid', 400);
    if (socialText(req.body?.expectedVersion) !== current.version) throw new SocialContentWorkflowError('social_content_version_conflict', 409);
    await refreshSocialTaskReferenceOutputs({ repository, ...identity, taskId,
      operationId: requireIdempotencyKey(req.headers['idempotency-key']), now: now() });
    res.json({ task: await readSocialTaskDetail({ repository, tenantId: identity.tenantId, taskId }) });
  }));

  router.get('/tasks/:taskId/production-state', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const state = await readSocialProductionState({
      repository,
      tenantId: identity.tenantId,
      taskId: requireSocialId(req.params.taskId),
      version: socialText(req.query.version) || null,
    });
    if (!state) throw new SocialContentWorkflowError('social_production_handoff_not_found', 404);
    res.json(state);
  }));

  router.patch('/tasks/:taskId', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const task = await updateSocialContentTask({
      repository,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseUpdateSocialTask(req.body),
      now: now(),
    });
    res.json({ task });
  }));

  router.post('/tasks/:taskId/files', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    const taskId = requireSocialId(req.params.taskId);
    const usage = socialText(req.query.usage);
    if (!['source', 'metric_evidence', 'artifact_media'].includes(usage)) throw new SocialContentWorkflowError('social_content_file_usage_invalid', 400);
    const idempotencyKey = requireIdempotencyKey(req.headers['idempotency-key']);
    const lengthHeader = socialText(req.headers['content-length']);
    if (lengthHeader && !/^\d+$/.test(lengthHeader)) {
      throw new SocialContentWorkflowError('social_content_file_length_invalid', 400);
    }
    const result = await withSocialContentUploadAdmission({
      repository,
      tenantId: identity.tenantId,
      taskId,
      action: async () => {
        const task = await readSocialTaskDetail({ repository, tenantId: identity.tenantId, taskId });
        if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
        const capacity = await socialTaskFileCapacity({ repository, tenantId: identity.tenantId, taskId });
        const upload = await storeSocialContentFile({
          stream: req,
          tenantId: identity.tenantId,
          name: socialText(req.query.name) || socialText(req.headers['x-file-name']),
          mimeType: socialText(req.headers['content-type']),
          ...(lengthHeader ? { declaredLength: Number(lengthHeader) } : {}),
          maximumBytes: capacity.remainingBytes,
          materialLibrary: usage === 'source',
        });
        const transientPath = upload.transientPath;
        const stored = durableSocialContentFileDescriptor(upload);
        try {
          const file = await registerSocialContentFile({
            repository,
            ...identity,
            taskId,
            usage: usage as 'source' | 'metric_evidence' | 'artifact_media',
            idempotencyKey,
            stored,
            ...(transientPath ? { transientPath } : {}),
            ...(backendFilePort ? { backendFilePort } : {}),
            now: now(),
          });
          const material = usage === 'source'
            ? await registerSocialTaskCreativeMaterial({
              tenantId: identity.tenantId,
              taskId,
              productId: task.brief.productId,
              productRef: task.brief.productRef,
              file,
              stored,
              ...(transientPath ? { transientPath } : {}),
              ...(socialTaskMaterialPort ? { materialPort: socialTaskMaterialPort } : {}),
            })
            : null;
          return { file, material };
        } finally {
          await cleanupTransientSocialContentUpload(upload);
        }
      },
    });
    const material = result.material ? {
      id: result.material.id,
      sourceRef: `socialmaterial:${Buffer.from(String(result.material.id), 'utf8').toString('base64url')}`,
      sourceVersion: String(result.material.sourceRevision || result.material.analysisSourceRevision || result.material.sha256 || result.material.contentSha256 || ''),
      name: result.material.name,
      type: result.material.type,
      sourceType: result.material.sourceType,
      contentSha256: result.material.contentSha256,
      productId: result.material.productId || null,
      productRef: result.material.productRef ?? null,
      productName: result.material.productName ?? null,
      sourceTaskIds: result.material.sourceTaskIds,
      createdAt: result.material.createdAt,
    } : null;
    res.status(201).json({ file: result.file, ...(material ? { material } : {}) });
  }));

  router.get('/files/:fileId', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const file = await readSocialContentFile({
      repository,
      tenantId: identity.tenantId,
      fileId: requireSocialId(req.params.fileId),
      ...(backendFilePort ? { backendFilePort } : {}),
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.view.mimeType);
    res.setHeader('Content-Length', String(file.view.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.view.name)}`);
    if (file.localPath) { res.sendFile(file.localPath); return; }
    if (file.backend) { res.end(file.backend.buf); return; }
    if (!file.object) throw new SocialContentWorkflowError('social_content_file_storage_unavailable', 503);
    Readable.from(file.object.body).pipe(res);
  }));

  router.get('/tasks/:taskId/artifacts/:artifactId/media', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const media = await openSocialArtifactPreviewMedia({
      repository,
      tenantId: identity.tenantId,
      taskId: requireSocialId(req.params.taskId),
      artifactId: requireSocialId(req.params.artifactId, 'social_artifact_id_invalid'),
      ...(backendFilePort ? { backendFilePort } : {}),
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', media.file.mimeType);
    res.setHeader('Content-Length', String(media.file.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(media.file.name)}`);
    await pipeline(Readable.from(media.body), res);
  }));

  router.post('/tasks/:taskId/sources', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await addSocialTaskSource({
      repository,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseSocialSource(req.body),
      sourceOptions,
      now: now(),
    });
    res.status(201).json(result);
  }));

  router.delete('/tasks/:taskId/sources/:sourceId', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => key !== 'expectedTaskVersion')
      || !socialText(source.expectedTaskVersion)) {
      throw new SocialContentWorkflowError('social_content_source_remove_invalid', 400);
    }
    res.json(await removeSocialTaskSource({
      repository,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      sourceId: requireSocialId(req.params.sourceId, 'social_content_source_id_invalid'),
      expectedTaskVersion: socialText(source.expectedTaskVersion),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      now: now(),
    }));
  }));

  router.put('/tasks/:taskId/package-selection', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const task = await selectSocialWorkPackages({
      repository,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parsePackageSelection(req.body),
      now: now(),
    });
    res.json({ task });
  }));

  router.post('/tasks/:taskId/start', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'start');
    if (!dependencies.orchestratorQueue) throw new SocialContentWorkflowError('social_content_orchestrator_not_configured', 503);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => key !== 'expectedVersion') || !socialText(source.expectedVersion)) {
      throw new SocialContentWorkflowError('social_content_start_invalid', 400);
    }
    const task = await startSocialContentTask({
      repository,
      orchestratorQueue: dependencies.orchestratorQueue,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      expectedVersion: socialText(source.expectedVersion),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      now: now(),
    });
    res.status(task.status === 'attention' ? 200 : 202).json({
      task,
      ...(task.status === 'attention'
        ? { nextAction: { type: 'continue_production', page: 'smartAssets' } }
        : {}),
    });
  }));

  router.post('/tasks/:taskId/artifacts', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await createSocialContentArtifact({
      repository,
      backendFilePort,
      accessResolver,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseSocialArtifact(req.body),
      trustedAgentOrigin: false,
      now: now(),
    });
    res.status(201).json(result);
  }));

  router.post('/tasks/:taskId/artifacts/:artifactId/decision', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    res.json(await decideSocialContentArtifact({
      repository,
      orchestratorQueue: dependencies.orchestratorQueue,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      artifactId: requireSocialId(req.params.artifactId, 'social_artifact_id_invalid'),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseArtifactDecision(req.body),
      now: now(),
    }));
  }));

  router.post('/tasks/:taskId/artifacts/batch-decision', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const task = await decideSocialContentArtifactBatch({
      repository,
      orchestratorQueue: dependencies.orchestratorQueue,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseArtifactBatchDecision(req.body),
      now: now(),
    });
    res.json({ task });
  }));

  router.post('/tasks/:taskId/delivery-packages', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await createSocialDeliveryPackage({
      repository,
      backendFilePort,
      accessResolver,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseDeliveryPackage(req.body),
      now: now(),
    });
    res.status(201).json(result);
  }));

  router.get('/delivery-packages/:packageId/download', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const result = await readSocialDeliveryPackage({
      repository,
      tenantId: identity.tenantId,
      packageId: requireSocialId(req.params.packageId, 'social_delivery_package_id_invalid'),
    });
    const loadMedia = (descriptor: Parameters<typeof openSocialArtifactMedia>[0]['descriptor']) => openSocialArtifactMedia({
      repository,
      tenantId: identity.tenantId,
      taskId: result.view.taskId,
      descriptor,
      ...(backendFilePort ? { backendFilePort } : {}),
    });
    await verifySocialDeliveryArchiveMedia(result.manifest, loadMedia);
    const contentLength = socialDeliveryArchiveContentLength(result.manifest, loadMedia);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="${result.view.packageId}.zip"`);
    await pipeline(Readable.from(streamSocialDeliveryArchive(result.manifest, loadMedia)), res);
  }));

  router.post('/tasks/:taskId/publications', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await registerSocialPublication({
      repository,
      ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parsePublication(req.body),
      now: now(),
    });
    res.status(201).json(result);
  }));

  router.post('/publications/:publicationId/metrics', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await submitSocialMetrics({
      repository,
      ...identity,
      publicationId: requireSocialId(req.params.publicationId, 'social_publication_id_invalid'),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseMetrics(req.body),
      now: now(),
    });
    res.status(201).json(result);
  }));

  return router;
}
import {createWeeklyContentQualityRecoveryRouter} from './weeklyContentQualityRecoveryRouter.js';
import {createWeeklyContentQualityRecoveryService} from '../socialPrograms/weeklyContentQualityRecovery.js';

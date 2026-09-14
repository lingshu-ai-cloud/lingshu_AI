import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { SOCIAL_CONTENT_TASK_STATUSES, SOCIAL_WORK_PACKAGE_STATUSES } from '../../shared/contracts/socialContentWorkflow.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  buildStarter198CapabilityManifest,
  starter198CapabilityAllowed,
  starter198OrgRole,
} from './profile.js';
import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import {
  addSocialTaskSource,
  createSocialContentTask,
  listSocialContentTasks,
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
  readSocialContentFile,
  registerSocialContentFile,
  storeSocialContentFile,
  withSocialContentUploadAdmission,
} from './socialContentFiles.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialTaskFileCapacity } from './socialContentLimits.js';
import {
  SocialContentWorkflowError,
  parseArtifactDecision,
  parseArtifactBatchDecision,
  parseCreateSocialTask,
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

type AccessLevel = 'read' | 'write' | 'start';

export interface SocialContentRouterDependencies {
  repository?: Starter198Repository;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  resolveRole?: (request: Request, userId: string) => Promise<unknown>;
  platformAdmin?: (request: Request) => Promise<{ userId: string } | null>;
  sourceOptions?: SocialContentSourceOptionsPort;
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

  router.use(requireAuth);
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
    const access = await repository.access(tenantId);
    const manifest = buildStarter198CapabilityManifest(access, now());
    const required = level === 'read'
      ? ['workspace.read', 'production_site.read'] as const
      : level === 'start'
        ? ['orchestrator.command.submit', 'workflow.standard.run'] as const
        : ['orchestrator.command.submit'] as const;
    if (required.some(capability => !starter198CapabilityAllowed(manifest, capability))) {
      throw new SocialContentWorkflowError('social_content_not_entitled', 403);
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
    res.json({ task });
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
    const file = await withSocialContentUploadAdmission({
      repository,
      tenantId: identity.tenantId,
      taskId,
      action: async () => {
        await requireSocialTask({ repository, tenantId: identity.tenantId, taskId });
        const capacity = await socialTaskFileCapacity({ repository, tenantId: identity.tenantId, taskId });
        const stored = await storeSocialContentFile({
          stream: req,
          tenantId: identity.tenantId,
          name: socialText(req.query.name) || socialText(req.headers['x-file-name']),
          mimeType: socialText(req.headers['content-type']),
          ...(lengthHeader ? { declaredLength: Number(lengthHeader) } : {}),
          maximumBytes: capacity.remainingBytes,
        });
        return registerSocialContentFile({
          repository,
          ...identity,
          taskId,
          usage: usage as 'source' | 'metric_evidence' | 'artifact_media',
          idempotencyKey,
          stored,
          now: now(),
        });
      },
    });
    res.status(201).json({ file });
  }));

  router.get('/files/:fileId', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'read');
    const file = await readSocialContentFile({ repository, tenantId: identity.tenantId, fileId: requireSocialId(req.params.fileId) });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.view.mimeType);
    res.setHeader('Content-Length', String(file.view.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.view.name)}`);
    if (file.localPath) { res.sendFile(file.localPath); return; }
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
    res.status(202).json({
      task,
      ...(task.status === 'attention'
        ? { nextAction: { type: 'open_professional_workspace', page: 'smartAssets' } }
        : {}),
    });
  }));

  router.post('/tasks/:taskId/artifacts', asyncRoute(async (req, res) => {
    const identity = await authorize(req, res, 'write');
    bodyWithinLimit(req);
    const result = await createSocialContentArtifact({
      repository,
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

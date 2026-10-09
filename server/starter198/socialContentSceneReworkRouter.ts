import { Router, type Request, type Response } from 'express';
import type { Starter198Repository } from './repository.js';
import { readSocialSceneReworkAvailability, readSocialSceneReworkStatus } from './socialContentSceneReworkRead.js';
import { admitSocialSceneRework } from './socialContentSceneReworkAdmission.js';
import { requireSocialTask } from './socialContentRecords.js';
import { socialObject } from './socialContentValidation.js';
import { createSocialSceneReworkCostPolicyRouter } from './socialContentSceneReworkCostPolicyRouter.js';
import { resumeSocialSceneRework } from './socialContentSceneReworkResume.js';
import { resolveSceneCacheSourceRun } from './socialContentSceneCacheSource.js';

/** Mounted beneath the existing authenticated social-content router. */
export function createSocialSceneReworkRouter(input: {
  repository: Starter198Repository;
  authorize: (req: Request, res: Response, level: 'read' | 'start') => Promise<{ tenantId: string; userId: string }>;
  /** Required registration: admitting jobs without a dedicated worker is forbidden. */
  assertWorkerRegistered: () => Promise<void>;
  wake: (jobId: string) => Promise<void>;
}) {
  const router = Router({ mergeParams: true });
  router.use('/:operationId/cost-policy', createSocialSceneReworkCostPolicyRouter({ repository: input.repository, authorize: input.authorize }));
  const safe = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => {
    void handler(req, res).catch(error => {
      const code = error instanceof Error ? error.message : '';
      // Provider payloads, paths and credentials must never be rendered here.
      const publicCode = /^(?:scene_rework_[a-z_]+|starter_198_[a-z_]+|social_content_[a-z_]+)$/.test(code)
        ? code : 'scene_rework_unavailable';
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      res.status(typeof status === 'number' && [400, 401, 403, 404, 409, 503].includes(status)
        ? status : publicCode === 'scene_rework_unavailable' ? 503 : 409).json({ error: publicCode });
    });
  };
  const taskId = (req: Request) => {
    if (!/^[a-zA-Z0-9._:@-]{1,200}$/.test(req.params.taskId)) throw new Error('scene_rework_identity_invalid');
    return req.params.taskId;
  };
  router.get('/', safe(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    if (Object.keys(req.query).some(key => key !== 'parentArtifactId')
      || typeof req.query.parentArtifactId !== 'string'
      || !/^[a-zA-Z0-9._:@-]{1,200}$/.test(req.query.parentArtifactId)) throw new Error('scene_rework_parent_identity_invalid');
    res.json({ item: await readSocialSceneReworkAvailability({ repository: input.repository,
      tenantId: identity.tenantId, actorUserId: identity.userId, taskId: taskId(req), parentArtifactId: req.query.parentArtifactId }) });
  }));
  router.get('/:operationId', safe(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    if (Object.keys(req.query).length) throw new Error('scene_rework_query_invalid');
    res.json({ item: await readSocialSceneReworkStatus({ repository: input.repository, tenantId: identity.tenantId,
      actorUserId: identity.userId, taskId: taskId(req), operationId: req.params.operationId }) });
  }));
  router.post('/:operationId/resume', safe(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const body = socialObject(req.body);
    if (!body || Object.keys(body).some(key => !['expectedJobId', 'expectedPolicyHash'].includes(key))
      || typeof body.expectedJobId !== 'string' || !/^[a-zA-Z0-9._:@-]{1,200}$/.test(body.expectedJobId)
      || body.expectedPolicyHash !== undefined && (typeof body.expectedPolicyHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedPolicyHash))) {
      throw new Error('scene_rework_resume_invalid');
    }
    await input.assertWorkerRegistered();
    const item = await resumeSocialSceneRework({ repository: input.repository, tenantId: identity.tenantId,
      actorUserId: identity.userId, taskId: taskId(req), operationId: req.params.operationId,
      expectedJobId: body.expectedJobId, expectedPolicyHash: body.expectedPolicyHash as string | undefined });
    await input.wake(item.jobId).catch(() => undefined);
    res.json({ item });
  }));
  router.post('/', safe(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const body = socialObject(req.body);
    if (!body || Object.keys(body).some(key => !['parentArtifactId', 'affectedSceneIds', 'expectedCacheHash'].includes(key))
      || typeof body.parentArtifactId !== 'string' || !/^[a-zA-Z0-9._:@-]{1,200}$/.test(body.parentArtifactId)
      || typeof body.expectedCacheHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedCacheHash)
      || !Array.isArray(body.affectedSceneIds) || body.affectedSceneIds.length < 1 || body.affectedSceneIds.length > 100
      || body.affectedSceneIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9._:@-]{1,200}$/.test(id))
      || new Set(body.affectedSceneIds).size !== body.affectedSceneIds.length) throw new Error('scene_rework_selection_invalid');
    const id = taskId(req);
    await requireSocialTask({ repository: input.repository, tenantId: identity.tenantId, taskId: id });
    const sourceRunId = await resolveSceneCacheSourceRun(input.repository, { tenantId: identity.tenantId, taskId: id,
      parentArtifactId: body.parentArtifactId });
    await input.assertWorkerRegistered();
    const result = await admitSocialSceneRework({ repository: input.repository, tenantId: identity.tenantId,
      actorUserId: identity.userId, taskId: id, sourceRunId, parentArtifactId: body.parentArtifactId,
      expectedCacheHash: body.expectedCacheHash, affectedSceneIds: body.affectedSceneIds as string[] });
    // Database admission is authoritative even if the optional wake-up fails.
    await input.wake(result.job.id).catch(() => undefined);
    res.status(202).json({ item: await readSocialSceneReworkStatus({ repository: input.repository,
      tenantId: identity.tenantId, actorUserId: identity.userId, taskId: id, operationId: result.intent.operationId }) });
  }));
  return router;
}

import { uploadPlatformAdCreative, reconcilePlatformAdCreative } from '../platformAds/creativeUpload.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { PlatformAdCreativeError, bindPlatformAdCreative, listPlatformAdCreatives, listPlatformAdCreativeSources } from '../platformAds/creatives.js';
import { PlatformAdTaskLockError } from '../platformAds/taskLock.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
export const platformAdCreativesRouter = Router();
platformAdCreativesRouter.use(requireAuth, requireAdWriteAccess);
function failure(res: import('express').Response, error: unknown) {
  let status = 503, message = '投放素材暂不可用，请刷新后重试';
  if (error instanceof PlatformAdCreativeError) { status = error.status; message = error.message; }
  else if (error instanceof PlatformAdTaskLockError) { status = error.statusCode; message = error.message; }
  else if (error instanceof SocialContentWorkflowError) { status = error.status; }
  else if (error instanceof AdProviderError) {
    status = error.code === 'NOT_FOUND' ? 404 : error.code === 'STORAGE_ERROR' ? 503
      : ['INVALID_INPUT', 'INVALID_MEDIA', 'INVALID_ACCOUNT', 'NOT_SUPPORTED'].includes(error.code) ? 400 : 409;
    message = error.code === 'STORAGE_ERROR' ? '素材回执保存失败，请核对后恢复' : error.message;
  }
  res.status(status).json({ error: message });
}
platformAdCreativesRouter.get('/creative-sources', async (req, res) => {
  try { res.json(await listPlatformAdCreativeSources((res.locals as AuthLocals).tenantId, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/tasks/:taskId/creatives', async (req, res) => {
  try { res.json({ items: await listPlatformAdCreatives((res.locals as AuthLocals).tenantId, req.params.taskId) }); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.post('/tasks/:taskId/creatives', async (req, res) => {
  try { res.json(await bindPlatformAdCreative((res.locals as AuthLocals).tenantId, req.params.taskId, req.body || {})); } catch (error) { failure(res, error); }
});

for (const [action, handler] of [['upload', uploadPlatformAdCreative], ['reconcile', reconcilePlatformAdCreative]] as const) {
  platformAdCreativesRouter.post(`/tasks/:taskId/creatives/:creativeId/${action}`, async (req, res) => {
    try { res.json(await handler((res.locals as AuthLocals).tenantId, req.params.taskId, req.params.creativeId, req.body || {})); } catch (error) { failure(res, error); }
  });
}

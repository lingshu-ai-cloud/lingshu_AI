import { uploadPlatformAdCreative, reconcilePlatformAdCreative } from '../platformAds/creativeUpload.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { PlatformAdCreativeError, bindPlatformAdCreative, listPlatformAdCreatives, listPlatformAdCreativeSources } from '../platformAds/creatives.js';
import { PlatformAdTaskLockError } from '../platformAds/taskLock.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { Readable } from 'node:stream';
import { listAdCreativeLibrary, getAdCreativeReport, getAdCreativePreview } from '../platformAds/creativeLibrary.js';
import { attachExistingAdCreative } from '../platformAds/creativeMapping.js';
import { openPlatformAdCreativeMedia } from '../platformAds/creatives.js';
import { getMetaSetup, getMetaPlanAudit } from '../platformAds/metaPlanAudit.js';
import { getMetaDestinationAssets } from '../platformAds/metaDestinationAssets.js';
import { getMetaTargetingOptions } from '../platformAds/metaTargetingOptions.js';
import { getAdSourceLifecycle, listAdSourceCatalog, parseAdSourceIdentity } from '../platformAds/creativeHistory.js';
import { listExternalHistorySources, openExternalHistoryVideo } from '../platformAds/externalHistory.js';
import { listMaterialDirectory } from '../platformAds/materialDirectory.js';
import { readSelectableAdMaterial } from '../platformAds/creativeSelection.js';
import { cachedVideoThumbnail } from '../platformAds/videoThumbnail.js';
export const platformAdCreativesRouter = Router();
platformAdCreativesRouter.use(requireAuth, requireAdWriteAccess);
platformAdCreativesRouter.get('/connections/:id/meta-targeting-options', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await getMetaTargetingOptions((res.locals as AuthLocals).tenantId, req.params.id, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/material-directory', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await listMaterialDirectory((res.locals as AuthLocals).tenantId, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-history-sources', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json({ items: await listExternalHistorySources((res.locals as AuthLocals).tenantId) }); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-selection', async (req, res) => {
  try { const { selection } = await readSelectableAdMaterial((res.locals as AuthLocals).tenantId, req.query); res.setHeader('Cache-Control', 'private, no-store'); res.json(selection); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-selection/media', async (req, res) => {
  try { const { bytes } = await readSelectableAdMaterial((res.locals as AuthLocals).tenantId, req.query); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('video/mp4').send(bytes); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-selection/thumbnail', async (req, res) => {
  try {
    const tenantId = (res.locals as AuthLocals).tenantId, { version, ...identityQuery } = req.query;
    const key = `${tenantId}:selection:${String(version || '')}:${JSON.stringify(identityQuery)}`;
    const bytes = await cachedVideoThumbnail(key, async () => (await readSelectableAdMaterial(tenantId, identityQuery)).bytes);
    res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('image/jpeg').send(bytes);
  } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-history', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await listAdSourceCatalog((res.locals as AuthLocals).tenantId, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-history/media', async (req, res) => {
  try {
    const identity = parseAdSourceIdentity(req.query);
    if (!identity.sourceId || !identity.projectId || identity.origin !== 'studio') throw new PlatformAdCreativeError('请选择原企业素材', 400);
    const bytes = await openExternalHistoryVideo((res.locals as AuthLocals).tenantId, identity.sourceId, identity.projectId);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('video/mp4').send(bytes);
  } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-history/thumbnail', async (req, res) => {
  try {
    const tenantId = (res.locals as AuthLocals).tenantId, { version, ...identityQuery } = req.query, identity = parseAdSourceIdentity(identityQuery);
    if (!identity.sourceId || !identity.projectId || identity.origin !== 'studio') throw new PlatformAdCreativeError('请选择原企业素材', 400);
    const key = `${tenantId}:history:${identity.sourceId}:${identity.projectId}:${String(version || '')}`;
    const bytes = await cachedVideoThumbnail(key, () => openExternalHistoryVideo(tenantId, identity.sourceId!, identity.projectId!));
    res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('image/jpeg').send(bytes);
  } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-lifecycle', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await getAdSourceLifecycle((res.locals as AuthLocals).tenantId, parseAdSourceIdentity(req.query))); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/connections/:id/meta-setup', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await getMetaSetup((res.locals as AuthLocals).tenantId, req.params.id)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/connections/:id/meta-destination-assets', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await getMetaDestinationAssets((res.locals as AuthLocals).tenantId, req.params.id, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/tasks/:id/meta-audit', async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await getMetaPlanAudit((res.locals as AuthLocals).tenantId, req.params.id)); } catch (error) { failure(res, error); }
});
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
  res.status(status).json({ error: message, ...(error instanceof AdProviderError ? { code: error.code } : {}) });
}
platformAdCreativesRouter.get('/creative-library', async (req, res) => {
  try { res.json(await listAdCreativeLibrary((res.locals as AuthLocals).tenantId, req.query)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creative-library/:executionId/report', async (req, res) => {
  try { res.json(await getAdCreativeReport((res.locals as AuthLocals).tenantId, req.params.executionId)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creatives/:id/platform-preview', async (req, res) => {
  try { res.json(await getAdCreativePreview((res.locals as AuthLocals).tenantId, req.params.id)); } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.get('/creatives/:id/media', async (req, res) => {
  try {
    const { creative, body } = await openPlatformAdCreativeMedia((res.locals as AuthLocals).tenantId, req.params.id);
    res.setHeader('Content-Type', creative.mimeType); res.setHeader('Content-Length', creative.size);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = Readable.from(body); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch (error) { failure(res, error); }
});
platformAdCreativesRouter.post('/tasks/:taskId/creatives/attach-existing', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await attachExistingAdCreative(tenantId, userId, req.params.taskId, req.body || {})); } catch (error) { failure(res, error); }
});
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

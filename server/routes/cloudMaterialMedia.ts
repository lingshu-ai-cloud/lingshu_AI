import { Readable } from 'node:stream';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { entitlementGate } from '../middleware/subscription.js';
import { fetchCloudMaterial } from '../lib/cloudMaterials.js';
import { assetIdentity, verifyAssetToken } from '../lib/assetAccess.js';
import type { AuthLocals } from '../middleware/auth.js';

/**
 * Browser-safe cloud material playback.
 *
 * Some browser privacy clients block media loaded from an `/api/...` URL even
 * when the response is a valid image/video. Keep playback under the existing
 * `/media` namespace while retaining the same signed/cookie authentication and
 * subscription checks as the Studio API.
 */
export const cloudMaterialMediaRouter = Router();

cloudMaterialMediaRouter.use(async (req, res, next) => {
  const signedMatch = req.path.match(/^\/([^/]+)\/signed\/([^/]+)\/([^/]+)$/);
  if (!signedMatch) {
    await requireAuth(req, res, next);
    return;
  }
  const originalPath = `${req.baseUrl}/${signedMatch[1]}/${signedMatch[3]}`;
  // Signed media URLs must win over the browser's asset-session cookie. If the
  // cookie is resolved first, entitlementGate sees a normal user but media
  // elements still have no Authorization header, which incorrectly becomes
  // a 401 even though the URL signature is valid.
  const signed = verifyAssetToken(signedMatch[2], originalPath);
  let identity = null;
  try {
    identity = signed ? null : await assetIdentity(req);
  } catch (error) {
    console.error('[cloud-material-auth] identity verification unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(503).json({
      error: 'auth_provider_unavailable',
      message: '登录验证服务暂时不可用，请稍后重试。',
    });
    return;
  }
  if (!identity && !signed) {
    res.status(401).end();
    return;
  }
  (res.locals as AuthLocals).userId = identity?.userId || 'signed-media';
  (res.locals as AuthLocals).tenantId = identity?.tenantId || signed!.tenantId;
  (res.locals as AuthLocals).dataAuthority = identity?.dataAuthority;
  next();
});
cloudMaterialMediaRouter.use(entitlementGate());

cloudMaterialMediaRouter.get(['/:id/:kind', '/:id/signed/:assetToken/:kind'], async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const field = req.params.kind === 'poster.jpg'
    ? 'posterFile'
    : req.params.kind === 'media.mp4'
      ? 'videoFile'
      : null;
  if (!field) {
    res.status(404).end();
    return;
  }

  const upstream = await fetchCloudMaterial(req.params.id, field, req.headers.range, tenantId);
  if (!upstream || !upstream.body) {
    res.status(404).end();
    return;
  }

  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', field === 'posterFile' ? 'private, max-age=86400' : 'private, max-age=3600');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.status(upstream.status);
  Readable.fromWeb(upstream.body as any).pipe(res);
});

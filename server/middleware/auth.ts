import type { Request, Response, NextFunction } from 'express';
import { auth } from '../storage/index.js';
import { assetIdentity, isExplicitAssetRequest, verifyAssetToken } from '../lib/assetAccess.js';

export interface AuthLocals {
  userId: string;
  tenantId: string;
  supportAccess?: {
    requestId: string;
    adminEmail: string;
    tenantName: string;
    expiresAt?: string;
  };
}

/** Attach userId + tenantId to res.locals; return 401 if token is missing/invalid */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Media elements cannot attach the localStorage bearer header. The API call
  // that loads the studio first synchronizes the same token into an HttpOnly,
  // same-site asset session cookie, so proxied video/audio routes can use it.
  const assetRequest = isExplicitAssetRequest(req.method, req.originalUrl || req.url);
  const result = await auth.verifyToken(req.headers.authorization) || (assetRequest ? await assetIdentity(req) : null);
  // Browser media elements cannot attach an Authorization header. A signed URL
  // is already scoped to the exact request path, tenant and expiry by HMAC, so
  // accept a valid token for any GET/HEAD asset route instead of coupling auth
  // to Express' mount-relative req.path shape.
  const originalPath = new URL(req.originalUrl || req.url, 'http://local').pathname;
  const signedMedia = assetRequest
    ? verifyAssetToken(req.query.assetToken, originalPath)
    : null;
  if (!result && !signedMedia) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (res.locals as AuthLocals).userId = result?.userId || 'signed-media';
  (res.locals as AuthLocals).tenantId = result?.tenantId || signedMedia!.tenantId;
  (res.locals as AuthLocals).supportAccess = result?.supportAccess;
  if (result?.supportAccess && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'support_access_read_only' });
    return;
  }
  next();
}

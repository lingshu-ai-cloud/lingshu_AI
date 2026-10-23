import { AsyncLocalStorage } from 'node:async_hooks';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { signAssetUrl, tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';


export const studioTenantContext = new AsyncLocalStorage<string>();

export function scopedStudioAssetDir(root: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return tenantAssetDir(root, tenantId);
}

export function scopedStudioAssetUrl(prefix: string, file: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return signAssetUrl(`/${prefix}/${tenantAssetRelativePath(tenantId, file)}`, tenantId);
}

export async function enterpriseCtx(): Promise<string> {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) return '';
  try { return buildEnterpriseContext(await readTenantEnterpriseProfile(tenantId)); }
  catch { return ''; }
}

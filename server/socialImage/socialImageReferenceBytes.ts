import fs from 'node:fs';
import path from 'node:path';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { objectStorageDownload, objectStorageEnabled } from '../storage/objectStorage.js';
import { store } from '../storage/index.js';
import { fetchFile } from '../storage/files.js';
import { readStoredImagePostReference } from './socialImageStoredReference.js';

/** Read the original tenant-scoped reference bytes used by both evidence and paid admission. */
export async function readSocialImageReferenceBytes(tenantId: string, raw: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  let route = '';
  try { route = new URL(raw, 'http://local.invalid').pathname; } catch { return null; }
  if (route.startsWith('/api/overseas/videos/')) return readStoredImagePostReference(tenantId, route, {
    readRecord: id => store.getById<Record<string, unknown>>('trend_videos', id),
    download: async key => {
      const object = await objectStorageDownload(key);
      return object?.buf?.length ? { bytes: object.buf, mimeType: object.contentType || 'image/jpeg' } : null;
    },
    readFile: async (id, filename) => {
      const file = await fetchFile('trend_videos', id, filename);
      return file ? { bytes: file.buf, mimeType: file.contentType } : null;
    },
  });
  const rendered = route.match(/^\/api\/overseas\/social-images\/renders\/([a-zA-Z0-9._-]+\.png)$/);
  if (rendered) {
    const file = path.resolve(process.cwd(), 'data', 'social-image-renders', enterpriseAssetTenantKey(tenantId), path.basename(rendered[1]!));
    return fs.existsSync(file) ? { bytes: fs.readFileSync(file), mimeType: 'image/png' } : null;
  }
  const enterprise = route.match(/^\/api\/overseas\/enterprise\/assets\/([\w.-]+)$/);
  if (enterprise) {
    const filename = path.basename(enterprise[1]!);
    const local = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId), filename);
    if (fs.existsSync(local)) return { bytes: fs.readFileSync(local), mimeType: /\.png$/i.test(filename) ? 'image/png' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/jpeg' };
    if (objectStorageEnabled()) {
      const object = await objectStorageDownload(enterpriseAssetObjectKey(tenantId, filename));
      if (object?.buf?.length) return { bytes: object.buf, mimeType: object.contentType || 'image/jpeg' };
    }
  }
  const library = await readMaterialLibrary(tenantId).catch(() => null);
  const privateName = route.match(/^\/api\/overseas\/studio\/private-assets\/materials\/([\w.-]+)$/)?.[1];
  const material = library?.items.find(item => item.type === 'image' && String(item.tenantId || item.tenant_id || '') === tenantId && (
    [item.url, item.poster].some(url => {
      try { return url && new URL(String(url), 'http://local.invalid').pathname === route; } catch { return false; }
    }) || (privateName && [item.objectKey, item.posterObjectKey].some(key => key && path.basename(String(key)) === privateName))
  ));
  return material ? readTenantMaterialBytes(material as any, tenantId).catch(() => null) : null;
}

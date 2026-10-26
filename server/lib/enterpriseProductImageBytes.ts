import fs from 'node:fs';
import path from 'node:path';
import { tenantCatalogImageFile } from './enterpriseMediaImage.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { objectStorageDownload, objectStorageEnabled } from '../storage/objectStorage.js';

/** Read the product's persisted image without HTTP fetching or crossing tenant roots. */
export async function readTenantProductImageBytes(tenantId: string, url: string, options: {
  mediaRoot?: string;
  enterpriseRoot?: string;
  readObject?: (key: string) => Promise<Buffer | null>;
} = {}): Promise<Buffer | null> {
  const mediaRoot = options.mediaRoot || process.env.SOCIAL_CONTENT_MEDIA_ROOT || path.resolve('data/media');
  const catalog = tenantCatalogImageFile(url, tenantId, mediaRoot);
  if (catalog) return fs.readFileSync(catalog);
  // Only a relative enterprise route is accepted. An external URL with a
  // similar pathname must never be interpreted as an owned enterprise upload.
  const match = /^\/api\/overseas\/enterprise\/assets\/([a-zA-Z0-9][\w.-]*\.(?:png|jpe?g|webp))$/i.exec(url);
  if (!match) return null;
  const filename = match[1]!;
  const tenantRoot = path.join(options.enterpriseRoot || path.resolve('data/enterprise-assets'), enterpriseAssetTenantKey(tenantId));
  try {
    const root = fs.realpathSync(tenantRoot);
    const file = fs.realpathSync(path.join(root, filename));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) return null;
    if (fs.statSync(file).size > 10 * 1024 * 1024) return null;
    return fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const readObject = options.readObject || (async (key: string) => objectStorageEnabled()
    ? (await objectStorageDownload(key))?.buf || null : null);
  const bytes = await readObject(enterpriseAssetObjectKey(tenantId, filename));
  return bytes?.length && bytes.length <= 10 * 1024 * 1024 ? bytes : null;
}

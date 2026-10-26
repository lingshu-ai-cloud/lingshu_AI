import fs from 'fs';
import path from 'path';
import { type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { objectStorageEnabled, objectStorageGetObject, objectStorageUpload } from '../storage/objectStorage.js';
import { materialAssetContentType, tenantPrivateObjectKey } from '../storage/materialAssets.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioPrivateAssetRoutes(deps: Pick<StudioApplicationPorts, 'scopedStudioAssetUrl' | 'studioRouter'>) {
  const scopedStudioAssetUrl: StudioApplicationPorts['scopedStudioAssetUrl'] = (...args) => deps.scopedStudioAssetUrl(...args);
  const studioRouter = deps.studioRouter;

  function privateStudioAssetUrl(namespace: string, tenantId: string, file: string): string {
    return signAssetUrl(`/api/overseas/studio/private-assets/${namespace}/${path.basename(file)}`, tenantId);
  }

  async function persistPrivateStudioAsset(namespace: string, tenantId: string, filePath: string, contentType?: string): Promise<string> {
    const file = path.basename(filePath);
    if (!objectStorageEnabled()) return scopedStudioAssetUrl(namespace, file);
    const key = tenantPrivateObjectKey(namespace, tenantId, file);
    await objectStorageUpload({ key, body: fs.readFileSync(filePath), contentType: materialAssetContentType(file, contentType || '') });
    return privateStudioAssetUrl(namespace, tenantId, file);
  }

  function registerGetPrivateAssetsNamespaceFile() {
    studioRouter.get('/private-assets/:namespace/:file', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const namespace = String(req.params.namespace || '');
      if (!['tts', 'voice-samples', 'covers', 'exports', 'materials', 'material-records'].includes(namespace)) { res.status(404).end(); return; }
      let key = tenantPrivateObjectKey(namespace, tenantId, req.params.file);
      if (namespace === 'material-records') {
        const match = String(req.params.file).match(/^(.+)\.(media|poster)$/);
        if (!match) { res.status(404).end(); return; }
        // Resolve the original key from the authorized inventory, never from a
        // client-supplied path or a basename guess across storage namespaces.
        const inventory = await readMaterialLibrary(tenantId);
        const records = inventory.items.filter(item => item.id === match[1]);
        key = records.length === 1 ? String(records[0]![match[2] === 'poster' ? 'posterObjectKey' : 'objectKey'] || '') : '';
        if (!key) { res.status(404).end(); return; }
      }
      const object = await objectStorageGetObject(key, req.headers.range);
      if (!object) { res.status(404).end(); return; }
      res.setHeader('Content-Type', object.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Accept-Ranges', object.acceptRanges || 'bytes');
      res.setHeader('Content-Disposition', 'inline');
      if (object.contentLength !== undefined) res.setHeader('Content-Length', String(object.contentLength));
      if (object.contentRange) { res.status(206); res.setHeader('Content-Range', object.contentRange); }
      for await (const chunk of object.body) res.write(chunk);
      res.end();
    });
  }

  return { privateStudioAssetUrl, persistPrivateStudioAsset, registerGetPrivateAssetsNamespaceFile };
}

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

/** Mount after requireAuth. Only serve this tenant's local MP4 exports. */
export function studioRenderMediaRouter(root: string) {
  const router = Router();
  router.get('/:file', (req, res) => {
    const tenantId = String(res.locals.tenantId || '');
    const file = String(req.params.file || '');
    if (!/^[\w-]+$/.test(tenantId) || !/^[\w-]+\.mp4$/.test(file)) {
      res.status(404).end(); return;
    }
    let target: string;
    try {
      const folder = path.join(fs.realpathSync(root), tenantId);
      target = path.join(folder, file);
      // Do not follow links out of the tenant directory.
      if (fs.realpathSync(folder) !== folder || fs.realpathSync(target) !== target || !fs.statSync(target).isFile()) {
        res.status(404).end(); return;
      }
    } catch { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(target);
  });
  return router;
}

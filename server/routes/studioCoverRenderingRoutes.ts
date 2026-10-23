import { buildCoverSvg } from './studioCoverSvg.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { consumeDemoQuota } from '../lib/demo.js';
import { type AuthLocals } from '../middleware/auth.js';
import { MEDIA_DIR, COVERS_ROOT } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioCoverRenderingRoutes(deps: Pick<StudioApplicationPorts, 'studioTenantContext' | 'studioRouter' | 'scopedStudioAssetDir' | 'persistPrivateStudioAsset'>) {
  const studioTenantContext = deps.studioTenantContext;
  const studioRouter = deps.studioRouter;
  const scopedStudioAssetDir: StudioApplicationPorts['scopedStudioAssetDir'] = (...args) => deps.scopedStudioAssetDir(...args);
  const persistPrivateStudioAsset: StudioApplicationPorts['persistPrivateStudioAsset'] = (...args) => deps.persistPrivateStudioAsset(...args);

  function inlineFrame(bgImageUrl?: string): string | undefined {
    if (!bgImageUrl) return undefined;
    try {
      // 浏览器从视频抽出的静态帧可直接作为封面底图；限制格式和体积，避免任意 data URI 写入。
      if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(bgImageUrl)) {
        return bgImageUrl.length <= 8 * 1024 * 1024 ? bgImageUrl : undefined;
      }
      const tenantId = studioTenantContext.getStore();
      if (!tenantId) return undefined;
      const relative = bgImageUrl.split('?')[0].replace(/^.*\/media\//, '');
      if (!relative.startsWith(`tenants/${tenantId}/`) && !relative.startsWith('shared/')) return undefined;
      const local = path.join(MEDIA_DIR, relative);
      if (!fs.existsSync(local)) return undefined;
      const ext = path.extname(local).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`;
    } catch { return undefined; }
  }

  function registerPostCover() {
    studioRouter.post('/cover', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { title = '', ratio = '9:16', accent = '#d97706', bgImageUrl, color, size, position, verticalPosition, align, font, weight, artPreset } = req.body ?? {};
      try {
        fs.mkdirSync(scopedStudioAssetDir(COVERS_ROOT), { recursive: true });
        const file = `${randomUUID()}.svg`;
        const dataUri = inlineFrame(bgImageUrl);
        if (!dataUri) {
          res.status(400).json({ ok: false, error: 'cover_frame_required' });
          return;
        }
        const filePath = path.join(scopedStudioAssetDir(COVERS_ROOT), file);
        fs.writeFileSync(filePath, buildCoverSvg({ title, ratio, accent, bgImageUrl: dataUri, color, size, position, verticalPosition, align, font, weight, artPreset }), 'utf8');
        res.json({ ok: true, url: await persistPrivateStudioAsset('covers', tenantId, filePath, 'image/svg+xml'), hasFrame: !!dataUri });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  return { registerPostCover };
}

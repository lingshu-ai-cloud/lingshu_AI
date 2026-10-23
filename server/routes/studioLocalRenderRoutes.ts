import fs from 'fs';
import path from 'path';
import { verifyRenderToken } from '../lib/renderToken.js';
import { secureStudioRenderManifest, studioRenderManifestHash, MAX_STUDIO_RENDER_ASSET_BYTES, MAX_STUDIO_RENDER_TOTAL_BYTES } from '../lib/studioRenderSecurity.js';
import { type AuthLocals } from '../middleware/auth.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioLocalRenderRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'publishingRenderDir' | 'composite' | 'publishingRenderPreviewUrl'>) {
  const studioRouter = deps.studioRouter;
  const publishingRenderDir: StudioApplicationPorts['publishingRenderDir'] = (...args) => deps.publishingRenderDir(...args);
  const composite = deps.composite;
  const publishingRenderPreviewUrl: StudioApplicationPorts['publishingRenderPreviewUrl'] = (...args) => deps.publishingRenderPreviewUrl(...args);

  const activeStudioRenders = new Map<string, number>();

  const consumedStudioRenderJobs = new Map<string, number>();

  function registerPostRenderLocal() {
    studioRouter.post('/render/local', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const manifest = req.body?.manifest;
      const claim = verifyRenderToken(req.body?.token);
      if (!manifest || !req.body?.token) {
        res.status(400).json({ ok: false, error: '导出接口已更新，请刷新页面后重新发起渲染授权' }); return;
      }
      if (!claim || claim.scope !== 'render' || claim.tenantId !== tenantId || !/^[\w-]{1,80}$/.test(String(claim.jti || '')) || claim.jti !== manifest?.jobId
        || claim.manifestSha256 !== studioRenderManifestHash(manifest)) {
        res.status(403).json({ ok: false, error: '渲染授权无效，请重新发起导出' }); return;
      }
      const now = Date.now();
      for (const [job, expiry] of consumedStudioRenderJobs) if (expiry <= now) consumedStudioRenderJobs.delete(job);
      const replayKey = `${tenantId}:${claim.jti}`;
      if (consumedStudioRenderJobs.has(replayKey)) { res.status(409).json({ ok: false, error: '渲染授权已使用' }); return; }
      if ((activeStudioRenders.get(tenantId) || 0) >= 2 || [...activeStudioRenders.values()].reduce((sum, n) => sum + n, 0) >= 4) {
        res.status(429).json({ ok: false, error: '渲染任务繁忙，请稍后重试' }); return;
      }
      let safeManifest: Record<string, unknown>;
      const localPort = req.socket.localPort;
      try {
        if (!localPort) throw new Error('无法确认本机渲染服务端口');
        safeManifest = secureStudioRenderManifest(manifest, tenantId, String(claim.origin), `http://127.0.0.1:${localPort}`);
      } catch (error) {
        res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '渲染清单无效' }); return;
      }
      const outputDir = publishingRenderDir(tenantId);
      const claimDir = path.join(outputDir, '.render-claims', new Date().toISOString().slice(0, 10));
      try {
        fs.mkdirSync(claimDir, { recursive: true });
        const storedBytes = fs.readdirSync(outputDir, { withFileTypes: true })
          .filter(entry => entry.isFile() && /^studio-[\w-]+\.mp4$/.test(entry.name))
          .reduce((total, entry) => total + fs.statSync(path.join(outputDir, entry.name)).size, 0);
        if (storedBytes >= 5 * 1024 * 1024 * 1024) {
          res.status(429).json({ ok: false, error: '当前工作区成片存储已达 5 GiB 上限，请先清理旧成片' }); return;
        }
        if (fs.readdirSync(claimDir).length >= 20) {
          res.status(429).json({ ok: false, error: '今日导出次数已用完，请明天再试' }); return;
        }
        fs.writeFileSync(path.join(claimDir, `${claim.jti}.claim`), '', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        res.status((error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 409 : 500).json({ ok: false, error: '渲染授权已使用或无法记录导出任务' }); return;
      }
      consumedStudioRenderJobs.set(replayKey, Number(claim.exp) * 1000);
      activeStudioRenders.set(tenantId, (activeStudioRenders.get(tenantId) || 0) + 1);
      try {
        fs.mkdirSync(outputDir, { recursive: true });
        const result = await composite({
          ...safeManifest,
          requireVisualAssets: true,
          assetOrigin: `http://127.0.0.1:${localPort}`,
          serverStrictAssets: true,
          maxAssetBytes: MAX_STUDIO_RENDER_ASSET_BYTES,
          maxTotalAssetBytes: MAX_STUDIO_RENDER_TOTAL_BYTES,
          assetHeaders: {
            ...(req.get('authorization') ? { authorization: req.get('authorization') } : {}),
            ...(req.get('cookie') ? { cookie: req.get('cookie') } : {}),
          },
        }, undefined, outputDir);
        if (!result.ok) {
          res.status(500).json({ ok: false, error: result.error || '本地 MP4 导出失败' });
          return;
        }
        const outputPath = String(result.outputPath || '');
        res.json({
          ok: true,
          outputPath,
          previewUrl: outputPath ? publishingRenderPreviewUrl(tenantId, outputPath) : '',
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : '本地 MP4 导出失败' });
      } finally {
        const remaining = (activeStudioRenders.get(tenantId) || 1) - 1;
        if (remaining) activeStudioRenders.set(tenantId, remaining);
        else activeStudioRenders.delete(tenantId);
      }
    });
  }

  return { registerPostRenderLocal };
}

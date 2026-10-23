import { type RenderSpec } from './studioRenderManifestProjection.js';
import { runStudioEmphasisPrepass } from '../lib/studioEmphasisPrepass.js';
import { eligibleStudioEmphasisSource } from '../lib/studioRenderEmphasisPrepass.js';
import { randomUUID } from 'node:crypto';
import { signRenderToken } from '../lib/renderToken.js';
import { secureStudioRenderManifest, studioRenderManifestHash } from '../lib/studioRenderSecurity.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { type AuthLocals } from '../middleware/auth.js';
import { MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioRenderAdmissionRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'buildManifest'>) {
  const studioRouter = deps.studioRouter;
  const buildManifest: StudioApplicationPorts['buildManifest'] = (...args) => deps.buildManifest(...args);

  function registerPostRender() {
    studioRouter.post('/render', async (req, res) => {
      const spec = (req.body ?? {}) as RenderSpec;
      const jobId = randomUUID();
      const base = `${req.protocol}://${req.get('host')}`;
      let manifest = buildManifest(jobId, spec, base);
      const { tenantId } = res.locals as AuthLocals;
      if (spec.bgm && !manifest.bgm.url) {
        res.status(400).json({ ok: false, error: '所选配乐已不可用，请重新选择' }); return;
      }
      try {
        secureStudioRenderManifest(manifest, tenantId, base, 'http://127.0.0.1');
      } catch (error) {
        res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '渲染清单无效' });
        return;
      }
      if (!await consumeDemoQuota(req, res, 'render')) return;
      if (process.env.LINGSHU_EMPHASIS_PREPASS !== 'off' && manifest.emphasisPlan.events.length) {
        const sourcePath = eligibleStudioEmphasisSource({
          timeline: manifest.timeline,
          durationSeconds: manifest.spec.duration,
          mediaRoot: MEDIA_DIR,
        });
        if (sourcePath) {
          try {
            const emphasisPreanalysis = await runStudioEmphasisPrepass({
              sourcePath,
              durationMs: Math.round(manifest.spec.duration * 1000),
              storyboard: spec.timeline,
              candidateEvents: manifest.emphasisPlan.events,
            });
            manifest = buildManifest(jobId, spec, base, emphasisPreanalysis);
            secureStudioRenderManifest(manifest, tenantId, base, 'http://127.0.0.1');
          } catch { /* Visual preanalysis is best effort and must not block export. */ }
        }
      }
      const { token, payload } = signRenderToken({ jti: jobId, tenantId, origin: base, manifestSha256: studioRenderManifestHash(manifest) });

      res.status(201).json({
        ok: true,
        token,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        manifest,
      });
    });
  }

  return { registerPostRender };
}

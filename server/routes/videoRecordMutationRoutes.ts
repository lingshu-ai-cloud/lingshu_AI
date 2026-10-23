import { publicVideoRecord } from './videoPublicRecordProjection.js';
import { recordContentFormat } from './videoRecordVisibility.js';
import { reanalyzeStoredImagePost } from '../socialDiscovery/imagePostReanalysis.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { COL } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoRecordMutationRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'analyzeImagePostBestEffort'>) {
  const videosRouter = deps.videosRouter;
  const analyzeImagePostBestEffort: VideoApplicationPorts['analyzeImagePostBestEffort'] = (...args) => deps.analyzeImagePostBestEffort(...args);

  function registerPostIdReanalyzeImage() {
    videosRouter.post('/:id/reanalyze-image', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || recordContentFormat(record) !== 'image') { res.status(404).json({ error: 'Image post not found' }); return; }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) { res.status(404).json({ error: 'Image post not found' }); return; }
      if (['queued', 'processing', 'unknown'].includes(String(videoAnalysisOf(record).imageAnalysisQueueState || ''))) {
        res.status(409).json({ ok: false, error: 'image_post_queue_requires_reconciliation' });
        return;
      }
      try {
        const output = await reanalyzeStoredImagePost({
          store, collection: COL, tenantId: String(record.tenantId), record, analyze: analyzeImagePostBestEffort,
        });
        res.status(output.status === 'analyzed' ? 200 : 502).json({ ok: output.status === 'analyzed', analysis: output.analysis, error: output.error });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'image_post_analysis_unknown';
        console.error('[videos] image post reanalysis did not complete:', code);
        const publicCode = [
          'image_post_analysis_attempt_persistence_failed', 'image_post_analysis_result_persistence_failed',
          'image_post_analysis_superseded', 'image_post_analysis_source_changed',
          'image_post_record_disappeared_after_analysis',
        ].includes(code) ? code : 'image_post_analysis_unknown';
        res.status(['image_post_analysis_superseded', 'image_post_analysis_source_changed'].includes(publicCode) ? 409 : 503)
          .json({ ok: false, error: publicCode });
      }
    });
  }

  function registerPatchId() {
    videosRouter.patch('/:id', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const title = String(req.body?.title ?? '').trim().slice(0, 160);
      if (!title) { res.status(400).json({ error: 'Title is required' }); return; }
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean).slice(0, 20)
        : [];
      await store.update(COL, req.params.id, {
        title,
        tags: JSON.stringify(tags.map((tag: string) => tag.slice(0, 40))),
        updatedAt: new Date().toISOString(),
      });
      const updated = await store.getById<Record<string, unknown>>(COL, req.params.id);
      res.json({ ...publicVideoRecord(updated || record), canManage: true });
    });
  }

  function registerDeleteId() {
    videosRouter.delete('/:id', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      await store.delete(COL, req.params.id);
      res.json({ ok: true });
    });
  }

  return { registerPostIdReanalyzeImage, registerPatchId, registerDeleteId };
}

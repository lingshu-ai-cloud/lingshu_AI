import { randomUUID } from 'node:crypto';
import { acquireDurableOperationLease, releaseDurableOperationLease, type DurableOperationLease } from '../runtime/durableLease.js';
import { publicVideoRecord } from './videoPublicRecordProjection.js';
import { recordContentFormat } from './videoRecordVisibility.js';
import { reanalyzeStoredImagePost } from '../socialDiscovery/imagePostReanalysis.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { COL } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';
import { withAssistantPreviewInformation } from '../../scripts/customer-preview-ai-scope.mjs';
import { z } from 'zod';

const imageReanalysisInput = z.object({ imageIndex: z.number().int().min(1).max(10).optional() }).strict();

export function createVideoRecordMutationRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'analyzeImagePostBestEffort'>) {
  const videosRouter = deps.videosRouter;
  const analyzeImagePostBestEffort: VideoApplicationPorts['analyzeImagePostBestEffort'] = (...args) => deps.analyzeImagePostBestEffort(...args);

  function registerPostIdReanalyzeImage() {
    videosRouter.post('/:id/reanalyze-image', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const selection = imageReanalysisInput.safeParse(req.body ?? {});
      if (!selection.success) { res.status(400).json({ ok: false, error: 'image_post_analysis_selection_invalid' }); return; }
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || recordContentFormat(record) !== 'image') { res.status(404).json({ error: 'Image post not found' }); return; }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) { res.status(404).json({ error: 'Image post not found' }); return; }
      if (process.env.LINGSHU_LOCAL_PREVIEW === '1'
        && (process.env.NODE_ENV !== 'development' || process.env.ASSISTANT_PREVIEW_REAL_QUERIES !== '1')) {
        res.status(503).json({ ok: false, error: 'image_post_analysis_network_blocked' });
        return;
      }
      const analysis = videoAnalysisOf(record);
      if (['queued', 'processing', 'unknown'].includes(String(analysis.imageAnalysisQueueState || ''))
        || (analysis.imageAnalysisStatus === 'pending' && analysis.imageAnalysisAttemptId)) {
        res.status(409).json({ ok: false, error: 'image_post_queue_requires_reconciliation' });
        return;
      }
      let lease: DurableOperationLease | null = null;
      try {
        lease = await acquireDurableOperationLease({ dataStore: store, tenantId: String(record.tenantId), scope: 'image_post_analysis', subjectId: req.params.id, ownerId: randomUUID(), leaseDurationMs: 15 * 60_000 });
        if (!lease) throw Error('image_post_queue_requires_reconciliation');
        const latest = await store.getById<Record<string, unknown>>(COL, req.params.id);
        if (!latest || latest.tenantId !== record.tenantId) throw Error('image_post_record_disappeared_after_analysis');
        const analyze = async (...args: Parameters<typeof analyzeImagePostBestEffort>) => {
          if (process.env.LINGSHU_LOCAL_PREVIEW !== '1') return analyzeImagePostBestEffort(...args);
          // Reuse the existing, explicitly enabled preview model scope for this
          // user-requested analysis; all other preview network traffic stays denied.
          const result = await withAssistantPreviewInformation(() => analyzeImagePostBestEffort(...args));
          return { ...result.value, providerAudit: result.audit };
        };
        const output = await reanalyzeStoredImagePost({
          store, collection: COL, tenantId: String(record.tenantId), record: latest, analyze, imageIndex: selection.data.imageIndex,
        });
        const updated = output.status === 'analyzed' ? await store.getById<Record<string, unknown>>(COL, req.params.id) : null;
        res.status(output.status === 'analyzed' ? 200 : 502).json({ ok: output.status === 'analyzed', analysis: output.analysis, error: output.error, ...(updated ? { record: publicVideoRecord(updated) } : {}) });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'image_post_analysis_unknown';
        console.error('[videos] image post reanalysis did not complete:', code);
        const publicCode = [
          'image_post_analysis_attempt_persistence_failed', 'image_post_analysis_result_persistence_failed',
          'image_post_analysis_superseded', 'image_post_analysis_source_changed',
          'image_post_record_disappeared_after_analysis', 'image_post_analysis_provider_result_unknown',
          'image_post_queue_requires_reconciliation', 'image_post_analysis_attempt_requires_reconciliation',
          'image_post_analysis_selection_invalid',
        ].includes(code) ? code : 'image_post_analysis_unknown';
        res.status(publicCode === 'image_post_analysis_selection_invalid' ? 400 : ['image_post_analysis_superseded', 'image_post_analysis_source_changed',
          'image_post_analysis_provider_result_unknown', 'image_post_queue_requires_reconciliation',
          'image_post_analysis_attempt_requires_reconciliation'].includes(publicCode) ? 409 : 503)
          .json({ ok: false, error: publicCode });
      } finally { if (lease) await releaseDurableOperationLease({ dataStore: store, lease }); }
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

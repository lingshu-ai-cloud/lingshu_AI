import { filterCrawlerOpsTasksForRecordIds } from './videoCrawlerOpsTaskState.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { COL } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoOpsRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'crawlerOpsRecordIdsForTenant' | 'loadCrawlerOpsTasks' | 'crawlerOpsStats' | 'runCrawlerOpsWorkerOnce' | 'persistCrawlerOpsTasks' | 'analyzeOpsVideo'>) {
  const videosRouter = deps.videosRouter;
  const crawlerOpsRecordIdsForTenant: VideoApplicationPorts['crawlerOpsRecordIdsForTenant'] = (...args) => deps.crawlerOpsRecordIdsForTenant(...args);
  const loadCrawlerOpsTasks: VideoApplicationPorts['loadCrawlerOpsTasks'] = (...args) => deps.loadCrawlerOpsTasks(...args);
  const crawlerOpsStats: VideoApplicationPorts['crawlerOpsStats'] = (...args) => deps.crawlerOpsStats(...args);
  const runCrawlerOpsWorkerOnce: VideoApplicationPorts['runCrawlerOpsWorkerOnce'] = (...args) => deps.runCrawlerOpsWorkerOnce(...args);
  const persistCrawlerOpsTasks: VideoApplicationPorts['persistCrawlerOpsTasks'] = (...args) => deps.persistCrawlerOpsTasks(...args);
  const analyzeOpsVideo: VideoApplicationPorts['analyzeOpsVideo'] = (...args) => deps.analyzeOpsVideo(...args);

  function registerGetOpsQueue() {
    videosRouter.get('/ops/queue', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const visibleRecordIds = await crawlerOpsRecordIdsForTenant(tenantId);
      res.json({ items: filterCrawlerOpsTasksForRecordIds(loadCrawlerOpsTasks(), visibleRecordIds).filter(task => task.status === 'queued' || task.status === 'pushed' || task.status === 'processing') });
    });
  }

  function registerGetOpsStats() {
    videosRouter.get('/ops/stats', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const visibleRecordIds = await crawlerOpsRecordIdsForTenant(tenantId);
      res.json(crawlerOpsStats(tenantId, visibleRecordIds));
    });
  }

  function registerPostOpsRunOnce() {
    videosRouter.post('/ops/run-once', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const result = await runCrawlerOpsWorkerOnce({ tenantId });
      res.json(result);
    });
  }

  function registerPostOpsTaskIdResolve() {
    videosRouter.post('/ops/:taskId/resolve', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const { taskId } = req.params;
      const { videoBase64, mimeType = 'video/mp4', error } = req.body as {
        videoBase64?: string;
        mimeType?: string;
        error?: string;
      };
      const tasks = loadCrawlerOpsTasks();
      const task = tasks.find(item => item.id === taskId);
      if (!task) {
        res.status(404).json({ error: 'Crawler ops task not found' });
        return;
      }
      const record = await store.getById<Record<string, unknown>>(COL, task.recordId);
      if (!record || String(record.tenantId || '') !== tenantId || (task.tenantId && task.tenantId !== tenantId)) {
        // Deliberately use 404 so task IDs cannot be used to probe another tenant.
        res.status(404).json({ error: 'Crawler ops task not found' });
        return;
      }
      if (error) {
        persistCrawlerOpsTasks(tasks.map(item => item.id === taskId ? { ...item, status: 'failed', reason: error, updatedAt: new Date().toISOString() } : item));
        res.json({ ok: true, status: 'failed' });
        return;
      }
      if (!videoBase64) {
        res.status(400).json({ error: 'videoBase64 is required to resolve this task' });
        return;
      }
      try {
        await analyzeOpsVideo(task, videoBase64, mimeType);
        persistCrawlerOpsTasks(tasks.map(item => item.id === taskId ? { ...item, status: 'resolved', updatedAt: new Date().toISOString() } : item));
        res.json({ ok: true, status: 'resolved' });
      } catch (e) {
        res.status(502).json({ error: e instanceof Error ? e.message : 'Crawler ops resolve failed' });
      }
    });
  }

  return { registerGetOpsQueue, registerGetOpsStats, registerPostOpsRunOnce, registerPostOpsTaskIdResolve };
}

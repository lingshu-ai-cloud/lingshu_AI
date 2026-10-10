import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { AdMetricSnapshotError, getAdTaskMetricHistory, syncAdTaskMetricSnapshots } from '../platformAds/metricSnapshots.js';
import { PlatformAdTaskLockError } from '../platformAds/taskLock.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
export const platformAdMetricHistoryRouter = Router();
platformAdMetricHistoryRouter.use(requireAuth);
const status = (error: unknown) => error instanceof AdMetricSnapshotError ? error.status : error instanceof PlatformAdTaskLockError ? error.statusCode : error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503;
const message = (error: unknown) => error instanceof AdMetricSnapshotError || error instanceof PlatformAdTaskLockError || error instanceof AdProviderError ? error.message : '指标快照暂不可用';
platformAdMetricHistoryRouter.post('/tasks/:id/metrics/sync', requireAdWriteAccess, async (req, res) => {
  if (req.body && Object.keys(req.body).length) { res.status(400).json({ error: '同步仅支持最近 7 天，不接受自定义范围' }); return; }
  try { res.json(await syncAdTaskMetricSnapshots((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) { res.status(status(error)).json({ error: message(error) }); }
});
platformAdMetricHistoryRouter.get('/tasks/:id/metrics/history', async (req, res) => {
  try { res.json(await getAdTaskMetricHistory((res.locals as AuthLocals).tenantId, req.params.id, req.query.since, req.query.until)); }
  catch (error) { res.status(status(error)).json({ error: message(error) }); }
});

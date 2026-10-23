import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getAdTaskMetrics } from '../platformAds/metrics.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
import { getMetaPerformanceReport } from '../platformAds/metaPerformance.js';
import { PlatformAdCreativeError } from '../platformAds/creatives.js';
import { getMetaAccountHistory } from '../platformAds/accountHistory.js';
import { getHistoryAccounts } from '../platformAds/historyAccounts.js';
import { getAccountDirectory } from '../platformAds/accountDirectory.js';
import { getAccountAdAsset } from '../platformAds/accountAdAsset.js';
export const platformAdMetricsRouter = Router();
platformAdMetricsRouter.use(requireAuth);
platformAdMetricsRouter.get('/account-directory', async (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getAccountDirectory((res.locals as AuthLocals).tenantId)); }
  catch { res.status(503).json({ error: '授权账户目录暂不可读，请刷新重试' }); }
});
platformAdMetricsRouter.get('/connections/:id/history/:accountId/ads/:adId/creative', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getAccountAdAsset((res.locals as AuthLocals).tenantId, req.params.id, req.params.accountId, req.params.adId)); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : '平台素材读取失败，不能确认素材对应关系' }); }
});
platformAdMetricsRouter.get('/connections/:id/history-accounts', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json({ items: await getHistoryAccounts((res.locals as AuthLocals).tenantId, req.params.id) }); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : '授权账户清单读取失败' }); }
});
platformAdMetricsRouter.get(['/connections/:id/history', '/connections/:id/history/:accountId'], async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (Object.keys(req.query).length) { res.status(400).json({ error: '历史报告不接受额外参数' }); return; }
  try { res.json(await getMetaAccountHistory((res.locals as AuthLocals).tenantId, req.params.id, req.params.accountId)); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : 'Meta 账户历史报告暂不可用，请稍后刷新' }); }
});
platformAdMetricsRouter.get('/performance/:executionId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getMetaPerformanceReport((res.locals as AuthLocals).tenantId, req.params.executionId, req.query)); }
  catch (error) { res.status(error instanceof PlatformAdCreativeError ? error.status : 503).json({ error: error instanceof PlatformAdCreativeError || error instanceof AdProviderError ? error.message : 'Meta 报告暂不可用，请稍后刷新' }); }
});
platformAdMetricsRouter.get('/tasks/:id/metrics', async (req, res) => {
  try { res.json(await getAdTaskMetrics((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : '投放效果暂不可用' }); }
});

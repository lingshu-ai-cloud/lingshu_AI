import { readLocalBusinessPreview } from '../platformAds/localBusinessPreview.js';
import { getMetaAccountSpend, getMetaBusinessOverview } from '../platformAds/businessOverview.js';
import { randomUUID } from 'node:crypto';
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
import { parseAdReportPeriod } from '../../shared/adReportPeriod.js';
import { getImportedMetaDelivery } from '../platformAds/metaImportedDelivery.js';
import { getCreatedMetaDelivery } from '../platformAds/metaCreatedDelivery.js';
export const platformAdMetricsRouter = Router();
platformAdMetricsRouter.use(requireAuth);
platformAdMetricsRouter.get('/local-business-preview', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const data = readLocalBusinessPreview((res.locals as AuthLocals).tenantId, req.socket.remoteAddress);
    if (!data) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(data);
  } catch { res.status(503).json({ error: '本地企业数据暂不可读' }); }
});
platformAdMetricsRouter.get('/connections/:id/overview/:accountId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getMetaBusinessOverview((res.locals as AuthLocals).tenantId, req.params.id, req.params.accountId, req.query)); }
  catch (error) {
    const status = error instanceof AdProviderError ? error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 503 : 503;
    res.status(status).json({ error: error instanceof AdProviderError && error.code === 'NOT_CONFIGURED' ? 'Meta 连接配置待完善，请到账号管理核对授权。' : error instanceof AdProviderError ? error.message : 'Meta 经营报告暂不可用，请重试' });
  }
});
platformAdMetricsRouter.get('/connections/:id/spend/:accountId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getMetaAccountSpend((res.locals as AuthLocals).tenantId, req.params.id, req.params.accountId, req.query)); }
  catch (error) {
    const status = error instanceof AdProviderError ? error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 503 : 503;
    res.status(status).json({ error: error instanceof AdProviderError ? error.message : 'Meta 账户消耗暂不可用，请重试' });
  }
});
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
  try {
    let period;
    try { period = parseAdReportPeriod(req.query); } catch { throw new AdProviderError('请选择有效的历史日期或统计周期', 'INVALID_INPUT'); }
    res.json(await getAdTaskMetrics((res.locals as AuthLocals).tenantId, req.params.id, period));
  }
  catch (error) {
    const code = error instanceof AdProviderError ? error.code : 'METRICS_UNAVAILABLE';
    const status = code === 'NOT_FOUND' ? 404 : code === 'INVALID_INPUT' ? 400 : 503, requestId = randomUUID();
    console.warn('[platform-ads:metrics-read-failed]', { requestId, taskId: req.params.id, code, status });
    res.status(status).json({ error: error instanceof AdProviderError ? error.message : '投放效果暂不可用', code, requestId });
  }
});
platformAdMetricsRouter.get('/tasks/:id/imported-delivery', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getImportedMetaDelivery((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) {
    const code = error instanceof AdProviderError ? error.code : 'DELIVERY_UNAVAILABLE';
    const status = code === 'NOT_FOUND' ? 404 : code === 'INVALID_INPUT' ? 400 : 503;
    console.warn('[platform-ads:delivery-read-failed]', { taskId: req.params.id, code, status });
    res.status(status).json({ code, error: error instanceof AdProviderError ? error.message : '平台投放状态暂不可用' });
  }
});
platformAdMetricsRouter.get('/tasks/:id/created-delivery', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.json(await getCreatedMetaDelivery((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) {
    const code = error instanceof AdProviderError ? error.code : 'DELIVERY_UNAVAILABLE';
    const status = code === 'NOT_FOUND' ? 404 : code === 'INVALID_INPUT' ? 400 : 503;
    console.warn('[platform-ads:delivery-read-failed]', { taskId: req.params.id, code, status });
    res.status(status).json({ code, error: error instanceof AdProviderError ? error.message : '平台投放状态暂不可用' });
  }
});

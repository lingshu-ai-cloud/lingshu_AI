import { Router } from 'express';
import { adReleasePolicy } from '../platformAds/releasePolicy.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { connectAccount, getConnectionCredential, listConnections } from '../platformAds/connections.js';
import { AdProviderError, MetaAdsAdapter } from '../platformAds/metaAdapter.js';
import { beginMetaOAuth, finishMetaOAuth, oauthAccounts, selectOAuthAccount, metaOAuthConfigured } from '../platformAds/oauth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { GoogleAdsAdapter, TikTokAdsAdapter } from '../platformAds/otherAdapters.js';
export const platformAdConnectionsRouter = Router();
platformAdConnectionsRouter.get('/oauth/meta/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    await finishMetaOAuth(String(req.query.state || ''), String(req.query.code || ''));
    res.type('text/plain').send('Meta 广告授权已完成。请返回灵枢页面选择广告账户。');
  } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.use(requireAuth);
platformAdConnectionsRouter.use(requireAdWriteAccess);
platformAdConnectionsRouter.post('/oauth/meta/start', async (_req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await beginMetaOAuth(tenantId, userId)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/oauth/meta/:id/accounts', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await oauthAccounts(tenantId, userId, req.params.id)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/oauth/meta/:id/connect', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json({ connection: await selectOAuthAccount(tenantId, userId, req.params.id, String(req.body.accountId || '')) }); } catch (error) { failure(res, error); }
});
function failure(res: import('express').Response, error: unknown) {
  const known = error instanceof AdProviderError;
  res.status(known && error.code === 'NOT_FOUND' ? 404 : known && error.code === 'INVALID_INPUT' ? 400 : 503).json({ error: known ? error.message : '广告账户服务暂不可用', code: known ? error.code : 'SERVICE_ERROR' });
}
platformAdConnectionsRouter.get('/connections', async (_req, res) => {
  try { res.json({ items: await listConnections((res.locals as AuthLocals).tenantId), releasePolicy: adReleasePolicy(), capabilities: [
    { provider: 'meta', configured: Boolean(process.env.META_ADS_API_VERSION), oauthConfigured: metaOAuthConfigured(), reason: process.env.META_ADS_API_VERSION ? '支持授权连接及开发者令牌验证' : '尚未配置 API 版本' },
    { provider: 'tiktok', configured: true, reason: '支持令牌连接、视频观看广告人工创建与启停；自动和审批尚未开放' }, { provider: 'google', configured: Boolean(process.env.GOOGLE_ADS_API_VERSION), reason: '支持 Cloud OAuth 令牌连接、Demand Gen 人工创建与启停；自动和审批尚未开放' },
  ] }); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/connections', async (req, res) => {
  try { res.status(201).json({ connection: await connectAccount((res.locals as AuthLocals).tenantId, req.body || {}) }); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/connections/:id/campaigns', async (req, res) => {
  try {
    const { connection, accessToken } = await getConnectionCredential((res.locals as AuthLocals).tenantId, req.params.id);
    const data = connection.provider === 'meta' ? await new MetaAdsAdapter(accessToken).campaigns(connection.accountId) : connection.provider === 'tiktok' ? await new TikTokAdsAdapter(accessToken).campaigns(connection.accountId) : await new GoogleAdsAdapter(accessToken).campaigns(connection.accountId);
    res.json({ items: data.data || data.list || data.results?.map((item: any) => item.campaign) || [], hasMore: Boolean(data.paging?.next || data.nextPageToken || data.page_info?.total_page > 1) });
  } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/connections/:id/verify', async (req, res) => {
  try {
    const { connection, accessToken } = await getConnectionCredential((res.locals as AuthLocals).tenantId, req.params.id);
    res.json({ connection: await connectAccount(connection.tenant_id, { provider: connection.provider, accountId: connection.accountId, accessToken }) });
  } catch (error) { failure(res, error); }
});

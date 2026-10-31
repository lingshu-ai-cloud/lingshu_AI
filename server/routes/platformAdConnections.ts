import { PlatformAdTaskLockError } from '../platformAds/taskLock.js';
import { Router, urlencoded } from 'express';
import { adReleasePolicy } from '../platformAds/releasePolicy.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { connectAccount, getConnectionCredential, listConnections, checkConnectionAuthorization } from '../platformAds/connections.js';
import { AdProviderError, MetaAdsAdapter } from '../platformAds/metaAdapter.js';
import { beginMetaOAuth, finishMetaOAuth, oauthAccounts, oauthPages, selectOAuthAccount, metaOAuthConfigured, metaOAuthReadiness, cancelMetaOAuth, currentMetaOAuth, cancelOwnedMetaOAuth } from '../platformAds/oauth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { GoogleAdsAdapter, TikTokAdsAdapter } from '../platformAds/otherAdapters.js';
import { listPlatformAdResources, syncPlatformAdResources } from '../platformAds/resources.js';
import type { PlatformAdResourceLevel } from '../../shared/platformAdResources.js';
import { useGrantedAccount } from '../platformAds/accountDirectory.js';
import { handleMetaPrivacyRequest, metaDeletionRequestStatus } from '../platformAds/oauthPrivacy.js';
export const platformAdConnectionsRouter = Router();
platformAdConnectionsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
platformAdConnectionsRouter.get('/oauth/meta/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    if (req.query.error) {
      await cancelMetaOAuth(String(req.query.state || ''));
      res.type('text/plain').send('你已取消 Meta 授权，未连接新账户、未创建广告。请返回灵枢重新开始。'); return;
    }
    await finishMetaOAuth(String(req.query.state || ''), String(req.query.code || ''));
    res.type('text/plain').send('Meta 广告授权已完成。请返回灵枢页面选择广告账户。');
  } catch (error) { failure(res, error); }
});
for (const [path, deletion] of [['deauthorize', false], ['data-deletion', true]] as const) {
  platformAdConnectionsRouter.post(`/oauth/meta/${path}`, urlencoded({ extended: false, limit: '16kb', parameterLimit: 5 }), async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const result = await handleMetaPrivacyRequest(req.body?.signed_request, deletion);
      res.json(deletion ? result : { status: 'revoked' });
    } catch (error) { failure(res, error); }
  });
}
platformAdConnectionsRouter.get('/oauth/meta/data-deletion/status/:code', async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  try { res.json(await metaDeletionRequestStatus(req.params.code)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.use(requireAuth);
platformAdConnectionsRouter.use(requireAdWriteAccess);
platformAdConnectionsRouter.post('/connections/:id/use-granted-account', async (req, res) => {
  try { res.json({ connection: await useGrantedAccount((res.locals as AuthLocals).tenantId, req.params.id, String(req.body.accountId || '')) }); }
  catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/oauth/meta/start', async (_req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await beginMetaOAuth(tenantId, userId)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/oauth/meta/current', async (_req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await currentMetaOAuth(tenantId, userId)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/oauth/meta/:id/cancel', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await cancelOwnedMetaOAuth(tenantId, userId, req.params.id)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/oauth/meta/:id/accounts', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json(await oauthAccounts(tenantId, userId, req.params.id)); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/oauth/meta/:id/pages', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json({ items: await oauthPages(tenantId, userId, req.params.id, String(req.query.accountId || '')) }); } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/oauth/meta/:id/connect', async (req, res) => {
  try { const { tenantId, userId } = res.locals as AuthLocals; res.json({ connection: await selectOAuthAccount(tenantId, userId, req.params.id, String(req.body.accountId || ''), String(req.body.pageId || '')) }); } catch (error) { failure(res, error); }
});
function failure(res: import('express').Response, error: unknown) {
  if (error instanceof PlatformAdTaskLockError) { res.status(error.statusCode).json({ error: error.message, code: error.code }); return; }
  const known = error instanceof AdProviderError;
  const status = known && error.code === 'NOT_FOUND' ? 404
    : known && error.code === 'INVALID_INPUT' ? 400
      : known && ['NOT_SUPPORTED', 'ACCOUNT_CONTEXT_REQUIRED', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_REVOKED', 'AUTH_MISSING_PERMISSIONS', 'AUTH_APP_MISMATCH', 'AUTH_METADATA_INVALID', 'AUTH_CHECK_STALE', 'USER_REVOKED', 'DATA_DELETION_REQUESTED'].includes(error.code) ? 409 : 503;
  res.status(status).json({ error: known ? error.message : '广告账户服务暂不可用', code: known ? error.code : 'SERVICE_ERROR' });
}
platformAdConnectionsRouter.get('/connections', async (_req, res) => {
  try { res.json({ items: await listConnections((res.locals as AuthLocals).tenantId), releasePolicy: adReleasePolicy(), capabilities: [
    { provider: 'meta', configured: Boolean(process.env.META_ADS_API_VERSION), oauthConfigured: metaOAuthConfigured(), oauthReadiness: metaOAuthReadiness(), reason: process.env.META_ADS_API_VERSION ? '支持授权连接及开发者令牌验证' : '尚未配置 API 版本' },
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
    const items = connection.provider === 'tiktok'
      ? (data.list || []).map((item: any) => ({ id: String(item.campaign_id), name: String(item.campaign_name || item.campaign_id), status: item.operation_status }))
      : data.data || data.results?.map((item: any) => item.campaign) || [];
    res.json({ items, hasMore: Boolean(data.paging?.next || data.nextPageToken || data.page_info?.total_page > 1) });
  } catch (error) { failure(res, error); }
});
// Read-only live account status; never modifies authorization or billing.
platformAdConnectionsRouter.get('/connections/:id/live-status', async (req, res) => {
  try {
    const tenantId = (res.locals as AuthLocals).tenantId;
    const { connection, accessToken } = await getConnectionCredential(tenantId, req.params.id);
    if (connection.provider !== 'meta') throw new AdProviderError('该平台暂不支持账户状态读取', 'NOT_SUPPORTED');
    const account = await new MetaAdsAdapter(accessToken).account(connection.accountId);
    const id = String(account.account_id || account.id || '').replace(/^act_/, '');
    if (id !== connection.accountId.replace(/^act_/, '') || account.currency !== connection.currency || !Number.isInteger(account.account_status)) throw new AdProviderError('平台账户状态未核验', 'INVALID_RESPONSE');
    const current = (await getConnectionCredential(tenantId, req.params.id)).connection;
    const fingerprint = (value: typeof connection) => JSON.stringify([value.provider, value.accountId, value.currency, value.status, value.tokenCipher, value.updatedAt, value.authorization]);
    if (fingerprint(current) !== fingerprint(connection)) throw new AdProviderError('广告账户授权已变化，请重新查询', 'AUTH_CHECK_STALE');
    const rawBalance = account.is_prepay_account === true && typeof account.balance === 'string' && /^\d+$/.test(account.balance) ? Number(account.balance) : null;
    const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: connection.currency }).resolvedOptions().maximumFractionDigits;
    const balance = rawBalance !== null && Number.isSafeInteger(rawBalance)
      ? { amount: rawBalance / 10 ** fractionDigits, currency: connection.currency }
      : null;
    res.json({ accountStatus: account.account_status, balance, checkedAt: new Date().toISOString() });
  } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/connections/:id/authorization/check', async (req, res) => {
  try { res.json({ connection: await checkConnectionAuthorization((res.locals as AuthLocals).tenantId, req.params.id) }); }
  catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/connections/:id/verify', async (req, res) => {
  try {
    const { connection, accessToken } = await getConnectionCredential((res.locals as AuthLocals).tenantId, req.params.id);
    res.json({ connection: await connectAccount(connection.tenant_id, { provider: connection.provider, accountId: connection.accountId, accessToken }, connection.authorization) });
  } catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.post('/connections/:id/resources/sync', async (req, res) => {
  try { res.json(await syncPlatformAdResources((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) { failure(res, error); }
});
platformAdConnectionsRouter.get('/connections/:id/resources', async (req, res) => {
  try {
    const level = String(req.query.level || '') as PlatformAdResourceLevel;
    res.json(await listPlatformAdResources((res.locals as AuthLocals).tenantId, req.params.id, level));
  } catch (error) { failure(res, error); }
});

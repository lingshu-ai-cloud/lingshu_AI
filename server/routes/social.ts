import { normalizeMetricValues } from '../socialMetrics/aggregation.js';
import {refreshMessengerCapability} from '../messenger/capabilityRefresh.js';
import {createMessengerCapabilityScope} from '../messenger/capabilityAuthority.js';
import { readTikTokCreatorConsent } from '../publishing/tiktokCreatorConsent.js';
import { assertExactOAuthRedirectUri } from '../lib/oauthConfig.js';
import { consumeOAuthNonce, issueOAuthNonce, oauthClientIdentityHash } from '../lib/oauthNonceStore.js';
import { Router, type Request } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import {
  getFacebookComments,
  getFacebookPage,
  getFacebookPageInsights,
  getFacebookVideos,
  getInstagramAccount,
  getInstagramAccountFromPage,
  getInstagramComments,
  getInstagramMedia,
  getInstagramAccountInsights,
  getTikTokUser,
  getTikTokVideos,
  type SocialUploadInput,
} from '../integrations/social.js';
import {
  getLinkedInComments,
  getLinkedInPost,
  getLinkedInPostMetrics,
  linkedInAuthorUrn,
  linkedInOAuthScopes,
} from '../integrations/linkedin.js';
import { parseOAuthState, signOAuthState } from '../lib/tenantPlatformApps.js';
import { publishVideoToAccount, type PublishToAccountInput } from '../publishing/platformPublisher.js';
import { socialUploadHttpResponse } from '../publishing/directPublishHttp.js';
export { socialUploadHttpResponse } from '../publishing/directPublishHttp.js';
import { saveSocialMetricSnapshot } from '../socialMetrics/store.js';
import { socialAccessToken } from '../lib/accountCredentials.js';
import { instagramLoginOAuthScopes, metaOAuthScopes, tikTokOAuthScopes } from '../lib/socialOAuthScopes.js';


import {
  COL, TIKTOK_AUTH_URL, META_AUTH_URL, INSTAGRAM_AUTH_URL, LINKEDIN_AUTH_URL,
  graphVersion, getTikTokClient, getMetaClient, getInstagramClient, getLinkedInClient,
  advancedManualConnectEnabled, isPlatform, redirectUri, normalizeReturnTo,
  callbackHtml, readableSocialError, upsertSocialAccount, publicSocialAccount,
  bodyText, getAvailableMetaPages, assertTenantMessengerPageOwnership,
  admitTenantMessengerPage, assertMessengerAccountVersion, saveFacebookPageFromMeta,
  saveInstagramFromMeta, connectTikTok, connectInstagramLogin, connectMeta,
  connectLinkedIn, type PendingOAuthState, type SocialAccountRecord,
} from './socialOAuthSupport.js';

export const socialRouter = Router();

socialRouter.get('/oauth/:platform/callback', async (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).send('Unknown platform');
    return;
  }
  const state = String(req.query.state || '');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const signedState = parseOAuthState(state);
  const pending: PendingOAuthState | undefined = signedState && signedState.platform === platform ? { ...signedState, platform } : undefined;
  const returnTo = pending?.returnTo || '/';
  if (!pending || pending.platform !== platform) {
    res.status(400).type('html').send(callbackHtml({ ok: false, title: '授权已失效', message: '请回到系统重新连接账号。', returnTo, platform }));
    return;
  }
  try {
    assertExactOAuthRedirectUri(pending.redirectUri, redirectUri(req, platform));
    const client = platform === 'tiktok' ? await getTikTokClient(pending.tenantId)
      : platform === 'instagram' ? await getInstagramClient(pending.tenantId)
        : platform === 'linkedin' ? await getLinkedInClient(pending.tenantId)
          : await getMetaClient(pending.tenantId);
    if (!client || !await consumeOAuthNonce(state, { ...pending, clientHash: oauthClientIdentityHash(client) })) throw new Error('oauth_state_consumed_or_invalid');
    pending.clientHash = oauthClientIdentityHash(client);
    if (!code) throw new Error(String(req.query.error_description || req.query.error || '缺少授权码'));
    if (platform === 'tiktok') await connectTikTok(pending, code, req);
    else if (platform === 'instagram') await connectInstagramLogin(pending, code, req);
    else if (platform === 'linkedin') await connectLinkedIn(pending, code, req);
    else await connectMeta(pending, code, req);
    res.type('html').send(callbackHtml({ ok: true, title: '账号已连接', message: '授权完成，可以关闭这个窗口。', returnTo, platform }));
  } catch (error: any) {
    console.error(`${platform} OAuth callback error:`, error?.response?.data ?? error?.message ?? error);
    res.status(500).type('html').send(callbackHtml({ ok: false, title: '连接失败', message: readableSocialError(error), returnTo, platform }));
  }
});

socialRouter.use(requireAuth);

socialRouter.get('/oauth/:platform/status', async (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).json({ error: 'Unknown platform' });
    return;
  }
  const { tenantId } = res.locals as AuthLocals;
  const configured = platform === 'tiktok' ? Boolean(await getTikTokClient(tenantId))
    : platform === 'instagram' ? Boolean(await getInstagramClient(tenantId))
      : platform === 'linkedin' ? Boolean(await getLinkedInClient(tenantId))
        : Boolean(await getMetaClient(tenantId));
  const scopes = platform === 'tiktok' ? tikTokOAuthScopes()
    : platform === 'instagram' ? instagramLoginOAuthScopes()
      : platform === 'linkedin' ? linkedInOAuthScopes()
        : metaOAuthScopes(platform);
  res.json({
    configured,
    redirectUri: redirectUri(req, platform),
    scopes,
    manualConnectEnabled: advancedManualConnectEnabled(),
  });
});

socialRouter.post('/oauth/:platform/start', async (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).json({ error: 'Unknown platform' });
    return;
  }
  const { userId, tenantId } = res.locals as AuthLocals;
  const tiktokClient = platform === 'tiktok' ? await getTikTokClient(tenantId) : null;
  const metaClient = platform === 'facebook' ? await getMetaClient(tenantId) : null;
  const instagramClient = platform === 'instagram' ? await getInstagramClient(tenantId) : null;
  const linkedinClient = platform === 'linkedin' ? await getLinkedInClient(tenantId) : null;
  if (platform === 'tiktok' ? !tiktokClient : platform === 'instagram' ? !instagramClient : platform === 'linkedin' ? !linkedinClient : !metaClient) {
    res.status(503).json({ error: `${platform} 一键授权暂未开启，请联系服务顾问配置平台应用和回调地址。` });
    return;
  }
  const purpose = platform === 'facebook' && req.body?.purpose === 'messenger' ? 'messenger' as const : undefined;
  const state = signOAuthState({
    userId,
    tenantId,
    platform,
    returnTo: normalizeReturnTo(req.body?.returnTo),
    redirectUri: redirectUri(req, platform),
    purpose,
  });
  const parsedState = parseOAuthState(state);
  if (!parsedState) { res.status(503).json({ error: 'oauth_state_invalid' }); return; }
  try {
    await issueOAuthNonce(state, { ...parsedState, clientHash: oauthClientIdentityHash(tiktokClient || instagramClient || linkedinClient || metaClient) });
  } catch { res.status(503).json({ error: 'oauth_state_storage_unavailable' }); return; }


  if (platform === 'tiktok') {
    const scopes = tikTokOAuthScopes();
    const url = new URL(TIKTOK_AUTH_URL);
    url.searchParams.set('client_key', tiktokClient!.clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(','));
    url.searchParams.set('redirect_uri', redirectUri(req, platform));
    url.searchParams.set('state', state);
    res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes });
    return;
  }

  if (platform === 'instagram') {
    const scopes = instagramLoginOAuthScopes();
    const url = new URL(INSTAGRAM_AUTH_URL);
    url.searchParams.set('client_id', instagramClient!.appId);
    url.searchParams.set('redirect_uri', redirectUri(req, platform));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(','));
    url.searchParams.set('state', state);
    res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes });
    return;
  }

  if (platform === 'linkedin') {
    const scopes = linkedInOAuthScopes();
    const url = new URL(LINKEDIN_AUTH_URL);
    url.searchParams.set('client_id', linkedinClient!.clientId);
    url.searchParams.set('redirect_uri', redirectUri(req, platform));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes });
    return;
  }

  const scopes = metaOAuthScopes(purpose || platform);
  const url = new URL(`${META_AUTH_URL}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', metaClient!.appId);
  url.searchParams.set('redirect_uri', redirectUri(req, platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('state', state);
  url.searchParams.set('auth_type', 'rerequest');
  url.searchParams.set('return_scopes', 'true');
  res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes });
});

socialRouter.post('/connect/manual', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  if (!advancedManualConnectEnabled()) {
    res.status(403).json({ error: 'Advanced manual connect is disabled' });
    return;
  }

  const platform = bodyText(req.body?.platform);
  if (!isPlatform(platform)) {
    res.status(400).json({ error: 'Unknown platform' });
    return;
  }
  if (platform === 'linkedin') {
    res.status(409).json({ error: 'LinkedIn 仅支持 OAuth 授权接入，请使用“连接 LinkedIn”。' });
    return;
  }

  const accessToken = bodyText(req.body?.accessToken);
  if (!accessToken) {
    res.status(400).json({ error: 'Access Token is required' });
    return;
  }

  const refreshToken = bodyText(req.body?.refreshToken);
  const providerAccountId = bodyText(req.body?.providerAccountId);
  const parentPageId = bodyText(req.body?.parentPageId);
  const parentPageName = bodyText(req.body?.parentPageName);
  const title = bodyText(req.body?.title);
  const handle = bodyText(req.body?.handle);
  const avatarUrl = bodyText(req.body?.avatarUrl);

  try {
    let account: SocialAccountRecord | null = null;

    if (platform === 'tiktok') {
      const user = await getTikTokUser(accessToken);
      account = await upsertSocialAccount({
        tenantId,
        userId,
        platform,
        providerAccountId: user.openId,
        title: title || user.displayName,
        handle: handle || user.displayName,
        avatarUrl: avatarUrl || user.avatarUrl || '',
        accessToken,
        refreshToken,
        tokenExpiresAt: '',
        scope: tikTokOAuthScopes().join(','),
        parentPageId: '',
        parentPageName: '',
        followerCount: user.followerCount || 0,
        videoCount: user.videoCount || 0,
        viewCount: 0,
        likeCount: user.likeCount || 0,
      });
    }

    if (platform === 'facebook') {
      const requestedId = providerAccountId || parentPageId;
      const pages = await getAvailableMetaPages(accessToken).catch(error => {
        const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
        if (message.includes('session has expired') || message.includes('validating access token')) throw error;
        return [];
      });

      if (pages.length) {
        const targetPages = requestedId ? pages.filter(page => page.id === requestedId) : pages;
        if (!targetPages.length) throw new Error(`这个 Meta token 有效，但没有找到 Page ID ${requestedId}。请确认填的是 Facebook Page ID，或留空让系统自动连接全部 Page。`);
        const saved: SocialAccountRecord[] = [];
        for (const page of targetPages) {
          if (!page.accessToken) continue;
          saved.push(await saveFacebookPageFromMeta({ tenantId, userId, page }));
        }
        if (!saved.length) throw new Error('Meta 返回了 Page，但没有返回 Page Access Token。请重新生成 token，并勾选 pages_show_list / pages_read_engagement 权限。');
        account = saved[0];
      } else {
        const page = await getFacebookPage(accessToken, graphVersion(), requestedId);
        await assertTenantMessengerPageOwnership(tenantId,page.id);
        account = await upsertSocialAccount({
          tenantId,
          userId,
          platform,
          providerAccountId: page.id,
          title: title || page.name,
          handle: handle || page.name,
          avatarUrl: avatarUrl || page.pictureUrl || '',
          accessToken: page.accessToken,
          refreshToken: '',
          tokenExpiresAt: '',
          scope: metaOAuthScopes('facebook').filter(scope => !['pages_messaging','pages_manage_metadata'].includes(scope)).join(','),
          messengerSubscribed: false,
          parentPageId: page.id,
          parentPageName: page.name,
          followerCount: page.fanCount || 0,
          videoCount: 0,
          viewCount: 0,
          likeCount: 0,
        });
        try {
          const capability=await admitTenantMessengerPage(tenantId,page.id,page.accessToken);
          await assertMessengerAccountVersion(account,page.id,page.accessToken);
          const capabilityScope=createMessengerCapabilityScope({tenantId,accountId:account.id,pageId:page.id,appId:capability.appId,accessToken:page.accessToken,grantedScopes:capability.grantedScopes,validUntil:capability.validUntil});
          if(!await store.update(COL, account.id, { messengerSubscribed: true, messengerSubscriptionError: '', scope: capabilityScope })) throw Error('messenger_capability_persist_failed');
          account = { ...account, messengerSubscribed: true, messengerSubscriptionError: '', scope: capabilityScope };
        } catch (subscriptionError) {
          const message = subscriptionError instanceof Error ? subscriptionError.message : 'Messenger webhook subscription failed';
          await store.update(COL, account.id, { messengerSubscribed: false, messengerSubscriptionError: message });
          account = { ...account, messengerSubscribed: false, messengerSubscriptionError: message };
        }
      }
    }

    if (platform === 'instagram') {
      const requestedId = providerAccountId || parentPageId;
      const pages = await getAvailableMetaPages(accessToken).catch(error => {
        const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
        if (message.includes('session has expired') || message.includes('validating access token')) throw error;
        return [];
      });

      if (pages.length) {
        const targetPages = requestedId
          ? pages.filter(page => page.id === requestedId || page.instagram?.id === requestedId)
          : pages;
        const instagramPages = targetPages.filter(page => page.instagram);
        if (!instagramPages.length) {
          const pageNames = targetPages.map(page => page.name).filter(Boolean).slice(0, 3).join('、');
          throw new Error(`这个 Meta token 有效，也找到了 Page（${pageNames || '未命名'}），但没有找到绑定的 Instagram 专业账号。请确认该 Page 已绑定 IG 专业账号。`);
        }
        const saved: SocialAccountRecord[] = [];
        for (const page of instagramPages) {
          const savedAccount = await saveInstagramFromMeta({ tenantId, userId, page });
          if (savedAccount) saved.push(savedAccount);
        }
        account = saved[0] || null;
      } else {
        const pageId = parentPageId || providerAccountId || 'me';
        const linked = await getInstagramAccountFromPage(pageId, accessToken, graphVersion()).catch(async error => {
          if (!providerAccountId || pageId === 'me') throw error;
          return {
            page: { id: parentPageId, name: parentPageName },
            instagram: await getInstagramAccount(providerAccountId, accessToken, graphVersion()),
          };
        });

        account = await upsertSocialAccount({
          tenantId,
          userId,
          platform,
          providerAccountId: linked.instagram.id,
          title: title || linked.instagram.username,
          handle: handle || `@${linked.instagram.username}`,
          avatarUrl: avatarUrl || linked.instagram.profilePictureUrl || '',
          accessToken,
          refreshToken: '',
          tokenExpiresAt: '',
          scope: metaOAuthScopes('instagram').join(','),
          oauthProvider: 'facebook_login',
          instagramWebhookSubscribed: false,
          instagramWebhookSubscriptionError: '',
          parentPageId: linked.page.id || '',
          parentPageName: linked.page.name || '',
          followerCount: linked.instagram.followersCount || 0,
          videoCount: linked.instagram.mediaCount || 0,
          viewCount: 0,
          likeCount: 0,
        });
      }
    }

    if (!account) throw new Error('Unsupported platform');
    res.status(201).json({ ok: true, account: publicSocialAccount(account) });
  } catch (error: any) {
    console.error(`${platform} manual connect error:`, error?.response?.data ?? error?.message ?? error);
    res.status(error?.response?.status || 500).json({ ok: false, error: readableSocialError(error) });
  }
});

socialRouter.get('/accounts/:id/tiktok/creator-info', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try { res.json(await readTikTokCreatorConsent({ tenantId, accountId: String(req.params.id) })); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'tiktok_creator_query_failed' }); }
});

socialRouter.post('/accounts/:id/messenger/capability-refresh', async (req,res) => {
  const {tenantId}=res.locals as AuthLocals;
  try {res.json(await refreshMessengerCapability(store,tenantId,req.params.id));}
  catch {res.status(409).json({error:'messenger_capability_refresh_failed'});}
});

socialRouter.get('/accounts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = typeof req.query.platform === 'string' && isPlatform(req.query.platform) ? req.query.platform : undefined;
  const result = await store.list<SocialAccountRecord>(COL, {
    where: platform ? { tenantId, platform } : { tenantId },
    sort: '-connectedAt',
  });
  res.json({
    items: result.items.map(publicSocialAccount),
    total: result.totalItems,
  });
});

socialRouter.delete('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<SocialAccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

async function getAccount(req: Request, res: any) {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<SocialAccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) return null;
  return record;
}

function insightDateRange(req: Request) {
  const until = typeof req.query.until === 'string' ? req.query.until : new Date().toISOString().slice(0, 10);
  const sinceDefault = new Date(`${until}T00:00:00.000Z`);
  sinceDefault.setUTCDate(sinceDefault.getUTCDate() - 29);
  const since = typeof req.query.since === 'string' ? req.query.since : sinceDefault.toISOString().slice(0, 10);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(since) || !datePattern.test(until) || since > until) return null;
  const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days > 92) return null;
  return { since, until };
}

function routeRecord(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch { return {}; }
  return {};
}

async function linkedInRegisteredPosts(tenantId: string, accountId: string): Promise<Array<{ id: string; title: string; description: string }>> {
  const result = await store.list<Record<string, unknown>>('posts', { where: { tenant_id: tenantId, platform: 'linkedin' }, page: 1, perPage: 500 });
  if (result.totalItems > result.items.length) throw new Error('linkedin_registered_post_scan_incomplete');
  const posts = new Map<string, { id: string; title: string; description: string }>();
  for (const item of result.items) {
    const attempt = routeRecord(routeRecord(routeRecord(item.stats).publishResults)[accountId]);
    const id = bodyText(attempt.platformPostId || attempt.providerReceiptId);
    if (!/^urn:li:(?:share|ugcPost):/.test(id)) continue;
    posts.set(id, { id, title: bodyText(item.title), description: bodyText(item.description) });
  }
  return [...posts.values()];
}

socialRouter.get('/accounts/:id/insights', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.platform === 'tiktok') {
    res.status(400).json({
      error: 'TikTok 标准 OAuth 不提供账号级留存或流量来源；请使用视频列表中的播放、点赞、评论和分享指标生成趋势。',
      code: 'TIKTOK_ACCOUNT_INSIGHTS_UNAVAILABLE',
    });
    return;
  }
  const range = insightDateRange(req);
  if (!range) {
    res.status(400).json({ error: 'since/until 必须是 YYYY-MM-DD，范围不能超过 92 天' });
    return;
  }
  try {
    if (account.platform === 'linkedin') {
      const accessToken = socialAccessToken(account as unknown as Record<string, unknown>);
      const authorUrn = linkedInAuthorUrn(account);
      const posts = await linkedInRegisteredPosts(tenantId, account.id);
      const capturedAt = new Date().toISOString();
      const points: Array<{ contentId: string; metrics: ReturnType<typeof normalizeMetricValues> }> = [];
      for (const post of posts) {
        const raw = await getLinkedInPostMetrics({ accessToken, postId: post.id, authorUrn });
        const metrics = normalizeMetricValues({
          views: raw.views,
          reach: raw.impressions,
          likes: raw.likes,
          comments: raw.comments,
          shares: raw.shares,
        });
        await saveSocialMetricSnapshot({
          tenantId,
          platform: 'linkedin',
          accountId: account.id,
          contentId: post.id,
          capturedAt,
          valueKind: 'cumulative',
          metrics,
          rawMetrics: { source: 'linkedin_social_actions', coverage: 'registered_content_only', provider: raw },
        });
        points.push({ contentId: post.id, metrics });
      }
      res.json({ platform: 'linkedin', accountId: account.id, range, points, coverage: 'registered_content_only', fetchedAt: capturedAt });
      return;
    }
    const points = account.platform === 'facebook'
      ? await getFacebookPageInsights(account.providerAccountId, socialAccessToken(account as unknown as Record<string, unknown>), graphVersion(), range)
      : await getInstagramAccountInsights(account.providerAccountId, socialAccessToken(account as unknown as Record<string, unknown>), graphVersion(), range);
    const metricKeys: Record<string, 'views' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'followers' | 'profileViews' | 'watchTimeMinutes'> = {
      page_impressions_unique: 'reach',
      page_video_views: 'views',
      page_video_view_time: 'watchTimeMinutes',
      reach: 'reach',
      follower_count: 'followers',
      profile_views: 'profileViews',
      likes: 'likes',
      comments: 'comments',
      shares: 'shares',
      saves: 'saves',
    };
    const byDate = new Map<string, Record<string, number>>();
    for (const point of points) {
      const key = metricKeys[point.metric];
      if (!key || typeof point.value !== 'number' || !Number.isFinite(point.value)) continue;
      // Meta reports Facebook video view time in milliseconds.
      const value = point.metric === 'page_video_view_time' ? point.value / 60_000 : point.value;
      const date = point.endTime ? new Date(point.endTime).toISOString().slice(0, 10) : range.until;
      const metrics = byDate.get(date) || {};
      metrics[key] = value;
      byDate.set(date, metrics);
    }
    await Promise.all([...byDate].map(([date, metrics]) => saveSocialMetricSnapshot({
      tenantId,
      platform: account.platform,
      accountId: account.id,
      capturedAt: `${date}T12:00:00.000Z`,
      valueKind: 'daily',
      metrics,
      rawMetrics: { source: 'meta_insights' },
    })));
    res.json({ platform: account.platform, accountId: account.id, range, points, fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error(`${account.platform} insights error:`, error?.response?.data ?? error?.message ?? error);
    const apiCode = error?.response?.data?.error?.code;
    const status = error?.response?.status === 403 || apiCode === 10 || apiCode === 200 ? 403 : (error?.response?.status || 500);
    res.status(status).json({
      error: status === 403
        ? '当前授权没有 Insights 读取权限，请完成 Meta 应用审核并重新授权账号'
        : readableSocialError(error),
      ...(status === 403 ? { code: 'META_INSIGHTS_PERMISSION_REQUIRED' } : {}),
    });
  }
});

socialRouter.get('/accounts/:id/videos', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const maxResults = Number(req.query.maxResults ?? 25);
  try {
    let videos: unknown[] = []; const accessToken = socialAccessToken(account as unknown as Record<string, unknown>);
    let profilePatch: Partial<SocialAccountRecord> = {};
    if (account.platform === 'linkedin') {
      const authorUrn = linkedInAuthorUrn(account);
      const registered = (await linkedInRegisteredPosts(tenantId, account.id)).slice(0, Math.min(100, Math.max(1, maxResults)));
      videos = await Promise.all(registered.map(async local => {
        const [post, metrics] = await Promise.all([
          getLinkedInPost({ accessToken, postId: local.id }),
          getLinkedInPostMetrics({ accessToken, postId: local.id, authorUrn }),
        ]);
        return {
          id: post.id,
          title: local.title || 'LinkedIn post',
          description: local.description,
          publishedAt: '',
          thumbnailUrl: '',
          viewCount: metrics.views,
          likeCount: metrics.likes,
          commentCount: metrics.comments,
          shareCount: metrics.shares,
          duration: '',
          permalinkUrl: post.url,
        };
      }));
      profilePatch = { videoCount: videos.length };
    }
    if (account.platform === 'tiktok') {
      const [profile, items] = await Promise.all([getTikTokUser(accessToken), getTikTokVideos(accessToken, maxResults)]);
      videos = items;
      profilePatch = { title: profile.displayName, handle: profile.displayName, avatarUrl: profile.avatarUrl || account.avatarUrl,
        followerCount: profile.followerCount, videoCount: profile.videoCount, likeCount: profile.likeCount };
    }
    if (account.platform === 'facebook') {
      const [profile, items] = await Promise.all([
        getFacebookPage(accessToken, graphVersion(), account.providerAccountId),
        getFacebookVideos(account.providerAccountId, accessToken, graphVersion(), maxResults),
      ]);
      videos = items;
      profilePatch = { title: profile.name, handle: profile.name, avatarUrl: profile.pictureUrl || account.avatarUrl, followerCount: profile.fanCount || 0 };
    }
    if (account.platform === 'instagram') {
      const [profile, items] = await Promise.all([
        getInstagramAccount(account.providerAccountId, accessToken, graphVersion()),
        getInstagramMedia(account.providerAccountId, accessToken, graphVersion(), maxResults),
      ]);
      videos = items;
      profilePatch = { title: profile.username, handle: `@${profile.username}`, avatarUrl: profile.profilePictureUrl || account.avatarUrl,
        followerCount: profile.followersCount, videoCount: profile.mediaCount };
    }
    const capturedAt = new Date().toISOString();
    await Promise.all((videos as Array<Record<string, unknown>>).map(video => {
      const metrics = normalizeMetricValues({
        likes: video.likeCount,
        comments: video.commentCount,
        ...(account.platform !== 'instagram' ? { views: video.viewCount } : {}),
        ...(account.platform === 'tiktok' || account.platform === 'linkedin' ? { shares: video.shareCount } : {}),
      });
      // Instagram media listing does not return plays, and Facebook listing does
      // not return shares. Omit unavailable metrics instead of writing fake zeroes.
      return saveSocialMetricSnapshot({
        tenantId,
        platform: account.platform,
        accountId: account.id,
        contentId: String(video.id || ''),
        valueKind: 'cumulative',
        metrics,
        rawMetrics: {
          source: account.platform === 'linkedin' ? 'linkedin_registered_content' : 'platform_video_list',
          ...(account.platform === 'linkedin' ? { coverage: 'registered_content_only' } : {}),
        },
      });
    }));
    const knownViews = (videos as Array<Record<string, unknown>>).reduce((sum, video) => sum + (typeof video.viewCount === 'number' ? video.viewCount : 0), 0);
    const knownLikes = (videos as Array<Record<string, unknown>>).reduce((sum, video) => sum + (typeof video.likeCount === 'number' ? video.likeCount : 0), 0);
    await store.update(COL, account.id, {
      ...profilePatch,
      videoCount: Math.max(Number(profilePatch.videoCount ?? account.videoCount ?? 0), videos.length),
      viewCount: Math.max(Number(account.viewCount || 0), knownViews),
      likeCount: Math.max(Number(profilePatch.likeCount ?? account.likeCount ?? 0), knownLikes),
      lastSyncAt: capturedAt,
      status: 'connected',
    });
    res.json({ videos });
  } catch (error: any) {
    console.error(`${account.platform} videos error:`, error?.response?.data ?? error?.message ?? error);
    if ([401, 403].includes(Number(error?.response?.status))) await store.update(COL, account.id, { status: 'expired' });
    else await store.update(COL, account.id, { status: 'error' });
    res.status(error?.response?.status || 500).json({ error: readableSocialError(error) });
  }
});

socialRouter.get('/accounts/:id/video/:videoId/comments', async (req, res) => {
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const maxResults = Number(req.query.maxResults ?? 50);
  try {
    let comments: unknown[] = []; const accessToken = socialAccessToken(account as unknown as Record<string, unknown>);
    if (account.platform === 'tiktok') {
      res.status(501).json({ error: 'TikTok 评论读取需要额外 API 权限，当前暂未开放' });
      return;
    }
    if (account.platform === 'facebook') comments = await getFacebookComments(req.params.videoId, accessToken, graphVersion(), maxResults);
    if (account.platform === 'instagram') comments = await getInstagramComments(req.params.videoId, accessToken, graphVersion(), maxResults);
    if (account.platform === 'linkedin') comments = await getLinkedInComments({ accessToken, postId: req.params.videoId, count: maxResults });
    res.json({ comments, total: comments.length });
  } catch (error: any) {
    console.error(`${account.platform} comments error:`, error?.response?.data ?? error?.message ?? error);
    res.status(error?.response?.status || 500).json({ error: readableSocialError(error) });
  }
});

socialRouter.post('/accounts/:id/upload', async (req, res) => {
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.status !== 'connected') {
    res.status(400).json({ error: 'Account is not connected' });
    return;
  }
  const body = req.body as SocialUploadInput & { imagePaths?: string[]; videoPath?: string; projectId?: string; generationVersionId?: string; ratio?: string; contentId?: string; language?: string; trackWaLink?: boolean; generationKind?: 'script' | 'poster'; generationProvenance?: string; qualityStatus?: string; publishable?: boolean; generationRecordId?: string; sourceKind?: 'project' | 'manual_upload'; sourceVideoPath?: string; enterpriseFactVersion?: string; copyAudit?: PublishToAccountInput['copyAudit'] };
  if (!body.title || (!body.videoPath && !body.videoUrl && !body.imagePaths?.length)) {
    res.status(400).json({ error: 'title and videoPath/videoUrl/imagePaths are required' });
    return;
  }
  try {
    const result = await publishVideoToAccount({
      tenantId: account.tenantId,
      accountId: account.id,
      platform: account.platform,
      videoPath: body.videoPath,
      videoUrl: body.videoUrl,
      imagePaths: body.imagePaths,
      title: body.title,
      description: body.description,
      privacyStatus: body.privacyStatus,
      projectId: body.projectId,
      generationVersionId: body.generationVersionId,
      ratio: body.ratio,
      contentId: body.contentId,
      language: body.language,
      trackWaLink: body.trackWaLink,
      generationKind: body.generationKind, generationProvenance: body.generationProvenance,
      qualityStatus: body.qualityStatus, publishable: body.publishable, generationRecordId: body.generationRecordId,
      sourceKind: body.sourceKind, sourceVideoPath: body.sourceVideoPath,
      enterpriseFactVersion: body.enterpriseFactVersion, copyAudit: body.copyAudit,
    });
    const response = socialUploadHttpResponse(result);
    res.status(response.statusCode).json(response.body);
  } catch (error: any) {
    console.error(`${account.platform} upload error:`, error?.response?.data ?? error?.message ?? error);
    const status = error?.statusCode || error?.response?.status || 500;
    res.status(status).json({ ok: false, error: readableSocialError(error) });
  }
});

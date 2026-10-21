import {createMessengerCapabilityScope} from '../messenger/capabilityAuthority.js';
import { oauthClientIdentityHash } from '../lib/oauthNonceStore.js';
import type { Request } from 'express';
import { store } from '../storage/index.js';
import {
  exchangeMetaCode,
  exchangeInstagramLoginCode,
  exchangeTikTokCode,
  getInstagramLoginAccount,
  getMetaBusinessPages,
  getMetaPages,
  getTikTokUser,
  type SocialPlatform,
} from '../integrations/social.js';
import {
  exchangeLinkedInCode,
  getLinkedInAdminOrganizations,
  getLinkedInProfile,
  linkedInAuthorUrn,
  linkedInOAuthScopes,
  linkedInOrganizationPublishingEnabled,
} from '../integrations/linkedin.js';
import {
  advancedManualConnectEnabled as readAdvancedManualConnectEnabled,
  getTenantAwareMetaOAuthClient,
  getTenantAwareTikTokOAuthClient,
  getTenantAwareInstagramOAuthClient,
  getTenantAwareLinkedInOAuthClient,
} from '../lib/oauthConfig.js';
import { sealedSocialCredentialPatch, socialAccessToken } from '../lib/accountCredentials.js';
import { metaOAuthScopes } from '../lib/socialOAuthScopes.js';
import { connectMessengerPageCapability } from '../integrations/messenger.js';
import { subscribeInstagramAccount } from '../integrations/instagramWebhook.js';

export const COL = 'social_accounts';

export const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const META_AUTH_URL = 'https://www.facebook.com';
export const INSTAGRAM_AUTH_URL = 'https://www.instagram.com/oauth/authorize';
export const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';

export interface PendingOAuthState {
  userId: string;
  tenantId: string;
  platform: SocialPlatform;
  returnTo: string;
  expiresAt: number;
  purpose?: 'messenger';
  clientHash?: string;
  redirectUri?: string;
}

export interface SocialAccountRecord {
  id: string;
  tenantId: string;
  userId: string;
  platform: SocialPlatform;
  providerAccountId: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  scope?: string;
  oauthProvider?: 'instagram_login' | 'facebook_login' | 'linkedin_oidc';
  parentPageId?: string;
  parentPageName?: string;
  followerCount: number;
  videoCount: number;
  viewCount: number;
  likeCount: number;
  connectedAt: string;
  lastSyncAt?: string;
  status: 'connected' | 'error' | 'expired';
  messengerSubscribed?: boolean;
  messengerSubscriptionError?: string;
  instagramWebhookSubscribed?: boolean;
  instagramWebhookSubscriptionError?: string;
}


export function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

export async function getTikTokClient(tenantId?: string) {
  return getTenantAwareTikTokOAuthClient(tenantId);
}

export async function getMetaClient(tenantId?: string) {
  return getTenantAwareMetaOAuthClient(tenantId);
}

export async function getInstagramClient(tenantId?: string) {
  return getTenantAwareInstagramOAuthClient(tenantId);
}

export async function getLinkedInClient(tenantId?: string) {
  return getTenantAwareLinkedInOAuthClient(tenantId);
}

export function advancedManualConnectEnabled() {
  return readAdvancedManualConnectEnabled();
}

export function isPlatform(value: string): value is SocialPlatform {
  return value === 'tiktok' || value === 'instagram' || value === 'facebook' || value === 'linkedin';
}

export function getPublicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

export function redirectUri(req: Request, platform: SocialPlatform) {
  return `${getPublicOrigin(req)}/api/overseas/social/oauth/${platform}/callback`;
}

export function normalizeReturnTo(value: unknown) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed.slice(0, 300);
}


export function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function callbackHtml(input: {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
  platform: SocialPlatform;
}) {
  const payload = {
    source: 'overseas-workbench',
    type: 'social-oauth',
    platform: input.platform,
    status: input.ok ? 'success' : 'error',
    message: input.message,
  };
  const separator = input.returnTo.includes('?') ? '&' : '?';
  const fallbackUrl = `${input.returnTo}${separator}${input.platform}_oauth=${input.ok ? 'connected' : 'error'}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(input.title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #64748b; line-height: 1.6; font-size: 14px; }
    a { display: inline-flex; margin-top: 18px; color: #dc2626; font-weight: 700; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(input.title)}</h1>
    <p>${htmlEscape(input.message)}</p>
    <a href="${htmlEscape(fallbackUrl)}">返回应用</a>
  </main>
  <script>
    const payload = ${scriptSafeJson(payload)};
    const fallbackUrl = ${scriptSafeJson(fallbackUrl)};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, "*");
        window.close();
      } else {
        setTimeout(() => window.location.replace(fallbackUrl), 900);
      }
    } catch {
      setTimeout(() => window.location.replace(fallbackUrl), 900);
    }
  </script>
</body>
</html>`;
}

export function readableSocialError(error: any) {
  const data = error?.response?.data;
  const message = data?.error?.message || data?.error_description || data?.message || error?.message;
  const lower = String(message || '').toLowerCase();
  if (data?.error === 'invalid_grant') return '授权已过期或授权码无效，请重新连接账号。';
  if (lower.includes('session has expired')) {
    return 'Meta Access Token 已过期，请重新生成一个新的 token 后再保存。Graph API Explorer 里生成的临时 token 通常很快会过期。';
  }
  if (lower.includes('error validating access token')) {
    return 'Meta Access Token 无效或已过期，请重新生成 token，并确认勾选了 Page / Instagram 相关权限。';
  }
  if (lower.includes('permission') || lower.includes('permissions') || lower.includes('scope')) {
    if (lower.includes('tiktok') || lower.includes('video.publish') || lower.includes('content posting')) {
      return 'TikTok 发布权限暂不可用。请检查平台应用权限配置后重新连接账号。';
    }
    if (lower.includes('linkedin') || lower.includes('w_member_social') || lower.includes('w_organization_social')) {
      return 'LinkedIn 发布权限不足。个人账号需要 w_member_social；企业主页还需要通过 Community Management API 审核并授予主页发布权限。';
    }
    return '平台授权权限不足。请重新连接账号，并确认 Meta 应用已开通 pages_manage_posts / instagram_content_publish 等发布权限。';
  }
  if (lower.includes('unsupported post request') || lower.includes('object does not exist')) {
    return 'Meta 没有找到可发布的 Page 或 Instagram 专业账号。请确认发布目标是 Facebook Page，且 Instagram 已绑定到该 Page。';
  }
  if (lower.includes('invalid parameter') && lower.includes('video')) {
    return '平台无法读取这个视频。Instagram 需要公网可访问的视频 URL，请确认 R2_PUBLIC_URL 可以直接访问生成的视频文件。';
  }
  if (lower.includes('media id is not available')) {
    return 'Instagram 视频还在处理，系统已更新为等待处理完成后再发布。请稍后重新发布一次。';
  }
  if (lower.includes('socket hang up') || lower.includes('econnreset')) {
    return 'Facebook 上传连接被中断。系统已改用更稳定的 Facebook 视频上传接口，请稍后重新发布一次。';
  }
  if (String(message || '').includes('R2 credentials')) return 'Instagram 发布本地视频需要先配置 R2 公网存储。';
  return message || '社交平台请求失败';
}

export async function upsertSocialAccount(data: Omit<SocialAccountRecord, 'id' | 'connectedAt' | 'lastSyncAt' | 'status'>) {
  const existing = await store.list<SocialAccountRecord>(COL, {
    where: { tenantId: data.tenantId, platform: data.platform, providerAccountId: data.providerAccountId },
    perPage: 1,
  });
  const now = new Date().toISOString();
  const payload = {
    ...data, ...sealedSocialCredentialPatch({ accessToken: data.accessToken, refreshToken: data.refreshToken }),
    connectedAt: existing.items[0]?.connectedAt || now,
    lastSyncAt: now,
    status: 'connected' as const,
  };
  if (existing.items[0]) {
    await store.update(COL, existing.items[0].id, payload);
    return { ...existing.items[0], ...payload };
  }
  const created = await store.create<SocialAccountRecord>(COL, payload);
  if (!created) throw new Error('保存社交账号失败');
  return created;
}

export function publicSocialAccount(a: SocialAccountRecord) {
  const instagramMessagingReady = a.platform === 'instagram'
    && a.status === 'connected'
    && a.oauthProvider === 'instagram_login'
    && String(a.scope || '').split(',').includes('instagram_business_manage_messages')
    && Date.parse(a.tokenExpiresAt || '') > Date.now()
    && a.instagramWebhookSubscribed === true;
  return {
    id: a.id,
    platform: a.platform,
    providerAccountId: a.providerAccountId,
    title: a.title,
    handle: a.handle,
    avatarUrl: a.avatarUrl,
    parentPageId: a.parentPageId,
    parentPageName: a.parentPageName,
    followerCount: a.followerCount,
    videoCount: a.videoCount,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    connectedAt: a.connectedAt,
    lastSyncAt: a.lastSyncAt,
    status: a.status,
    oauthProvider: a.oauthProvider || (a.platform === 'instagram' ? 'facebook_login' : undefined),
    messengerSubscribed: a.messengerSubscribed === true,
    messengerSubscriptionError: a.messengerSubscriptionError || '',
    instagramMessagingReady,
    instagramApiMode: a.platform === 'instagram' ? (a.oauthProvider || 'facebook_login') : undefined,
    instagramLegacyContentReady: a.platform === 'instagram' && a.oauthProvider !== 'instagram_login',
    instagramWebhookSubscribed: a.instagramWebhookSubscribed === true,
    instagramWebhookSubscriptionError: a.instagramWebhookSubscriptionError || '',
    linkedinOwnerType: a.platform === 'linkedin' && String(a.parentPageId || '').startsWith('urn:li:organization:') ? 'organization' : a.platform === 'linkedin' ? 'member' : undefined,
    linkedinAuthorUrn: a.platform === 'linkedin' ? linkedInAuthorUrn(a) : undefined,
  };
}

export function bodyText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getAvailableMetaPages(accessToken: string) {
  const graph = graphVersion();
  const results = await Promise.allSettled([
    getMetaPages(accessToken, graph),
    getMetaBusinessPages(accessToken, graph),
  ]);
  const pages = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const seen = new Set<string>();
  return pages.filter(page => {
    if (!page.id || seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

export async function assertTenantMessengerPageOwnership(tenantId:string,pageId:string) {
  let count=0;
  for(let page=1;page<=1000;page++) {
    const owners=await store.list<SocialAccountRecord>(COL,{where:{platform:'facebook',providerAccountId:pageId},page,perPage:250});
    if(owners.items.some(owner=>owner.tenantId!==tenantId)) throw Error('messenger_native_page_owned_by_foreign_tenant');
    count+=owners.items.length;if(count===owners.totalItems)break;
    if(!owners.items.length||count>owners.totalItems||page===1000)throw Error('messenger_native_page_ownership_incomplete');
  }
}
export async function admitTenantMessengerPage(tenantId:string,pageId:string,pageAccessToken:string) {
  await assertTenantMessengerPageOwnership(tenantId,pageId);
  const client=await getTenantAwareMetaOAuthClient(tenantId);
  if(!client)throw Error('messenger_tenant_app_missing');
  const capability=await connectMessengerPageCapability({pageId,pageAccessToken,...client});
  const currentClient=await getTenantAwareMetaOAuthClient(tenantId);
  if(!currentClient||currentClient.appId!==client.appId||currentClient.appSecret!==client.appSecret)throw Error('messenger_tenant_app_changed');
  return capability;
}

export async function assertMessengerAccountVersion(account:SocialAccountRecord,pageId:string,pageAccessToken:string) {
  const current=await store.getById<SocialAccountRecord>(COL,account.id);
  if(!current||current.tenantId!==account.tenantId||current.platform!=='facebook'||current.status!=='connected'||current.providerAccountId!==pageId||socialAccessToken({accessToken:current.accessToken})!==pageAccessToken)throw Error('messenger_account_changed');
}

export async function saveFacebookPageFromMeta(input: {
  tenantId: string;
  userId: string;
  page: Awaited<ReturnType<typeof getMetaPages>>[number];
  purpose?: 'messenger';
}) {
  await assertTenantMessengerPageOwnership(input.tenantId,input.page.id);
  const account = await upsertSocialAccount({
    tenantId: input.tenantId,
    userId: input.userId,
    platform: 'facebook',
    providerAccountId: input.page.id,
    title: input.page.name,
    handle: input.page.name,
    avatarUrl: input.page.pictureUrl || '',
    accessToken: input.page.accessToken,
    refreshToken: '',
    tokenExpiresAt: '',
    scope: metaOAuthScopes(input.purpose || 'facebook').filter(scope => !['pages_messaging','pages_manage_metadata'].includes(scope)).join(','),
    messengerSubscribed: false,
    parentPageId: input.page.id,
    parentPageName: input.page.name,
    followerCount: input.page.fanCount || 0,
    videoCount: 0,
    viewCount: 0,
    likeCount: 0,
  });
  try {
    const capability=await admitTenantMessengerPage(input.tenantId,input.page.id,input.page.accessToken);
    await assertMessengerAccountVersion(account,input.page.id,input.page.accessToken);
    const capabilityScope=createMessengerCapabilityScope({tenantId:input.tenantId,accountId:account.id,pageId:input.page.id,appId:capability.appId,accessToken:input.page.accessToken,grantedScopes:capability.grantedScopes,validUntil:capability.validUntil});
    if(!await store.update(COL, account.id, { messengerSubscribed: true, messengerSubscriptionError: '', scope: capabilityScope })) throw Error('messenger_capability_persist_failed');
    return { ...account, messengerSubscribed: true, messengerSubscriptionError: '', scope: capabilityScope };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Messenger webhook subscription failed';
    await store.update(COL, account.id, { messengerSubscribed: false, messengerSubscriptionError: message });
    return { ...account, messengerSubscribed: false, messengerSubscriptionError: message };
  }
}

export async function saveInstagramFromMeta(input: {
  tenantId: string;
  userId: string;
  page: Awaited<ReturnType<typeof getMetaPages>>[number];
}) {
  if (!input.page.instagram) return null;
  return upsertSocialAccount({
    tenantId: input.tenantId,
    userId: input.userId,
    platform: 'instagram',
    providerAccountId: input.page.instagram.id,
    title: input.page.instagram.username,
    handle: `@${input.page.instagram.username}`,
    avatarUrl: input.page.instagram.profilePictureUrl || '',
    accessToken: input.page.accessToken,
    refreshToken: '',
    tokenExpiresAt: '',
    scope: metaOAuthScopes('instagram').join(','),
    oauthProvider: 'facebook_login',
    instagramWebhookSubscribed: false,
    instagramWebhookSubscriptionError: '',
    parentPageId: input.page.id,
    parentPageName: input.page.name,
    followerCount: input.page.instagram.followersCount || 0,
    videoCount: input.page.instagram.mediaCount || 0,
    viewCount: 0,
    likeCount: 0,
  });
}

export async function connectTikTok(pending: PendingOAuthState, code: string, req: Request) {
  const client = await getTikTokClient(pending.tenantId);
  if (!client || oauthClientIdentityHash(client) !== pending.clientHash) throw new Error('oauth_tenant_client_changed');
  if (!client) throw new Error('TikTok 一键授权暂未开启，请联系服务顾问配置平台应用和回调地址。');
  const tokens = await exchangeTikTokCode({ ...client, code, redirectUri: redirectUri(req, 'tiktok') });
  const user = await getTikTokUser(tokens.accessToken);
  await upsertSocialAccount({
    tenantId: pending.tenantId,
    userId: pending.userId,
    platform: 'tiktok',
    providerAccountId: user.openId,
    title: user.displayName,
    handle: user.displayName,
    avatarUrl: user.avatarUrl || '',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : '',
    scope: tokens.scope || '',
    parentPageId: '',
    parentPageName: '',
    followerCount: user.followerCount || 0,
    videoCount: user.videoCount || 0,
    viewCount: 0,
    likeCount: user.likeCount || 0,
  });
}

export async function connectInstagramLogin(pending: PendingOAuthState, code: string, req: Request) {
  const client = await getInstagramClient(pending.tenantId);
  if (!client || oauthClientIdentityHash(client) !== pending.clientHash) throw new Error('oauth_tenant_client_changed');
  if (!client) throw new Error('Instagram 一键授权尚未配置 Instagram App ID 和 App Secret。');
  const tokens = await exchangeInstagramLoginCode({
    ...client,
    code,
    redirectUri: redirectUri(req, 'instagram'),
  });
  if (!tokens.permissions.includes('instagram_business_manage_messages')) {
    throw new Error('Instagram 未授予私信权限，请重新授权并允许消息访问。');
  }
  const account = await getInstagramLoginAccount(tokens.accessToken, graphVersion());
  // /me resolves the account represented by the exchanged access token. Its
  // Graph ID can differ from the user_id returned by Instagram's OAuth endpoint.
  const saved = await upsertSocialAccount({
    tenantId: pending.tenantId,
    userId: pending.userId,
    platform: 'instagram',
    providerAccountId: account.id,
    title: account.username,
    handle: `@${account.username}`,
    avatarUrl: account.profilePictureUrl || '',
    accessToken: tokens.accessToken,
    refreshToken: '',
    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    scope: tokens.permissions.join(','),
    oauthProvider: 'instagram_login',
    instagramWebhookSubscribed: false,
    instagramWebhookSubscriptionError: '',
    parentPageId: '',
    parentPageName: '',
    followerCount: account.followersCount || 0,
    videoCount: account.mediaCount || 0,
    viewCount: 0,
    likeCount: 0,
  });
  try {
    await subscribeInstagramAccount({ accountId: account.id, accessToken: tokens.accessToken });
    await store.update(COL, saved.id, { instagramWebhookSubscribed: true, instagramWebhookSubscriptionError: '' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagram webhook subscription failed';
    await store.update(COL, saved.id, { instagramWebhookSubscribed: false, instagramWebhookSubscriptionError: message });
  }
}

export async function connectMeta(pending: PendingOAuthState, code: string, req: Request) {
  const client = await getMetaClient(pending.tenantId);
  if (!client || oauthClientIdentityHash(client) !== pending.clientHash) throw new Error('oauth_tenant_client_changed');
  if (!client) throw new Error('Meta 一键授权暂未开启，请联系服务顾问配置平台应用和回调地址。');
  const userToken = await exchangeMetaCode({
    appId: client.appId,
    appSecret: client.appSecret,
    code,
    redirectUri: redirectUri(req, pending.platform),
    graphVersion: graphVersion(),
  });
  const pages = await getAvailableMetaPages(userToken);
  let saved = 0;
  for (const page of pages) {
    if (pending.platform === 'facebook') {
      await saveFacebookPageFromMeta({ tenantId: pending.tenantId, userId: pending.userId, page, purpose: pending.purpose });
      saved += 1;
    }
    if (pending.platform === 'instagram' && page.instagram) {
      await upsertSocialAccount({
        tenantId: pending.tenantId,
        userId: pending.userId,
        platform: 'instagram',
        providerAccountId: page.instagram.id,
        title: page.instagram.username,
        handle: `@${page.instagram.username}`,
        avatarUrl: page.instagram.profilePictureUrl || '',
        accessToken: page.accessToken,
        refreshToken: '',
        tokenExpiresAt: '',
        scope: metaOAuthScopes('instagram').join(','),
        oauthProvider: 'facebook_login',
        instagramWebhookSubscribed: false,
        instagramWebhookSubscriptionError: '',
        parentPageId: page.id,
        parentPageName: page.name,
        followerCount: page.instagram.followersCount || 0,
        videoCount: page.instagram.mediaCount || 0,
        viewCount: 0,
        likeCount: 0,
      });
      saved += 1;
    }
  }
  if (!saved) {
    if (!pages.length) {
      throw new Error(pending.platform === 'instagram'
        ? 'Meta 没有返回任何 Facebook Page。请在授权页点击“编辑访问权限”，勾选已绑定 Instagram 的 Page；如果没有弹出权限页，请先移除旧的 Business Integration 后重试。'
        : 'Meta 没有返回任何可管理的 Facebook Page。请在授权页点击“编辑访问权限”并勾选 Page；如果没有弹出权限页，请先移除旧的 Business Integration 后重试。');
    }
    const pageNames = pages.map(page => page.name).filter(Boolean).slice(0, 3).join('、');
    throw new Error(pending.platform === 'instagram'
      ? `Meta 返回了 ${pages.length} 个 Page（${pageNames || '未命名'}），但这些 Page 没有返回已绑定的 Instagram 专业账号。请确认 IG 是专业账号，并在该 Page 的 Linked accounts 里绑定 Instagram 后重新授权。`
      : `Meta 返回了 ${pages.length} 个 Page，但没有可保存的 Page Access Token。请重新授权并确认 pages_show_list / pages_read_engagement 权限已授权。`);
  }
}

export async function connectLinkedIn(pending: PendingOAuthState, code: string, req: Request) {
  const client = await getLinkedInClient(pending.tenantId);
  if (!client || oauthClientIdentityHash(client) !== pending.clientHash) throw new Error('oauth_tenant_client_changed');
  const tokens = await exchangeLinkedInCode({ ...client, code, redirectUri: redirectUri(req, 'linkedin') });
  const grantedScopes = tokens.scope || linkedInOAuthScopes().join(' ');
  const profile = await getLinkedInProfile(tokens.accessToken);
  const tokenExpiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : '';
  await upsertSocialAccount({
    tenantId: pending.tenantId,
    userId: pending.userId,
    platform: 'linkedin',
    providerAccountId: profile.id,
    title: profile.name,
    handle: '',
    avatarUrl: profile.pictureUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt,
    scope: grantedScopes,
    oauthProvider: 'linkedin_oidc',
    parentPageId: '',
    parentPageName: '',
    followerCount: 0,
    videoCount: 0,
    viewCount: 0,
    likeCount: 0,
  });
  if (!linkedInOrganizationPublishingEnabled()) return;
  const organizations = await getLinkedInAdminOrganizations(tokens.accessToken);
  for (const organization of organizations) {
    await upsertSocialAccount({
      tenantId: pending.tenantId,
      userId: pending.userId,
      platform: 'linkedin',
      providerAccountId: organization.id,
      title: organization.name,
      handle: organization.vanityName,
      avatarUrl: '',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt,
      scope: grantedScopes,
      oauthProvider: 'linkedin_oidc',
      parentPageId: organization.authorUrn,
      parentPageName: organization.name,
      followerCount: 0,
      videoCount: 0,
      viewCount: 0,
      likeCount: 0,
    });
  }
}

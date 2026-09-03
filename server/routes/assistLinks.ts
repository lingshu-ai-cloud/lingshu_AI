import { Router, type Request } from 'express';
import { requireAdminUser } from '../lib/demoAccounts.js';
import {
  getPublicOrigin,
  getTenantAwareGoogleOAuthClient,
  getTenantAwareMetaOAuthClient,
  getTenantAwareTikTokOAuthClient,
} from '../lib/oauthConfig.js';
import {
  claimAssistLink,
  findAssistLinkByRawToken,
  generateAssistLinkToken,
  oauthPlatformForAssistPlatform,
  publicAssistLinkStatus,
  recordAssistLinkAudit,
  type AssistLinkRecord,
  type AssistLinkPlatform,
} from '../lib/assistLinkCapability.js';
import { signOAuthState } from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';

export const assistLinksRouter = Router();

const COL = 'assist_links';
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const META_AUTH_URL = 'https://www.facebook.com';
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const ASSIST_TTL_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const META_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_read_user_content',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'read_insights',
];
const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'video.list',
  'video.publish',
];

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function platformParam(value: unknown): AssistLinkPlatform | null {
  const platform = bodyText(value);
  return platform === 'meta' || platform === 'google' || platform === 'tiktok' ? platform : null;
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function platformName(platform: AssistLinkPlatform) {
  if (platform === 'meta') return 'Meta / Facebook / Instagram';
  if (platform === 'google') return 'Google / YouTube';
  return 'TikTok';
}

async function findTenantUserId(tenantId: string) {
  const result = await store.list<Record<string, unknown>>('users', { where: { tenantId }, perPage: 1 });
  return bodyText(result.items[0]?.id) || `assist_${tenantId}`;
}

assistLinksRouter.post('/admin/assist-links', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const tenantId = bodyText(req.body?.tenantId);
  const platform = platformParam(req.body?.platform);
  if (!tenantId || !platform) {
    res.status(400).json({ error: 'tenantId_and_platform_required' });
    return;
  }

  const token = generateAssistLinkToken();
  const expiresAt = new Date(Date.now() + ASSIST_TTL_MS).toISOString();
  const record = await store.create<AssistLinkRecord>(COL, {
    token_hash: token.tokenHash,
    token_prefix: token.tokenPrefix,
    token_last4: token.tokenLast4,
    tenant_id: tenantId,
    platform,
    status: 'pending',
    expires_at: expiresAt,
    used_at: '',
    claimed_at: '',
    claim_expires_at: '',
    claim_nonce_hash: '',
    revoked_at: '',
    created_by: admin.userId,
    revision: 0,
  });
  if (!record) {
    res.status(500).json({ error: 'assist_link_create_failed' });
    return;
  }

  try {
    await recordAssistLinkAudit(record, 'assist_link.created', { actorUserId: admin.userId, actorEmail: admin.email });
  } catch (error) {
    await store.compareAndSet(COL, record.id, { status: 'pending', revision: 0 }, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revision: 1,
    }).catch(() => undefined);
    throw error;
  }

  // The raw capability appears exactly once: in this creation response URL.
  // Only its digest and a non-sensitive display hint are persisted.
  res.json({
    ok: true,
    link: `${getPublicOrigin(req)}/assist/${encodeURIComponent(token.rawToken)}`,
    tenantId,
    ...publicAssistLinkStatus(record),
  });
});

assistLinksRouter.get('/assist-links/:token', async (req, res) => {
  const token = bodyText(req.params.token);
  const record = token ? await findAssistLinkByRawToken(token) : null;
  if (!record) {
    res.status(404).json({ valid: false, error: 'not_found' });
    return;
  }
  res.json(publicAssistLinkStatus(record));
});

assistLinksRouter.post('/assist-links/:token/start', async (req, res) => {
  const token = bodyText(req.params.token);
  const record = token ? await findAssistLinkByRawToken(token) : null;
  if (!record) {
    res.status(410).json({ error: 'assist_link_invalid_or_expired' });
    return;
  }

  const tenantId = record.tenant_id;
  const oauthPlatform = oauthPlatformForAssistPlatform(record.platform);
  const googleClient = record.platform === 'google' ? await getTenantAwareGoogleOAuthClient(tenantId) : null;
  const tiktokClient = record.platform === 'tiktok' ? await getTenantAwareTikTokOAuthClient(tenantId) : null;
  const metaClient = record.platform === 'meta' ? await getTenantAwareMetaOAuthClient(tenantId) : null;
  if (record.platform === 'google' && !googleClient) {
    res.status(503).json({ error: 'google_oauth_not_configured' });
    return;
  }
  if (record.platform === 'tiktok' && !tiktokClient) {
    res.status(503).json({ error: 'tiktok_oauth_not_configured' });
    return;
  }
  if (record.platform === 'meta' && !metaClient) {
    res.status(503).json({ error: 'meta_oauth_not_configured' });
    return;
  }

  const claimed = await claimAssistLink(record);
  if (!claimed.ok) {
    if (claimed.reason === 'claim_in_progress' || claimed.reason === 'conflict') {
      res.status(409).json({ error: 'assist_link_in_progress' });
      return;
    }
    res.status(410).json({ error: 'assist_link_invalid_or_expired' });
    return;
  }

  try {
    await recordAssistLinkAudit(
      claimed.record,
      'assist_link.claimed',
      { metadata: { reclaimedExpiredClaim: claimed.reclaimedExpiredClaim } },
    );
  } catch (error) {
    await store.compareAndSet(COL, claimed.record.id, {
      status: 'claimed',
      revision: claimed.claim.revision,
      claim_nonce_hash: claimed.record.claim_nonce_hash || '',
    }, {
      status: 'pending',
      claimed_at: '',
      claim_expires_at: '',
      claim_nonce_hash: '',
      revision: claimed.claim.revision + 1,
    }).catch(() => undefined);
    throw error;
  }

  const userId = await findTenantUserId(tenantId);
  // The browser keeps the magic token in sessionStorage. OAuth state carries
  // only the durable record id + a short-lived claim nonce, never the token.
  const returnTo = '/assist/status?done=1';
  const oauthState = signOAuthState({
    userId,
    tenantId,
    platform: oauthPlatform,
    returnTo,
    expiresAt: Date.parse(claimed.record.claim_expires_at || ''),
    assist: claimed.claim,
  });

  if (record.platform === 'google') {
    const redirectUri = `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`;
    const url = new URL(GOOGLE_OAUTH_URL);
    url.searchParams.set('client_id', googleClient!.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', oauthState);
    res.json({ url: url.toString(), platform: record.platform, platformName: platformName(record.platform) });
    return;
  }

  if (record.platform === 'tiktok') {
    const redirectUri = `${getPublicOrigin(req)}/api/overseas/social/oauth/tiktok/callback`;
    const url = new URL(TIKTOK_AUTH_URL);
    url.searchParams.set('client_key', tiktokClient!.clientKey);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
    url.searchParams.set('state', oauthState);
    res.json({ url: url.toString(), platform: record.platform, platformName: platformName(record.platform) });
    return;
  }

  const redirectUri = `${getPublicOrigin(req)}/api/overseas/social/oauth/facebook/callback`;
  const url = new URL(`${META_AUTH_URL}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', metaClient!.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_SCOPES.join(','));
  url.searchParams.set('state', oauthState);
  url.searchParams.set('auth_type', 'rerequest');
  url.searchParams.set('return_scopes', 'true');
  res.json({ url: url.toString(), platform: record.platform, platformName: platformName(record.platform) });
});

// Kept as an explicit tombstone for stale clients. Anonymous callers can no
// longer mark a link complete; only a verified OAuth callback may consume it.
assistLinksRouter.post('/assist-links/:token/complete', (_req: Request, res) => {
  res.status(410).json({ error: 'assist_link_completion_is_callback_only' });
});

import { Router, type Response } from 'express';
import { writeAuditLog } from '../lib/auditLog.js';
import { pbListStrict } from '../storage/pb.js';
import {
  effectiveOAuthConfig,
  OAuthConfigUnavailableError,
  oauthCallbackUrls,
  getPublicOrigin,
  readOAuthConfig,
  writeOAuthConfig,
  type OAuthPlatform,
  type StoredOAuthConfig,
} from '../lib/oauthConfig.js';
import { requireInternalAdmin, requireAdminUser } from '../lib/demoAccounts.js';
import {
  getVideoAdminAlert,
  listVideoAdminAlerts,
} from '../lib/videoAdminAlerts.js';
import { attachManualVideoUploadAndQueue } from './videos.js';
import { listStyleAdoptionTrends } from '../knowledge/styleMemory.js';
import {
  decryptSecret,
  getTenantPlatformApp,
  listTenantPlatformApps,
  publicTenantPlatformApp,
  tenantWebhookUrl,
  upsertTenantPlatformApp,
  type TenantPlatformAppRecord,
  type TenantPlatform,
} from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';
import axios from 'axios';
import { listLocalTenants } from '../lib/localTenants.js';
import {
  deliveryProvisioningHidden,
} from '../starter198/deliveryProvisioning.js';
import { disconnectTenantPlatformAccounts } from '../lib/socialAccountCleanup.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { createAdminDeliveryStarterRouter } from './adminDeliveryStarter.js';
import { registerAdminAccountRoutes } from './adminAccountRoutes.js';
import {
  contentExecutionDefaults,
  listContentExecutionLimits,
  setContentExecutionLimit,
  type ContentExecutionLimitScope,
} from '../contentExecution/durableQueue.js';

export const adminRouter = Router();
adminRouter.use(requireInternalAdmin);

import { cachedAdminInspirationVideos, reconcileStoredVideoAlerts, enrichVideoAlerts, bodyText, type InspirationContentFormat } from './adminAlertSupport.js';

function platformParam(value: unknown): TenantPlatform | null {
  const platform = bodyText(value);
  return platform === 'meta' || platform === 'google' || platform === 'tiktok' || platform === 'wecom' ? platform : null;
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function publicPendingPlatformApp(req: Parameters<typeof publicTenantPlatformApp>[0], tenantId: string, platform: TenantPlatform) {
  return {
    id: '',
    tenantId,
    platform,
    appId: '',
    appSecret: '',
    appSecretSet: false,
    appSecretLength: 0,
    waConfigId: '',
    businessId: '',
    wabaId: '',
    phoneNumberId: '',
    waPublicNumber: '',
    pageId: '',
    igUserId: '',
    youtubeChannelId: '',
    webhookVerifyToken: '',
    webhookVerifyTokenSet: false,
    webhookVerifyTokenLength: 0,
    wecomEncodingAesKeySet: false,
    wecomEncodingAesKeyLength: 0,
    webhookUrl: platform === 'meta' || platform === 'wecom' ? tenantWebhookUrl(req, tenantId, platform) : '',
    oauthRedirectUri: platform === 'google'
      ? `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`
      : platform === 'tiktok'
        ? `${getPublicOrigin(req)}/api/overseas/social/oauth/tiktok/callback`
        : '',
    tokenType: 'user_60d',
    accessTokenSet: false,
    accessTokenLength: 0,
    tokenExpiresAt: '',
    status: 'pending',
    checklist: {},
    notes: '',
  };
}

export function adminTenantPlatformApp(
  req: Parameters<typeof publicTenantPlatformApp>[0],
  app: TenantPlatformAppRecord,
) {
  return { ...publicTenantPlatformApp(req, app), appSecret: '' };
}

function publicDeliveryTenant(req: Parameters<typeof publicTenantPlatformApp>[0], tenant: Record<string, any>, apps: Awaited<ReturnType<typeof listTenantPlatformApps>>) {
  const tenantId = String(tenant.id || tenant.tenantId || '');
  const name = String(tenant?.name || tenant?.companyName || tenant?.company || tenantId);
  const registeredEmail = String(tenant?.registeredEmail || '').trim();
  const subscriptionPlan = String(tenant?.subscriptionPlan || '').trim().toLowerCase();
  const subscriptionStatus = String(tenant?.subscriptionStatus || '').trim().toLowerCase();
  const accountType = subscriptionPlan === 'admin'
    ? 'admin'
    : subscriptionPlan === 'trial' || subscriptionStatus === 'trialing'
      ? 'trial'
      : subscriptionPlan === 'customer' || subscriptionPlan === 'delivery' || subscriptionStatus === 'pending_delivery'
        ? 'customer'
        : 'existing';
  const registrationState = tenant?.registeredAt || registeredEmail
    ? 'registered'
    : tenant?.inviteCode
      ? 'waiting_registration'
      : 'existing';
  const inviteParams = new URLSearchParams({
    invite: String(tenant?.inviteCode || ''),
    company: name,
  });
  return {
    tenantId,
    name,
    contactName: String(tenant?.contactName || tenant?.contact || ''),
    industry: String(tenant?.industry || ''),
    notes: String(tenant?.notes || ''),
    inviteCode: String(tenant?.inviteCode || ''),
    inviteUrl: tenant?.inviteCode ? `${getPublicOrigin(req)}/register?${inviteParams.toString()}` : '',
    registrationState,
    registeredEmail,
    subscriptionPlan,
    subscriptionStatus,
    accountType,
    apps: (['meta', 'google', 'tiktok', 'wecom'] as TenantPlatform[]).map(platform => {
      const app = apps.find(item => item.tenant_id === tenantId && item.platform === platform);
      return app ? adminTenantPlatformApp(req, app) : publicPendingPlatformApp(req, tenantId, platform);
    }),
  };
}

adminRouter.use(createAdminDeliveryStarterRouter({
  presentTenant: (req, tenant) => ({ ...publicDeliveryTenant(req, tenant, []), productProfile: 'starter_198' }),
}));

const DELIVERY_TEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readChecklist(app?: { last_checklist?: string }): Record<string, any> {
  try {
    const parsed = JSON.parse(bodyText(app?.last_checklist) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function passedRecently(checklist: Record<string, any>, id: string) {
  if (!checklist[id]) return false;
  const timestamp = bodyText(checklist[`${id}_at`]);
  if (!timestamp) return false;
  const passedAt = Date.parse(timestamp);
  return Number.isFinite(passedAt) && Date.now() - passedAt <= DELIVERY_TEST_MAX_AGE_MS;
}

function missingDeliveryRequirements(platform: TenantPlatform, app: any): string[] {
  const checklist = readChecklist(app);
  const appSecret = decryptSecret(app?.app_secret);
  const missing: string[] = [];
  if (!bodyText(app?.app_id)) missing.push(platform === 'wecom' ? '企业微信 CorpID' : platform === 'tiktok' ? 'TikTok Client Key' : 'App ID');
  if (!appSecret) missing.push(platform === 'wecom' ? '企业微信应用 Secret' : platform === 'tiktok' ? 'TikTok Client Secret' : 'App Secret');
  if (platform === 'meta') {
    if (!bodyText(app?.phone_number_id)) missing.push('Phone Number ID');
    if (!passedRecently(checklist, 'whatsapp_test_passed')) missing.push('WhatsApp 最近自检通过');
    if (!passedRecently(checklist, 'webhook_test_passed')) missing.push('Webhook 订阅最近自检通过');
  } else if (platform === 'google') {
    if (!passedRecently(checklist, 'google_test_passed')) missing.push('Google OAuth 最近自检通过');
  } else if (platform === 'tiktok') {
    if (!passedRecently(checklist, 'tiktok_test_passed')) missing.push('TikTok OAuth 最近自检通过');
  }
  if (platform === 'wecom') {
    const googleTestIndex = missing.findIndex(item => item.includes('Google OAuth'));
    if (googleTestIndex >= 0) missing.splice(googleTestIndex, 1);
    if (!bodyText(app?.business_id)) missing.push('企业微信 AgentId');
    if (!bodyText(app?.webhook_verify_token)) missing.push('企业微信回调 Token');
    if (!decryptSecret(app?.wecom_encoding_aes_key)) missing.push('企业微信 EncodingAESKey');
    if (!passedRecently(checklist, 'wecom_callback_verified')) missing.push('企业微信回调最近自检通过');
    if (!passedRecently(checklist, 'wecom_message_test_passed')) missing.push('企业微信消息最近自检通过');
  }
  return missing;
}

export function publicOAuthConfig(req: Parameters<typeof oauthCallbackUrls>[0], adminEmail: string) {
  const stored = readOAuthConfig();
  const effective = effectiveOAuthConfig(stored);
  return {
    admin: adminEmail,
    updatedAt: stored.updatedAt ?? null,
    disabledPlatforms: stored.disabledPlatforms ?? [],
    callbacks: oauthCallbackUrls(req),
    values: {
      youtubeOAuthClientId: effective.youtubeOAuthClientId,
      youtubeOAuthClientSecret: '',
      metaSocialAppId: effective.metaSocialAppId,
      metaSocialAppSecret: '',
      instagramAppId: effective.instagramAppId,
      instagramAppSecret: '',
      tiktokClientKey: effective.tiktokClientKey,
      tiktokClientSecret: '',
      linkedinClientId: effective.linkedinClientId,
      linkedinClientSecret: '',
      advancedManualConnectEnabled: effective.advancedManualConnectEnabled,
    },
    secretSet: {
      youtubeOAuthClientSecret: Boolean(effective.youtubeOAuthClientSecret),
      metaSocialAppSecret: Boolean(effective.metaSocialAppSecret),
      instagramAppSecret: Boolean(effective.instagramAppSecret),
      tiktokClientSecret: Boolean(effective.tiktokClientSecret),
      linkedinClientSecret: Boolean(effective.linkedinClientSecret),
    },
    secretLength: {
      youtubeOAuthClientSecret: effective.youtubeOAuthClientSecret.length,
      metaSocialAppSecret: effective.metaSocialAppSecret.length,
      instagramAppSecret: effective.instagramAppSecret.length,
      tiktokClientSecret: effective.tiktokClientSecret.length,
      linkedinClientSecret: effective.linkedinClientSecret.length,
    },
  };
}
function oauthConfigFailure(res: Response, error: unknown): void {
  const unavailable = error instanceof OAuthConfigUnavailableError;
  console.error('[oauth-config]', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  res.status(unavailable ? 503 : 500).json({ error: unavailable ? 'oauth_config_unavailable' : 'oauth_config_failed' });
}

function adminContentLimitValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('content_execution_limit_value_invalid');
  return parsed;
}

adminRouter.get('/content-execution-limits/:tenantId', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) { res.status(403).json({ error: 'admin_required' }); return; }
  const tenantId = bodyText(req.params.tenantId);
  if (!tenantId) { res.status(400).json({ error: 'tenant_id_required' }); return; }
  try {
    const limits = await listContentExecutionLimits(store, tenantId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ tenantId, defaults: contentExecutionDefaults(), limits });
  } catch (error) {
    console.error('[admin] content execution limits read failed', error instanceof Error ? error.message : error);
    res.status(503).json({ error: 'content_execution_limits_unavailable' });
  }
});

adminRouter.put('/content-execution-limits/:tenantId', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) { res.status(403).json({ error: 'admin_required' }); return; }
  const tenantId = bodyText(req.params.tenantId);
  if (!tenantId) { res.status(400).json({ error: 'tenant_id_required' }); return; }
  const fixed: Array<{ scope: ContentExecutionLimitScope; scopeKey: string; value: unknown }> = [
    { scope: 'tenant', scopeKey: '*', value: req.body?.tenantMaxRunning },
    { scope: 'account', scopeKey: '*', value: req.body?.accountDefaultMaxRunning },
    { scope: 'task_type', scopeKey: 'social_content_weekly', value: req.body?.weeklyMaxRunning },
    { scope: 'task_type', scopeKey: 'social_content_instant', value: req.body?.instantMaxRunning },
  ];
  const overrides = Array.isArray(req.body?.accountOverrides) ? req.body.accountOverrides : [];
  try {
    for (const item of [
      ...fixed,
      ...overrides.map((item: unknown) => {
        const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const accountId = bodyText(row.accountId);
        if (!accountId) throw new Error('content_execution_account_override_invalid');
        return { scope: 'account' as const, scopeKey: accountId, value: row.maxRunning };
      }),
    ]) {
      await setContentExecutionLimit({
        dataStore: store, tenantId, scope: item.scope, scopeKey: item.scopeKey,
        maxRunning: adminContentLimitValue(item.value), updatedBy: admin.userId,
      });
    }
    const limits = await listContentExecutionLimits(store, tenantId);
    await writeAuditLog({
      tenantId, actorUserId: admin.userId, actorEmail: admin.email,
      action: 'content_execution_limits.updated', targetType: 'tenant', targetId: tenantId,
      metadata: { limits: limits.map(item => ({ scope: item.scope, scopeKey: item.scopeKey, maxRunning: item.maxRunning })) },
    });
    res.json({ tenantId, defaults: contentExecutionDefaults(), limits });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'content_execution_limits_update_failed';
    const invalid = code.includes('_invalid');
    res.status(invalid ? 400 : 503).json({ error: invalid ? code : 'content_execution_limits_update_failed' });
  }
});

registerAdminAccountRoutes(adminRouter);

adminRouter.get('/video-alerts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const reconciliation = await reconcileStoredVideoAlerts();

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100) || 100));
  const includeResolved = req.query.includeResolved === 'true';
  const items = await enrichVideoAlerts(listVideoAdminAlerts(limit, includeResolved));
  const summary = items.reduce((counts, item) => {
    counts.total += 1;
    counts[item.accountType] += 1;
    return counts;
  }, { total: 0, trial: 0, customer: 0, admin: 0, unknown: 0 });

  res.json({ admin: admin.email, items, summary, reconciliation });
});

adminRouter.get('/inspiration-videos', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const perPage = Math.max(1, Math.min(100, Number(req.query.perPage || 20) || 20));
  const platform = bodyText(req.query.platform);
  const status = bodyText(req.query.status);
  const contentFormat: InspirationContentFormat = req.query.contentFormat === 'image' ? 'image' : 'video';
  const result = await cachedAdminInspirationVideos({
    page,
    perPage,
    platform: platform || undefined,
    status: status || undefined,
    contentFormat,
    search: bodyText(req.query.search) || undefined,
    crawlRange: bodyText(req.query.crawlRange) || 'all',
  });
  // Listing must stay read-only. Media repair and AI analysis used to be launched
  // here, so every dashboard refresh spawned more downloads/ffmpeg work and could
  // starve an explicit user-requested analysis.
  res.json({ admin: admin.email, ...result });
});

adminRouter.post('/video-alerts/:id/upload', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const alert = getVideoAdminAlert(req.params.id);
  if (!alert) {
    res.status(404).json({ error: 'video_alert_not_found' });
    return;
  }

  const body = req.body ?? {};
  const recordId = bodyText(body.recordId) || alert.recordId;
  if (recordId !== alert.recordId) {
    res.status(400).json({ error: 'record_id_mismatch' });
    return;
  }

  const videoBase64 = bodyText(body.videoBase64);
  if (!videoBase64) {
    res.status(400).json({ error: 'videoBase64_required' });
    return;
  }

  try {
    const result = await attachManualVideoUploadAndQueue({
      recordId: alert.recordId,
      videoBase64,
      mimeType: bodyText(body.mimeType) || 'video/mp4',
      filename: bodyText(body.filename) || 'manual-video.mp4',
      uploadedBy: admin.userId,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'manual_video_upload_failed' });
  }
});

adminRouter.get('/oauth-config', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(publicOAuthConfig(req, admin.email)); }
  catch (error) { oauthConfigFailure(res, error); }
});
adminRouter.put('/oauth-config', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req.body ?? {}; const stored = readOAuthConfig();
    const disabledPlatforms = new Set<OAuthPlatform>(stored.disabledPlatforms ?? []);
    const patch: Partial<StoredOAuthConfig> = {
      youtubeOAuthClientId: bodyText(body.youtubeOAuthClientId),
      metaSocialAppId: bodyText(body.metaSocialAppId),
      instagramAppId: bodyText(body.instagramAppId),
      tiktokClientKey: bodyText(body.tiktokClientKey),
      linkedinClientId: bodyText(body.linkedinClientId),
      advancedManualConnectEnabled: body.advancedManualConnectEnabled === true,
    };

    const youtubeSecret = bodyText(body.youtubeOAuthClientSecret);
    const metaSecret = bodyText(body.metaSocialAppSecret);
    const instagramSecret = bodyText(body.instagramAppSecret);
    const tiktokSecret = bodyText(body.tiktokClientSecret);
    const linkedinSecret = bodyText(body.linkedinClientSecret);
    if (youtubeSecret) patch.youtubeOAuthClientSecret = youtubeSecret;
    if (metaSecret) patch.metaSocialAppSecret = metaSecret;
    if (instagramSecret) patch.instagramAppSecret = instagramSecret;
    if (tiktokSecret) patch.tiktokClientSecret = tiktokSecret;
    if (linkedinSecret) patch.linkedinClientSecret = linkedinSecret;

    if (patch.youtubeOAuthClientId && youtubeSecret) disabledPlatforms.delete('youtube');
    if (patch.metaSocialAppId && metaSecret) disabledPlatforms.delete('meta');
    if (patch.instagramAppId && instagramSecret) disabledPlatforms.delete('instagram');
    if (patch.tiktokClientKey && tiktokSecret) disabledPlatforms.delete('tiktok');
    if (patch.linkedinClientId && linkedinSecret) disabledPlatforms.delete('linkedin');
    patch.disabledPlatforms = Array.from(disabledPlatforms);

    await writeOAuthConfig(patch);
    res.json(publicOAuthConfig(req, admin.email));
  } catch (error) { oauthConfigFailure(res, error); }
});

adminRouter.delete('/oauth-config/:platform', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  const platform = bodyText(req.params.platform) as OAuthPlatform;
  if (!['youtube', 'meta', 'instagram', 'tiktok', 'linkedin'].includes(platform)) {
    res.status(400).json({ error: 'invalid_oauth_platform' });
    return;
  }
  try {
    const stored = readOAuthConfig();
    const disabledPlatforms = new Set<OAuthPlatform>(stored.disabledPlatforms ?? []);
    disabledPlatforms.add(platform);
    const patch: Partial<StoredOAuthConfig> = {
      disabledPlatforms: Array.from(disabledPlatforms),
    };
    if (platform === 'youtube') {
      patch.youtubeOAuthClientId = '';
      patch.youtubeOAuthClientSecret = '';
    } else if (platform === 'meta') {
      patch.metaSocialAppId = '';
      patch.metaSocialAppSecret = '';
    } else if (platform === 'instagram') {
      patch.instagramAppId = '';
      patch.instagramAppSecret = '';
    } else if (platform === 'tiktok') {
      patch.tiktokClientKey = '';
      patch.tiktokClientSecret = '';
    } else {
      patch.linkedinClientId = '';
      patch.linkedinClientSecret = '';
    }
    const disconnectedAccounts = await disconnectTenantPlatformAccounts(admin.tenantId, platform);
    await writeOAuthConfig(patch);
    res.json({
      ok: true,
      platform,
      disconnectedAccounts,
      config: publicOAuthConfig(req, admin.email),
    });
  } catch (error) {
    oauthConfigFailure(res, error);
  }
});

adminRouter.get('/delivery/platform-apps', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  let tenants: { items: Record<string, any>[] } | undefined;
  let apps: TenantPlatformAppRecord[] | undefined;
  try {
    [tenants, apps] = await Promise.all([
      pbListStrict<Record<string, any>>('tenants', { perPage: 200 }),
      pbListStrict<TenantPlatformAppRecord>('tenant_platform_apps', { perPage: 500, sort: 'tenant_id' }).then(result => result.items),
    ]);
  } catch (error) {
    if (localFallbacksEnabled()) {
      tenants = { items: listLocalTenants() as unknown as Record<string, any>[] };
      apps = [];
    } else {
      const detail = error instanceof Error ? error.message : 'unknown_error';
      res.status(503).json({ error: 'tenants_unavailable', detail });
      return;
    }
  }
  if (!tenants || !apps) {
    res.status(503).json({ error: 'tenants_unavailable', detail: 'unknown_error' });
    return;
  }
  const tenantIds = new Set<string>([
    ...tenants.items.map(item => String(item.id || item.tenantId || '')).filter(Boolean),
    ...apps.map(app => app.tenant_id),
  ]);

  res.json({
    admin: admin.email,
    tenants: Array.from(tenantIds)
      .filter(tenantId => tenantId !== admin.tenantId)
      .filter(tenantId => {
        const tenant = tenants.items.find(item => item.id === tenantId || item.tenantId === tenantId);
        return !deliveryProvisioningHidden(tenant);
      })
      .map(tenantId => {
        const tenant = tenants.items.find(item => item.id === tenantId || item.tenantId === tenantId) || { id: tenantId, name: tenantId };
        return publicDeliveryTenant(req, tenant, apps);
      }),
  });
});

adminRouter.get('/style-adoption-trends', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.json({ admin: admin.email, items: await listStyleAdoptionTrends() });
});

adminRouter.put('/delivery/platform-apps/:tenantId/:platform', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const platform = platformParam(req.params.platform);
  if (!platform) {
    res.status(400).json({ error: 'invalid_platform' });
    return;
  }
  try {
    const app = await upsertTenantPlatformApp({
      tenantId: bodyText(req.params.tenantId),
      platform,
      appId: bodyText(req.body?.appId),
      appSecret: bodyText(req.body?.appSecret),
      waConfigId: bodyText(req.body?.waConfigId),
      businessId: bodyText(req.body?.businessId),
      wabaId: bodyText(req.body?.wabaId),
      phoneNumberId: bodyText(req.body?.phoneNumberId),
      waPublicNumber: bodyText(req.body?.waPublicNumber),
      pageId: bodyText(req.body?.pageId),
      igUserId: bodyText(req.body?.igUserId),
      youtubeChannelId: bodyText(req.body?.youtubeChannelId),
      webhookVerifyToken: bodyText(req.body?.webhookVerifyToken),
      wecomEncodingAesKey: bodyText(req.body?.wecomEncodingAesKey),
      tokenType: req.body?.tokenType === 'system_user_permanent' ? 'system_user_permanent' : 'user_60d',
      accessToken: bodyText(req.body?.accessToken),
      tokenExpiresAt: bodyText(req.body?.tokenExpiresAt),
      status: bodyText(req.body?.status) as any || 'pending',
      checklist: req.body?.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : undefined,
      notes: bodyText(req.body?.notes),
    });
    res.json({ ok: true, app: adminTenantPlatformApp(req, app) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'platform_app_save_failed' });
  }
});

adminRouter.post('/delivery/platform-apps/:tenantId/:platform/complete', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const platform = platformParam(req.params.platform);
  if (!platform) {
    res.status(400).json({ error: 'invalid_platform' });
    return;
  }
  const tenantId = bodyText(req.params.tenantId);
  const existing = await getTenantPlatformApp(tenantId, platform);
  const missing = missingDeliveryRequirements(platform, existing);
  if (!existing || missing.length > 0) {
    const message = `交付完成前还缺：${missing.join('、')}`;
    res.status(409).json({
      error: message,
      code: 'delivery_requirements_missing',
      missing,
      message,
    });
    return;
  }
  const app = await upsertTenantPlatformApp({
    tenantId,
    platform,
    status: 'active',
    notes: bodyText(req.body?.notes),
  });
  res.json({ ok: true, app: adminTenantPlatformApp(req, app) });
});

adminRouter.post('/delivery/platform-apps/:tenantId/:platform/test/:kind', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  const tenantId = bodyText(req.params.tenantId);
  const platform = platformParam(req.params.platform);
  const kind = bodyText(req.params.kind);
  if (!platform) {
    res.status(400).json({ ok: false, error: 'invalid_platform' });
    return;
  }

  const app = await getTenantPlatformApp(tenantId, platform);
  const token = decryptSecret(app?.access_token);
  const appSecret = decryptSecret(app?.app_secret);
  const markTestPassed = async (id: string) => {
    if (!app) return;
    await upsertTenantPlatformApp({
      tenantId,
      platform,
      checklist: {
        ...readChecklist(app),
        [id]: true,
        [`${id}_at`]: new Date().toISOString(),
      } as any,
    });
  };
  try {
    if (!app) throw new Error('请先保存该租户的平台应用配置');
    if (kind === 'pages') {
      if (platform !== 'meta') throw new Error('主页列表自检仅适用于 Meta');
      if (!token) throw new Error('请先录入访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/me/accounts`, {
        params: { access_token: token, fields: 'id,name', limit: 10 },
      });
      await markTestPassed('pages_test_passed');
      res.json({ ok: true, message: `已拉取 ${resp.data?.data?.length ?? 0} 个主页`, data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'webhook') {
      if (platform !== 'meta') throw new Error('Webhook 自检仅适用于 Meta');
      if (!app.app_id || !token) throw new Error('请先录入 App ID 和访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/${app.app_id}/subscriptions`, {
        params: { access_token: token },
      });
      await markTestPassed('webhook_test_passed');
      res.json({ ok: true, message: 'Webhook 订阅状态已返回', data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'whatsapp') {
      if (platform !== 'meta') throw new Error('WhatsApp 自检仅适用于 Meta');
      if (!token) throw new Error('请先录入 token');
      if (!app.phone_number_id && !app.wa_config_id) throw new Error('请先录入 Phone Number ID 或 WhatsApp Embedded Signup Config ID');
      await markTestPassed('whatsapp_test_passed');
      res.json({ ok: true, message: app.phone_number_id ? 'WhatsApp Phone Number ID 已保存，可继续真实发送测试。' : 'WhatsApp Config ID 已保存，可继续 Embedded Signup。' });
      return;
    }
    if (kind === 'google') {
      if (platform !== 'google') throw new Error('Google 自检仅适用于 Google');
      if (!app.app_id || !appSecret) throw new Error('请先录入 Google Client ID / Secret');
      await markTestPassed('google_test_passed');
      res.json({ ok: true, message: 'Google OAuth 应用信息已保存，等待用户授权验证。' });
      return;
    }
    if (kind === 'tiktok') {
      if (platform !== 'tiktok') throw new Error('TikTok 自检仅适用于 TikTok');
      if (!app.app_id || !appSecret) throw new Error('请先录入 TikTok Client Key / Secret');
      await markTestPassed('tiktok_test_passed');
      res.json({ ok: true, message: 'TikTok OAuth 应用信息已保存，等待客户授权验证。' });
      return;
    }
    if (kind === 'wecom_webhook') {
      if (platform !== 'wecom') throw new Error('企业微信回调自检仅适用于企业微信');
      if (!app.app_id || !bodyText(app.webhook_verify_token) || !decryptSecret(app.wecom_encoding_aes_key)) {
        throw new Error('请先录入 CorpID、回调 Token 和 EncodingAESKey');
      }
      await markTestPassed('wecom_callback_verified');
      res.json({ ok: true, message: '企业微信回调参数已保存，请到企业微信后台完成 URL 验证。' });
      return;
    }
    if (kind === 'wecom') {
      if (platform !== 'wecom') throw new Error('企业微信消息自检仅适用于企业微信');
      if (!app.app_id || !appSecret || !bodyText(app.business_id)) {
        throw new Error('请先录入 CorpID、应用 Secret 和 AgentId');
      }
      await markTestPassed('wecom_message_test_passed');
      res.json({ ok: true, message: '企业微信应用配置已保存；真实同步需要开通客户联系/会话内容存档后联调。' });
      return;
    }
    throw new Error('未知自检项');
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || '自检失败';
    res.status(400).json({ ok: false, error: msg });
  }
});

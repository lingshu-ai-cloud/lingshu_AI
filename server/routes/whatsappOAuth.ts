import axios from 'axios';
import { verifyWhatsAppTenantConnection } from '../whatsapp/connectionHealth.js';
import { Router, type Request, type Response } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { getTenantPlatformApp, publicTenantPlatformApp, signOAuthState, parseOAuthState } from '../lib/tenantPlatformApps.js';
import { issueOAuthNonce, consumeOAuthNonce, oauthClientIdentityHash } from '../lib/oauthNonceStore.js';
import { getPublicOrigin } from '../lib/oauthConfig.js';
import { assertVerifiedWhatsAppAssets } from '../whatsapp/assetAuthority.js';
import { resolveTenantWhatsAppConfig } from '../whatsapp/send.js';
import { whatsappPlatformConfig, WHATSAPP_PLATFORM_SECRET_REF, WHATSAPP_PLATFORM_WEBHOOK_PATH } from '../whatsapp/platformConfig.js';
import { assertWhatsAppAtomicStorage, connectWhatsAppTenant, disconnectWhatsAppTenant, WhatsAppOnboardingError } from '../whatsapp/onboarding.js';

export const whatsappOAuthRouter = Router();
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const clientHash = () => oauthClientIdentityHash(whatsappPlatformConfig());
function failure(res: Response, error: unknown) {
  const known = error instanceof WhatsAppOnboardingError;
  const provider = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
  console.warn('[whatsapp-onboarding]', { code: known ? error.code : 'whatsapp_onboarding_unavailable',
    providerCode: typeof provider?.code === 'number' ? provider.code : undefined,
    traceId: typeof provider?.fbtrace_id === 'string' ? provider.fbtrace_id : undefined });
  res.status(known ? error.status : 503).json({ error: known ? error.code : 'whatsapp_onboarding_unavailable',
    message: known ? error.code : 'WhatsApp 接入暂不可用，请重新开始授权。' });
}
whatsappOAuthRouter.use(requireAuth, enforceSupportSessionReadOnly);
whatsappOAuthRouter.use((req, res, next) => {
  const { tenantId } = res.locals as AuthLocals;
  const requested = text(req.body?.tenantId || req.query.tenantId);
  res.setHeader('Cache-Control', 'no-store');
  if (requested && requested !== tenantId) { res.status(403).json({ error: 'tenant_not_allowed' }); return; }
  next();
});
whatsappOAuthRouter.use(async (req, res, next) => {
  if (req.method === 'GET') { next(); return; }
  try {
    const role = await requestOrganizationRoleStrict(req.headers.authorization, (res.locals as AuthLocals).userId);
    if (!role || !['admin', 'super_admin'].includes(role)) { res.status(403).json({ error: 'whatsapp_admin_required' }); return; }
    next();
  } catch (error) { failure(res, error); }
});

whatsappOAuthRouter.get('/config', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const config = whatsappPlatformConfig();
    const app = await getTenantPlatformApp(tenantId, 'meta');
    let connected = false;
    try {
      if (app?.app_secret === WHATSAPP_PLATFORM_SECRET_REF && app.app_id === config.appId) {
        assertVerifiedWhatsAppAssets(app); resolveTenantWhatsAppConfig(tenantId, app); connected = true;
      }
    } catch { /* A saved record is not proof of a usable connection. */ }
    let storageReady = false;
    try { await assertWhatsAppAtomicStorage(); storageReady = true; } catch { /* Readiness only. */ }
    res.json({ tenantId, appId: config.appId, configId: config.configId, graphVersion: config.graphVersion,
      signupMode: config.signupMode, configured: config.configured, storageReady, connected, missing: config.missing,
      webhookUrl: `${getPublicOrigin(req)}${WHATSAPP_PLATFORM_WEBHOOK_PATH}`,
      account: app ? { phoneNumber: app.wa_public_number || '', phoneNumberId: app.phone_number_id || '',
        wabaId: app.waba_id || '', status: app.status || 'pending', tokenExpiresAt: app.token_expires_at || '',
        legacy: app.app_secret !== WHATSAPP_PLATFORM_SECRET_REF } : null });
  } catch (error) { failure(res, error); }
});

whatsappOAuthRouter.post('/session', async (_req, res) => {
  try {
    const config = whatsappPlatformConfig();
    if (!config.configured) throw new WhatsAppOnboardingError('whatsapp_platform_not_configured', 503);
    await assertWhatsAppAtomicStorage();
    const { tenantId, userId } = res.locals as AuthLocals;
    const expiresAt = Date.now() + 10 * 60_000;
    const state = signOAuthState({ tenantId, userId, platform: 'whatsapp', returnTo: '/', expiresAt });
    await issueOAuthNonce(state, { tenantId, userId, platform: 'whatsapp', expiresAt, clientHash: clientHash() });
    res.json({ state, expiresAt, tenantId });
  } catch (error) { failure(res, error); }
});

whatsappOAuthRouter.post('/exchange', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = res.locals as AuthLocals;
    const state = text(req.body?.state), parsed = parseOAuthState(state);
    const code = text(req.body?.code);
    const session = req.body?.sessionInfo;
    const wabaId = text(session?.waba_id), phoneNumberId = text(session?.phone_number_id);
    if (!code || code.length > 4096 || !/^\d{1,64}$/.test(wabaId) || !/^\d{1,64}$/.test(phoneNumberId))
      throw new WhatsAppOnboardingError('embedded_signup_session_info_incomplete', 400);
    if (!parsed || parsed.tenantId !== tenantId || parsed.userId !== userId || parsed.platform !== 'whatsapp'
      || !await consumeOAuthNonce(state, { tenantId, userId, platform: 'whatsapp', expiresAt: parsed.expiresAt, clientHash: clientHash() }))
      throw new WhatsAppOnboardingError('whatsapp_signup_session_invalid', 403);
    const app = await connectWhatsAppTenant({ tenantId, code, wabaId, phoneNumberId });
    res.json({ ok: true, app: publicTenantPlatformApp(req, app) });
  } catch (error) { failure(res, error); }
});
whatsappOAuthRouter.post('/disconnect', async (_req, res) => {
  try { await disconnectWhatsAppTenant((res.locals as AuthLocals).tenantId); res.json({ ok: true }); }
  catch (error) { failure(res, error); }
});

whatsappOAuthRouter.post('/verify', async (_req, res) => {
  try { res.json(await verifyWhatsAppTenantConnection((res.locals as AuthLocals).tenantId)); }
  catch (error) { failure(res, error); }
});

import axios from 'axios';
import { Router } from 'express';
import { store } from '../storage/index.js';
import { assertVerifiedWhatsAppAssets, whatsappAssetAuthorityHash } from '../whatsapp/assetAuthority.js';
import {
  decryptSecret,
  getTenantPlatformApp,
  publicTenantPlatformApp,
  upsertTenantPlatformApp,
} from '../lib/tenantPlatformApps.js';
import { getPhoneNumberInfo } from '../integrations/whatsapp.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';

export const whatsappOAuthRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function sessionData(input: any): Record<string, any> {
  const raw = input?.sessionInfo ?? input?.session_info ?? input?.data ?? {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function wabaIdFrom(input: any): string {
  const data = sessionData(input);
  return firstText(
    input?.wabaId,
    input?.waba_id,
    input?.wabaID,
    data?.waba_id,
    data?.wabaId,
    data?.wabaID,
    data?.business_account_id,
    data?.whatsapp_business_account_id,
  );
}

function phoneNumberIdFrom(input: any): string {
  const data = sessionData(input);
  return firstText(
    input?.phoneNumberId,
    input?.phone_number_id,
    input?.phoneNumberID,
    data?.phone_number_id,
    data?.phoneNumberId,
    data?.phoneNumberID,
    data?.phone_number?.id,
    data?.phone?.id,
  );
}

async function tenantForRequest(req: any, res: any): Promise<string | null> {
  const { tenantId } = res.locals as AuthLocals;
  const requestedTenantId = text(req.body?.tenantId || req.query?.tenantId);
  if (!requestedTenantId || requestedTenantId === tenantId) return tenantId;
  return null;
}

async function exchangeCodeForLongLivedToken(input: {
  appId: string;
  appSecret: string;
  code: string;
}): Promise<{ accessToken: string; expiresAt: string }> {
  const shortTokenResp = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    maxRedirects: 0, timeout: 15000,
    params: {
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
    },
  });
  const shortToken = text(shortTokenResp.data?.access_token);
  if (!shortToken) throw new Error('meta_code_exchange_returned_empty_token');

  const longTokenResp = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    maxRedirects: 0, timeout: 15000,
    params: {
      grant_type: 'fb_exchange_token',
      client_id: input.appId,
      client_secret: input.appSecret,
      fb_exchange_token: shortToken,
    },
  });
  const accessToken = text(longTokenResp.data?.access_token) || shortToken;
  const expiresIn = Number(longTokenResp.data?.expires_in || shortTokenResp.data?.expires_in || 60 * 24 * 3600);
  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

whatsappOAuthRouter.get('/config', requireAuth, async (req, res) => {
  const tenantId = await tenantForRequest(req, res);
  if (!tenantId) {
    res.status(403).json({ error: 'tenant_not_allowed' });
    return;
  }
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appId = text(app?.app_id);
  const configId = text(app?.wa_config_id);
  let verified = false;
  try { if (app) { assertVerifiedWhatsAppAssets(app); verified = true; } } catch { /* Configuration metadata remains observable; contents remain blocked. */ }
  res.json({
    tenantId,
    appId,
    configId,
    configured: Boolean(appId && configId && decryptSecret(app?.app_secret)),
    connected: Boolean(
      verified && app?.status === 'active'
      && text(app?.waba_id)
      && text(app?.phone_number_id)
      && decryptSecret(app?.access_token),
    ),
    missing: {
      appId: !appId,
      appSecret: !decryptSecret(app?.app_secret),
      configId: !configId,
    },
  });
});

whatsappOAuthRouter.post('/exchange', requireAuth, async (req, res) => {
  const tenantId = await tenantForRequest(req, res);
  if (!tenantId) {
    res.status(403).json({ error: 'tenant_not_allowed' });
    return;
  }

  const code = text(req.body?.code);
  const wabaId = wabaIdFrom(req.body);
  const phoneNumberId = phoneNumberIdFrom(req.body);
  if (!code) {
    res.status(400).json({ error: 'embedded_signup_code_required' });
    return;
  }
  if (!wabaId || !phoneNumberId) {
    res.status(400).json({ error: 'embedded_signup_session_info_incomplete' });
    return;
  }

  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appId = text(app?.app_id);
  const appSecret = decryptSecret(app?.app_secret);
  if (!appId || !appSecret) {
    res.status(409).json({ error: 'tenant_meta_app_not_configured' });
    return;
  }

  try {
    const token = await exchangeCodeForLongLivedToken({ appId, appSecret, code });
    const request = { headers: { Authorization: `Bearer ${token.accessToken}` }, maxRedirects: 0, timeout: 15000 };
    const debug = await axios.get(`https://graph.facebook.com/${graphVersion()}/debug_token`, {
      ...request, params: { input_token: token.accessToken, access_token: `${appId}|${appSecret}` },
    });
    const authority = debug.data?.data;
    if (authority?.is_valid !== true || String(authority.app_id) !== appId || !Array.isArray(authority.scopes)
      || !['whatsapp_business_management', 'whatsapp_business_messaging'].every(scope => authority.scopes.includes(scope))) throw Error('whatsapp_token_authority_invalid');
    const phones = await axios.get(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}/phone_numbers`, request);
    if (!Array.isArray(phones.data?.data) || phones.data.data.filter((phone: {id?: unknown}) => String(phone.id) === phoneNumberId).length !== 1) throw Error('whatsapp_asset_membership_invalid');
    const info = await getPhoneNumberInfo({ phoneNumberId, accessToken: token.accessToken, verifyToken: text(app?.webhook_verify_token) });
    if (String(info?.id) !== phoneNumberId) throw Error('whatsapp_phone_identity_invalid');
    const waPublicNumber = text(info?.display_phone_number || info?.phone_number).replace(/[^\d]/g, '');
    if (!waPublicNumber) throw Error('whatsapp_phone_number_missing');
    let ownershipCount = 0;
    for (let page = 1; page <= 1000; page++) {
      const owners = await store.list<import('../lib/tenantPlatformApps.js').TenantPlatformAppRecord>('tenant_platform_apps', { where: { platform: 'meta', phone_number_id: phoneNumberId }, page, perPage: 250 });
      if (owners.items.some(owner => owner.tenant_id !== tenantId)) throw Error('whatsapp_asset_owned_by_foreign_tenant');
      ownershipCount += owners.items.length;
      if (ownershipCount === owners.totalItems) break;
      if (!owners.items.length || ownershipCount > owners.totalItems || page === 1000) throw Error('whatsapp_asset_ownership_incomplete');
    }
    const subscribed = await axios.post(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}/subscribed_apps`, {}, request);
    if (subscribed.data?.success !== true) throw Error('whatsapp_subscription_not_confirmed');
    const current = await getTenantPlatformApp(tenantId, 'meta');
    if (!current || current.id !== app?.id || whatsappAssetAuthorityHash(current) !== whatsappAssetAuthorityHash(app)) throw Error('whatsapp_account_version_changed');
    const checklist = (() => {
      try {
        return JSON.parse(text(app?.last_checklist) || '{}');
      } catch {
        return {};
      }
    })();
    const updated = await upsertTenantPlatformApp({
      tenantId,
      platform: 'meta',
      wabaId,
      phoneNumberId,
      waPublicNumber: waPublicNumber || undefined,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
      tokenType: 'user_60d',
      status: 'active',
      checklist: {
        ...checklist,
        customer_scanned: true,
        whatsapp_embedded_signup_done: true,
      },
    });
    const proofChecklist = { ...checklist, customer_scanned: true, whatsapp_embedded_signup_done: true, whatsappAssetProof: { authorityHash: whatsappAssetAuthorityHash(updated), verifiedAt: new Date().toISOString() } };
    if (!await store.update('tenant_platform_apps', updated.id, { last_checklist: JSON.stringify(proofChecklist) })) throw Error('whatsapp_asset_proof_persist_failed');
    updated.last_checklist = JSON.stringify(proofChecklist);
    res.json({ ok: true, app: publicTenantPlatformApp(req, updated) });
  } catch (error: any) {
    res.status(502).json({
      error: 'whatsapp_exchange_failed',
      message: 'WhatsApp account verification failed',
    });
  }
});

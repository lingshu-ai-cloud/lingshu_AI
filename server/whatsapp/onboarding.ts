import { whatsappTokenExpiry } from './tokenAuthority.js';
import axios from 'axios';
import { createHash, randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { TenantPlatformAppRecord } from '../lib/tenantPlatformApps.js';
import { encryptSecret, getTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { withLegacyExternalEffectAllowed } from '../starter198/legacyEffectGuard.js';
import { WHATSAPP_PLATFORM_SECRET_REF, whatsappPlatformConfig } from './platformConfig.js';
import { whatsappAssetAuthorityHash } from './assetAuthority.js';

export class WhatsAppOnboardingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export async function assertWhatsAppAtomicStorage() {
  if (!await store.supportsAtomicOperationLease?.() || !await store.supportsAtomicCompareAndSwap?.() || !store.compareAndSwap)
    throw new WhatsAppOnboardingError('whatsapp_atomic_storage_required', 503);
}
/** Serializes binding mutations across all platform tenants, using the existing database unique lease. */
export async function withWhatsAppBindingLock<T>(action: (fence: () => Promise<void>) => Promise<T>) {
  await assertWhatsAppAtomicStorage();
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId: 'whatsapp-platform',
    scope: 'whatsapp-binding', subjectId: 'all', ownerId: randomUUID(), leaseDurationMs: 120_000 });
  if (!lease) throw new WhatsAppOnboardingError('whatsapp_binding_busy');
  try { return await action(() => assertDurableOperationLease({ dataStore: store, lease })); }
  finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}

export async function connectWhatsAppTenant(input: { tenantId: string; code: string; wabaId: string; phoneNumberId: string }) {
  const config = whatsappPlatformConfig();
  if (!config.configured) throw new WhatsAppOnboardingError('whatsapp_platform_not_configured', 503);
  return withLegacyExternalEffectAllowed(input.tenantId, guard => withWhatsAppBindingLock(async bindingFence => {
    const fence = async () => { await guard.beforeEffect(); await bindingFence(); };
    const existingRows = await store.list<TenantPlatformAppRecord>('tenant_platform_apps', {
      where: { tenant_id: input.tenantId, platform: 'meta' }, perPage: 2,
    });
    if (existingRows.totalItems !== existingRows.items.length || existingRows.totalItems > 1) throw new WhatsAppOnboardingError('whatsapp_account_ambiguous');
    const existing = existingRows.items[0] ? structuredClone(existingRows.items[0]) : null;
    if (existing?.app_id && existing.app_id !== config.appId)
      throw new WhatsAppOnboardingError('whatsapp_existing_meta_app_conflict');
    if (existing && existing.app_secret !== WHATSAPP_PLATFORM_SECRET_REF
      && (existing.page_id || existing.ig_user_id || (existing.access_token && !existing.phone_number_id)))
      throw new WhatsAppOnboardingError('whatsapp_existing_meta_app_conflict');
    if (existing?.phone_number_id && existing.phone_number_id !== input.phoneNumberId)
      throw new WhatsAppOnboardingError('whatsapp_number_change_requires_migration');
    if (existing?.waba_id && existing.waba_id !== input.wabaId)
      throw new WhatsAppOnboardingError('whatsapp_account_change_requires_migration');
    // This endpoint binds a business integration token directly; it never assumes a 60-day user token.
    await fence();
    const response = await axios.get(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`, {
      maxRedirects: 0, timeout: 15000,
      params: { client_id: config.appId, client_secret: config.appSecret, code: input.code },
    });
    const accessToken = typeof response.data?.access_token === 'string' ? response.data.access_token.trim() : '';
    if (!accessToken) throw new WhatsAppOnboardingError('whatsapp_token_missing', 502);
    const request = { headers: { Authorization: `Bearer ${accessToken}` }, maxRedirects: 0, timeout: 15000 };
    const debug = await axios.get(`https://graph.facebook.com/${config.graphVersion}/debug_token`, {
      ...request, params: { input_token: accessToken, access_token: `${config.appId}|${config.appSecret}` },
    });
    let expiresAt: string;
    try { expiresAt = whatsappTokenExpiry(debug.data?.data, config.appId); }
    catch (error) { throw new WhatsAppOnboardingError((error as Error).message, 502); }
    let memberVerified = false, after = '';
    const cursors = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      await fence();
      const phones = await axios.get(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(input.wabaId)}/phone_numbers`, {
        ...request, params: { fields: 'id', limit: 100, ...(after ? { after } : {}) },
      });
      if (!Array.isArray(phones.data?.data)) break;
      const matches = phones.data.data.filter((phone: { id?: unknown }) => String(phone.id) === input.phoneNumberId);
      if (matches.length === 1) { memberVerified = true; break; }
      if (matches.length > 1 || !phones.data?.paging?.next) break;
      after = typeof phones.data?.paging?.cursors?.after === 'string' ? phones.data.paging.cursors.after : '';
      if (!after || cursors.has(after)) break;
      cursors.add(after); // Never follow provider-supplied next URLs with credentials.
    }
    if (!memberVerified) throw new WhatsAppOnboardingError('whatsapp_asset_membership_invalid', 502);
    const phone = await axios.get(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(input.phoneNumberId)}`, { ...request, params: { fields: 'id,display_phone_number,status' } });
    if (phone.data?.status !== 'CONNECTED') throw new WhatsAppOnboardingError('whatsapp_phone_registration_required');
    const publicNumber = String(phone.data?.display_phone_number || '').replace(/[^\d]/g, '');
    if (String(phone.data?.id) !== input.phoneNumberId || !publicNumber)
      throw new WhatsAppOnboardingError('whatsapp_phone_identity_invalid', 502);
    for (const field of ['phone_number_id', 'waba_id'] as const) {
      const owners = await store.list<TenantPlatformAppRecord>('tenant_platform_apps', {
        where: { platform: 'meta', [field]: field === 'phone_number_id' ? input.phoneNumberId : input.wabaId }, perPage: 2,
      });
      if (owners.totalItems !== owners.items.length || owners.totalItems > 1 || owners.items.some(owner => owner.tenant_id !== input.tenantId || owner.id !== existing?.id))
        throw new WhatsAppOnboardingError('whatsapp_asset_owned_by_foreign_tenant');
    }
    await fence();
    const subscribed = await axios.post(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {}, request);
    if (subscribed.data?.success !== true) throw new WhatsAppOnboardingError('whatsapp_subscription_not_confirmed', 502);
    await fence();
    // Changing the platform configuration while authorization is in flight invalidates this attempt.
    if (JSON.stringify(whatsappPlatformConfig()) !== JSON.stringify(config))
      throw new WhatsAppOnboardingError('whatsapp_platform_configuration_changed');
    const record: TenantPlatformAppRecord = { ...existing,
      id: existing?.id || `wa${createHash('sha256').update(input.tenantId).digest('hex').slice(0, 13)}`,
      tenant_id: input.tenantId, platform: 'meta', app_id: config.appId, app_secret: WHATSAPP_PLATFORM_SECRET_REF,
      wa_config_id: config.configId, waba_id: input.wabaId, phone_number_id: input.phoneNumberId,
      wa_public_number: publicNumber, webhook_verify_token: '', access_token: encryptSecret(accessToken),
      token_type: 'business_integration', token_expires_at: expiresAt, status: 'active',
    };
    let previousChecklist: Record<string, unknown> = {};
    try { const value = JSON.parse(existing?.last_checklist || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) previousChecklist = value; } catch { /* Rebuild only the WhatsApp proof. */ }
    record.last_checklist = JSON.stringify({ ...previousChecklist, whatsapp_embedded_signup_done: true,
      whatsappAssetProof: { authorityHash: whatsappAssetAuthorityHash(record), verifiedAt: new Date().toISOString() } });
    if (existing) {
      if (!await store.compareAndSwap!('tenant_platform_apps', existing.id, { ...existing }, { ...record }))
        throw new WhatsAppOnboardingError('whatsapp_account_version_changed');
    } else if (!await store.create('tenant_platform_apps', { ...record })) {
      throw new WhatsAppOnboardingError('whatsapp_binding_persist_failed', 503);
    }
    return record;
  }));
}

/** Local disconnection stops ingress and existing send boundaries; remote app revocation remains a separate action. */
export async function disconnectWhatsAppTenant(tenantId: string) {
  return withLegacyExternalEffectAllowed(tenantId, guard => withWhatsAppBindingLock(async bindingFence => {
    const fence = async () => { await guard.beforeEffect(); await bindingFence(); };
    const app = await getTenantPlatformApp(tenantId, 'meta');
    if (!app || app.app_secret !== WHATSAPP_PLATFORM_SECRET_REF) throw new WhatsAppOnboardingError('whatsapp_platform_binding_missing');
    await fence();
    if (!await store.compareAndSwap!('tenant_platform_apps', app.id, { ...app }, {
      status: 'pending', access_token: '', token_expires_at: '', last_checklist: '{}',
    })) throw new WhatsAppOnboardingError('whatsapp_account_version_changed');
  }));
}

import axios from 'axios';
import { store } from '../storage/index.js';
import { decryptSecret, getTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { withLegacyExternalEffectAllowed } from '../starter198/legacyEffectGuard.js';
import { whatsappPlatformConfig, WHATSAPP_PLATFORM_SECRET_REF } from './platformConfig.js';
import { assertVerifiedWhatsAppAssets } from './assetAuthority.js';
import { withWhatsAppBindingLock, WhatsAppOnboardingError } from './onboarding.js';
import { whatsappTokenExpiry } from './tokenAuthority.js';

/** Checks credentials/phone without sending a customer message or silently refreshing a business token. */
export async function verifyWhatsAppTenantConnection(tenantId: string) {
  return withLegacyExternalEffectAllowed(tenantId, guard => withWhatsAppBindingLock(async fence => {
    const config = whatsappPlatformConfig(), app = await getTenantPlatformApp(tenantId, 'meta');
    if (!app || app.app_secret !== WHATSAPP_PLATFORM_SECRET_REF || !['active', 'error'].includes(app.status || '') || !app.access_token)
      throw new WhatsAppOnboardingError('whatsapp_platform_binding_missing');
    assertVerifiedWhatsAppAssets(app);
    await guard.beforeEffect(); await fence();
    let status: 'active' | 'error' | 'token_expired' = 'active', reason = '', expiresAt = app.token_expires_at || '';
    try {
      const request = { headers: { Authorization: `Bearer ${decryptSecret(app.access_token)}` }, maxRedirects: 0, timeout: 15000 };
      const debug = await axios.get(`https://graph.facebook.com/${config.graphVersion}/debug_token`, {
        ...request, params: { input_token: decryptSecret(app.access_token), access_token: `${config.appId}|${config.appSecret}` },
      });
      expiresAt = whatsappTokenExpiry(debug.data?.data, config.appId);
      const phone = await axios.get(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(app.phone_number_id || '')}`, {
        ...request, params: { fields: 'id,status' },
      });
      if (String(phone.data?.id) !== app.phone_number_id || phone.data?.status !== 'CONNECTED') throw Error('whatsapp_phone_registration_required');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const revoked = message === 'whatsapp_token_authority_invalid' || message === 'whatsapp_token_expired'
        || (axios.isAxiosError(error) && Number(error.response?.data?.error?.code) === 190);
      status = revoked ? 'token_expired' : 'error';
      reason = revoked ? 'whatsapp_reauthorization_required' : 'whatsapp_connection_verification_failed';
    }
    await guard.beforeEffect(); await fence();
    if (JSON.stringify(config) !== JSON.stringify(whatsappPlatformConfig())) throw new WhatsAppOnboardingError('whatsapp_platform_configuration_changed');
    if (!await store.compareAndSwap!('tenant_platform_apps', app.id, { ...app }, { status, token_expires_at: expiresAt }))
      throw new WhatsAppOnboardingError('whatsapp_account_version_changed');
    return { connected: status === 'active', status, reason };
  }));
}

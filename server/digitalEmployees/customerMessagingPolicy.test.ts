import assert from 'node:assert/strict';
import { resolveCustomerMessagingAuthorization } from './customerMessagingPolicy.js';

const base = {
  tenantId: 'tenant_policy_test',
  configVersion: 3,
  configActive: true,
  customerAgentEnabled: true,
  allowRealCustomerMessages: true,
  providerReady: true,
  backgroundWorkerEnabled: true,
};

const ready = resolveCustomerMessagingAuthorization(base);
assert.equal(ready.inboundAutoSendAllowed, true);
assert.equal(ready.manualFollowupSendAllowed, true);
assert.equal(ready.scheduledFollowupSendAllowed, true);
assert.equal(ready.configVersion, 3);

const noConsent = resolveCustomerMessagingAuthorization({ ...base, allowRealCustomerMessages: false });
assert.equal(noConsent.inboundAutoSendAllowed, false);
assert.equal(noConsent.manualFollowupSendAllowed, false);
assert.equal(noConsent.scheduledFollowupSendAllowed, false);
assert.ok(noConsent.reasons.includes('tenant_real_customer_messages_not_authorized'));

const customerAgentOff = resolveCustomerMessagingAuthorization({ ...base, customerAgentEnabled: false });
assert.equal(customerAgentOff.inboundAutoSendAllowed, false);
assert.equal(customerAgentOff.scheduledFollowupSendAllowed, false);
assert.ok(customerAgentOff.reasons.includes('customer_agent_not_enabled'));

const noProvider = resolveCustomerMessagingAuthorization({ ...base, providerReady: false });
assert.equal(noProvider.inboundAutoSendAllowed, false);
assert.equal(noProvider.manualFollowupSendAllowed, false);
assert.equal(noProvider.scheduledFollowupSendAllowed, false);
assert.ok(noProvider.reasons.includes('whatsapp_provider_not_ready'));

const workerStopped = resolveCustomerMessagingAuthorization({ ...base, backgroundWorkerEnabled: false });
assert.equal(workerStopped.inboundAutoSendAllowed, true, 'the follow-up kill switch must not disable signed inbound webhook replies');
assert.equal(workerStopped.manualFollowupSendAllowed, true, 'manual approved dispatch does not depend on the polling process');
assert.equal(workerStopped.scheduledFollowupSendAllowed, false);

console.log('customer messaging authorization policy tests passed');

const { readCustomerMessagingAuthorization } = await import('./customerMessagingPolicy.js');
const { resolveTenantWhatsAppConfig } = await import('../whatsapp/send.js');
const now = new Date('2026-10-07T00:00:00Z');
const config = { id: 'config', tenant_id: base.tenantId, status: 'active', config_version: 3, config: { enabledWorkflows: ['batch_followup'], allowRealCustomerMessages: true } };
const wa = { id: 'meta', tenant_id: base.tenantId, platform: 'meta' as const, status: 'active' as const, phone_number_id: 'phone-id', access_token: 'sealed-valid', token_expires_at: '2026-11-01T00:00:00Z' };
const messenger = { id: 'page', tenantId: base.tenantId, platform: 'facebook', status: 'connected', messengerSubscribed: true, providerAccountId: 'page-id', accessToken: 'sealed-valid' };
const instagram = { id: 'ig', tenantId: base.tenantId, platform: 'instagram', status: 'connected', oauthProvider: 'instagram_login', providerAccountId: 'ig-id', accessToken: 'sealed-valid', scope: 'instagram_business_manage_messages', instagramWebhookSubscribed: true };
function fixtures(meta: Record<string, unknown>[], pages: Record<string, unknown>[], consent = true) {
  return {
    dataStore: { async list(collection: string) {
      const items = collection === 'digital_employee_configs' ? [{ ...config, config: { ...config.config, allowRealCustomerMessages: consent } }] : collection === 'tenant_platform_apps' ? meta : pages;
      return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 100 };
    } } as any,
    now,
    openWhatsAppSecret: (value?: string) => { if (value !== 'sealed-valid') throw new Error('credential_invalid'); return 'test-token'; },
    openMessengerToken: (account: Record<string, unknown>) => { if (account.accessToken !== 'sealed-valid') throw new Error('credential_invalid'); return 'test-token'; },
  };
}
const waOnly = fixtures([wa], []);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'whatsapp', waOnly)).manualFollowupSendAllowed, true);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'messenger', waOnly)).inboundAutoSendAllowed, false);
const pageOnly = fixtures([], [messenger]);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'messenger', pageOnly)).inboundAutoSendAllowed, true);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'whatsapp', pageOnly)).manualFollowupSendAllowed, false, 'Messenger never authorizes the WhatsApp followup worker');
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'instagram', pageOnly)).providerReady, false, 'Facebook Page authorization cannot authorize Instagram');
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'instagram', fixtures([], [instagram]))).inboundAutoSendAllowed, true);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'messenger', fixtures([], [instagram]))).providerReady, false, 'Instagram authorization cannot authorize Messenger');
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'instagram', fixtures([], [{ ...instagram, scope: 'instagram_business_basic' }]))).providerReady, false);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'instagram', fixtures([], [{ ...instagram, instagramWebhookSubscribed: false }]))).providerReady, false);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'instagram', fixtures([], [{ ...instagram, tenantId: 'other' }]))).providerReady, false);
for (const patch of [{ access_token: '' }, { access_token: 'corrupt' }, { phone_number_id: '' }, { tenant_id: 'other' }, { status: 'token_expired' }, { token_expires_at: '2026-10-06T00:00:00Z' }, { token_expires_at: 'invalid-date' }]) {
  const denied = await readCustomerMessagingAuthorization(base.tenantId, 'whatsapp', fixtures([{ ...wa, ...patch }], [messenger]));
  assert.equal(denied.manualFollowupSendAllowed, false);
  assert.ok(denied.reasons.includes('whatsapp_provider_not_ready'));
}
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'whatsapp', fixtures([wa, wa], []))).providerReady, false, 'ambiguous tenant connection fails closed');
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'whatsapp', fixtures([wa], [], false))).manualFollowupSendAllowed, false);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'messenger', fixtures([], [{ ...messenger, accessToken: 'corrupt' }]))).providerReady, false);
assert.equal((await readCustomerMessagingAuthorization(base.tenantId, 'messenger', fixtures([], [{ ...messenger, tenantId: 'other' }]))).providerReady, false);
assert.throws(() => resolveTenantWhatsAppConfig(base.tenantId, { ...wa, status: 'token_expired' }, waOnly.openWhatsAppSecret, now), /tenant_whatsapp_not_configured/, 'the actual sending path uses the same credential gate');
console.log('channel-specific readiness and credential isolation tests passed');

assert.throws(() => resolveTenantWhatsAppConfig(base.tenantId, { ...wa, access_token: 'v1:invalid:invalid:invalid' }, undefined, now), /tenant_whatsapp_not_configured/, 'actual decryption failure cannot authorize the sender');

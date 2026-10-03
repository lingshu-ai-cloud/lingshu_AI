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
assert.ok(noProvider.reasons.includes('messenger_provider_not_ready'));

const workerStopped = resolveCustomerMessagingAuthorization({ ...base, backgroundWorkerEnabled: false });
assert.equal(workerStopped.inboundAutoSendAllowed, true, 'the follow-up kill switch must not disable signed inbound webhook replies');
assert.equal(workerStopped.manualFollowupSendAllowed, true, 'manual approved dispatch does not depend on the polling process');
assert.equal(workerStopped.scheduledFollowupSendAllowed, false);

console.log('customer messaging authorization policy tests passed');

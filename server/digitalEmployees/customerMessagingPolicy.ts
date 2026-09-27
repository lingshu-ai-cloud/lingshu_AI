import { socialAccessToken } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';

type ConfigRecord = {
  id: string;
  tenant_id: string;
  status?: string;
  config_version?: number;
  config?: unknown;
};

export interface CustomerMessagingAuthorization {
  tenantId: string;
  configVersion: number;
  configActive: boolean;
  customerAgentEnabled: boolean;
  tenantAuthorized: boolean;
  providerReady: boolean;
  backgroundWorkerEnabled: boolean;
  inboundAutoSendAllowed: boolean;
  manualFollowupSendAllowed: boolean;
  scheduledFollowupSendAllowed: boolean;
  reasons: string[];
}

export interface CustomerMessagingAuthorizationInput {
  tenantId: string;
  configVersion?: number;
  configActive: boolean;
  customerAgentEnabled: boolean;
  allowRealCustomerMessages: boolean;
  providerReady: boolean;
  backgroundWorkerEnabled: boolean;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Pure policy resolver. Tenant consent and a usable provider connection are
 * mandatory for every real message. The background flag is only a kill switch
 * for scheduled outreach; it never grants consent by itself.
 */
export function resolveCustomerMessagingAuthorization(
  input: CustomerMessagingAuthorizationInput,
): CustomerMessagingAuthorization {
  const tenantAuthorized = input.configActive && input.customerAgentEnabled && input.allowRealCustomerMessages;
  const realSendReady = tenantAuthorized && input.providerReady;
  const reasons: string[] = [];
  if (!input.configActive) reasons.push('digital_employee_configuration_inactive');
  if (!input.customerAgentEnabled) reasons.push('customer_agent_not_enabled');
  if (!input.allowRealCustomerMessages) reasons.push('tenant_real_customer_messages_not_authorized');
  if (!input.providerReady) reasons.push('messenger_provider_not_ready');
  if (!input.backgroundWorkerEnabled) reasons.push('followup_background_worker_disabled');
  return {
    tenantId: input.tenantId,
    configVersion: Math.max(0, Math.trunc(Number(input.configVersion) || 0)),
    configActive: input.configActive,
    customerAgentEnabled: input.customerAgentEnabled,
    tenantAuthorized,
    providerReady: input.providerReady,
    backgroundWorkerEnabled: input.backgroundWorkerEnabled,
    inboundAutoSendAllowed: realSendReady,
    manualFollowupSendAllowed: realSendReady,
    scheduledFollowupSendAllowed: realSendReady && input.backgroundWorkerEnabled,
    reasons,
  };
}

export function followupBackgroundWorkerEnabled(): boolean {
  return process.env.FOLLOWUP_WORKER_ENABLED === 'true';
}

export async function readCustomerMessagingAuthorization(
  tenantId: string,
): Promise<CustomerMessagingAuthorization> {
  try {
    const [configs, messengerAccounts] = await Promise.all([
      store.list<ConfigRecord>('digital_employee_configs', {
        where: { tenant_id: tenantId },
        sort: '-config_version',
        page: 1,
        perPage: 1,
      }),
      store.list<Record<string, unknown>>('social_accounts', {
        where: { tenantId, platform: 'facebook', status: 'connected' },
        page: 1,
        perPage: 100,
      }),
    ]);
    const configRecord = configs.items[0];
    const config = jsonObject(configRecord?.config);
    const enabledWorkflows = Array.isArray(config.enabledWorkflows)
      ? config.enabledWorkflows.map(item => String(item || ''))
      : [];
    const providerReady = messengerAccounts.items.some(account => {
      if (account.messengerSubscribed !== true) return false;
      try { return Boolean(socialAccessToken(account)); } catch { return false; }
    });
    return resolveCustomerMessagingAuthorization({
      tenantId,
      configVersion: configRecord?.config_version,
      configActive: Boolean(configRecord && configRecord.status === 'active'),
      customerAgentEnabled: enabledWorkflows.includes('customer_segmentation') || enabledWorkflows.includes('batch_followup'),
      allowRealCustomerMessages: config.allowRealCustomerMessages === true,
      providerReady,
      backgroundWorkerEnabled: followupBackgroundWorkerEnabled(),
    });
  } catch {
    return resolveCustomerMessagingAuthorization({
      tenantId,
      configVersion: 0,
      configActive: false,
      customerAgentEnabled: false,
      allowRealCustomerMessages: false,
      providerReady: false,
      backgroundWorkerEnabled: followupBackgroundWorkerEnabled(),
    });
  }
}

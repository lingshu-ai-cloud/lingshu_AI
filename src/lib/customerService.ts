import { authHeader } from './auth';

export type PartialAutoReplyDecision = 'pending' | 'enabled' | 'declined';

export interface CustomerServiceStatus {
  messengerAuthorization?: CustomerServiceStatus['messagingAuthorization'];
  enabled: boolean;
  enabledAt: string;
  observationDay: number;
  remainingHours: number;
  eligibleForPartialAutoReply: boolean;
  partialAutoReplyEnabled: boolean;
  partialAutoReplyDecision: PartialAutoReplyDecision;
  shouldAskPartialAutoReply: boolean;
  canAutoSend: boolean;
  approvedFaqCount: number;
  autoReplyReady: boolean;
  messagingAuthorization?: {
    configVersion: number;
    configActive: boolean;
    customerAgentEnabled: boolean;
    tenantAuthorized: boolean;
    providerReady: boolean;
    inboundAutoSendAllowed: boolean;
    scheduledFollowupSendAllowed: boolean;
    reasons: string[];
  };
}

async function parseStatusResponse(response: Response): Promise<CustomerServiceStatus> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || '智能客服设置暂时无法保存');
  return (data.status ?? data) as CustomerServiceStatus;
}

export async function getCustomerServiceStatus(): Promise<CustomerServiceStatus> {
  return parseStatusResponse(await fetch('/api/overseas/enterprise/customer-service/status', {
    headers: { 'Cache-Control': 'no-cache', ...authHeader() },
  }));
}

export async function updateCustomerServiceStatus(input: {
  enabled?: boolean;
  partialAutoReplyDecision?: 'enabled' | 'declined';
}): Promise<CustomerServiceStatus> {
  return parseStatusResponse(await fetch('/api/overseas/enterprise/customer-service/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  }));
}

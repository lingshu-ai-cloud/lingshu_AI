import axios from 'axios';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookUrl?: string;
}

export type WhatsAppDeliveryOutcome = 'definite_failure' | 'unknown' | 'partial';

export type WhatsAppSendReceipt = {
  providerMessageId: string;
};

export class WhatsAppDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly outcome: WhatsAppDeliveryOutcome,
    public readonly providerMessageIds: string[] = [],
    public readonly sentMessages: string[] = [],
  ) {
    super(code);
    this.name = 'WhatsAppDeliveryError';
  }
}

export function requiresWhatsAppReconciliation(error: unknown): error is WhatsAppDeliveryError {
  return error instanceof WhatsAppDeliveryError && (error.outcome === 'unknown' || error.outcome === 'partial');
}

export function metaGraphVersion(env: NodeJS.ProcessEnv = process.env): string {
  const version = String(env.META_GRAPH_VERSION || 'v25.0').trim();
  if (!/^v\d{1,3}\.\d{1,3}$/.test(version)) throw new Error('META_GRAPH_VERSION_invalid');
  return version;
}

export function whatsappProviderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const timeout = Number(env.WHATSAPP_PROVIDER_TIMEOUT_MS || 30_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new Error('WHATSAPP_PROVIDER_TIMEOUT_MS_invalid');
  }
  return timeout;
}

function graphUrl(config: WhatsAppConfig, resource: string): string {
  return `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(config.phoneNumberId)}/${resource}`;
}

function responseMessageId(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return '';
  const first = messages[0];
  return first && typeof first === 'object' && typeof (first as { id?: unknown }).id === 'string'
    ? (first as { id: string }).id.trim()
    : '';
}

function deliveryError(error: unknown): WhatsAppDeliveryError {
  if (error instanceof WhatsAppDeliveryError) return error;
  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0);
    if (status >= 400 && status < 500) {
      return new WhatsAppDeliveryError(`whatsapp_provider_http_${status}`, 'definite_failure');
    }
    // A timeout, connection reset, or provider 5xx may have occurred after
    // Meta accepted the request. Retrying without reconciliation can duplicate.
    return new WhatsAppDeliveryError(status ? `whatsapp_provider_http_${status}` : 'whatsapp_provider_outcome_unknown', 'unknown');
  }
  return new WhatsAppDeliveryError('whatsapp_provider_outcome_unknown', 'unknown');
}

export async function sendWhatsAppText(config: WhatsAppConfig, to: string, text: string): Promise<WhatsAppSendReceipt> {
  try {
    const response = await axios.post(
    graphUrl(config, 'messages'),
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    {
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      timeout: whatsappProviderTimeoutMs(),
    },
    );
    const providerMessageId = responseMessageId(response.data);
    if (!providerMessageId) throw new WhatsAppDeliveryError('whatsapp_provider_ack_missing', 'unknown');
    return { providerMessageId };
  } catch (error) {
    throw deliveryError(error);
  }
}

export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  to: string,
  templateName: string,
  languageCode: string,
  components: object[] = []
): Promise<WhatsAppSendReceipt> {
  try {
    const response = await axios.post(
    graphUrl(config, 'messages'),
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, components },
    },
    {
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      timeout: whatsappProviderTimeoutMs(),
    },
    );
    const providerMessageId = responseMessageId(response.data);
    if (!providerMessageId) throw new WhatsAppDeliveryError('whatsapp_provider_ack_missing', 'unknown');
    return { providerMessageId };
  } catch (error) {
    throw deliveryError(error);
  }
}

export function verifyWhatsAppWebhook(
  config: WhatsAppConfig,
  mode: string,
  token: string,
  challenge: string
): string | null {
  if (mode === 'subscribe' && token === config.verifyToken) return challenge;
  return null;
}

export async function getPhoneNumberInfo(config: WhatsAppConfig) {
  const res = await axios.get(
    `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(config.phoneNumberId)}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` }, timeout: whatsappProviderTimeoutMs() }
  );
  return res.data;
}

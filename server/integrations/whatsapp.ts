import axios from 'axios';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookUrl?: string;
}

export interface WhatsAppSendReceipt {
  messageId: string;
  recipientId: string;
  raw: Record<string, unknown>;
}

function sendReceipt(data: unknown): WhatsAppSendReceipt {
  const raw = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const messages = Array.isArray(raw.messages) ? raw.messages as Array<Record<string, unknown>> : [];
  const contacts = Array.isArray(raw.contacts) ? raw.contacts as Array<Record<string, unknown>> : [];
  return {
    messageId: String(messages[0]?.id || ''),
    recipientId: String(contacts[0]?.wa_id || ''),
    raw,
  };
}

export async function sendWhatsAppText(config: WhatsAppConfig, to: string, text: string, callbackData?: string): Promise<WhatsAppSendReceipt> {
  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${config.phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text }, ...(callbackData ? { biz_opaque_callback_data: callbackData } : {}) },
    { headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' } }
  );
  return sendReceipt(response.data);
}

export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  to: string,
  templateName: string,
  languageCode: string,
  components: object[] = [],
  callbackData?: string
): Promise<WhatsAppSendReceipt> {
  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${config.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      ...(callbackData ? { biz_opaque_callback_data: callbackData } : {}),
      template: { name: templateName, language: { code: languageCode }, components },
    },
    { headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' } }
  );
  return sendReceipt(response.data);
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
    `https://graph.facebook.com/v19.0/${config.phoneNumberId}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } }
  );
  return res.data;
}

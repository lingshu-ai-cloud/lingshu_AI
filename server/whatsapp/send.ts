import { getTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { tenantPlatformSecret } from '../security/platformCredentials.js';
import {
  sendWhatsAppTemplate,
  sendWhatsAppText,
  WhatsAppDeliveryError,
  type WhatsAppConfig,
} from '../integrations/whatsapp.js';
import { planMobileChatMessages } from '../agents/mobileChatStyle.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getTenantWhatsAppConfig(tenantId: string): Promise<WhatsAppConfig> {
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const phoneNumberId = text(app?.phone_number_id);
  const accessToken = app ? tenantPlatformSecret(app, 'access_token') : '';

  if (!app || !phoneNumberId || !accessToken) {
    throw new Error('tenant_whatsapp_not_configured');
  }

  return { phoneNumberId, accessToken, verifyToken: '' };
}

function pacingDelayMs(): number {
  const configuredMin = Number(process.env.WHATSAPP_MESSAGE_DELAY_MIN_MS ?? 1500);
  const configuredMax = Number(process.env.WHATSAPP_MESSAGE_DELAY_MAX_MS ?? 3000);
  const min = Number.isFinite(configuredMin) ? Math.max(0, configuredMin) : 1500;
  const max = Number.isFinite(configuredMax) ? Math.max(min, configuredMax) : 3000;
  return Math.round(min + Math.random() * (max - min));
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export type WhatsAppSentBatch = {
  messages: string[];
  providerMessageIds: string[];
};

export async function sendTenantWhatsAppTextBatch(tenantId: string, to: string, body: string): Promise<WhatsAppSentBatch> {
  const waNumber = text(to);
  const content = text(body);
  if (!waNumber || !content) throw new Error('whatsapp_to_and_body_required');
  const config = await getTenantWhatsAppConfig(tenantId);
  const plan = planMobileChatMessages(content);
  const messages = plan.messages;
  if (!messages.length) throw new Error('whatsapp_body_required');
  if (plan.truncated) throw new Error('whatsapp_message_exceeds_three_bubbles');
  const providerMessageIds: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (index > 0) await wait(pacingDelayMs());
    try {
      const receipt = await sendWhatsAppText(config, waNumber, messages[index]);
      providerMessageIds.push(receipt.providerMessageId);
    } catch (error) {
      if (providerMessageIds.length > 0) {
        throw new WhatsAppDeliveryError(
          'whatsapp_partial_delivery_reconciliation_required',
          'partial',
          providerMessageIds,
          messages.slice(0, providerMessageIds.length),
        );
      }
      throw error;
    }
  }
  return { messages, providerMessageIds };
}

export async function sendTenantWhatsAppText(tenantId: string, to: string, body: string): Promise<string[]> {
  return (await sendTenantWhatsAppTextBatch(tenantId, to, body)).messages;
}

export async function sendTenantWhatsAppTemplate(input: {
  tenantId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  variables?: string[];
}): Promise<string> {
  const to = text(input.to);
  const templateName = text(input.templateName);
  if (!to || !templateName) throw new Error('whatsapp_template_target_required');

  const components = input.variables?.length
    ? [{
        type: 'body',
        parameters: input.variables.map(value => ({ type: 'text', text: String(value || '') })),
      }]
    : [];

  const config = await getTenantWhatsAppConfig(input.tenantId);
  const receipt = await sendWhatsAppTemplate(config, to, templateName, input.languageCode || 'en_US', components);
  return receipt.providerMessageId;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Called only after HMAC validation; an app may serve several business accounts. */
export function selectWhatsAppStatusWebhookPayload(payload: any, binding: { wabaId: string; phoneNumberId: string }) {
  const entry: unknown[] = [];
  if (payload?.object !== 'whatsapp_business_account' || !binding.wabaId || !binding.phoneNumberId || !Array.isArray(payload.entry)) {
    return { object: 'whatsapp_business_account', entry };
  }
  for (const item of payload.entry) {
    if (text(item?.id) !== binding.wabaId || !Array.isArray(item.changes)) continue;
    const changes = item.changes.filter((change: any) => change?.field === 'messages'
      && text(change.value?.metadata?.phone_number_id) === binding.phoneNumberId
      && Array.isArray(change.value?.statuses)).map((change: any) => ({ field: 'messages', value: {
        metadata: { phone_number_id: binding.phoneNumberId }, statuses: change.value.statuses,
      } }));
    if (changes.length) entry.push({ id: binding.wabaId, changes });
  }
  return { object: 'whatsapp_business_account', entry };
}

export function selectWhatsAppInboundWebhookPayload(payload: any, binding: { wabaId: string; phoneNumberId: string }) {
  const entry: unknown[] = [];
  if (payload?.object !== 'whatsapp_business_account' || !binding.wabaId || !binding.phoneNumberId || !Array.isArray(payload.entry)) {
    return { object: 'whatsapp_business_account', entry };
  }
  for (const item of payload.entry) {
    if (text(item?.id) !== binding.wabaId || !Array.isArray(item.changes)) continue;
    const changes = item.changes.filter((change: any) => change?.field === 'messages'
      && text(change.value?.metadata?.phone_number_id) === binding.phoneNumberId
      && Array.isArray(change.value?.messages) && change.value.messages.length > 0).map((change: any) => ({
        field: 'messages', value: { metadata: change.value.metadata,
          contacts: Array.isArray(change.value.contacts) ? change.value.contacts : [], messages: change.value.messages },
      }));
    if (changes.length) entry.push({ id: binding.wabaId, changes });
  }
  return { object: 'whatsapp_business_account', entry };
}

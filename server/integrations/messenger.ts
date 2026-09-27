const META_GRAPH = 'https://graph.facebook.com';

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

async function metaRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${META_GRAPH}/${graphVersion()}${path}`, init);
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = data.error && typeof data.error === 'object'
      ? String((data.error as Record<string, unknown>).message || '')
      : '';
    throw new Error(providerError || `Meta Messenger request failed (${response.status})`);
  }
  return data;
}

export async function subscribeMessengerPage(input: { pageId: string; pageAccessToken: string }) {
  const fields = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'];
  const params = new URLSearchParams({
    subscribed_fields: fields.join(','),
    access_token: input.pageAccessToken,
  });
  return metaRequest(`/${encodeURIComponent(input.pageId)}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
}

export async function sendMessengerText(input: {
  pageId: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}) {
  const data = await metaRequest(`/${encodeURIComponent(input.pageId)}/messages?access_token=${encodeURIComponent(input.pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: input.recipientId },
      messaging_type: 'RESPONSE',
      message: { text: input.text },
    }),
  });
  return {
    messageId: String(data.message_id || ''),
    recipientId: String(data.recipient_id || input.recipientId),
    raw: data,
  };
}

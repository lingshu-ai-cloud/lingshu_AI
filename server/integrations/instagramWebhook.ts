const INSTAGRAM_GRAPH = 'https://graph.instagram.com';

export async function subscribeInstagramAccount(input: { accountId: string; accessToken: string }): Promise<void> {
  const version = process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
  const fields = ['messages', 'messaging_postbacks', 'message_reactions', 'messaging_seen'];
  const response = await fetch(`${INSTAGRAM_GRAPH}/${version}/${encodeURIComponent(input.accountId)}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ subscribed_fields: fields.join(',') }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || data.success !== true) {
    const detail = data.error && typeof data.error === 'object'
      ? String((data.error as Record<string, unknown>).message || '') : '';
    throw new Error(detail || `Instagram webhook subscription failed (${response.status})`);
  }
}

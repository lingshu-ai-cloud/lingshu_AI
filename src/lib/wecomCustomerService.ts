import { authHeader } from './auth';

const BASE = '/api/overseas/wecom-customer-service';

export type WeComConversationStatus =
  | 'waiting_first_response'
  | 'draft_pending'
  | 'in_progress'
  | 'waiting_customer'
  | 'human_required'
  | 'send_failed'
  | 'resolved';

export type WeComConnectionStatus = {
  status: 'unconfigured' | 'configuring' | 'connected' | 'degraded' | 'error';
  connected: boolean;
  label?: string;
  lastSyncAt?: string;
  pendingCount?: number;
  humanRequiredCount?: number;
  reason?: string;
};

export type WeComConversationSummary = {
  id: string;
  status: WeComConversationStatus;
  customerName: string;
  lastMessagePreview: string;
  lastMessageAt?: string;
  sourceTitle?: string;
  openKfId?: string;
  unreadCount?: number;
  riskLevel?: 'low' | 'medium' | 'high';
};

export type WeComMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sentAt?: string;
  status?: string;
  senderName?: string;
};

export type WeComReplyDraft = {
  id: string;
  body: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanReview: boolean;
  riskReasons: string[];
  knowledgeCitations?: Array<{ id?: string; title: string }>;
  status?: string;
};

export type WeComConversationDetail = {
  conversation: WeComConversationSummary;
  messages: WeComMessage[];
  drafts: WeComReplyDraft[];
  outbound?: Array<{ id: string; status: string; body?: string; error?: string }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || '企业微信客服请求失败');
  return data;
}

export async function getWeComConnectionStatus(): Promise<WeComConnectionStatus> {
  const data = await request<WeComConnectionStatus & { connection?: WeComConnectionStatus }>('/connection/status');
  return data.connection ?? data;
}

export async function recoverWeComCallbacks(): Promise<{
  attempted: number;
  processed: number;
  alreadyProcessed: number;
  busy: number;
  expired: number;
  failed: number;
}> {
  const data = await request<{ recovery: {
    attempted: number;
    processed: number;
    alreadyProcessed: number;
    busy: number;
    expired: number;
    failed: number;
  } }>('/callbacks/recover', {
    method: 'POST',
    body: JSON.stringify({ limit: 25 }),
  });
  return data.recovery;
}

export async function listWeComConversations(status?: string): Promise<WeComConversationSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}&page=1&perPage=100` : '?page=1&perPage=100';
  const data = await request<{ items?: WeComConversationSummary[]; conversations?: WeComConversationSummary[] }>(`/conversations${query}`);
  return data.items ?? data.conversations ?? [];
}

export async function getWeComConversation(id: string): Promise<WeComConversationDetail> {
  return request<WeComConversationDetail>(`/conversations/${encodeURIComponent(id)}/messages`);
}

export async function createWeComReplyDraft(id: string, instruction?: string): Promise<WeComReplyDraft> {
  const data = await request<WeComReplyDraft & { draft?: WeComReplyDraft }>(`/conversations/${encodeURIComponent(id)}/draft`, {
    method: 'POST',
    body: JSON.stringify({ instruction: instruction?.trim() || undefined }),
  });
  return data.draft ?? data;
}

export async function sendWeComReply(input: {
  conversationId: string;
  draftId: string;
  humanApproved: boolean;
}): Promise<{ id?: string; status: string; message?: string }> {
  return request(`/conversations/${encodeURIComponent(input.conversationId)}/send`, {
    method: 'POST',
    body: JSON.stringify({
      draftId: input.draftId,
      humanApproved: input.humanApproved,
      idempotencyKey: `wecom-send:${input.conversationId}:${input.draftId}`,
    }),
  });
}

export async function handoffWeComConversation(id: string, reason?: string): Promise<void> {
  await request(`/conversations/${encodeURIComponent(id)}/handoff`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason?.trim() || '客服主动接管' }),
  });
}

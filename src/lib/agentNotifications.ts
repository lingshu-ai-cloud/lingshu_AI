import type { AgentNotification, AgentNotificationList } from '../../shared/contracts/agentNotification';
import { authHeader } from './auth';

async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/overseas/agent-notifications${path}`, {
    ...options,
    headers: { ...authHeader(), ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || '消息读取失败');
  return payload;
}

export const agentNotificationsApi = {
  list: (signal?: AbortSignal) => request<AgentNotificationList>('?limit=50', { signal }),
  read: (id: string) => request<{ item: AgentNotification }>(`/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  readAll: () => request<{ updated: number }>('/read-all', { method: 'POST' }),
};


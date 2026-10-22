import { authHeader } from '../../lib/auth';
import type { PlatformCopy, PublishPlatform } from '../../lib/publishQueueState';

export async function fetchPublishingJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || '请求失败'), { statusCode: response.status });
  return data;
}

export function platformBody(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (fallback.trim()) return fallback;
  if (!copy) return fallback;
  if (platform === 'youtube') return copy.description || fallback;
  if (platform === 'facebook' || platform === 'linkedin') return copy.text || fallback;
  return copy.caption || fallback;
}

export function platformTitle(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (fallback.trim()) return fallback;
  if (platform === 'youtube') return copy?.title || fallback;
  return fallback;
}

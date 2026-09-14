import { authHeader } from './auth';

export async function getSupportAccessSetting(request: typeof fetch = fetch): Promise<boolean> {
  const response = await request('/api/overseas/support-access/settings', { headers: authHeader() });
  const data = await response.json().catch(() => ({})) as { defaultAuthorized?: boolean; error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || `读取失败（${response.status}）`);
  if (typeof data.defaultAuthorized !== 'boolean') throw new Error('服务返回的授权状态无效');
  return data.defaultAuthorized;
}

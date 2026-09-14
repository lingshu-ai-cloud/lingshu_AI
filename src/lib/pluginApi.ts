import { authHeader } from './auth';

type PluginApiErrorPayload = { error?: string; message?: string };

export async function pluginApiRequest<T>(
  path: string,
  init: RequestInit = {},
  request: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authHeader())) headers.set(name, value);
  const response = await request(`/api/overseas/plugins${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown;
  if (text.trim()) {
    try { payload = JSON.parse(text); }
    catch {
      if (response.ok) throw new Error('插件接口返回格式无效');
      payload = text;
    }
  }
  if (!response.ok) {
    const details = payload && typeof payload === 'object' ? payload as PluginApiErrorPayload : null;
    throw new Error(details?.error || details?.message || (typeof payload === 'string' ? payload : '') || `插件接口错误：${response.status}`);
  }
  return payload as T;
}

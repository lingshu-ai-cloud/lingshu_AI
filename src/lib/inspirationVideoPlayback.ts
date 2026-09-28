export type PlaybackUrlFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export function isPlaybackUrlResolver(url: string): boolean {
  try {
    const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
    return /\/media-url\/?$/.test(new URL(url, base).pathname);
  } catch {
    return /\/media-url(?:[/?#]|$)/.test(url);
  }
}

/** Resolve protected video endpoints while leaving direct/blob URLs untouched. */
export async function resolveInspirationPlaybackUrl(
  source: string,
  options: { signal?: AbortSignal; request?: PlaybackUrlFetch; headers?: HeadersInit } = {},
): Promise<string> {
  const normalized = String(source || '').trim();
  if (!normalized) throw new Error('没有可用的视频地址');
  if (!isPlaybackUrlResolver(normalized)) return normalized;

  const request = options.request || fetch;
  const response = await request(normalized, {
    headers: options.headers,
    credentials: 'same-origin',
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({})) as { url?: string; error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `视频地址获取失败（HTTP ${response.status}）`);
  }
  const playbackUrl = String(payload.url || '').trim();
  if (!playbackUrl) throw new Error('服务端没有返回可播放的视频地址');
  return playbackUrl;
}

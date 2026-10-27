import type { TrendVideo } from './inspirationTypes';

export function sourceEmbedUrl(video: Pick<TrendVideo, 'sourceUrl' | 'platform'>): string {
  const source = String(video.sourceUrl || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (video.platform === 'youtube') {
      const id = url.hostname.includes('youtu.be')
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0` : '';
    }
    if (video.platform === 'tiktok') {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1` : '';
    }
    if (video.platform === 'instagram' && /\/(?:reel|p|tv)\//i.test(url.pathname)) {
      return `${source.replace(/[?#].*$/, '').replace(/\/$/, '')}/embed/`;
    }
  } catch { /* malformed URLs fall back to the original-site action */ }
  return '';
}

export type PlaybackUrlFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const TRANSIENT_PLAYBACK_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('视频地址获取已取消');
}

async function waitForPlaybackRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, delayMs));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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
  options: { signal?: AbortSignal; request?: PlaybackUrlFetch; headers?: HeadersInit; retryDelaysMs?: number[] } = {},
): Promise<string> {
  const normalized = String(source || '').trim();
  if (!normalized) throw new Error('没有可用的视频地址');
  if (!isPlaybackUrlResolver(normalized)) return normalized;

  const request = options.request || fetch;
  const retryDelays = options.retryDelaysMs ?? [300, 900, 1_800];
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options.signal);
    let response: Awaited<ReturnType<PlaybackUrlFetch>> | null = null;
    try {
      response = await request(normalized, {
        headers: options.headers,
        credentials: 'same-origin',
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      lastError = error instanceof Error ? error : new Error('视频地址获取失败');
      if (attempt === retryDelays.length) throw lastError;
    }
    if (response) {
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string; message?: string };
      if (options.signal?.aborted) throw abortError(options.signal);
      if (response.ok) {
        const playbackUrl = String(payload.url || '').trim();
        if (!playbackUrl) throw new Error('服务端没有返回可播放的视频地址');
        return playbackUrl;
      }
      lastError = new Error(payload.message || payload.error || `视频地址获取失败（HTTP ${response.status}）`);
      if (!TRANSIENT_PLAYBACK_STATUSES.has(response.status) || attempt === retryDelays.length) throw lastError;
    }
    await waitForPlaybackRetry(retryDelays[attempt] || 0, options.signal);
  }
  throw lastError || new Error('视频地址获取失败');
}

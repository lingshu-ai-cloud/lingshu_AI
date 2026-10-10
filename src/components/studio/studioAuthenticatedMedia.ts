import { authHeader } from '../../lib/auth';

const DEFAULT_TIMEOUT_MS = 30_000;
const audioBlobCache = new Map<string, string>();
const videoBlobCache = new Map<string, string>();
const audioBlobRequests = new Map<string, Promise<string>>();
const videoBlobRequests = new Map<string, Promise<string>>();

export class StudioRequestTimeoutError extends Error {
  constructor(message = '请求超时') {
    super(message);
    this.name = 'StudioRequestTimeoutError';
  }
}

export async function withStudioTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StudioRequestTimeoutError(`请求超过 ${Math.ceil(timeoutMs / 1000)} 秒，已停止等待`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSameOriginUrl(sourceUrl: string): boolean {
  try {
    return new URL(sourceUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function authenticatedAudioBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = audioBlobCache.get(sourceUrl);
  if (cached) return cached;
  const pending = audioBlobRequests.get(sourceUrl);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(sourceUrl, { headers: authHeader(), credentials: 'same-origin' });
    if (!response.ok) throw new Error(`音频请求失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('服务器返回了空音频');
    const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
    if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw new Error(`服务器返回的不是音频（${contentType}）`);
    }
    const playableBlob = blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(playableBlob);
    audioBlobCache.set(sourceUrl, blobUrl);
    return blobUrl;
  })().finally(() => audioBlobRequests.delete(sourceUrl));
  audioBlobRequests.set(sourceUrl, request);
  return request;
}

async function authenticatedVideoBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = videoBlobCache.get(sourceUrl);
  if (cached) return cached;
  const pending = videoBlobRequests.get(sourceUrl);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(sourceUrl, isSameOriginUrl(sourceUrl)
      ? { headers: authHeader(), credentials: 'same-origin' }
      : { credentials: 'omit' });
    if (!response.ok) throw new Error(`视频请求失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('服务器返回了空视频');
    const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
    if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
      throw new Error(`服务器返回的不是视频（${contentType}）`);
    }
    const playableBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(playableBlob);
    videoBlobCache.set(sourceUrl, blobUrl);
    return blobUrl;
  })().finally(() => videoBlobRequests.delete(sourceUrl));
  videoBlobRequests.set(sourceUrl, request);
  return request;
}

export async function playAudioWithAuthenticatedFallback(
  element: HTMLAudioElement,
  sourceUrl: string,
  volume: number,
): Promise<void> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  element.pause();
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  if (element.ended || !Number.isFinite(element.currentTime)) element.currentTime = 0;
  element.volume = Math.max(0, Math.min(1, volume));
  try {
    await element.play();
  } catch {
    const blobUrl = await authenticatedAudioBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    element.currentTime = 0;
    await element.play();
  }
}

export async function playVideoWithAuthenticatedFallback(
  element: HTMLVideoElement,
  sourceUrl: string,
): Promise<string> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  try {
    await element.play();
    return sourceUrl;
  } catch {
    const blobUrl = await authenticatedVideoBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    await element.play();
    return blobUrl;
  }
}

export function waitForStudioMediaReady(element: HTMLMediaElement, timeoutMs = 20_000): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      element.removeEventListener('loadeddata', ready);
      element.removeEventListener('canplay', ready);
      element.removeEventListener('error', failed);
      element.removeEventListener('abort', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => {
      cleanup();
      const code = element.error?.code;
      reject(new Error(code ? `媒体加载失败（code ${code}）` : '媒体加载被中断'));
    };
    element.addEventListener('loadeddata', ready, { once: true });
    element.addEventListener('canplay', ready, { once: true });
    element.addEventListener('error', failed, { once: true });
    element.addEventListener('abort', failed, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new StudioRequestTimeoutError(`媒体准备超过 ${Math.ceil(timeoutMs / 1000)} 秒`));
    }, timeoutMs);
  });
}

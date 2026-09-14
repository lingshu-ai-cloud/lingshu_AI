import { authHeader } from './auth';
import { SOCIAL_CONTENT_MAX_FILE_BYTES, socialContentMimeForFileName } from './socialContentFiles';

export type ManualSocialArtifactMediaSource = Blob | string | null | undefined;

export interface PreparedSocialArtifactMedia {
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}

type MediaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ALLOWED_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

function cleanMime(value: string): string {
  return value.toLowerCase().split(';', 1)[0]!.trim();
}

function extensionFor(mimeType: string): string {
  return ({
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  } as Record<string, string>)[mimeType] || '';
}

function safeName(value: string, mimeType: string, mode: 'video' | 'poster'): string {
  const extension = extensionFor(mimeType);
  const basename = value.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0]
    ?.normalize('NFKC').replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  const fallback = mode === 'video' ? 'social-video' : 'social-poster';
  const stem = (basename || fallback).replace(/\.[^.]+$/, '');
  return `${stem || fallback}.${extension}`;
}

function validateMime(mimeType: string, mode: 'video' | 'poster'): void {
  if (!ALLOWED_MIME.has(mimeType)
    || (mode === 'video' && !mimeType.startsWith('video/'))
    || (mode === 'poster' && !mimeType.startsWith('image/'))) {
    throw new Error(mode === 'video' ? '当前成片不是支持的视频格式，请重新生成' : '当前海报不是支持的图片格式，请重新生成');
  }
}

function resolveStringMediaSource(source: string, origin: string): { target: string; browserOwned: boolean } {
  let target = source.trim();
  if (!target || /^file:/i.test(target) || /^(?:[a-zA-Z]:[\\/]|\/Users\/|\/home\/|\/root\/|\.\.?[\\/])/.test(target)) {
    throw new Error('当前成品无法安全读取，请重新生成');
  }
  const browserOwned = /^(?:blob:|data:)/i.test(target);
  if (/^blob:/i.test(target) && new URL(target).origin !== origin) {
    throw new Error('只可提交当前工作区生成的成品文件');
  }
  if (!browserOwned) {
    const parsed = new URL(target, origin);
    if (parsed.origin !== origin || !allowedStudioPath(parsed.pathname)) {
      throw new Error('只可提交当前工作区生成的成品文件');
    }
    target = parsed.toString();
  }
  return { target, browserOwned };
}

function allowedStudioPath(pathname: string): boolean {
  if (/%2f|%5c/i.test(pathname)) return false;
  return /^\/api\/overseas\/publishing\/local-videos\/[^/]+$/.test(pathname)
    || /^\/api\/overseas\/studio\/private-assets\/materials\/[^/]+$/.test(pathname)
    || /^\/media\/(?:tenants\/[^/]+|shared)\/.+/.test(pathname)
    || /^\/(?:studio-media|cloud-files)\/[^/]+\/(?:media\.mp4|poster\.jpg)$/.test(pathname);
}

function currentOrigin(explicit?: string): string {
  const value = explicit || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!/^https?:\/\//i.test(value)) throw new Error('当前成品无法安全读取，请重新生成');
  return value;
}

function sourceName(source: Blob | string): string {
  if (typeof source !== 'string' && typeof (source as File).name === 'string') return (source as File).name;
  if (typeof source === 'string' && !/^(?:blob:|data:)/i.test(source)) {
    try { return decodeURIComponent(new URL(source, 'http://local.invalid').pathname.split('/').at(-1) || ''); } catch { return ''; }
  }
  return '';
}

async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验成品文件，请升级浏览器后重试');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchMedia(source: string, origin: string, request: MediaFetch): Promise<Blob> {
  const { target, browserOwned } = resolveStringMediaSource(source, origin);
  const response = await request(target, browserOwned ? undefined : {
    headers: authHeader(),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('成品文件读取失败，请重新生成后再提交');
  if (!browserOwned && response.url) {
    const finalUrl = new URL(response.url, origin);
    if (finalUrl.origin !== origin || !allowedStudioPath(finalUrl.pathname)) {
      throw new Error('成品文件来源校验失败，请重新生成');
    }
  }
  const declared = Number(response.headers.get('Content-Length') || 0);
  if (declared > SOCIAL_CONTENT_MAX_FILE_BYTES) throw new Error('成品文件超过 110 MB，请压缩后重试');
  return response.blob();
}

/**
 * A synchronous gate for Studio controls. The actual bytes are still verified by
 * prepareSocialArtifactMedia immediately before upload.
 */
export function isSocialArtifactMediaSourceEligible(input: {
  source: ManualSocialArtifactMediaSource;
  contentMode: 'video' | 'poster';
  origin?: string;
}): boolean {
  if (!input.source) return false;
  if (typeof input.source !== 'string') {
    if (!input.source.size || input.source.size > SOCIAL_CONTENT_MAX_FILE_BYTES) return false;
    try {
      validateMime(cleanMime(input.source.type), input.contentMode);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const origin = /^data:/i.test(input.source)
      ? input.origin || ''
      : currentOrigin(input.origin);
    resolveStringMediaSource(input.source, origin);
    if (/^data:/i.test(input.source)) {
      const mimeType = cleanMime(/^data:([^;,]+)/i.exec(input.source)?.[1] || '');
      validateMime(mimeType, input.contentMode);
    }
    return true;
  } catch {
    return false;
  }
}

export async function prepareSocialArtifactMedia(input: {
  source: ManualSocialArtifactMediaSource;
  contentMode: 'video' | 'poster';
  origin?: string;
  request?: MediaFetch;
}): Promise<PreparedSocialArtifactMedia> {
  if (!input.source) throw new Error(input.contentMode === 'video' ? '请先生成完整成片' : '请先生成完整海报');
  const origin = typeof input.source === 'string' && !/^data:/i.test(input.source)
    ? currentOrigin(input.origin) : input.origin || '';
  const raw = typeof input.source === 'string'
    ? await fetchMedia(input.source, origin, input.request || fetch)
    : input.source;
  if (!raw.size) throw new Error('成品文件为空，请重新生成');
  if (raw.size > SOCIAL_CONTENT_MAX_FILE_BYTES) throw new Error('成品文件超过 110 MB，请压缩后重试');
  const providedName = sourceName(input.source);
  const mimeType = cleanMime(raw.type) || socialContentMimeForFileName(providedName);
  validateMime(mimeType, input.contentMode);
  const blob = raw.type === mimeType ? raw : new Blob([raw], { type: mimeType });
  return {
    blob,
    name: safeName(providedName, mimeType, input.contentMode),
    mimeType,
    size: blob.size,
    sha256: await sha256(blob),
  };
}

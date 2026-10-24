import { AssistantActionError } from '../assistant/actionRouting.js';

const SUPPORTED_VIDEO_PLATFORMS = new Set(['tiktok', 'instagram', 'youtube', 'facebook', 'linkedin']);
const SAFE_MEDIA_URL = /^(?:https?:\/\/|\/(?:api|files|media|uploads)\/)/i;

function invalid(message: string): never {
  throw new AssistantActionError('assistant_thread_message_invalid', 400, message);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== 'string') return invalid(`${label}格式无效。`);
  if (!value.trim()) return invalid(`${label}不能为空。`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) return invalid(`${label}过长。`);
  return value.trim();
}

function mediaUrl(value: unknown, label: string): string {
  const url = text(value, 2_048, label);
  if (!SAFE_MEDIA_URL.test(url) || /[\\\u0000-\u001f]/.test(url)) return invalid(`${label}无效。`);
  return url;
}

export function parseAssistantReferenceMedia(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const source = object(value);
  const platform = String(source?.platform || '');
  if (!source || source.kind !== 'video' || !SUPPORTED_VIDEO_PLATFORMS.has(platform)) {
    return invalid('参考视频格式无效。');
  }
  const duration = source.duration === undefined ? undefined : Number(source.duration);
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0 || duration > 86_400)) {
    return invalid('参考视频时长无效。');
  }
  return {
    kind: 'video',
    title: text(source.title, 500, '参考视频标题'),
    platform,
    ...(source.referenceId === undefined ? {} : { referenceId: text(source.referenceId, 256, '参考视频编号') }),
    ...(source.thumbnailUrl === undefined ? {} : { thumbnailUrl: mediaUrl(source.thumbnailUrl, '参考视频封面') }),
    ...(source.mediaUrl === undefined ? {} : { mediaUrl: mediaUrl(source.mediaUrl, '参考视频媒体地址') }),
    ...(source.sourceUrl === undefined ? {} : { sourceUrl: mediaUrl(source.sourceUrl, '参考视频来源地址') }),
    ...(duration === undefined ? {} : { duration }),
  };
}

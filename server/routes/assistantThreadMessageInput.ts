import { AssistantActionError } from '../assistant/actionRouting.js';
import { creationReplySchema } from '../../shared/contracts/contentCreationDialogue.js';
import { parseAssistantReferenceMedia } from './assistantThreadReferenceMedia.js';

export const MAX_MESSAGES = 120;
export const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_MESSAGE_SOURCES = 8;

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function threadInputError(code: string, message: string, status = 400): never {
  throw new AssistantActionError(code, status, message);
}

export function boundedText(value: unknown, maxBytes: number, code: string, label: string, required = false): string {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    return threadInputError(code, `${label}格式无效。`);
  }
  const normalized = value.trim();
  if ((required && !normalized) || byteLength(value) > maxBytes) {
    return threadInputError(code, `${label}${required && !normalized ? '不能为空' : '过长'}。`);
  }
  return value;
}

export function parseMessages(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    return threadInputError('assistant_thread_messages_invalid', `会话最多保留 ${MAX_MESSAGES} 条消息。`, 413);
  }
  return value.map(item => {
    const source = object(item);
    if (!source || !['user', 'assistant'].includes(String(source.role))) {
      return threadInputError('assistant_thread_message_invalid', '会话消息无效。');
    }
    const content = boundedText(source.content, MAX_MESSAGE_BYTES, 'assistant_thread_message_invalid', '会话消息');
    let sources: Array<{ title: string; uri: string }> | undefined;
    if (source.sources !== undefined) {
      if (!Array.isArray(source.sources) || source.sources.length > MAX_MESSAGE_SOURCES) {
        return threadInputError('assistant_thread_message_invalid', '消息来源数量无效。');
      }
      sources = source.sources.map(item => {
        const entry = object(item);
        if (!entry) return threadInputError('assistant_thread_message_invalid', '消息来源无效。');
        return {
          title: boundedText(entry.title, 240, 'assistant_thread_message_invalid', '消息来源名称', true).trim(),
          uri: boundedText(entry.uri, 2_048, 'assistant_thread_message_invalid', '消息来源地址', true).trim(),
        };
      });
    }
    const creation = source.creation === undefined ? undefined : creationReplySchema.safeParse(source.creation);
    if (creation && !creation.success) return threadInputError('assistant_creation_invalid', '创作消息格式无效。');
    const referenceMedia = parseAssistantReferenceMedia(source.referenceMedia);
    return { role: source.role, content, ...(sources ? { sources } : {}), ...(creation?.success ? { creation: creation.data } : {}), ...(referenceMedia ? { referenceMedia } : {}) };
  });
}

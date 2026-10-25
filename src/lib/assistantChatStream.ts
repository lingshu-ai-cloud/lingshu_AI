import type { Message } from '../App';
import type { AssistantFileIntent } from '../../shared/assistantFileIntent';
import { assistantFileMarker } from '../../shared/assistantFileIntent';
import { createAssistantFile } from './assistantFilesApi';
import { AssistantStreamCompletion } from './assistantStreamCompletion';
import { assistantTaskPortalSchema } from '../../shared/contracts/assistantTaskPortal';

const ASSISTANT_CHAT_RESPONSE_TIMEOUT_MS = 20_000;
const ASSISTANT_CHAT_STREAM_IDLE_TIMEOUT_MS = 30_000;

export class AssistantRequestTimeoutError extends Error {}

function withAssistantTimeout<T>(
  promise: Promise<T>, timeoutMs: number, onTimeout: () => void, message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      onTimeout();
      reject(new AssistantRequestTimeoutError(message));
    }, timeoutMs);
    promise.then(
      value => { window.clearTimeout(timeoutId); resolve(value); },
      error => { window.clearTimeout(timeoutId); reject(error); },
    );
  });
}

export async function streamAssistantReply(input: {
  endpoint: string;
  headers: HeadersInit;
  body: unknown;
  controller: AbortController;
  fileIntent: AssistantFileIntent | null;
  fileTitle: string;
  isCurrent: () => boolean;
  onStart: () => void;
  onText: (text: string) => void;
  onSources: (sources: NonNullable<Message['sources']>) => void;
  onTaskPortal?: (portal: NonNullable<Message['taskPortal']>) => void;
  onFileReady: (content: string) => void;
  onTimeout: () => void;
  responseErrorMessage: (response: Response) => Promise<string>;
}): Promise<void> {
  const {
    endpoint, headers, body, controller, fileIntent, fileTitle, isCurrent,
    onStart, onText, onSources, onFileReady, onTimeout, responseErrorMessage,
  } = input;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let fileBody = '';
  let fileStreamError = '';
  try {
    const response = await withAssistantTimeout(
      fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal }),
      ASSISTANT_CHAT_RESPONSE_TIMEOUT_MS,
      () => { onTimeout(); controller.abort(); },
      '模型连接在 20 秒内没有返回响应。',
    );
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(await responseErrorMessage(response));
    if (!response.body) throw new Error('模型响应为空，请稍后重试。');
    onStart();
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const completion = new AssistantStreamCompletion();
    const consumeLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      try {
        const event = completion.accept(line.slice(6).trim());
        if (!event) return;
        const portal = assistantTaskPortalSchema.safeParse(event.taskPortal);
        if (!fileIntent && portal.success && portal.data.phase === 'offered') input.onTaskPortal?.(portal.data);
        if (event.text) {
          if (fileIntent) fileBody += event.text;
          else onText(event.text);
        } else if (event.sources?.length) onSources(event.sources);
        else if (event.error) fileStreamError = event.error;
      } catch {
        // Ignore malformed stream chunks; completion validates the final marker.
      }
    };
    while (true) {
      const { done, value } = await withAssistantTimeout(
        reader.read(), ASSISTANT_CHAT_STREAM_IDLE_TIMEOUT_MS,
        () => { onTimeout(); controller.abort(); void reader?.cancel(); },
        '模型流式回答超过 30 秒没有新内容。',
      );
      if (!isCurrent()) return;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
    completion.assertComplete();
    if (!fileIntent || !isCurrent()) return;
    if (fileStreamError || !fileBody.trim()) throw new Error('文件内容未完整生成，请重试。');
    const file = await withAssistantTimeout(
      createAssistantFile({ title: fileTitle, content: fileBody, format: fileIntent.format, diagram: fileIntent.diagram }, controller.signal),
      50_000, () => controller.abort(), '文件生成超时，请重试。',
    );
    if (isCurrent()) onFileReady(`已生成 ${fileIntent.format.toUpperCase()} 文件，可在下方下载。\n${assistantFileMarker(file.id)}`);
  } finally {
    if (reader) void reader.cancel().catch(() => {});
  }
}

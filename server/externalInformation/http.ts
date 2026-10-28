import { createLinkedAbort } from '../lib/abort.js';

export class ExternalInformationError extends Error {
  constructor(readonly code: string, message: string, readonly sources?: Array<{ title: string; uri: string }>) { super(message); }
}

/** Fixed provider URLs only; callers never pass a user-supplied URL or retry. */
export async function externalJson(url: URL, options: {
  signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch; init?: RequestInit;
} = {}): Promise<unknown> {
  const body = await externalText(url, options);
  try { return JSON.parse(body); }
  catch { throw new ExternalInformationError('external_invalid_response', '外部数据格式异常，本次未采用。'); }
}

/** Bounded transport shared by fixed data endpoints and allowlisted public source verification. */
export async function externalText(url: URL, options: {
  signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch; init?: RequestInit;
} = {}): Promise<string> {
  const deadline = createLinkedAbort({ parentSignal: options.signal, timeoutMs: options.timeoutMs ?? 10_000 });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetcher ?? fetch)(url, { ...options.init, redirect: 'error', signal: deadline.signal });
    if (!response.ok) {
      if (response.status === 403 && url.hostname === 'maas.qianwenaiapi.com') {
        const rejection = await response.json().catch(() => null) as { code?: unknown } | null;
        if (rejection?.code === 'AccessDenied.Unpurchased') {
          throw new ExternalInformationError('qwen_model_access_denied', '千问暂未授予模型调用权限，请检查千问账户余额及模型开通状态后重试。');
        }
      }
      if (!response.bodyUsed) await response.body?.cancel();
      throw new ExternalInformationError(response.status === 429 ? 'external_rate_limited' : 'external_http_error',
        response.status === 429 ? '数据源暂时限流，请稍后再查。' : '外部数据源暂时不可用，请稍后再查。');
    }
    reader = response.body?.getReader();
    if (!reader) throw new ExternalInformationError('external_invalid_response', '外部数据源返回了空响应。');
    const decoder = new TextDecoder();
    let size = 0, body = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) throw new ExternalInformationError('external_response_too_large', '外部数据超出本次查询范围，请缩小查询条件。');
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    if (error instanceof ExternalInformationError) throw error;
    throw new ExternalInformationError(deadline.timedOut ? 'external_timeout' : 'external_unavailable', '外部查询暂未完成，本次没有取得可核验结果。');
  } finally {
    await reader?.cancel().catch(() => {});
    deadline.cleanup();
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

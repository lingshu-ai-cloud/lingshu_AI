const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(?:^|[_-])(?:access|refresh|id)?token(?:$|[_-])|password|passwd|secret|cookie|authorization|api[_-]?key|oauth[_-]?token/i;

/** Redacts credentials while keeping JSON and CLI diagnostics useful. */
export function redactText(input: string): string {
  return input
    .replace(
      /((?:"|')?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|api[_-]?key|password|passwd|secret|cookie|authorization)(?:"|')?\s*:\s*)(["'])(.*?)\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /\b(access_token|refresh_token|id_token|oauth_token|api_key|password|passwd|secret|cookie|authorization)=([^\s&]+)/gi,
      `$1=${REDACTED}`,
    );
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry, seen);
  }
  return result;
}

export function safeEvent<T>(event: T): T {
  return redactValue(event) as T;
}

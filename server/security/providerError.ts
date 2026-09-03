function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function redact(value: string): string {
  return value
    .replace(/((?:access|refresh)[_-]?token|client[_-]?secret|app[_-]?secret|authorization)\s*[:=]\s*[^\s,;&]+/gi, '$1=[REDACTED]')
    .replace(/\b(?:Bearer\s+)?(?:ya29\.|1\/\/|EA[A-Za-z0-9]|EAA)[A-Za-z0-9._~+\/-]{8,}\b/gi, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
}

/**
 * Returns a deliberately small log payload. Never pass the provider error
 * object itself to a logger: Axios attaches request headers and bodies to it.
 */
export function safeProviderError(error: unknown): {
  status: number | null;
  code: string;
  message: string;
} {
  const candidate = error && typeof error === 'object' ? error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: unknown };
  } : {};
  const data = candidate.response?.data && typeof candidate.response.data === 'object'
    ? candidate.response.data as { error_description?: unknown; error?: unknown; message?: unknown }
    : {};
  const nestedError = data.error && typeof data.error === 'object'
    ? data.error as { message?: unknown; code?: unknown }
    : {};
  const rawStatus = Number(candidate.response?.status ?? candidate.status);
  return {
    status: Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null,
    code: redact(scalar(candidate.code) || scalar(nestedError.code)).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80),
    message: redact(
      scalar(data.error_description)
      || scalar(nestedError.message)
      || scalar(data.message)
      || scalar(candidate.message)
      || 'provider_request_failed',
    ),
  };
}

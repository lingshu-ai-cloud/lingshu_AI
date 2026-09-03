function safePathFilename(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  try {
    const decoded = decodeURIComponent(value);
    return Boolean(decoded) && !/[\\/]/.test(decoded) && decoded !== '.' && decoded !== '..';
  } catch {
    return false;
  }
}

/**
 * Store only the tenant-scoped canonical audio path in a long-lived job.
 * HMAC query tokens are intentionally discarded and reissued when a Worker
 * claims the job, so a queue wait cannot expire the Worker input.
 */
export function canonicalDigitalHumanVoiceoverPath(value: unknown, tenantId: string): string {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1200 || raw.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(raw)) return '';
  let pathname = '';
  try { pathname = new URL(raw, 'http://local').pathname; } catch { return ''; }

  const privateMatch = pathname.match(/^\/api\/overseas\/studio\/private-assets\/tts\/([^/]+)$/);
  if (privateMatch && safePathFilename(privateMatch[1]!)) return pathname;

  const localMatch = pathname.match(/^\/tts\/tenants\/([^/]+)\/([^/]+)$/);
  if (!localMatch || !safePathFilename(localMatch[2]!)) return '';
  try {
    return decodeURIComponent(localMatch[1]!) === tenantId ? pathname : '';
  } catch {
    return '';
  }
}

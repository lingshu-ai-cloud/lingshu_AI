import { isIP } from 'node:net';

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export function isBlockedWebhookLiteralHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const family = isIP(host);
  if (family === 4) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (family === 6) {
    if (host === '::' || host === '::1' || host.startsWith('::ffff:')) return true;
    const first = Number.parseInt(host.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

export function validateOutboxWebhookTarget(input: {
  rawUrl: string;
  production: boolean;
  allowedOrigins?: string;
}): URL {
  let target: URL;
  try { target = new URL(input.rawUrl); } catch { throw new Error('digital_employee_webhook_url_invalid'); }
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('digital_employee_webhook_protocol_invalid');
  if (target.username || target.password) throw new Error('digital_employee_webhook_credentials_forbidden');
  if (isBlockedWebhookLiteralHost(target.hostname)) throw new Error('digital_employee_webhook_private_host_forbidden');
  if (!input.production) return target;
  if (target.protocol !== 'https:') throw new Error('digital_employee_webhook_https_required');
  const rawOrigins = String(input.allowedOrigins || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!rawOrigins.length) throw new Error('digital_employee_webhook_allowed_origins_required');
  const allowed = new Set<string>();
  for (const rawOrigin of rawOrigins) {
    let candidate: URL;
    try { candidate = new URL(rawOrigin); } catch { throw new Error('digital_employee_webhook_allowed_origin_invalid'); }
    if (candidate.protocol !== 'https:' || candidate.username || candidate.password
      || candidate.pathname !== '/' || candidate.search || candidate.hash
      || isBlockedWebhookLiteralHost(candidate.hostname)) {
      throw new Error('digital_employee_webhook_allowed_origin_invalid');
    }
    allowed.add(candidate.origin);
  }
  if (!allowed.has(target.origin)) throw new Error('digital_employee_webhook_origin_not_allowed');
  return target;
}

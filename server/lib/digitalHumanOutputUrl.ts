/** Cloud output trust must not depend on a configured local GPU endpoint. */
export function trustedDigitalHumanOutputUrl(value: unknown, providerId: string | undefined, localBaseUrl: string, extraHosts = ''): string {
  let output: URL;
  try { output = new URL(String(value || '').trim()); } catch { return ''; }
  if (output.username || output.password) return '';
  if (providerId === 'heygen') {
    if (output.protocol !== 'https:' || (output.port && output.port !== '443')) return '';
    return /(^|\.)heygen\.(ai|com)$/.test(output.hostname) ? output.toString() : '';
  }
  if (!['https:', 'http:'].includes(output.protocol)) return '';
  let local: URL;
  try { local = new URL(localBaseUrl); } catch { return ''; }
  const allowed = new Set([local.host, ...extraHosts.split(',').map(host => host.trim()).filter(Boolean)]);
  return allowed.has(output.host) ? output.toString() : '';
}

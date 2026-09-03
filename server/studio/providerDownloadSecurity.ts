import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { isPrivateOrReservedAddress } from './renderAssetPolicy.js';

export class ProviderDownloadSecurityError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProviderDownloadSecurityError';
    this.code = code;
  }
}

function normalizedSuffixes(values: Iterable<string>): string[] {
  return Array.from(values)
    .map(value => String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function hostAllowed(hostname: string, suffixes: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

async function assertPublicHostname(
  hostname: string,
  resolveHostname?: (hostname: string) => Promise<string[]>,
): Promise<void> {
  const addresses = isIP(hostname)
    ? [hostname]
    : resolveHostname
      ? await resolveHostname(hostname).catch(() => [])
      : (await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [])).map(item => item.address);
  if (!addresses.length || addresses.some(isPrivateOrReservedAddress)) {
    throw new ProviderDownloadSecurityError('provider_asset_private_network_forbidden');
  }
}

export async function validateProviderAssetUrl(input: {
  rawUrl: string;
  allowedHostSuffixes: Iterable<string>;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}): Promise<URL> {
  let url: URL;
  try { url = new URL(String(input.rawUrl || '').trim()); }
  catch { throw new ProviderDownloadSecurityError('provider_asset_url_invalid'); }
  const suffixes = normalizedSuffixes(input.allowedHostSuffixes);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !url.hostname || !suffixes.length || !hostAllowed(url.hostname, suffixes)) {
    throw new ProviderDownloadSecurityError('provider_asset_url_forbidden');
  }
  await assertPublicHostname(url.hostname, input.resolveHostname);
  return url;
}

export async function readBoundedProviderResponse(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new ProviderDownloadSecurityError('provider_asset_too_large');
  }
  if (!response.body) throw new ProviderDownloadSecurityError('provider_asset_empty');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      received += chunk.length;
      if (received > maximumBytes) {
        await reader.cancel('provider asset too large').catch(() => undefined);
        throw new ProviderDownloadSecurityError('provider_asset_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!received) throw new ProviderDownloadSecurityError('provider_asset_empty');
  return Buffer.concat(chunks, received);
}

export async function downloadProviderAsset(input: {
  rawUrl: string;
  allowedHostSuffixes: Iterable<string>;
  maximumBytes: number;
  allowedContentTypes: Iterable<string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}): Promise<{ bytes: Buffer; contentType: string; url: URL }> {
  const maximumBytes = Math.max(1, Math.floor(input.maximumBytes));
  const url = await validateProviderAssetUrl(input);
  const response = await (input.fetchImpl || fetch)(url, {
    method: 'GET',
    signal: input.signal,
    // A redirect must be validated as a new provider response; silently
    // following one would bypass both the host allow-list and DNS check.
    redirect: 'error',
  });
  if (!response.ok) throw new ProviderDownloadSecurityError(`provider_asset_http_${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  const allowed = normalizedSuffixes(input.allowedContentTypes);
  if (!contentType || !allowed.some(type => type.endsWith('/') ? contentType.startsWith(type) : contentType === type)) {
    throw new ProviderDownloadSecurityError('provider_asset_content_type_forbidden');
  }
  return { bytes: await readBoundedProviderResponse(response, maximumBytes), contentType, url };
}

export function localStudioTtsFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && String(env.STUDIO_TTS_ALLOW_LOCAL_FALLBACK || 'true').toLowerCase() !== 'false';
}

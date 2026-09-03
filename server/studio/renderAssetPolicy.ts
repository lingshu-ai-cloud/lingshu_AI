import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { verifyAssetToken } from '../lib/assetAccess.js';

type AssetKind = 'visual' | 'audio' | 'cover';

const DATA_MIME_BY_KIND: Record<AssetKind, Set<string>> = {
  visual: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
  audio: new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/aac']),
  cover: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
};

export class RenderAssetPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'RenderAssetPolicyError';
    this.code = code;
  }
}

function configuredBytes(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = Number(process.env[name]);
  const value = Number.isFinite(configured) ? configured : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}

function dataUriBytes(value: string, kind: AssetKind): number {
  const comma = value.indexOf(',');
  if (comma < 0) throw new RenderAssetPolicyError('render_asset_data_uri_invalid');
  const header = value.slice(5, comma).toLowerCase();
  const body = value.slice(comma + 1);
  const parts = header.split(';');
  const mime = parts.shift() || '';
  if (parts.length !== 1 || parts[0] !== 'base64' || !DATA_MIME_BY_KIND[kind].has(mime)) {
    throw new RenderAssetPolicyError('render_asset_data_mime_forbidden');
  }
  if (!body || !/^[a-z0-9+/]*={0,2}$/i.test(body) || body.length % 4 === 1) {
    throw new RenderAssetPolicyError('render_asset_data_base64_invalid');
  }
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(body.length * 3 / 4) - padding);
}

function signedSameOriginTenant(url: URL, tenantId: string): boolean {
  const token = url.searchParams.get('assetToken');
  if (token) {
    if (Array.from(url.searchParams.keys()).some(key => key !== 'assetToken')) return false;
    return verifyAssetToken(token, url.pathname)?.tenantId === tenantId;
  }
  const match = url.pathname.match(/^\/(cloud-files|studio-media)\/([^/]+)\/signed\/([^/]+)\/([^/]+)$/);
  if (!match || url.search) return false;
  const originalPath = `/${match[1]}/${match[2]}/${match[4]}`;
  return verifyAssetToken(match[3], originalPath)?.tenantId === tenantId;
}

function supportedSameOriginPath(pathname: string): boolean {
  return /^\/(?:media|bgm|tts|covers)\//.test(pathname)
    || /^\/(?:cloud-files|studio-media)\//.test(pathname)
    || /^\/api\/overseas\/studio\/(?:private-assets|materials\/pb)\//.test(pathname);
}

function objectKeyForSignedUrl(url: URL, allowedObjectKeys: Set<string>): string | null {
  if (!url.searchParams.has('X-Amz-Signature') || !url.searchParams.has('X-Amz-Credential')) return null;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  return Array.from(allowedObjectKeys).find(key => pathname === `/${key}` || pathname.endsWith(`/${key}`)) || null;
}

function privateOrReservedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 2, 168].includes(b))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0);
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0];
  if (isIP(normalized) === 4) return privateOrReservedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return privateOrReservedIpv4(mapped);
  const mappedHex = normalized.match(/::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return privateOrReservedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

async function assertPublicObjectStorageHost(hostname: string, resolveHostname?: (hostname: string) => Promise<string[]>): Promise<void> {
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new RenderAssetPolicyError('render_asset_private_network_forbidden');
  }
  const addresses = isIP(hostname)
    ? [hostname]
    : resolveHostname
      ? await resolveHostname(hostname).catch(() => [])
      : (await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [])).map(item => item.address);
  if (!addresses.length || addresses.some(isPrivateOrReservedAddress)) {
    throw new RenderAssetPolicyError('render_asset_private_network_forbidden');
  }
}

function assetUrls(manifest: unknown): Array<{ value: string; kind: AssetKind }> {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new RenderAssetPolicyError('render_manifest_invalid');
  }
  const value = manifest as Record<string, unknown>;
  const timeline = Array.isArray(value.timeline) ? value.timeline : [];
  if (timeline.length > 60) throw new RenderAssetPolicyError('render_timeline_too_large');
  if (timeline.some(item => !item || typeof item !== 'object' || !String((item as Record<string, unknown>).url || '').trim())) {
    throw new RenderAssetPolicyError('render_timeline_asset_missing');
  }
  const result: Array<{ value: string; kind: AssetKind }> = timeline.map(item => ({
    value: String(item && typeof item === 'object' ? (item as Record<string, unknown>).url || '' : '').trim(),
    kind: 'visual' as const,
  })).filter(item => item.value);
  for (const [field, kind] of [['voiceover', 'audio'], ['bgm', 'audio'], ['cover', 'cover']] as const) {
    const nested = value[field];
    const url = String(nested && typeof nested === 'object' ? (nested as Record<string, unknown>).url || '' : '').trim();
    if (url) result.push({ value: url, kind });
  }
  return result;
}

export async function validateRenderManifestAssets(input: {
  manifest: unknown;
  origin: string;
  tenantId: string;
  objectStorageOrigin?: string;
  allowedObjectKeys?: Iterable<string>;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}): Promise<void> {
  const origin = new URL(input.origin).origin;
  const objectStorageOrigin = input.objectStorageOrigin ? new URL(input.objectStorageOrigin).origin : '';
  const allowedObjectKeys = new Set(Array.from(input.allowedObjectKeys || []).filter(Boolean));
  const perAssetLimit = configuredBytes('RENDER_INLINE_ASSET_MAX_BYTES', 25 * 1024 * 1024, 1, 100 * 1024 * 1024);
  const totalLimit = configuredBytes('RENDER_INLINE_TOTAL_MAX_BYTES', 75 * 1024 * 1024, perAssetLimit, 120 * 1024 * 1024);
  const validatedExternalHosts = new Set<string>();
  let inlineTotal = 0;

  for (const asset of assetUrls(input.manifest)) {
    if (asset.value.startsWith('data:')) {
      const size = dataUriBytes(asset.value, asset.kind);
      if (size <= 0 || size > perAssetLimit) throw new RenderAssetPolicyError('render_asset_data_too_large');
      inlineTotal += size;
      if (inlineTotal > totalLimit) throw new RenderAssetPolicyError('render_asset_data_total_too_large');
      continue;
    }
    if (asset.value.length > 8_192) throw new RenderAssetPolicyError('render_asset_url_too_long');
    let parsed: URL;
    try { parsed = new URL(asset.value); } catch { throw new RenderAssetPolicyError('render_asset_url_invalid'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new RenderAssetPolicyError('render_asset_protocol_forbidden');
    }
    if (parsed.origin === origin) {
      if (!supportedSameOriginPath(parsed.pathname) || !signedSameOriginTenant(parsed, input.tenantId)) {
        throw new RenderAssetPolicyError('render_asset_same_origin_signature_invalid');
      }
      continue;
    }
    if (parsed.protocol !== 'https:' || !objectStorageOrigin || parsed.origin !== objectStorageOrigin || !objectKeyForSignedUrl(parsed, allowedObjectKeys)) {
      throw new RenderAssetPolicyError('render_asset_external_url_forbidden');
    }
    if (!validatedExternalHosts.has(parsed.hostname)) {
      await assertPublicObjectStorageHost(parsed.hostname, input.resolveHostname);
      validatedExternalHosts.add(parsed.hostname);
    }
  }
}

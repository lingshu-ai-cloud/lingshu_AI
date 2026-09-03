import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PUBLISH_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const PUBLISH_VIDEO_REFERENCE_PREFIX = 'lingshu-video:v1:';

export function publishingUploadDir(tenantId: string): string {
  const rawTenantId = String(tenantId || '').trim();
  const tenantFolder = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(rawTenantId)
    && rawTenantId !== '.' && rawTenantId !== '..'
    ? rawTenantId
    : `tenant-${createHash('sha256').update(rawTenantId || 'missing-tenant').digest('hex')}`;
  return path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantFolder);
}

function pathFromPublishingReference(tenantId: string, value: string): string | null {
  if (!value.startsWith(PUBLISH_VIDEO_REFERENCE_PREFIX)) return null;
  const encoded = value.slice(PUBLISH_VIDEO_REFERENCE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{2,684}$/.test(encoded)) return null;
  try {
    const filename = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!filename || filename === '.' || filename === '..' || filename.includes('\0')
      || path.basename(filename) !== filename || Buffer.byteLength(filename, 'utf8') > 512) return null;
    return path.join(publishingUploadDir(tenantId), filename);
  } catch {
    return null;
  }
}

function normalizedPath(tenantId: string, value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (raw.startsWith(PUBLISH_VIDEO_REFERENCE_PREFIX)) return pathFromPublishingReference(tenantId, raw);
  try {
    return raw.startsWith('file://') ? path.resolve(fileURLToPath(raw)) : path.resolve(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve a renderer/upload-owned video for one tenant. Both the lexical path
 * and the final realpath are checked so `..` and symlinks cannot cross tenant
 * storage boundaries.
 */
export function resolveTenantPublishingVideo(
  tenantId: string,
  value: unknown,
  options: { extensions?: readonly string[]; mustExist?: boolean } = {},
): string | null {
  const requested = normalizedPath(tenantId, value);
  if (!requested) return null;
  const root = publishingUploadDir(tenantId);
  if (!requested.startsWith(`${root}${path.sep}`)) return null;
  const allowedExtensions = options.extensions || [...PUBLISH_VIDEO_EXTENSIONS];
  if (!allowedExtensions.includes(path.extname(requested).toLowerCase())) return null;
  if (options.mustExist === false) return requested;
  try {
    const [realRoot, realFile] = [fs.realpathSync(root), fs.realpathSync(requested)];
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
    if (!allowedExtensions.includes(path.extname(realFile).toLowerCase())) return null;
    return fs.statSync(realFile).isFile() ? realFile : null;
  } catch {
    return null;
  }
}

/** Convert an internal path into a tenant-scoped opaque browser/API reference. */
export function publishingVideoReference(tenantId: string, value: unknown): string {
  const resolved = resolveTenantPublishingVideo(tenantId, value);
  if (!resolved) return '';
  return `${PUBLISH_VIDEO_REFERENCE_PREFIX}${Buffer.from(path.basename(resolved), 'utf8').toString('base64url')}`;
}

/**
 * Hash the bytes of a tenant-owned publishing artifact without loading a
 * potentially multi-gigabyte video into memory. The path is resolved again
 * here so callers cannot accidentally hash a file outside the tenant root.
 */
export async function tenantPublishingVideoSha256(
  tenantId: string,
  value: unknown,
  options: { extensions?: readonly string[] } = {},
): Promise<{ filePath: string; sha256: string; size: number; mtimeMs: number }> {
  const filePath = resolveTenantPublishingVideo(tenantId, value, { extensions: options.extensions });
  if (!filePath) throw new Error('publishing_video_outside_tenant_storage');
  const before = fs.statSync(filePath);
  if (!before.isFile()) throw new Error('publishing_video_not_a_file');
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  const after = fs.statSync(filePath);
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error('publishing_video_changed_while_hashing');
  }
  return { filePath, sha256: digest.digest('hex'), size: after.size, mtimeMs: after.mtimeMs };
}

export function hasSupportedVideoContainerSignature(filePath: string): boolean {
  try {
    const handle = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(16);
      const bytes = fs.readSync(handle, header, 0, header.length, 0);
      if (bytes < 12) return false;
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.mp4' || ext === '.mov') return header.subarray(4, 8).toString('ascii') === 'ftyp';
      if (ext === '.webm' || ext === '.mkv') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if (ext === '.avi') return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 11).toString('ascii') === 'AVI';
      return false;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function configuredPublicVideoOrigins(): Set<string> {
  const candidates = [
    process.env.R2_PUBLIC_URL,
    ...(process.env.PUBLISH_VIDEO_URL_ALLOWED_ORIGINS || '').split(','),
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') origins.add(parsed.origin);
    } catch { /* Ignore malformed configuration; readiness should report it. */ }
  }
  return origins;
}

/** Only explicitly configured HTTPS origins can be handed to a social platform. */
export function normalizeApprovedPublicVideoUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return configuredPublicVideoOrigins().has(parsed.origin) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

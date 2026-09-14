import { createHash } from 'node:crypto';
import type { SocialArtifactMediaDescriptor } from './socialArtifactMedia.js';
import {
  socialDeliveryArchiveEntries,
  socialDeliveryArtifactDirectory,
  type SocialDeliveryManifest,
} from './socialDeliveryArchive.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

type MediaLoader = (descriptor: SocialArtifactMediaDescriptor) => Promise<AsyncIterable<Uint8Array>>;

interface StreamEntry {
  name: string;
  size: number;
  sha256?: string;
  open: () => Promise<AsyncIterable<Uint8Array>>;
}

const ZIP_UTF8_DATA_DESCRIPTOR_FLAG = 0x0808;
const ZIP_MINIMUM_DATE = 0x0021;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024;

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crcUpdate(current: number, bytes: Uint8Array): number {
  let value = current;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return value >>> 0;
}

function safeMediaName(value: string, mimeType: string): string {
  const extension: Record<string, string> = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  const parsed = value.normalize('NFKC').split(/[\\/]/).at(-1)?.replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 160) || 'media';
  const suffix = extension[mimeType];
  if (!suffix) throw new SocialContentWorkflowError('social_delivery_media_type_invalid', 503);
  return parsed.toLowerCase().endsWith(`.${suffix}`) ? parsed : `${parsed.replace(/\.[^.]+$/, '')}.${suffix}`;
}

async function* oneBuffer(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

function entries(manifest: SocialDeliveryManifest, loadMedia: MediaLoader): StreamEntry[] {
  const result: StreamEntry[] = socialDeliveryArchiveEntries(manifest).map(entry => ({
    name: entry.name,
    size: entry.bytes.length,
    open: async () => oneBuffer(entry.bytes),
  }));
  for (const media of manifest.media) {
    const artifactIndex = manifest.artifacts.findIndex(item => item.artifactId === media.artifactId);
    if (artifactIndex < 0) throw new SocialContentWorkflowError('social_delivery_package_integrity_violation', 503);
    const directory = socialDeliveryArtifactDirectory(manifest.artifacts[artifactIndex]!, artifactIndex);
    result.push({
      name: `${directory}/media/${safeMediaName(media.name, media.mimeType)}`,
      size: media.size,
      sha256: media.sha256,
      open: () => loadMedia(media),
    });
  }
  const names = new Set(result.map(entry => entry.name));
  if (!result.length || result.length > MAX_ARCHIVE_ENTRIES || names.size !== result.length) {
    throw new SocialContentWorkflowError('social_delivery_archive_limit_exceeded', 503);
  }
  return result;
}

async function digestEntry(entry: StreamEntry): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const value of await entry.open()) {
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > entry.size) throw new SocialContentWorkflowError('social_delivery_media_integrity_violation', 503);
    hash.update(chunk);
  }
  if (size !== entry.size || (entry.sha256 && hash.digest('hex') !== entry.sha256)) {
    throw new SocialContentWorkflowError('social_delivery_media_integrity_violation', 503);
  }
}

/** Verify frozen sizes and SHA-256 values before response headers are committed. */
export async function verifySocialDeliveryArchiveMedia(manifest: SocialDeliveryManifest, loadMedia: MediaLoader): Promise<void> {
  for (const entry of entries(manifest, loadMedia)) {
    if (entry.sha256) await digestEntry(entry);
  }
}

export function socialDeliveryArchiveContentLength(manifest: SocialDeliveryManifest, loadMedia: MediaLoader): number {
  const planned = entries(manifest, loadMedia);
  const total = planned.reduce((sum, entry) => {
    const nameBytes = Buffer.byteLength(entry.name, 'utf8');
    return sum + 30 + nameBytes + entry.size + 16 + 46 + nameBytes;
  }, 22);
  if (!Number.isSafeInteger(total) || total > MAX_ARCHIVE_BYTES || total > 0xffffffff) {
    throw new SocialContentWorkflowError('social_delivery_archive_limit_exceeded', 503);
  }
  return total;
}

/** Stream a deterministic ZIP without collecting large media files in process memory. */
export async function* streamSocialDeliveryArchive(
  manifest: SocialDeliveryManifest,
  loadMedia: MediaLoader,
): AsyncGenerator<Uint8Array> {
  const planned = entries(manifest, loadMedia);
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of planned) {
    const name = Buffer.from(entry.name, 'utf8');
    if (!name.length || name.length > 65_535 || entry.size > 0xffffffff) {
      throw new SocialContentWorkflowError('social_delivery_archive_limit_exceeded', 503);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(ZIP_UTF8_DATA_DESCRIPTOR_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(ZIP_MINIMUM_DATE, 12);
    local.writeUInt16LE(name.length, 26);
    yield local;
    yield name;

    const hash = createHash('sha256');
    let crc = 0xffffffff;
    let size = 0;
    for await (const value of await entry.open()) {
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > entry.size) throw new SocialContentWorkflowError('social_delivery_media_integrity_violation', 503);
      crc = crcUpdate(crc, chunk);
      hash.update(chunk);
      yield chunk;
    }
    if (size !== entry.size || (entry.sha256 && hash.digest('hex') !== entry.sha256)) {
      throw new SocialContentWorkflowError('social_delivery_media_integrity_violation', 503);
    }
    const checksum = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(ZIP_UTF8_DATA_DESCRIPTOR_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(ZIP_MINIMUM_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + size + descriptor.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  for (const part of centralParts) yield part;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(planned.length, 8);
  end.writeUInt16LE(planned.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}

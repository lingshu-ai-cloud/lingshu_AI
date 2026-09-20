import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SocialContentFile } from '../../shared/contracts/socialContentWorkflow.js';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { upsertSocialTaskMaterial, type MaterialRecord } from '../lib/materialLibrary.js';
import {
  materialAssetObjectKey,
  materialAssetTenantKey,
  materialAssetTypeAllowed,
  tenantPrivateObjectKey,
} from '../storage/materialAssets.js';
import { objectStorageEnabled, r2GetObject, r2Head, r2UploadFile } from '../storage/r2.js';
import {
  acquireDurableOperationLease,
  releaseDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import { socialTaskFileCapacity } from './socialContentLimits.js';
import { requireSocialTask } from './socialContentRecords.js';
import {
  SocialContentWorkflowError,
  socialPublicId,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';

export const MAX_SOCIAL_CONTENT_FILE_BYTES = 110 * 1024 * 1024;
export const MAX_CONCURRENT_SOCIAL_CONTENT_UPLOADS = 16;
const ROOT = path.resolve(process.cwd(), 'data', 'social-content-sources');
const TEMP = path.resolve(process.cwd(), 'data', 'social-content-upload-temp');
const MATERIAL_ROOT = path.resolve(process.cwd(), 'data', 'media');
const UPLOAD_POOL_TENANT = 'starter198-social-upload-pool';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export interface StoredSocialContentFile {
  storageKind: 'local' | 'object';
  storageKey: string;
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

async function acquireUploadLease(input: {
  repository: Starter198Repository;
  tenantId: string;
  scope: string;
  subjectId: string;
  ownerId: string;
}): Promise<DurableOperationLease | null> {
  if (!input.repository.dataStore) {
    if (process.env.NODE_ENV === 'production') {
      throw new SocialContentWorkflowError('social_content_upload_admission_unavailable', 503);
    }
    return null;
  }
  try {
    return await acquireDurableOperationLease({
      dataStore: input.repository.dataStore,
      tenantId: input.tenantId,
      scope: input.scope,
      subjectId: input.subjectId,
      ownerId: input.ownerId,
      leaseDurationMs: 15 * 60_000,
    });
  } catch {
    throw new SocialContentWorkflowError('social_content_upload_admission_unavailable', 503);
  }
}

/** Database-backed admission protects every process, not just one Node worker. */
export async function withSocialContentUploadAdmission<T>(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  action: () => Promise<T>;
}): Promise<T> {
  if (!input.repository.dataStore) {
    if (process.env.NODE_ENV === 'production') {
      throw new SocialContentWorkflowError('social_content_upload_admission_unavailable', 503);
    }
    return input.action();
  }
  const ownerId = `social-upload:${process.pid}:${randomUUID()}`;
  let poolLease: DurableOperationLease | null = null;
  let taskLease: DurableOperationLease | null = null;
  try {
    for (let index = 0; index < MAX_CONCURRENT_SOCIAL_CONTENT_UPLOADS; index += 1) {
      poolLease = await acquireUploadLease({
        repository: input.repository,
        tenantId: UPLOAD_POOL_TENANT,
        scope: 'starter-social-upload-pool',
        subjectId: `slot-${index}`,
        ownerId,
      });
      if (poolLease) break;
    }
    if (!poolLease) throw new SocialContentWorkflowError('social_content_upload_busy', 429);
    taskLease = await acquireUploadLease({
      repository: input.repository,
      tenantId: input.tenantId,
      scope: 'starter-social-upload-task',
      subjectId: input.taskId,
      ownerId,
    });
    if (!taskLease) throw new SocialContentWorkflowError('social_content_task_upload_busy', 429);
    return await input.action();
  } finally {
    if (taskLease) {
      await releaseDurableOperationLease({ dataStore: input.repository.dataStore, lease: taskLease }).catch(() => undefined);
    }
    if (poolLease) {
      await releaseDurableOperationLease({ dataStore: input.repository.dataStore, lease: poolLease }).catch(() => undefined);
    }
  }
}

function safeName(value: unknown): string {
  const name = path.basename(socialText(value));
  if (!name || name.length > 240 || /[\u0000-\u001f]/.test(name)) {
    throw new SocialContentWorkflowError('social_content_file_name_invalid', 400);
  }
  return name;
}

function mime(value: unknown): string {
  const type = socialText(value).toLowerCase().split(';', 1)[0];
  if (!MIME_EXTENSIONS[type]) throw new SocialContentWorkflowError('social_content_file_type_unsupported', 415);
  return type;
}

function magicAllowed(type: string, bytes: Buffer): boolean {
  if (!bytes.length) return false;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/gif') return /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (type === 'video/mp4' || type === 'video/quicktime' || type === 'audio/mp4') return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (type === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === 'audio/mpeg') return bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  if (type.includes('officedocument')) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (type.startsWith('text/')) return !bytes.includes(0);
  return type === 'audio/wav' || type === 'audio/x-wav'
    ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
    : false;
}

export async function storeSocialContentFile(input: {
  stream: Readable;
  tenantId: string;
  name: string;
  mimeType: string;
  declaredLength?: number;
  maximumBytes?: number;
  materialLibrary?: boolean;
}): Promise<StoredSocialContentFile> {
  const name = safeName(input.name);
  const mimeType = mime(input.mimeType);
  const maximumBytes = Math.min(MAX_SOCIAL_CONTENT_FILE_BYTES, Math.max(0, Math.floor(input.maximumBytes ?? MAX_SOCIAL_CONTENT_FILE_BYTES)));
  if (maximumBytes < 1 || (Number.isFinite(input.declaredLength) && Number(input.declaredLength) > maximumBytes)) {
    throw new SocialContentWorkflowError('social_content_file_too_large', 413);
  }
  await fsp.mkdir(TEMP, { recursive: true });
  const temporary = path.join(TEMP, `${socialPublicId('upload')}.part`);
  let byteSize = 0;
  const hash = createHash('sha256');
  const header: Buffer[] = [];
  let headerBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maximumBytes) {
        callback(Object.assign(new Error('file too large'), { code: 'SOCIAL_FILE_TOO_LARGE' }));
        return;
      }
      hash.update(chunk);
      if (headerBytes < 512) {
        const part = chunk.subarray(0, Math.min(chunk.length, 512 - headerBytes));
        header.push(part);
        headerBytes += part.length;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(input.stream, limiter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (!byteSize || !magicAllowed(mimeType, Buffer.concat(header))) {
      throw new SocialContentWorkflowError('social_content_file_content_invalid', 415);
    }
    const sha256 = hash.digest('hex');
    const storedName = `${sha256}.${MIME_EXTENSIONS[mimeType]}`;
    if (objectStorageEnabled()) {
      // Creative task uploads are the same bytes shown in "My Materials".
      // Store one tenant-private object and let both records reference it;
      // documents remain in the task-only namespace.
      const storageKey = input.materialLibrary && materialAssetTypeAllowed(mimeType)
        ? materialAssetObjectKey(input.tenantId, storedName)
        : tenantPrivateObjectKey('social-content-sources', input.tenantId, storedName);
      const current = await r2Head(storageKey);
      if (!current || current.size !== byteSize || current.contentType !== mimeType) {
        await r2UploadFile({ key: storageKey, filePath: temporary, contentType: mimeType, contentLength: byteSize });
        const verified = await r2Head(storageKey);
        if (!verified || verified.size !== byteSize) throw new SocialContentWorkflowError('social_content_file_storage_unavailable', 503);
      }
      return { storageKind: 'object', storageKey, name, mimeType, byteSize, sha256 };
    }
    if (process.env.NODE_ENV === 'production') {
      throw new SocialContentWorkflowError('social_content_object_storage_required', 503);
    }
    const tenantDirectory = path.join(ROOT, materialAssetTenantKey(input.tenantId));
    await fsp.mkdir(tenantDirectory, { recursive: true });
    const finalPath = path.join(tenantDirectory, storedName);
    try {
      await fsp.link(temporary, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    }
    return {
      storageKind: 'local',
      storageKey: path.posix.join(materialAssetTenantKey(input.tenantId), storedName),
      name,
      mimeType,
      byteSize,
      sha256,
    };
  } catch (error) {
    if (error instanceof SocialContentWorkflowError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === 'SOCIAL_FILE_TOO_LARGE') {
      throw new SocialContentWorkflowError('social_content_file_too_large', 413);
    }
    throw new SocialContentWorkflowError('social_content_file_upload_failed', 400);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function creativeMaterialType(mimeType: string): 'video' | 'image' | 'audio' | null {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function ensureLocalMaterialMirror(input: {
  tenantId: string;
  stored: StoredSocialContentFile;
}): Promise<{ file: string; url: string }> {
  const source = path.resolve(ROOT, input.stored.storageKey);
  if (!source.startsWith(`${ROOT}${path.sep}`)) {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  const filename = path.basename(input.stored.storageKey);
  const relative = tenantAssetRelativePath(input.tenantId, filename);
  const targetDirectory = tenantAssetDir(MATERIAL_ROOT, input.tenantId);
  const target = path.join(targetDirectory, filename);
  await fsp.mkdir(targetDirectory, { recursive: true });
  try {
    await fsp.link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EXDEV') {
      try { await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL); }
      catch (copyError) {
        if ((copyError as NodeJS.ErrnoException)?.code !== 'EEXIST') throw copyError;
      }
    } else if (code !== 'EEXIST') {
      throw error;
    }
  }
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile() || stat.size !== input.stored.byteSize
      || await sha256File(target) !== input.stored.sha256) {
      throw new Error('material mirror integrity mismatch');
    }
  } catch {
    throw new SocialContentWorkflowError('social_content_material_storage_unavailable', 503);
  }
  return { file: relative, url: `/media/${relative}` };
}

/**
 * Bridge a user-provided task source into the canonical creative inventory.
 * PDF/office/text evidence never reaches this function because it has no
 * creative media type. Task-file ownership remains authoritative for reads.
 */
export async function registerSocialTaskCreativeMaterial(input: {
  tenantId: string;
  taskId: string;
  productRef?: string | null;
  file: SocialContentFile;
  stored: StoredSocialContentFile;
}): Promise<MaterialRecord | null> {
  const type = creativeMaterialType(input.file.mimeType);
  if (!type) return null;
  if (input.file.sha256 !== input.stored.sha256) {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  const filename = path.basename(input.stored.storageKey);
  const local = input.stored.storageKind === 'local'
    ? await ensureLocalMaterialMirror({ tenantId: input.tenantId, stored: input.stored })
    : { file: tenantAssetRelativePath(input.tenantId, filename), url: '' };
  const timestamp = input.file.createdAt || new Date().toISOString();
  const record: MaterialRecord = {
    id: `social-${createHash('sha256').update(`${input.tenantId}\0${input.file.sha256}`).digest('hex').slice(0, 32)}`,
    name: input.file.name,
    folder: '任务素材',
    type,
    duration: 0,
    size: humanFileSize(input.file.size),
    file: local.file,
    url: local.url,
    ...(type === 'image' && local.url ? { poster: local.url } : {}),
    ...(input.stored.storageKind === 'object' ? {
      objectKey: input.stored.storageKey,
      ...(type === 'image' ? { posterObjectKey: input.stored.storageKey } : {}),
    } : {}),
    scope: 'own',
    tenantId: input.tenantId,
    usage: 'editable',
    sourceType: 'social_task_upload',
    sourceTaskId: input.taskId,
    sourceFileRef: input.file.fileRef,
    // Social task briefs currently carry a product name/reference, not the
    // enterprise product's stable identity. Keep the stable field explicitly
    // empty so the UI may use an exact productName fallback without pretending
    // that free text is a product ID.
    productId: '',
    createdAt: timestamp,
  };
  return upsertSocialTaskMaterial({
    id: record.id,
    tenantId: input.tenantId,
    taskId: input.taskId,
    taskFileRef: input.file.fileRef,
    contentSha256: input.file.sha256,
    productRef: input.productRef,
    record,
  });
}

export function socialContentFileView(record: StarterRecord): SocialContentFile {
  const fileId = socialText(record.file_id);
  const usage = socialText(record.usage) as SocialContentFile['usage'];
  const size = Number(record.byte_size);
  const sha256 = socialText(record.content_sha256);
  if (!fileId || !['source', 'metric_evidence', 'artifact_media'].includes(usage) || !Number.isSafeInteger(size) || size < 1
    || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new SocialContentWorkflowError('social_content_file_record_invalid', 503);
  }
  return {
    fileId,
    taskId: socialText(record.task_id),
    usage,
    fileRef: `socialfile:${fileId}`,
    name: socialText(record.name),
    mimeType: socialText(record.mime_type),
    size,
    sha256,
    createdAt: socialText(record.created_at),
  };
}

export async function findSocialContentFile(input: {
  repository: Starter198Repository;
  tenantId: string;
  fileId: string;
  taskId?: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentFiles, input.tenantId, {
    where: { file_id: input.fileId, ...(input.taskId ? { task_id: input.taskId } : {}) }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  return result.items[0] ?? null;
}

async function fileByContent(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  usage: SocialContentFile['usage'];
  sha256: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentFiles, input.tenantId, {
    where: { task_id: input.taskId, usage: input.usage, content_sha256: input.sha256 },
    perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

export async function registerSocialContentFile(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  usage: SocialContentFile['usage'];
  idempotencyKey: string;
  stored: StoredSocialContentFile;
  now?: Date;
}): Promise<SocialContentFile> {
  await requireSocialTask(input);
  const mutation = await executeSocialContentMutation<{ file: SocialContentFile }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash({ taskId: input.taskId, usage: input.usage, ...input.stored }),
    operation: 'upload_social_content_file',
    targetId: input.taskId,
    now: input.now,
    replay: async () => {
      const existing = await fileByContent({ ...input, sha256: input.stored.sha256 });
      if (!existing) {
        throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      }
      return { file: socialContentFileView(existing) };
    },
    action: async operationId => {
      const existing = await input.repository.list(STARTER_COLLECTIONS.socialContentFiles, input.tenantId, {
        where: { last_operation_id: operationId }, perPage: 2,
      });
      if (existing.totalItems > 1 || existing.items.length > 1) {
        throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
      }
      if (existing.items[0]) return { file: socialContentFileView(existing.items[0]) };
      const duplicate = await fileByContent({ ...input, sha256: input.stored.sha256 });
      if (duplicate) return { file: socialContentFileView(duplicate) };
      const capacity = await socialTaskFileCapacity(input);
      if (input.stored.byteSize > capacity.remainingBytes) {
        throw new SocialContentWorkflowError('social_content_file_task_bytes_exceeded', 413);
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      const created = await input.repository.create(STARTER_COLLECTIONS.socialContentFiles, input.tenantId, {
        file_id: socialPublicId('socialfile'),
        task_id: input.taskId,
        usage: input.usage,
        name: input.stored.name,
        mime_type: input.stored.mimeType,
        byte_size: input.stored.byteSize,
        content_sha256: input.stored.sha256,
        storage_kind: input.stored.storageKind,
        storage_key: input.stored.storageKey,
        last_operation_id: operationId,
        created_by: input.userId,
        created_at: timestamp,
      });
      return { file: socialContentFileView(created) };
    },
  });
  return mutation.value.file;
}

export async function requireOwnedSocialFileRef(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  fileRef: string;
  usage?: SocialContentFile['usage'];
}): Promise<StarterRecord> {
  const match = /^socialfile:(socialfile_[a-f0-9]{24})$/.exec(input.fileRef);
  if (!match) throw new SocialContentWorkflowError('social_content_file_ref_invalid', 400);
  const record = await findSocialContentFile({ ...input, fileId: match[1]! });
  if (!record || (input.usage && socialText(record.usage) !== input.usage)) {
    throw new SocialContentWorkflowError('social_content_file_not_found', 404);
  }
  return record;
}

export async function readSocialContentFile(input: {
  repository: Starter198Repository;
  tenantId: string;
  fileId: string;
}): Promise<{
  view: SocialContentFile;
  localPath?: string;
  object?: Awaited<ReturnType<typeof r2GetObject>>;
}> {
  const record = await findSocialContentFile(input);
  if (!record) throw new SocialContentWorkflowError('social_content_file_not_found', 404);
  const view = socialContentFileView(record);
  const kind = socialText(record.storage_kind);
  const key = socialText(record.storage_key);
  if (kind === 'object') {
    const object = await r2GetObject(key);
    if (!object) throw new SocialContentWorkflowError('social_content_file_not_found', 404);
    return { view, object };
  }
  if (kind !== 'local' || process.env.NODE_ENV === 'production') {
    throw new SocialContentWorkflowError('social_content_file_storage_unavailable', 503);
  }
  const localPath = path.resolve(ROOT, key);
  let exists = false;
  if (localPath.startsWith(`${ROOT}${path.sep}`)) {
    try { exists = (await fsp.stat(localPath)).isFile(); } catch { exists = false; }
  }
  if (!exists) {
    throw new SocialContentWorkflowError('social_content_file_not_found', 404);
  }
  return { view, localPath };
}

/** Verify that a registered file still points at the immutable, content-addressed bytes. */
export async function assertSocialContentFilePersisted(input: {
  record: StarterRecord;
  tenantId: string;
}): Promise<SocialContentFile> {
  if (socialText(input.record.tenant_id) !== input.tenantId) {
    throw new SocialContentWorkflowError('social_content_file_not_found', 404);
  }
  const view = socialContentFileView(input.record);
  const key = socialText(input.record.storage_key);
  if (!path.basename(key).startsWith(`${view.sha256}.`)) {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  const kind = socialText(input.record.storage_kind);
  if (kind === 'object') {
    const head = await r2Head(key);
    if (!head || head.size !== view.size || head.contentType !== view.mimeType) {
      throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
    }
    return view;
  }
  if (kind !== 'local' || process.env.NODE_ENV === 'production') {
    throw new SocialContentWorkflowError('social_content_file_storage_unavailable', 503);
  }
  const localPath = path.resolve(ROOT, key);
  if (!localPath.startsWith(`${ROOT}${path.sep}`)) {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  try {
    const stat = await fsp.stat(localPath);
    if (!stat.isFile() || stat.size !== view.size) throw new Error('invalid social file');
  } catch {
    throw new SocialContentWorkflowError('social_content_file_integrity_violation', 503);
  }
  return view;
}

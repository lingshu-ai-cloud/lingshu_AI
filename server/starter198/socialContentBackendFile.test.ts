import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Starter198Repository, StarterRecord } from './repository.js';
import {
  cleanupTransientSocialContentUpload,
  durableSocialContentFileDescriptor,
  inspectTransientSocialContentFile,
  persistTransientSocialContentBackendFile,
  registerSocialTaskCreativeMaterial,
  socialContentFileDownloadUrl,
  storeSocialContentFile,
  type SocialContentBackendFilePort,
} from './socialContentFiles.js';

const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-backend-file-test-'));
try {
  const filePath = path.join(directory, 'render.mp4');
  const bytes = Buffer.from('000000186674797069736f6d00000200', 'hex');
  await fsp.writeFile(filePath, bytes);
  const stored = await inspectTransientSocialContentFile({
    filePath,
    name: '最终成片.mp4',
    mimeType: 'video/mp4',
  });
  assert.equal(stored.storageKind, 'backend_file');
  assert.equal(stored.byteSize, bytes.length);

  const record: StarterRecord = {
    id: 'pbfilerecord001',
    tenant_id: 'tenant-a',
    storage_kind: 'backend_pending',
    storage_key: stored.storageKey,
  };
  const updates: Record<string, unknown>[] = [];
  const repository = {
    update: async (_collection: string, tenantId: string, recordId: string, data: Record<string, unknown>) => {
      assert.equal(tenantId, 'tenant-a');
      assert.equal(recordId, record.id);
      updates.push(data);
    },
  } as unknown as Starter198Repository;
  let durableBytes: Buffer | null = null;
  const backendFilePort: SocialContentBackendFilePort = {
    attach: async input => {
      assert.equal(input.field, 'backend_file');
      assert.equal(input.path, filePath);
      durableBytes = await fsp.readFile(input.path);
      return `${stored.sha256}_pb.mp4`;
    },
    fetch: async input => input.filename && durableBytes
      ? { buf: durableBytes, contentType: 'video/mp4' }
      : null,
  };

  await persistTransientSocialContentBackendFile({
    repository,
    tenantId: 'tenant-a',
    record,
    stored,
    transientPath: filePath,
    backendFilePort,
  });
  assert.deepEqual(durableBytes, bytes);
  assert.deepEqual(updates, [{
    storage_kind: 'backend_file',
    storage_key: `${stored.sha256}_pb.mp4`,
  }]);
  assert.equal(
    socialContentFileDownloadUrl('socialfile_123'),
    '/api/overseas/starter-198/social-content/files/socialfile_123',
  );

  const previousForceBackend = process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES;
  process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES = 'true';
  const upload = await storeSocialContentFile({
    stream: Readable.from(bytes), tenantId: 'tenant-a', name: '客户原片.mp4',
    mimeType: 'video/mp4', declaredLength: bytes.length, materialLibrary: true,
  }).finally(() => {
    if (previousForceBackend === undefined) delete process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES;
    else process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES = previousForceBackend;
  });
  assert.equal(upload.storageKind, 'backend_file', 'no R2 configuration falls back to the backend file field, not data/media');
  assert.ok(upload.transientPath);
  assert.deepEqual(await fsp.readFile(upload.transientPath!), bytes);
  const durable = durableSocialContentFileDescriptor(upload);
  assert.equal(durable.transientPath, undefined, 'OS temp path is never part of the durable record descriptor');

  let bridgedInput: Record<string, any> | undefined;
  const material = await registerSocialTaskCreativeMaterial({
    tenantId: 'tenant-a', taskId: 'task-a', productRef: '精华液',
    file: {
      fileId: 'file-a', taskId: 'task-a', usage: 'source', fileRef: 'socialfile:file-a',
      name: upload.name, mimeType: upload.mimeType, size: upload.byteSize, sha256: upload.sha256,
      createdAt: new Date().toISOString(), downloadUrl: '/test',
    },
    stored: durable,
    transientPath: upload.transientPath,
    materialPort: {
      async upsert(input) {
        bridgedInput = input;
        return { id: 'pb-material-a', name: input.title, type: input.type, sourceType: 'social_task_upload' };
      },
    },
  });
  assert.equal(material?.id, 'pb-material-a');
  assert.equal(bridgedInput?.media.path, upload.transientPath);
  assert.equal(bridgedInput?.sha256, upload.sha256);
  await cleanupTransientSocialContentUpload(upload);
  await assert.rejects(() => fsp.stat(upload.transientPath!), /ENOENT/);

  await assert.rejects(
    () => persistTransientSocialContentBackendFile({
      repository,
      tenantId: 'tenant-a',
      record: { ...record, id: 'pbfilerecord002' },
      stored,
      transientPath: filePath,
      backendFilePort: {
        attach: async () => 'corrupt.mp4',
        fetch: async () => ({ buf: Buffer.from('corrupt'), contentType: 'video/mp4' }),
      },
    }),
    (error: unknown) => (error as { code?: string }).code === 'social_content_file_integrity_violation',
  );
} finally {
  await fsp.rm(directory, { recursive: true, force: true });
}

console.log('social content backend file tests passed');

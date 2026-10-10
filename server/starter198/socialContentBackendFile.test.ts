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
import { readLocalMaterials } from '../lib/materialLibrary.js';
import { runWithDataAuthority } from '../storage/dataAuthority.js';

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

  const isolatedStorageEnvironment = [
    'OBJECT_STORAGE_DRIVER', 'COS_REGION', 'OBJECT_STORAGE_REGION',
    'COS_BUCKET', 'OBJECT_STORAGE_BUCKET_NAME', 'COS_SECRET_ID',
    'OBJECT_STORAGE_ACCESS_KEY_ID', 'COS_SECRET_KEY', 'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  ] as const;
  const previousStorageEnvironment = Object.fromEntries(
    isolatedStorageEnvironment.map(key => [key, process.env[key]]),
  );
  const previousForceBackend = process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES;
  process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES = 'true';
  process.env.OBJECT_STORAGE_DRIVER = 'cos';
  for (const key of isolatedStorageEnvironment.slice(1)) delete process.env[key];
  const upload = await storeSocialContentFile({
    stream: Readable.from(bytes), tenantId: 'tenant-a', name: '客户原片.mp4',
    mimeType: 'video/mp4', declaredLength: bytes.length, materialLibrary: true,
  }).finally(() => {
    if (previousForceBackend === undefined) delete process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES;
    else process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES = previousForceBackend;
    for (const key of isolatedStorageEnvironment) {
      const previous = previousStorageEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
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

  const localMaterialRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-local-material-test-'));
  const originalCwd = process.cwd();
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.chdir(localMaterialRoot);
    const localMaterial = await runWithDataAuthority('local', () => registerSocialTaskCreativeMaterial({
      tenantId: 'tenant-local', taskId: 'task-local', productId: 'product-local', productRef: '本地产品',
      file: {
        fileId: 'file-local', taskId: 'task-local', usage: 'source', fileRef: 'socialfile:file-local',
        name: upload.name, mimeType: upload.mimeType, size: upload.byteSize, sha256: upload.sha256,
        createdAt: new Date(0).toISOString(), downloadUrl: '/api/overseas/starter-198/social-content/files/file-local',
      },
      stored: durable,
      transientPath: upload.transientPath,
      materialPort: { async upsert() { throw new Error('PocketBase unavailable'); } },
    }));
    assert.equal(localMaterial?.sourceType, 'social_task_upload');
    assert.equal(localMaterial?.usage, 'editable');
    assert.equal(localMaterial?.productId, 'product-local');
    assert.equal(localMaterial?.productRef, '本地产品');
    assert.equal(localMaterial?.url, '/api/overseas/starter-198/social-content/files/file-local');
    assert.deepEqual(localMaterial?.sourceTaskIds, ['task-local']);
    assert.equal(readLocalMaterials().length, 1, 'local authority indexes the durable task file in data/materials.json');

    process.env.NODE_ENV = 'production';
    await assert.rejects(
      () => runWithDataAuthority('local', () => registerSocialTaskCreativeMaterial({
        tenantId: 'tenant-production', taskId: 'task-production',
        file: {
          fileId: 'file-production', taskId: 'task-production', usage: 'source', fileRef: 'socialfile:file-production',
          name: upload.name, mimeType: upload.mimeType, size: upload.byteSize, sha256: upload.sha256,
          createdAt: new Date(0).toISOString(), downloadUrl: '/test-production',
        },
        stored: durable,
        transientPath: upload.transientPath,
        materialPort: { async upsert() { throw new Error('PocketBase unavailable in production'); } },
      })),
      /PocketBase unavailable in production/,
      'production never silently falls back to the application-server material index',
    );
    assert.equal(readLocalMaterials().length, 1, 'failed production registration did not mutate the local index');
  } finally {
    process.chdir(originalCwd);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await fsp.rm(localMaterialRoot, { recursive: true, force: true });
  }
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

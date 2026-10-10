import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { socialProductionPublishSourceClaim } from './publishSourceClaim.js';
import { materializeSocialProductionVideo } from './socialProductionMedia.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return { rows,
    async list<T>(collection: string, query: ListQuery = {}) { let items = [...(rows.get(collection) || [])]; for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value); const page = query.page ?? 1, perPage = query.perPage ?? 500; return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems: items.length, totalPages: Math.ceil(items.length / perPage), page, perPage }; },
    async getById<T>(collection: string, id: string) { return (rows.get(collection) || []).find(row => row.id === id) as T || null; },
    async create<T>() { return null as T | null; }, async update() { return false; }, async delete() { return false; },
  };
}

const bytes = Buffer.from('backend-owned-approved-video');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const fileId = 'socialfile_aaaaaaaaaaaaaaaaaaaaaaaa';
const fileRef = `socialfile:${fileId}`;
const sourceUrl = `/api/overseas/starter-198/social-content/files/${fileId}`;
const dataStore = memoryStore();
dataStore.rows.set('starter_social_content_files', [{ id: 'file-row', tenant_id: 'tenant-a', file_id: fileId, task_id: 'task-1', usage: 'artifact_media', name: 'video.mp4', mime_type: 'video/mp4', byte_size: bytes.length, content_sha256: sha256, storage_kind: 'backend_file', storage_key: 'stored-video.mp4', created_at: '2026-09-25T00:00:00Z' }]);
dataStore.rows.set('starter_social_content_artifacts', [{ id: 'artifact-row', tenant_id: 'tenant-a', task_id: 'task-1', artifact_id: 'artifact-1', version: 'artifact-v7', status: 'approved', resource_ref: fileRef, content_hash: sha256, content: { productionResult: { productionResultId: 'production-1', version: 'production-v3', status: 'asset_review', technicalReview: { approved: true }, creativeReview: { approved: true } }, mediaStorage: { video: { fileId, fileRef, url: sourceUrl, sha256 } } } }]);
const backendFilePort = { async attach() { return null; }, async fetch(input: { recordId: string; filename: string }) { return input.recordId === 'file-row' && input.filename === 'stored-video.mp4' ? { buf: bytes, contentType: 'video/mp4' } : null; } };

const materialized = await materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'attempt-1', expectedHash: sha256, dataStore, backendFilePort });
assert.equal(materialized.sourceUrl, sourceUrl);
assert.deepEqual(fs.readFileSync(materialized.videoPath), bytes);
const claim = await socialProductionPublishSourceClaim({ tenantId: 'tenant-a', artifactId: 'artifact-1', productionResultId: 'production-1', contentVersion: 'production-v3', contentHash: sha256, videoHash: sha256, videoPath: materialized.videoPath, artifactVideoUrl: sourceUrl, artifactFileId: fileId, artifactFileRef: fileRef, dataStore });
assert.equal(claim.sourceKind, 'social_production_artifact');
assert.equal(claim.artifactFileId, fileId);
await materialized.cleanup();
assert.equal(fs.existsSync(materialized.videoPath), false);

// Concurrent/repeated delivery of the same attempt owns independent upload copies.
const repeated = await Promise.all([1, 2].map(() => materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'same-attempt', expectedHash: sha256, dataStore, backendFilePort })));
assert.notEqual(repeated[0]!.videoPath, repeated[1]!.videoPath);
await repeated[0]!.cleanup();
assert.deepEqual(fs.readFileSync(repeated[1]!.videoPath), bytes);
await repeated[0]!.cleanup();
assert.deepEqual(fs.readFileSync(repeated[1]!.videoPath), bytes);
await repeated[1]!.cleanup();
await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'corrupted', expectedHash: sha256, dataStore, backendFilePort: { async attach() { return null; }, async fetch() { return { buf: Buffer.from('corrupted-owned-video'), contentType: 'video/mp4' }; } } }), /social_content_file_integrity_violation/);
// A rejected retry must leave the first successfully materialized copy untouched.
const surviving = await materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'corrupted', expectedHash: sha256, dataStore, backendFilePort });
await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'corrupted', expectedHash: sha256, dataStore, backendFilePort: { async attach() { return null; }, async fetch() { return { buf: Buffer.alloc(bytes.length), contentType: 'video/mp4' }; } } }), /social_content_file_integrity_violation/);
assert.deepEqual(fs.readFileSync(surviving.videoPath), bytes);
await surviving.cleanup();

await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-b', artifactId: 'artifact-1', attemptId: 'cross-tenant', expectedHash: sha256, dataStore, backendFilePort }), /social_production_artifact_not_found/);
await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'wrong-hash', expectedHash: 'b'.repeat(64), dataStore, backendFilePort }), /social_production_media_identity_mismatch/);
// Local development storage must pass the same physical-byte check as backend storage.
const localRoot = path.resolve('data', 'social-content-sources');
fs.mkdirSync(localRoot, { recursive: true });
const localDirectory = fs.mkdtempSync(path.join(localRoot, 'materialization-test-'));
const localFile = path.join(localDirectory, `${sha256}.mp4`);
const fileRow = dataStore.rows.get('starter_social_content_files')![0]!;
const previousNodeEnv = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'test';
  fileRow.storage_kind = 'local';
  fileRow.storage_key = path.relative(localRoot, localFile);
  fs.writeFileSync(localFile, bytes);
  const localCopy = await materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'local-copy', expectedHash: sha256, dataStore });
  assert.notEqual(localCopy.videoPath, localFile);
  fs.writeFileSync(localFile, Buffer.alloc(bytes.length));
  assert.deepEqual(fs.readFileSync(localCopy.videoPath), bytes);
  await localCopy.cleanup();
  assert.equal(fs.existsSync(localFile), true);
  await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'local-hash-failure', expectedHash: sha256, dataStore }), /social_production_media_integrity_violation/);
  fs.writeFileSync(localFile, bytes.subarray(0, bytes.length - 1));
  await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'local-size-failure', expectedHash: sha256, dataStore }), /social_production_media_integrity_violation/);
} finally {
  fs.rmSync(localDirectory, { recursive: true, force: true });
  fileRow.storage_kind = 'backend_file';
  fileRow.storage_key = 'stored-video.mp4';
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}

dataStore.rows.get('starter_social_content_artifacts')![0]!.content.productionResult.technicalReview.approved = false;
const revoked = await materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'revoked', expectedHash: sha256, dataStore, backendFilePort });
await assert.rejects(socialProductionPublishSourceClaim({ tenantId: 'tenant-a', artifactId: 'artifact-1', productionResultId: 'production-1', contentVersion: 'production-v3', contentHash: sha256, videoHash: sha256, videoPath: revoked.videoPath, artifactVideoUrl: sourceUrl, artifactFileId: fileId, artifactFileRef: fileRef, dataStore }), /social_production_artifact_stale/);
await revoked.cleanup();
console.log('social production backend media materialization tests passed');

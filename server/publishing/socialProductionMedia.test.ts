import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
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

await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-b', artifactId: 'artifact-1', attemptId: 'cross-tenant', expectedHash: sha256, dataStore, backendFilePort }), /social_production_artifact_not_found/);
await assert.rejects(materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'wrong-hash', expectedHash: 'b'.repeat(64), dataStore, backendFilePort }), /social_production_media_identity_mismatch/);
dataStore.rows.get('starter_social_content_artifacts')![0]!.content.productionResult.technicalReview.approved = false;
const revoked = await materializeSocialProductionVideo({ tenantId: 'tenant-a', artifactId: 'artifact-1', attemptId: 'revoked', expectedHash: sha256, dataStore, backendFilePort });
await assert.rejects(socialProductionPublishSourceClaim({ tenantId: 'tenant-a', artifactId: 'artifact-1', productionResultId: 'production-1', contentVersion: 'production-v3', contentHash: sha256, videoHash: sha256, videoPath: revoked.videoPath, artifactVideoUrl: sourceUrl, artifactFileId: fileId, artifactFileRef: fileRef, dataStore }), /social_production_artifact_stale/);
await revoked.cleanup();
console.log('social production backend media materialization tests passed');

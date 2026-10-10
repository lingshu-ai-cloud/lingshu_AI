import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGeneratedAssetArchiveService } from './generatedAssetArchive.js';
import type { GeneratedAssetArchiveInput } from '../../shared/contracts/generatedMaterial.js';
import type { WeeklyAssetRequirement } from '../../shared/weeklyAutomaticMaterial.js';

const quality = { state: 'accepted' as const, checks: [{ key: 'decode', status: 'passed' as const, evidence: 'decoded' }],
  checkedAt: '2026-10-09T00:00:00.000Z', policyVersion: 'quality.v1' };
function input(file: string, digest: string): GeneratedAssetArchiveInput {
  return { tenantId: 'tenant-a', name: 'Generated clip', media: { type: 'video', localPath: file, mimeType: 'video/mp4', contentSha256: digest, duration: 3 },
    generation: { pipelineId: 'non_person_generation', assetGenerationKind: 'concept_visual', pipelineVersion: 'v1', executionId: 'exec-1',
      provider: 'seedance', model: 'model', idempotencyKey: 'idem', inputFingerprint: 'fingerprint', promptOrSpecHash: 'spec', inputMaterialIds: [] },
    lineage: { sourceProjectId: 'project-1', sourceShotId: 'shot-1' }, quality, rightsScope: 'tenant_private' };
}

function withAutomaticEvidence(
  value: GeneratedAssetArchiveInput,
  requirement: WeeklyAssetRequirement,
): GeneratedAssetArchiveInput {
  return {
    ...value,
    automaticMaterial: {
      requirement,
      independentVisualCheckRef: 'vision-check:accepted',
      rightsEvidenceRef: 'tenant-rights:accepted',
      authorizationScopes: ['tenant_private'],
    },
  };
}

test('archives verified media and deduplicates by tenant plus content hash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-archive-'));
  const file = path.join(dir, 'clip.mp4'); const bytes = Buffer.from('generated-video'); fs.writeFileSync(file, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  let records: any[] = []; const objects = new Map<string, Buffer>(); let uploads = 0;
  const service = createGeneratedAssetArchiveService({ readMaterials: () => structuredClone(records), saveMaterials: next => { records = structuredClone(next); },
    downloadObject: async key => objects.has(key) ? { buf: objects.get(key)!, contentType: 'video/mp4' } : null,
    uploadObject: async ({ key, body }) => { uploads += 1; objects.set(key, body); return key; },
    headObject: async key => objects.has(key) ? { size: objects.get(key)!.length, contentType: 'video/mp4', etag: 'v1' } : null,
    now: () => new Date('2026-10-09T01:00:00.000Z') });
  const first = await service.archiveNewMedia(input(file, digest));
  const second = await service.archiveNewMedia({ ...input(file, digest), generation: { ...input(file, digest).generation, executionId: 'exec-2' } });
  assert.equal(first.id, second.id); assert.equal(records.length, 1); assert.equal(uploads, 1);
  assert.equal(second.folder, 'generated'); assert.equal(second.reuse.eligible, true); assert.equal(second.generation.executionId, 'exec-2');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('keeps automatic evidence without a new receipt and accumulates it by requirement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-archive-evidence-'));
  const file = path.join(dir, 'clip.mp4');
  const bytes = Buffer.from('generated-video-with-evidence');
  fs.writeFileSync(file, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  let records: any[] = [];
  const objects = new Map<string, Buffer>();
  const service = createGeneratedAssetArchiveService({
    readMaterials: () => structuredClone(records),
    saveMaterials: next => { records = structuredClone(next); },
    downloadObject: async key => objects.has(key) ? { buf: objects.get(key)!, contentType: 'video/mp4' } : null,
    uploadObject: async ({ key, body }) => { objects.set(key, body); return key; },
    headObject: async key => objects.has(key) ? { size: objects.get(key)!.length, contentType: 'video/mp4', etag: 'v1' } : null,
    now: () => new Date('2026-10-09T01:00:00.000Z'),
  });
  const heroRequirement = {
    subjectRef: 'product:hero', action: 'rotate', scene: 'studio', evidenceRequirement: 'non_evidentiary_visual',
    aspectRatio: '16:9', minimumDurationSeconds: 3, authorizationScope: 'tenant_private',
  };
  const detailRequirement = {
    ...heroRequirement, action: 'show-detail', scene: 'workbench', minimumDurationSeconds: 2,
  };
  try {
    await service.archiveNewMedia(withAutomaticEvidence(input(file, digest), heroRequirement));
    const withoutNewEvidence = await service.archiveNewMedia({
      ...input(file, digest), generation: { ...input(file, digest).generation, executionId: 'exec-without-evidence' },
    });
    assert.equal(withoutNewEvidence.provenance.weeklyAutomaticMaterialEvidence.length, 1);
    const accumulated = await service.archiveNewMedia(withAutomaticEvidence({
      ...input(file, digest), generation: { ...input(file, digest).generation, executionId: 'exec-detail' },
    }, detailRequirement));
    assert.equal(accumulated.provenance.weeklyAutomaticMaterialEvidence.length, 2);
    const replaced = await service.archiveNewMedia(withAutomaticEvidence({
      ...input(file, digest),
      generation: { ...input(file, digest).generation, executionId: 'exec-hero-v2', model: 'model-v2' },
    }, heroRequirement));
    assert.equal(replaced.provenance.weeklyAutomaticMaterialEvidence.length, 2);
    assert.equal(replaced.provenance.weeklyAutomaticMaterialEvidence
      .find((entry: any) => entry.action === 'rotate')?.model, 'model-v2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects hash mismatch and cross-tenant attachment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-archive-')); const file = path.join(dir, 'clip.mp4'); fs.writeFileSync(file, 'bytes');
  let records: any[] = [{ id: 'material-1', tenantId: 'tenant-b', scope: 'own', contentSha256: 'a'.repeat(64) }];
  const service = createGeneratedAssetArchiveService({ readMaterials: () => records, saveMaterials: next => { records = next; }, now: () => new Date(),
    downloadObject: async () => null, headObject: async () => null, uploadObject: async () => '' });
  await assert.rejects(() => service.archiveNewMedia(input(file, 'a'.repeat(64))), /哈希与文件不一致/);
  await assert.rejects(() => service.attachExistingMaterial('material-1', input(file, 'a'.repeat(64))), /不存在或不属于/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('attaches metadata to an existing material without copying it', async () => {
  const bytes = Buffer.from('existing'); const digest = createHash('sha256').update(bytes).digest('hex');
  const objectKey = 'materials/tenants/dGVuYW50LWE/existing.mp4';
  let records: any[] = [{ id: 'material-1', tenantId: 'tenant-a', scope: 'own', contentSha256: digest, objectKey }]; let uploads = 0;
  const service = createGeneratedAssetArchiveService({ readMaterials: () => structuredClone(records), saveMaterials: next => { records = next; },
    downloadObject: async key => key === objectKey ? { buf: bytes, contentType: 'video/mp4' } : null,
    headObject: async () => ({ size: bytes.length, contentType: 'video/mp4', etag: 'v1' }),
    uploadObject: async () => { uploads += 1; return ''; }, now: () => new Date('2026-10-09T01:00:00.000Z') });
  const request = input('', digest); request.media.localPath = undefined; request.media.objectKey = objectKey;
  const attached = await service.attachExistingMaterial('material-1', request);
  assert.equal(attached.id, 'material-1'); assert.equal(attached.generation.assetGenerationKind, 'concept_visual');
  assert.equal(attached.reuse.eligible, true); assert.equal(uploads, 0); assert.equal(records.length, 1);
});

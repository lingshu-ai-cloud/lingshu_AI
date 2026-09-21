import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { main as runImporterDryRun } from './import-materials-to-pb.js';
import {
  assertApprovedMaterialDownloadUrl,
  buildMaterialImportProvenance,
  buildMaterialImportVisualMetadata,
  DEFAULT_MATERIAL_LIBRARY_MAX_BYTES,
  DEFAULT_MATERIAL_LIBRARY_MAX_RECORDS,
  isBlockedMaterialRehostHost,
  isPrivateOrReservedIp,
  MaterialImportManifestError,
  POCKETBASE_MATERIAL_MAX_BYTES,
  validateMaterialImportManifest,
} from './lib/materialImportManifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function validManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    batchId: 'licensed-beauty-seed-v1',
    tenantId: 'tenant-a',
    scope: 'own',
    usage: 'editable',
    capacity: { maxRecords: 50, maxTotalBytes: 500 * 1024 * 1024 },
    normalization: { maxWidth: 1080, crf: 23 },
    assets: [{
      id: 'lab-clip-001', enabled: true, title: '实验室研发示意', folder: 'beauty_factory',
      source: {
        provider: 'Rights holder CDN', creator: 'Example Rights Holder',
        pageUrl: 'https://rights.example.com/assets/lab-clip-001',
        downloadUrl: 'https://media.example.com/lab-clip-001.webm',
        approvedDownloadHosts: ['media.example.com'],
      },
      license: {
        name: 'Direct commercial SaaS license', url: 'https://rights.example.com/licenses/contract-001',
        evidence: 'Contract 001 explicitly permits commercial derivatives and raw storage in the licensed SaaS material library.',
        capturedAt: '2026-09-20T00:00:00.000Z', attributionText: 'Example Rights Holder',
      },
      approval: {
        approvedBy: 'legal-reviewer', approvedAt: '2026-09-20T01:00:00.000Z',
        reference: 'LEGAL-2026-001',
        rationale: 'The signed agreement explicitly covers commercial derivative production and SaaS library storage.',
        rights: { commercialUse: true, derivatives: true, rawFileStorage: true, saasMaterialLibrary: true },
      },
      expectedSourceSha256: 'd'.repeat(64),
      clip: { startSeconds: 1, durationSeconds: 12 }, industry: '美妆制造', shotFunction: '实验室研发',
      applicability: '行业示意', tags: ['实验室', '研发'],
      visualReview: {
        reviewMethod: 'human',
        reviewedBy: 'visual-reviewer', reviewedAt: '2026-09-20T01:30:00.000Z', reference: 'VISUAL-2026-001',
        rationale: 'Reviewer watched the exact hash-bound clip and recorded only facts that are directly visible.',
        visualObservations: ['白色实验台上可见透明容器与戴手套的双手'],
        segment: {
          start: 0, end: 12, subject: ['戴手套的双手', '透明容器'], action: '双手在实验台上移动透明容器',
          shot: '近景', camera: '固定机位', environment: '白色实验台',
          observedFacts: ['白色台面上有透明容器', '画面中可见戴手套的双手'], confidence: 0.9, needsReview: false,
        },
      },
    }],
  };
}

test('accepts an explicitly approved licensed material manifest', () => {
  const manifest = validateMaterialImportManifest(validManifest());
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.capacity.maxRecords, 50);
  assert.equal(manifest.assets[0].approval.rights.saasMaterialLibrary, true);
});

test('requires an explicit enabled boolean, non-placeholder approvals and fixed safety capacity', () => {
  const missingEnabled = validManifest();
  delete (missingEnabled.assets as any[])[0].enabled;
  assert.throws(() => validateMaterialImportManifest(missingEnabled), /enabled 必须明确填写/);

  const placeholder = validManifest();
  (placeholder.assets as any[])[0].approval.approvedBy = 'replace-with-reviewer';
  assert.throws(() => validateMaterialImportManifest(placeholder), /不能使用 placeholder/);
  const pendingHumanReview = validManifest();
  (pendingHumanReview.assets as any[])[0].approval.approvedBy = 'pending-human-rights-review';
  (pendingHumanReview.assets as any[])[0].visualReview.reviewedBy = 'codex-direct-frame-review';
  assert.throws(() => validateMaterialImportManifest(pendingHumanReview), /不能使用 placeholder/);

  const oversized = validManifest();
  (oversized.capacity as any).maxRecords = DEFAULT_MATERIAL_LIBRARY_MAX_RECORDS + 1;
  (oversized.capacity as any).maxTotalBytes = DEFAULT_MATERIAL_LIBRARY_MAX_BYTES + 1;
  assert.throws(() => validateMaterialImportManifest(oversized), /capacity\.maxRecords/);
});

test('refuses missing rights approval and reference-only downloads', () => {
  const missingRight = validManifest();
  (((missingRight.assets as any[])[0].approval.rights) as Record<string, unknown>).rawFileStorage = false;
  assert.throws(() => validateMaterialImportManifest(missingRight), (error: unknown) => {
    assert.ok(error instanceof MaterialImportManifestError);
    assert.match(error.message, /rawFileStorage/);
    return true;
  });
  const referenceOnly = validManifest();
  referenceOnly.usage = 'reference_only';
  assert.throws(() => validateMaterialImportManifest(referenceOnly), /usage 必须是 editable/);
});

test('refuses social/stock rehosting, insecure URLs and private network targets', () => {
  for (const host of ['pexels.com', 'videos.pexels.com', 'youtube.com', 'www.tiktok.com', 'mixkit.co']) {
    assert.equal(isBlockedMaterialRehostHost(host), true, host);
  }
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.1.1', '192.168.1.2', '169.254.1.1', '::1', 'fd00::1', 'ff02::1', '2001:db8::1', '::ffff:7f00:1']) {
    assert.equal(isPrivateOrReservedIp(address), true, address);
  }
  assert.throws(
    () => assertApprovedMaterialDownloadUrl('https://redirect.example.net/video.mp4', ['media.example.com']),
    /未经批准的域名/,
  );
  const pexels = validManifest();
  (pexels.assets as any[])[0].source.downloadUrl = 'https://videos.pexels.com/video.mp4';
  (pexels.assets as any[])[0].source.approvedDownloadHosts = ['videos.pexels.com'];
  assert.throws(() => validateMaterialImportManifest(pexels), /禁止批量转载/);

  const http = validManifest();
  (http.assets as any[])[0].source.downloadUrl = 'http://media.example.com/video.mp4';
  assert.throws(() => validateMaterialImportManifest(http), /只允许 https/);
});

test('rejects duplicate asset ids and invalid source hashes', () => {
  const duplicate = validManifest();
  (duplicate.assets as any[]).push(structuredClone((duplicate.assets as any[])[0]));
  assert.throws(() => validateMaterialImportManifest(duplicate), /assets.id 重复/);
  const invalidHash = validManifest();
  (invalidHash.assets as any[])[0].expectedSourceSha256 = 'not-a-hash';
  assert.throws(() => validateMaterialImportManifest(invalidHash), /64 位十六进制/);
});

test('builds stable, auditable provenance without persisting the signed download URL', () => {
  const manifest = validateMaterialImportManifest(validManifest());
  const asset = manifest.assets[0];
  const provenance = buildMaterialImportProvenance({
    manifest, asset, manifestSha256: 'c'.repeat(64), sourceSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64), importedAt: '2026-09-20T02:00:00.000Z', finalDownloadHost: 'cdn.rights.example.com',
  });
  assert.equal(provenance.source.downloadHost, 'cdn.rights.example.com');
  assert.equal(provenance.manifestSha256, 'c'.repeat(64));
  assert.equal(provenance.source.pageUrl, 'https://rights.example.com/assets/lab-clip-001');
  assert.equal('downloadUrl' in provenance.source, false);
  assert.match(provenance.license.evidenceTextSha256, /^[a-f0-9]{64}$/);
});

test('builds a trusted whole-clip visual index without another vision model call', () => {
  const manifest = validateMaterialImportManifest(validManifest());
  const metadata = buildMaterialImportVisualMetadata({
    asset: manifest.assets[0], duration: 12.04, normalizedSha256: 'b'.repeat(64),
  });
  assert.deepEqual(metadata.visualObservations, ['白色实验台上可见透明容器与戴手套的双手']);
  assert.equal(metadata.segments[0].start, 0);
  assert.equal(metadata.segments[0].end, 12.04);
  assert.equal(metadata.segments[0].confidence, 0.9);
  assert.equal(metadata.segments[0].needsReview, false);
  assert.equal(metadata.segments[0].manualConfirmed, true);
  assert.equal(metadata.segmentAnalysisStatus, 'completed');
  assert.throws(() => buildMaterialImportVisualMetadata({
    asset: manifest.assets[0], duration: 10, normalizedSha256: 'b'.repeat(64),
  }), /不一致/);
});

test('keeps assisted visual evidence usable without claiming manual confirmation', () => {
  const input = validManifest();
  (input.assets as any[])[0].visualReview.reviewMethod = 'assisted';
  const manifest = validateMaterialImportManifest(input);
  const metadata = buildMaterialImportVisualMetadata({
    asset: manifest.assets[0], duration: 12, normalizedSha256: 'b'.repeat(64),
  });
  assert.equal(metadata.segments[0].manualConfirmed, false);
  assert.match(metadata.segments[0].authenticity, /关键帧辅助复核/);
});

test('example manifest is disabled and dry-run performs no network request', async () => {
  const manifestPath = path.join(root, 'docs/examples/material-import-manifest.example.json');
  const manifest = validateMaterialImportManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  assert.ok(manifest.assets.length > 0);
  assert.ok(manifest.assets.every(asset => !asset.enabled));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('dry-run must not use network'); };
  try {
    await runImporterDryRun(['--manifest', manifestPath]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PocketBase migration, repair schema and HTTP boundary agree on 100 MiB', () => {
  assert.equal(POCKETBASE_MATERIAL_MAX_BYTES, 104857600);
  const migration = fs.readFileSync(path.join(root, 'pb_migrations/1790294403_add_material_provenance.js'), 'utf8');
  const setup = fs.readFileSync(path.join(root, 'scripts/setup-pb.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server/routes/studio.ts'), 'utf8');
  for (const field of ['sourceUrl', 'licenseEvidence', 'sourceProvider', 'sourceCreator', 'licenseName', 'licenseUrl', 'licenseEvidenceTextSha256', 'manifestSha256', 'provenance']) {
    assert.match(migration, new RegExp(`name: \\"${field}\\"`), `migration field ${field}`);
    assert.match(setup, new RegExp(`name: '${field}'`), `repair schema field ${field}`);
  }
  assert.match(setup, /name: 'videoFile'[\s\S]*?maxSize: 104857600/);
  assert.match(server, /MAX_MATERIAL_UPLOAD_BYTES = 100 \* 1024 \* 1024/);
});

test('material provenance migration is additive, repeatable and owns only its fields', () => {
  const migrationSource = fs.readFileSync(path.join(root, 'pb_migrations/1790294403_add_material_provenance.js'), 'utf8');
  let up: ((app: any) => unknown) | undefined;
  let down: ((app: any) => unknown) | undefined;
  class FakeField {
    [key: string]: unknown;
    constructor(definition: Record<string, unknown>) { Object.assign(this, definition); }
  }
  const items = [
    new FakeField({ id: 'existing-video', name: 'videoFile', type: 'file', maxSize: 104857600 }),
    new FakeField({ id: 'existing-poster', name: 'posterFile', type: 'file', maxSize: 5242880 }),
    new FakeField({ id: 'existing-title', name: 'title' }),
  ];
  const fields = {
    get length() { return items.length; },
    addAt(index: number, field: FakeField) { items.splice(index, 0, field); },
    getByName(name: string) {
      // PocketBase 0.39 returns an empty value for a missing field. Keep this
      // fake aligned so migrations cannot accidentally rely on an exception.
      return items.find(item => item.name === name);
    },
    removeById(id: string) {
      const index = items.findIndex(item => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
  };
  const collection = { fields, indexes: [] as string[] };
  const app = { findCollectionByNameOrId: () => collection, save: (value: unknown) => value };
  vm.runInNewContext(migrationSource, {
    Field: FakeField,
    migrate: (upCallback: typeof up, downCallback: typeof down) => { up = upCallback; down = downCallback; },
  });
  assert.ok(up && down);
  up!(app);
  const afterFirst = items.length;
  up!(app);
  assert.equal(items.length, afterFirst, 'forward migration must be idempotent');
  assert.ok(fields.getByName('importBatchId'), 'PocketBase-style missing-field lookup must still add fields');
  assert.ok(collection.indexes.some(index => index.includes('idx_materials_tenant_scope_sha256')));
  down!(app);
  assert.ok(items.some(item => item.id === 'existing-video'), 'rollback must preserve pre-existing fields');
  assert.equal(items.some(item => item.name === 'provenance'), false);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpeg from 'ffmpeg-static';
import type { DataStore, Record_ } from '../storage/datastore.js';
import {
  ReferenceSourceMediaClockRepairError,
  repairReferenceSourceMediaClock,
} from './referenceSourceMediaClockRepair.js';

const exec = promisify(execFile);

function storeFor(initial: Record<string, unknown>, options: { cas?: boolean; rejectCas?: boolean } = {}) {
  let row = structuredClone(initial) as Record_;
  const writes: Array<{ expected: Record<string, unknown>; patch: Record<string, unknown> }> = [];
  const store = {
    async getById() { return structuredClone(row); },
    async create() { throw new Error('not used'); },
    async update() { throw new Error('unsafe update must not be used'); },
    async delete() { throw new Error('not used'); },
    async list() { return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 30 }; },
  } as DataStore;
  if (options.cas !== false) store.compareAndSwap = async (_collection, _id, expected, patch) => {
    writes.push({ expected: structuredClone(expected), patch: structuredClone(patch) });
    if (options.rejectCas) return false;
    row = { ...row, ...structuredClone(patch) };
    return true;
  };
  return { store, writes, row: () => structuredClone(row) };
}

function analysis(sha256: string, overrides: Record<string, unknown> = {}) {
  return {
    analysisMode: 'exact',
    analysisRunId: 'run-current',
    analysisQueueState: 'completed',
    analysisStage: 'completed',
    analysisQuality: 'video',
    geminiStatus: 'analyzed',
    contentSha256: sha256,
    videoObjectKey: 'objects/source.mp4',
    gemini: { scriptDetails15s: [{ time: '0-1.2s', visual: '真实画面' }] },
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, error => error instanceof ReferenceSourceMediaClockRepairError && error.code === code);
}

test('repairs a completed exact source clock with measured bytes through one exact CAS', async t => {
  assert.ok(ffmpeg, 'ffmpeg fixture dependency is required');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-clock-repair-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'source.mp4');
  await exec(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x180:rate=10', '-t', '1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file]);
  const bytes = await fs.readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const base = {
    id: 'reference-1', tenantId: 'tenant-a', videoFileId: 'objects/source.mp4', duration: 1,
    title: 'untouched', aiAnalysis: JSON.stringify(analysis(sha256)),
  };

  const success = storeFor(base);
  const receipt = await repairReferenceSourceMediaClock({
    dataStore: success.store, recordId: 'reference-1', tenantId: 'tenant-a',
    videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file,
  });
  assert.ok(receipt.duration >= 1.19 && receipt.duration <= 1.21);
  assert.equal(receipt.sourceSha256, sha256);
  assert.equal(success.writes.length, 1);
  assert.deepEqual(Object.keys(success.writes[0]!.patch).sort(), ['aiAnalysis', 'duration']);
  assert.equal(success.writes[0]!.expected.aiAnalysis, base.aiAnalysis);
  assert.equal(success.writes[0]!.expected.videoFileId, base.videoFileId);
  const saved = JSON.parse(String(success.row().aiAnalysis));
  assert.deepEqual(saved.gemini.sourceMediaClock, receipt);
  assert.equal(success.row().duration, receipt.duration);
  assert.equal(success.row().title, 'untouched');

  const legacy = storeFor({ ...base, aiAnalysis: JSON.stringify(analysis('', { contentSha256: undefined })) });
  const legacyReceipt = await repairReferenceSourceMediaClock({ dataStore: legacy.store, recordId: 'reference-1', tenantId: 'tenant-a',
    videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file, expectedSourceSha256: sha256 });
  assert.equal(legacyReceipt.sourceSha256, sha256, 'a legacy run may use the exact object-restoration hash receipt');

  const missingHash = storeFor({ ...base, aiAnalysis: JSON.stringify(analysis('', { contentSha256: undefined })) });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: missingHash.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_analysis_hash_missing');
  assert.equal(missingHash.writes.length, 0);

  const staleRun = storeFor({ ...base, aiAnalysis: JSON.stringify(analysis(sha256, { analysisRunId: 'new-run' })) });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: staleRun.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_analysis_run_changed');
  assert.equal(staleRun.writes.length, 0);

  const staleKey = storeFor({ ...base, aiAnalysis: JSON.stringify(analysis(sha256, { videoObjectKey: 'objects/new.mp4' })) });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: staleKey.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_video_object_changed');
  assert.equal(staleKey.writes.length, 0);

  const staleTenant = storeFor(base);
  await expectCode(repairReferenceSourceMediaClock({ dataStore: staleTenant.store, recordId: 'reference-1', tenantId: 'tenant-b', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_tenant_changed');
  assert.equal(staleTenant.writes.length, 0);

  const staleHash = storeFor({ ...base, aiAnalysis: JSON.stringify(analysis('f'.repeat(64))) });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: staleHash.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_source_hash_changed');
  assert.equal(staleHash.writes.length, 0);

  const withoutCas = storeFor(base, { cas: false });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: withoutCas.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_atomic_store_required');
  assert.equal(withoutCas.writes.length, 0);

  const lostCas = storeFor(base, { rejectCas: true });
  await expectCode(repairReferenceSourceMediaClock({ dataStore: lostCas.store, recordId: 'reference-1', tenantId: 'tenant-a', videoObjectKey: 'objects/source.mp4', analysisRunId: 'run-current', localFilePath: file }), 'source_clock_compare_and_swap_failed');
  assert.equal(lostCas.writes.length, 1);
  assert.deepEqual(lostCas.row(), base);
});

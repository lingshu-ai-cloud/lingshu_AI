import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanVideoBeforeMaterialAdmission,
  MaterialCleanupAdmissionError,
  MaterialCleanupQueue,
  requiresMaterialCleanup,
  type MaterialCleanupReport,
} from './materialCleanupAdmission.js';

const passingReport: MaterialCleanupReport = {
  schemaVersion: 'material-cleanup.v1', status: 'passed',
  toolchain: { ocr: 'paddleocr', maskTracker: 'sam2', inpaint: 'opencv-temporal', compositor: 'ffmpeg', seedanceUsed: false },
  framesProcessed: 120, totalFrames: 120, residualTextDetections: 0, unresolvedRegions: 0,
  maximumMaskCoverage: 0.08, temporalFlickerScore: 0.02,
};

const metrics = {
  source: { width: 576, height: 1024, duration: 4, fps: 30, hasAudio: true },
  candidate: { width: 576, height: 1024, duration: 4, fps: 30, hasAudio: true },
  durationDeltaFrames: 0, audioCorrelation: 1, wholeFrameSimilarity: 0.98,
  meanFrameDifference: 2, temporalMotionDifference: 0.1, freezeMismatchRatio: 0, comparedFrames: 20, limitations: [],
};

test('only manually uploaded videos enter cleanup; trusted automatic collection bypasses it', () => {
  assert.equal(requiresMaterialCleanup({ type: 'video', ingestionOrigin: 'manual_upload' }), true);
  assert.equal(requiresMaterialCleanup({ type: 'image', ingestionOrigin: 'manual_upload' }), false);
  assert.equal(requiresMaterialCleanup({ type: 'audio', ingestionOrigin: 'manual_upload' }), false);
  assert.equal(requiresMaterialCleanup({ type: 'video', ingestionOrigin: 'trusted_automatic_ingestion' }), false);
});

test('shared cleanup capacity is FIFO and rejects excess users before processing', async () => {
  const queue = new MaterialCleanupQueue(1, 1);
  let releaseFirst!: () => void;
  const order: string[] = [];
  const first = queue.run(async () => {
    order.push('first:start');
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    order.push('first:end');
    return 1;
  });
  const second = queue.run(async () => { order.push('second'); return 2; });
  await assert.rejects(queue.run(async () => 3), (error: unknown) => error instanceof MaterialCleanupAdmissionError
    && error.code === 'material_cleanup_unavailable'
    && /队列已满/.test(error.message));
  assert.deepEqual(queue.snapshot(), { active: 1, queued: 1, maximumConcurrency: 1, maximumQueued: 1 });
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
});

test('cleanup admits only a complete non-Seedance output with verified media continuity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'material-cleanup-pass-'));
  try {
    const source = path.join(directory, 'source.mp4'); fs.writeFileSync(source, 'source');
    const result = await cleanVideoBeforeMaterialAdmission({ sourcePath: source, outputDirectory: directory, sourceSha256: 'a'.repeat(64) }, {
      runPipeline: async (_input, output, report) => { fs.writeFileSync(output, 'cleaned'); fs.writeFileSync(report, JSON.stringify(passingReport)); },
      inspectPair: async () => metrics,
    });
    assert.equal(result.report.toolchain.seedanceUsed, false);
    assert.equal(result.sourceSha256, 'a'.repeat(64));
    assert.equal(result.sizeBytes, 7);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cleanup rejects residual text and never treats partial processing as admitted', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'material-cleanup-reject-'));
  try {
    const source = path.join(directory, 'source.mp4'); fs.writeFileSync(source, 'source');
    await assert.rejects(cleanVideoBeforeMaterialAdmission({ sourcePath: source, outputDirectory: directory, sourceSha256: 'b'.repeat(64) }, {
      runPipeline: async (_input, output, report) => {
        fs.writeFileSync(output, 'partial');
        fs.writeFileSync(report, JSON.stringify({ ...passingReport, status: 'rejected', framesProcessed: 119, residualTextDetections: 2 }));
      },
      inspectPair: async () => { throw new Error('quality inspection must not run'); },
    }), (error: unknown) => error instanceof MaterialCleanupAdmissionError
      && error.code === 'material_cleanup_rejected'
      && /仍检出 2 处/.test(error.message));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cleanup rejects any worker that reports Seedance or a substituted toolchain', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'material-cleanup-toolchain-'));
  try {
    const source = path.join(directory, 'source.mp4'); fs.writeFileSync(source, 'source');
    await assert.rejects(cleanVideoBeforeMaterialAdmission({ sourcePath: source, outputDirectory: directory, sourceSha256: 'c'.repeat(64) }, {
      runPipeline: async (_input, output, report) => {
        fs.writeFileSync(output, 'generated');
        fs.writeFileSync(report, JSON.stringify({ ...passingReport, toolchain: { ...passingReport.toolchain, seedanceUsed: true } }));
      },
      inspectPair: async () => metrics,
    }), (error: unknown) => error instanceof MaterialCleanupAdmissionError && error.code === 'material_cleanup_unavailable');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

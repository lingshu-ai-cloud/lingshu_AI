import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { probeReferenceMediaClock } from './referenceMediaClock.js';

const COLLECTION = 'trend_videos';
const SHA256 = /^[a-f0-9]{64}$/i;

export type ReferenceSourceMediaClockRepairInput = {
  dataStore: DataStore;
  recordId: string;
  tenantId: string;
  videoObjectKey: string;
  analysisRunId: string;
  localFilePath: string;
  /** SHA-256 receipt produced while restoring this exact object key. Required
   * for legacy completed analyses that did not persist contentSha256. */
  expectedSourceSha256?: string;
};

export type ReferenceSourceMediaClockRepairReceipt = {
  schemaVersion: 1;
  duration: number;
  fps: number | null;
  sourceSha256: string;
  analysisRunId: string;
  videoObjectKey: string;
  measuredAt: string;
};

export class ReferenceSourceMediaClockRepairError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ReferenceSourceMediaClockRepairError';
  }
}

function fail(code: string): never {
  throw new ReferenceSourceMediaClockRepairError(code);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function isCompletedExactAnalysis(analysis: Record<string, unknown>): boolean {
  const gemini = parseRecord(analysis.gemini);
  return analysis.analysisMode === 'exact'
    && analysis.analysisQueueState === 'completed'
    && analysis.analysisStage === 'completed'
    && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
    && ['analyzed', 'needs_review'].includes(String(analysis.geminiStatus || ''))
    && Array.isArray(gemini.scriptDetails15s)
    && gemini.scriptDetails15s.length > 0;
}

/**
 * Backfill the measured source clock for a completed exact analysis.
 *
 * This is deliberately fail-closed: the original source bytes, analysis run,
 * tenant and object key must still be the versions observed by the caller, and
 * the final write must win an atomic compare-and-swap over the original
 * analysis payload. It performs no network/provider calls.
 */
export async function repairReferenceSourceMediaClock(
  input: ReferenceSourceMediaClockRepairInput,
): Promise<ReferenceSourceMediaClockRepairReceipt> {
  if (!input.dataStore.compareAndSwap) fail('source_clock_atomic_store_required');
  const row = await input.dataStore.getById<Record_>(COLLECTION, input.recordId);
  if (!row) fail('source_clock_record_not_found');

  const tenantField = Object.prototype.hasOwnProperty.call(row, 'tenantId') ? 'tenantId' : 'tenant_id';
  if (String(row[tenantField] || '') !== input.tenantId) fail('source_clock_tenant_changed');

  const originalAnalysis = row.aiAnalysis;
  const analysis = parseRecord(originalAnalysis);
  if (String(analysis.analysisRunId || '') !== input.analysisRunId) fail('source_clock_analysis_run_changed');
  if (!isCompletedExactAnalysis(analysis)) fail('source_clock_exact_analysis_incomplete');

  const analysisObjectKey = String(analysis.videoObjectKey || '');
  const recordObjectKey = String(row.videoFileId || '');
  const currentObjectKey = analysisObjectKey || recordObjectKey;
  if (!currentObjectKey || currentObjectKey !== input.videoObjectKey) fail('source_clock_video_object_changed');

  const recordedSha256 = String(analysis.contentSha256 || '').toLowerCase();
  const receiptSha256 = String(input.expectedSourceSha256 || '').toLowerCase();
  if (recordedSha256 && receiptSha256 && recordedSha256 !== receiptSha256) fail('source_clock_hash_receipt_conflict');
  const expectedSha256 = recordedSha256 || receiptSha256;
  if (!SHA256.test(expectedSha256)) fail('source_clock_analysis_hash_missing');
  const [clock, measuredSha256] = await Promise.all([
    probeReferenceMediaClock(input.localFilePath),
    sha256File(input.localFilePath),
  ]);
  if (measuredSha256 !== expectedSha256) fail('source_clock_source_hash_changed');

  const measuredAt = new Date().toISOString();
  const receipt: ReferenceSourceMediaClockRepairReceipt = {
    schemaVersion: 1,
    duration: clock.duration,
    fps: clock.fps,
    sourceSha256: measuredSha256,
    analysisRunId: input.analysisRunId,
    videoObjectKey: input.videoObjectKey,
    measuredAt,
  };
  const gemini = parseRecord(analysis.gemini);
  const nextAnalysis = {
    ...analysis,
    contentSha256: measuredSha256,
    gemini: {
      ...gemini,
      sourceMediaClock: receipt,
    },
  };
  const expected: Record<string, unknown> = {
    [tenantField]: row[tenantField],
    aiAnalysis: originalAnalysis,
  };
  if (Object.prototype.hasOwnProperty.call(row, 'videoFileId')) expected.videoFileId = row.videoFileId;
  const storedAnalysis = typeof originalAnalysis === 'string' ? JSON.stringify(nextAnalysis) : nextAnalysis;
  const committed = await input.dataStore.compareAndSwap(
    COLLECTION,
    input.recordId,
    expected,
    { duration: clock.duration, aiAnalysis: storedAnalysis },
  );
  if (!committed) fail('source_clock_compare_and_swap_failed');
  return receipt;
}

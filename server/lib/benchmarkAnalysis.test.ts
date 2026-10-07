import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkAnalysisForRecord } from './benchmarkAnalysis.js';
import { videoAnalysisOf } from './videoAnalysisCodec.js';
import { normalizeVideoAnalysis } from '../agents/gemini.js';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo.js';
import type { VideoAiAnalysis } from '../types/index.js';
test('read projection has stable revision, and manual correction/rerun invalidates it', () => {
  const analysis = benchmarkVideoFixture(); const record = { id: 'video-fixture', duration: 9, aiAnalysis: JSON.stringify(analysis) };
  const first = benchmarkAnalysisForRecord(record, analysis);
  assert.equal(first.source.evidenceRevision, benchmarkAnalysisForRecord(record, analysis).source.evidenceRevision);
  assert.notEqual(first.source.evidenceRevision, benchmarkAnalysisForRecord(record, { ...analysis, correction: { version: 1 } }).source.evidenceRevision);
  assert.notEqual(first.source.evidenceRevision, benchmarkAnalysisForRecord(record, { ...analysis, analysisRunId: 'rerun' }).source.evidenceRevision);
  const read = videoAnalysisOf(record).benchmarkAnalysis as typeof first;
  assert.equal(read.status, 'ready'); assert.equal(read.source.videoId, 'video-fixture');
  assert.equal(benchmarkAnalysisForRecord(record, { ...analysis, gemini: JSON.stringify(analysis.gemini) }).status, 'ready');
  const stale = videoAnalysisOf({ ...record, aiAnalysis: JSON.stringify({ ...analysis, benchmarkAnalysis: { status: 'fake' } }) });
  assert.equal((stale.benchmarkAnalysis as typeof first).status, 'ready');
  assert.equal(videoAnalysisOf({ id: 'image', aiAnalysis: JSON.stringify({ contentFormat: 'image' }) }).benchmarkAnalysis, undefined);
});
test('provider normalization preserves first-shot hook and typed material/role fields', () => {
  const analysis = benchmarkVideoFixture();
  const normalized = normalizeVideoAnalysis(analysis.gemini as Partial<VideoAiAnalysis>);
  assert.equal(normalized.scriptDetails15s?.[7].materialType, 'consumer_demo');
  assert.equal(normalized.scriptDetails15s?.[0].narrativeRole, 'hook');
  assert.ok(normalized.scriptDetails15s?.[0].classificationEvidence);
  const old = normalizeVideoAnalysis({ scriptDetails15s: [{ time: '0-1s', visual: '产品' }] });
  assert.equal(old.scriptDetails15s?.[0].materialType, 'unknown');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBenchmarkAnalysis, recordOf } from './benchmarkAnalysis.js';
import { productionReferenceAdmission } from './productionReferenceAdmission.js';
import { benchmarkVideoFixture } from '../tests/fixtures/benchmarkVideo.js';

const build = (analysis = benchmarkVideoFixture()) => buildBenchmarkAnalysis({ analysis, videoId: 'reference', duration: 9, evidenceRevision: 'v1' });
test('complete evidence is admitted, but completed review-required evidence is not production-ready', () => {
  assert.equal(productionReferenceAdmission(build()).ready, true);
  const source = benchmarkVideoFixture();
  source.analysisQuality = 'video_review_required'; source.geminiStatus = 'needs_review';
  const shots = recordOf(source.gemini).scriptDetails15s as Record<string, unknown>[];
  shots[7].materialType = 'unknown'; shots[7].needsReview = true;
  const snapshot = JSON.stringify(source);
  const result = productionReferenceAdmission(build(source));
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockingShotIds, ['shot_8']);
  assert.equal(result.executableShotIds.length, 8, 'one unresolved shot must not erase executable siblings');
  assert.ok(result.blockers.some(item => item.includes('第 8 镜') && item.includes('类型未确认')));
  assert.equal(JSON.stringify(source), snapshot, 'admission never edits frozen/source evidence');
});
test('observation windows, timeline gaps and blank visuals are refused before new plan selection', () => {
  const source = benchmarkVideoFixture();
  const shots = recordOf(source.gemini).scriptDetails15s as Record<string, unknown>[];
  shots[2].analysisGranularity = 'observation_window'; shots[4].time = '4.6-5s'; shots[6].visual = '';
  const result = productionReferenceAdmission(build(source));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(item => item.includes('物理镜头边界')));
  assert.ok(result.blockers.some(item => item.includes('完整覆盖原片')));
  assert.ok(result.blockingShotIds.includes('shot_7'));
});
test('pending, failed and review evidence never becomes ready through a stale completed flag', () => {
  for (const patch of [{ analysisError: 'timeout' }, { geminiStatus: 'needs_review' }, { analysisProgress: { stage: 'analyzing' } }]) {
    assert.equal(productionReferenceAdmission(build({ ...benchmarkVideoFixture(), ...patch })).ready, false);
  }
  assert.equal(productionReferenceAdmission(null).ready, false);
  assert.equal(productionReferenceAdmission(buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'reference', duration: 9 })).ready, true,
    'UI admission does not invent a source revision requirement absent from its existing payload');
});

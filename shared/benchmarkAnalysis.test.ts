import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBenchmarkAnalysis, benchmarkMaterialType, benchmarkTimeRange, recordOf } from './benchmarkAnalysis.js';
import { benchmarkVideoFixture, lightingBenchmarkFixture } from '../tests/fixtures/benchmarkVideo.js';

const build = (analysis = benchmarkVideoFixture()) => buildBenchmarkAnalysis({ analysis, videoId: 'video-fixture', duration: 9, evidenceRevision: 'revision' });
test('nine shots remain nine when a speech line covers six shots', () => {
  const result = build();
  assert.equal(result.status, 'ready'); assert.equal(result.totalShots, 9);
  assert.equal(result.speechGroups.length, 3); assert.equal(result.speechGroups[2].shotIds.length, 6);
  assert.equal(result.materialCounts.product, 5); assert.equal(result.materialCounts.consumer_demo, 1);
  assert.equal(result.structure[2].shotIds.length, 5);
  assert.equal(result.shots[0].materialType, 'talking_head', 'factory background does not override the visible speaker');
  assert.equal(result.hookShotId, 'shot_1');
  assert.ok(!('hook' in result));
});
test('legacy visible actions are mapped transparently without clearing review', () => {
  const fixture = benchmarkVideoFixture(); const gemini = recordOf(fixture.gemini);
  delete gemini.hookAnalysis;
  const rows = gemini.scriptDetails15s as Record<string, unknown>[];
  delete rows[0].materialType; rows[1].materialType = 'dtc';
  const result = build(fixture);
  assert.equal(result.status, 'partial'); assert.equal(result.shots[0].materialType, 'talking_head');
  assert.equal(result.shots[0].classificationSource, 'legacy_evidence');
  assert.equal(result.shots[1].materialType, 'factory'); assert.equal(result.hookShotId, 'shot_1');
  assert.equal(benchmarkMaterialType('toString'), 'unknown');
});
test('failed, review and pending source states cannot reuse an old ready analysis', () => {
  assert.equal(build({ ...benchmarkVideoFixture(), analysisError: 'timeout' }).status, 'failed');
  assert.equal(build({ ...benchmarkVideoFixture(), geminiStatus: 'needs_review' }).status, 'needs_review');
  assert.equal(build({ ...benchmarkVideoFixture(), requestedAnalysisMode: 'exact' }).status, 'pending');
  assert.equal(build({ ...benchmarkVideoFixture(), analysisMode: 'strategy' }).totalShots, null);
  assert.equal(build({ ...benchmarkVideoFixture(), analysisMode: 'strategy' }).status, 'partial');
});
test('invalid boundaries, holes and unknown duration cannot claim full timeline', () => {
  for (const time of ['bad', '0-0s', '0:01-0:04', '1-0s']) assert.equal(benchmarkTimeRange(time), null);
  assert.deepEqual(benchmarkTimeRange('0.00s–0.92s'), { start: 0, end: 0.92 });
  const fixture = benchmarkVideoFixture(); (recordOf(fixture.gemini).scriptDetails15s as Record<string, unknown>[])[2].time = '2.8-3s';
  assert.equal(build(fixture).timelineComplete, false); assert.equal(build(fixture).status, 'partial');
  assert.equal(buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture() }).timelineComplete, false);
});
test('observation windows are not presented as physical shot counts', () => {
  const fixture = benchmarkVideoFixture(); (recordOf(fixture.gemini).scriptDetails15s as Record<string, unknown>[])[0].analysisGranularity = 'observation_window';
  assert.equal(build(fixture).totalShots, null); assert.equal(build(fixture).status, 'partial');
});
test('coarse ASR stays coarse and uncertain, with honest temporal overlap mapping', () => {
  const fixture = benchmarkVideoFixture(); const transcript = recordOf(recordOf(fixture.gemini).audioTranscript);
  transcript.segments = [{ start: 0, end: 5, text: 'estimated words', timingPrecision: 'coarse', needsReview: false },
    { start: -1, end: 3, text: 'invalid' }];
  const result = build(fixture); assert.equal(result.speechGroups.length, 1);
  assert.equal(result.speechGroups[0].timingPrecision, 'coarse'); assert.equal(result.speechGroups[0].needsReview, true);
  assert.equal(result.speechGroups[0].shotIds.length, 5);
});
test('media evidence only retains the existing source-video scoped route', () => {
  const fixture = benchmarkVideoFixture(); const rows = recordOf(fixture.gemini).scriptDetails15s as Record<string, unknown>[];
  rows[0].materialEvidence = { firstFrameRef: '/tmp/secret.jpg', clipRef: '/api/overseas/videos/other/shot/1/clip', firstFrameObjectKey: 'secret' };
  rows[1].materialEvidence = { firstFrameRef: '/api/overseas/videos/video-fixture/shot/2/first-frame' };
  const result = build(fixture); assert.equal(result.shots[0].firstFrameRef, null); assert.equal(result.shots[0].clipRef, null);
  assert.ok(result.shots[1].firstFrameRef); assert.ok(!JSON.stringify(result).includes('secret'));
});

test('legacy microphone presenter is classified, factory setting alone remains unknown', () => {
  const result = buildBenchmarkAnalysis({ analysis: { gemini: { scriptDetails15s: [
    { time: '0-3.4s', visual: '女主播穿米白连衣裙，手持黑色麦克风与绿色吊灯，面带微笑挥手' },
    { time: '3.4-9s', visual: '厂房背景与窗户' },
  ] } } });
  assert.equal(result.shots[0].materialType, 'talking_head');
  assert.equal(result.shots[0].narrativeRole, 'hook');
  assert.equal(result.shots[0].needsReview, true);
  assert.equal(result.shots[1].materialType, 'unknown');
});

test('existing lighting reference uses presenter evidence and factory actions for all six shots', () => {
  const result = buildBenchmarkAnalysis({ analysis: lightingBenchmarkFixture(), duration: 14.26 });
  assert.deepEqual(result.shots.map(shot => shot.materialType), ['talking_head', 'talking_head', 'product', 'factory', 'factory', 'talking_head']);
  assert.deepEqual(result.structure.map(segment => [segment.materialType, segment.shotIds.length]), [['talking_head', 2], ['product', 1], ['factory', 2], ['talking_head', 1]]);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.materialCounts.unknown, 0);
});

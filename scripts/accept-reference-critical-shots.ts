import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: path.resolve('../local-preview-1002/.env'), quiet: true });
dotenv.config({ path: path.resolve('../local-preview-1002/.env.local'), override: true, quiet: true });
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.resolve('data/local-store');
process.env.NO_PROXY = [...new Set(String(process.env.NO_PROXY || '').split(',').concat(['localhost', '127.0.0.1', '::1']))].join(',');
process.env.no_proxy = process.env.NO_PROXY;

const sourceId = process.env.CRITICAL_ACCEPT_SOURCE_ID || 'trend_videos_192e76d4b21244c4a2922e60672c95f2';
const reportDir = path.resolve(process.env.CRITICAL_ACCEPT_REPORT_DIR || 'data/acceptance/yucheng-critical-shots-aligned-20261010');
fs.mkdirSync(reportDir, { recursive: true });
const save = (name: string, value: unknown) => fs.writeFileSync(path.join(reportDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const baselinePath = path.resolve('data/acceptance/yucheng-critical-shots-qwen-20261010.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
if (!fs.existsSync(path.join(reportDir, 'baseline-before.json'))) save('baseline-before.json', baseline);
const stage1 = JSON.parse(fs.readFileSync(path.resolve('data/acceptance/yucheng-word-alignment-20261010/report.json'), 'utf8'));
assert.equal(stage1.status, 'passed', 'word-alignment E2E passed before classification');
assert.equal(stage1.browserUi.status, 'passed', 'real product browser inspection passed before classification');
const { store } = await import('../server/storage/index.js');
const { runWithDataAuthority, dataAuthorityRequestScope } = await import('../server/storage/dataAuthority.js');
const { issueVerifiedLocalIdentityToken } = await import('../server/auth/localIdentity.js');
const { readLocalAccountRecords, localAccountRecordsFile } = await import('../server/lib/localAccountStore.js');
const { parseAnalysisTimeRange } = await import('../server/lib/videoAnalysisCodec.js');
const { videosRouter } = await import('../server/routes/videos.js');
const record = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
assert.ok(record);
const before = parse(record.aiAnalysis);
assert.equal(before.speechAlignment.status, 'aligned');
if (!fs.existsSync(path.join(reportDir, 'before-record.json'))) save('before-record.json', record);
const account = readLocalAccountRecords(localAccountRecordsFile()).find(account => account.tenantId === record.tenantId && account.role === 'super_admin');
assert.ok(account);
const token = issueVerifiedLocalIdentityToken(account);
const app = express();
app.use(express.json());
app.use(dataAuthorityRequestScope);
app.use('/api/overseas/videos', videosRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/videos/${sourceId}`;
const request = async (suffix: string, method = 'GET') => {
  const response = await fetch(`${base}${suffix}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(10 * 60_000) });
  return { statusCode: response.status, body: await response.json() };
};
try {
  // Refresh from the same cached measured ASR, retaining latest beat-boundary
  // corrections without a second supplier task.
  const alignmentRefresh = await request('/align-speech', 'POST');
  save('alignment-cache-refresh.json', alignmentRefresh);
  assert.equal(alignmentRefresh.statusCode, 200);
  assert.equal(alignmentRefresh.body.alignment.taskId, stage1.alignment.taskId);
  const response = await request('/classify-critical-shots', 'POST');
  save('classification-api-response.json', response);
  if (response.statusCode !== 200) save(`failed-api-attempt-${Date.now()}.json`, response);
  assert.equal(response.statusCode, 200, `classification succeeds: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.ok, true);
  const saved = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
  save('after-record.json', saved);
  const analysis = parse(saved.aiAnalysis);
  assert.equal(analysis.contentSha256, before.contentSha256);
  assert.equal(analysis.analysisRunId, before.analysisRunId);
  assert.deepEqual(analysis.gemini.audioTranscript, before.gemini.audioTranscript, 'Qwen visual classification retains measured audio clock');
  const shots = analysis.gemini.scriptDetails15s;
  const summary = analysis.criticalShotAnalysis;
  assert.ok(summary?.frameEvidence?.length > 0, 'actual reference extraction frame schedule is persisted');
  assert.equal(summary.provider, 'qwen');
  assert.equal(summary.ruleVersion, 'critical_shot_word_frame_v1');
  assert.equal(summary.evidenceVersion, 'frame-word-id-projection-v2');
  const parsedProviderResponse = JSON.parse(summary.providerResponse.raw);
  const providerResponse = Array.isArray(parsedProviderResponse) && parsedProviderResponse.length === 1
    ? parsedProviderResponse[0] : parsedProviderResponse;
  assert.equal(summary.frameCount, summary.frameEvidence.length);
  for (const frame of summary.frameEvidence) {
    assert.ok(Number.isFinite(frame.seconds) && Number.isFinite(frame.requestedSeconds), 'actual and requested extraction clocks are recorded separately');
    assert.ok(Math.abs(frame.seconds * stage1.fps - Math.round(frame.seconds * stage1.fps)) < .01, 'actual decoded frame clock agrees with independent source fps');
  }
  assert.equal(shots.length, 17);
  const rows = shots.map((shot: any, index: number) => {
    const decision = shot.criticalShot;
    assert.ok(decision, 'every shot has a product Qwen decision');
    assert.ok(['critical', 'non_critical'].includes(decision.classification));
    const isCritical = decision.primaryHook || (decision.uniqueVisualMechanism && decision.explicitAudioVisualSync);
    assert.equal(decision.classification, isCritical ? 'critical' : 'non_critical', 'product critical-shot formula holds');
    assert.ok(decision.reason?.trim(), 'model reasoning is retained');
    assert.ok(decision.provenance || decision.model, 'product model provenance is retained');
    const modelRow = providerResponse.shots.find((row: any) => row.shotId === `shot-${index + 1}`);
    for (const field of ['classification', 'primaryHook', 'uniqueVisualMechanism', 'explicitAudioVisualSync']) {
      assert.equal(decision[field], modelRow[field], 'classification is exactly the product Qwen decision');
    }
    const range = parseAnalysisTimeRange(shot.time)!;
    assert.ok(range && range.end <= Number(saved.duration) + .01);
    const frames = summary.frameEvidence.filter((frame: any) => frame.shotId === `shot-${index + 1}`).map((frame: any) => frame.seconds);
    assert.ok(frames.length >= 2, 'every shot has actual Qwen image inputs');
    for (const event of decision.actionEvents || []) {
      assert.ok(Number.isFinite(event.start) && Number.isFinite(event.end) && event.end >= event.start && event.start >= range.start && event.end <= range.end, 'action event is bounded by actual shot');
      assert.equal(event.timingPrecision, 'sampled_frames', 'sampled action evidence is not promoted to frame-perfect timing');
      assert.ok(event.evidenceFrameSeconds.length >= 2, 'action has multiple physical frame witnesses');
      for (const second of event.evidenceFrameSeconds) {
        assert.ok(frames.some((frame: number) => Math.abs(frame - second) < .005), 'every cited frame was actually supplied to Qwen');
      }
      assert.equal(event.start, Math.min(...event.evidenceFrameSeconds), 'action observation starts at an actual witness frame');
      assert.equal(event.end, Math.max(...event.evidenceFrameSeconds), 'action observation ends at an actual witness frame');
    }
    if (decision.explicitAudioVisualSync) assert.ok(decision.syncPoints?.length > 0, 'positive sync verdict has explicit validated evidence');
    const wordMap = new Map<string, any>(shot.speechAlignment.words.map((word: any) => [word.wordId, word]));
    for (const point of decision.syncPoints || []) {
      assert.ok(Number.isInteger(point.eventIndex) && point.eventIndex >= 0 && point.eventIndex < decision.actionEvents.length, 'sync points reference legal action events');
      const event = decision.actionEvents[point.eventIndex];
      assert.equal(point.timingPrecision, 'word_frame_interval_projection');
      assert.ok(point.wordIds?.length > 0 && typeof point.reason === 'string' && point.reason.trim(), 'model semantic reason and word evidence are retained');
      assert.ok(Number.isFinite(point.syncTime) && point.syncTime >= event.start && point.syncTime <= event.end, 'sync time falls within observed action');
      for (const wordId of point.wordIds) {
        const word = wordMap.get(wordId);
        assert.ok(word?.syncEligible === true && word.end > word.start, 'sync references actual usable word clock, never invented or zero-duration word');
        const start = Math.max(word.overlapStart, event.start), end = Math.min(word.overlapEnd, event.end);
        assert.ok(end > start, 'source word and observed action genuinely overlap');
        assert.ok(point.syncTime >= start && point.syncTime < end, 'reported sync time falls within each referenced word/event actual intersection');
      }
      const projectedStart = Math.max(event.start, ...point.wordIds.map((wordId: string) => wordMap.get(wordId).overlapStart));
      const projectedEnd = Math.min(event.end, ...point.wordIds.map((wordId: string) => wordMap.get(wordId).overlapEnd));
      assert.deepEqual(point.timeRange, { start: projectedStart, end: projectedEnd }, 'sync interval is deterministic real clock intersection');
      assert.equal(point.syncTime, (projectedStart + projectedEnd) / 2, 'sync anchor is explicitly computed midpoint, not model invented time');
      assert.ok(point.wordIds.some((wordId: string) => {
        const word = wordMap.get(wordId);
        return point.syncTime >= Math.max(word.start, event.start) && point.syncTime <= Math.min(word.end, event.end);
      }), 'reported sync time is inside a genuine audio/action intersection');
    }
    const previous = baseline.result.shots.find((item: any) => Number(item.shotId) === index + 1);
    return { ...decision, shotId: index + 1, time: shot.time, dialogue: shot.dialogue,
      previousClassification: previous?.classification, classification: decision.classification,
      changed: previous?.classification !== decision.classification };
  });
  save('comparison.json', rows);
  const readBack = await request('');
  save('api-after.json', readBack);
  assert.equal(readBack.statusCode, 200);
  const publicAnalysis = parse(readBack.body.aiAnalysis);
  assert.deepEqual(publicAnalysis.criticalShotAnalysis, analysis.criticalShotAnalysis);
  assert.deepEqual(publicAnalysis.gemini.scriptDetails15s.map((shot: any) => shot.criticalShot), shots.map((shot: any) => shot.criticalShot), 'authenticated API returns actual persisted per-shot decisions');
  const replay = await request('/classify-critical-shots', 'POST');
  save('cache-replay-response.json', replay);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body.classification, response.body.classification, 'second request returns exact cached paid classification');
  const replayRecord = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
  assert.deepEqual(parse(replayRecord.aiAnalysis).criticalShotAnalysis, analysis.criticalShotAnalysis, 'cache replay retains exact fingerprint and classification artifact');
  const report = { status: 'passed', sourceId, at: new Date().toISOString(), alignmentTaskId: before.speechAlignment.taskId,
    supplierCalls: { qwenFiletrans: 1, qwenVl: 2, qwenVlInitiallyRejectedValidation: 2,
      qwenVlIrrecoverableRejected: 1, qwenVlSucceededAfterParserRecovery: 1,
      parserRecoveryAdditionalSupplierCalls: 0, preSubmissionExtractionFailures: 2 },
    knownEarlierPaidFailure: 'data/analysis-output/critical-shots/929c8fc3e5d298b38ad6cb87115d9d80e9978ca89cbd689e464ab0248c52b282.json',
    priorCriticalShotIds: baseline.result.summary.criticalShotIds, criticalShotIds: rows.filter((row: any) => row.classification === 'critical').map((row: any) => row.shotId),
    authenticatedApiReadback: true, durableStorageReadback: true, cacheReplaySameResult: true,
    criticalShotAnalysis: analysis.criticalShotAnalysis, shots: rows };
  save('report.json', report);
  console.log(JSON.stringify({ status: 'passed', sourceId, criticalShotIds: report.criticalShotIds, shotCount: rows.length, reportDir }));
} catch (error) {
  save('failure.json', { status: 'failed', at: new Date().toISOString(), sourceId, error: error instanceof Error ? error.stack : String(error) });
  throw error;
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

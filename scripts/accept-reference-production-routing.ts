import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

// Actual local customer account, router, supplier and durable store. This is
// an acceptance command, never an automatic retry of an uncertain paid task.
dotenv.config({ path: path.resolve('../local-preview-1002/.env'), quiet: true });
dotenv.config({ path: path.resolve('../local-preview-1002/.env.local'), override: true, quiet: true });
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.resolve('data/local-store');
process.env.NO_PROXY = [...new Set(String(process.env.NO_PROXY || '').split(',').concat(['localhost', '127.0.0.1', '::1']))].join(',');
process.env.no_proxy = process.env.NO_PROXY;

const sourceId = process.env.ROUTING_ACCEPT_SOURCE_ID || 'trend_videos_192e76d4b21244c4a2922e60672c95f2';
const reportDir = path.resolve(process.env.ROUTING_ACCEPT_REPORT_DIR || 'data/acceptance/yucheng-presenter-routing-20261010');
fs.mkdirSync(reportDir, { recursive: true });
const save = (name: string, value: unknown) => fs.writeFileSync(path.join(reportDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const stage2 = JSON.parse(fs.readFileSync(path.resolve('data/acceptance/yucheng-critical-shots-aligned-20261010/report.json'), 'utf8'));
assert.equal(stage2.status, 'passed');
assert.equal(stage2.browserUi.status, 'passed', 'critical-shot product UI acceptance precedes independent identity routing');
const { store } = await import('../server/storage/index.js');
const { runWithDataAuthority, dataAuthorityRequestScope } = await import('../server/storage/dataAuthority.js');
const { issueVerifiedLocalIdentityToken } = await import('../server/auth/localIdentity.js');
const { readLocalAccountRecords, localAccountRecordsFile } = await import('../server/lib/localAccountStore.js');
const { parseAnalysisTimeRange } = await import('../server/lib/videoAnalysisCodec.js');
const { videosRouter } = await import('../server/routes/videos.js');
const beforeRecord = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
assert.ok(beforeRecord);
const before = parse(beforeRecord.aiAnalysis);
if (!fs.existsSync(path.join(reportDir, 'before-record.json'))) save('before-record.json', beforeRecord);
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ status: 'preflight', sourceId, shotCount: before.gemini.scriptDetails15s.length, criticalShotIds: stage2.criticalShotIds, submitted: false }));
  process.exit(0);
}

const account = readLocalAccountRecords(localAccountRecordsFile()).find(account => account.tenantId === beforeRecord.tenantId && account.role === 'super_admin');
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
  const response = await request('/route-production', 'POST');
  save('routing-api-response.json', response);
  if (response.statusCode !== 200) save(`failed-api-attempt-${Date.now()}.json`, response);
  assert.equal(response.statusCode, 200, `production routing succeeds: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.ok, true);
  const saved = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
  save('after-record.json', saved);
  const analysis = parse(saved.aiAnalysis);
  assert.equal(analysis.contentSha256, before.contentSha256);
  assert.equal(analysis.analysisRunId, before.analysisRunId);
  assert.deepEqual(analysis.speechAlignment, before.speechAlignment, 'identity routing preserves paid ASR artifact');
  assert.deepEqual(analysis.gemini.audioTranscript, before.gemini.audioTranscript);
  assert.deepEqual(analysis.criticalShotAnalysis, before.criticalShotAnalysis, 'identity routing does not rerun or change critical judgment');
  const shots = analysis.gemini.scriptDetails15s;
  assert.equal(shots.length, 17);
  assert.ok(analysis.presenterContinuitySummary, 'actual visual presenter evidence is persisted');
  assert.ok(analysis.referenceProductionRoutingSummary, 'routing summary is persisted');
  const identitySummary = analysis.presenterContinuitySummary;
  assert.equal(identitySummary.provider, 'qwen');
  assert.equal(identitySummary.sourceSha256, before.contentSha256);
  assert.equal(identitySummary.videoId, sourceId);
  assert.ok(identitySummary.providerResponse.raw && identitySummary.cacheKey, 'raw provider decision and paid fingerprint are durable');
  assert.equal(identitySummary.frameCount, identitySummary.frameEvidence.length);
  const parsedProvider = JSON.parse(identitySummary.providerResponse.raw);
  const provider = Array.isArray(parsedProvider) && parsedProvider.length === 1 ? parsedProvider[0] : parsedProvider;
  assert.equal(provider.shots.length, shots.length);
  assert.equal(new Set(provider.shots.map((shot: any) => shot.shotId)).size, shots.length);
  for (const frame of identitySummary.frameEvidence) {
    assert.ok(Number.isFinite(frame.seconds) && Number.isFinite(frame.requestedSeconds));
    assert.ok(Math.abs(frame.seconds * 30 - Math.round(frame.seconds * 30)) < .01, 'identity images retain actual source 30fps decoded PTS');
  }
  const rows = shots.map((shot: any, index: number) => {
    assert.deepEqual(shot.criticalShot, before.gemini.scriptDetails15s[index].criticalShot);
    assert.deepEqual(shot.speechAlignment, before.gemini.scriptDetails15s[index].speechAlignment);
    assert.ok(shot.presenterContinuityEvidence, 'every shot has an independent visual identity result');
    assert.ok(shot.referenceProductionRouting, 'every shot has a product production route');
    const evidence = shot.presenterContinuityEvidence;
    const original = provider.shots.find((row: any) => row.shotId === `shot-${index + 1}`);
    assert.ok(original);
    for (const field of ['personPresence', 'observedPresenterRole', 'personContinuityId', 'confidence']) {
      assert.equal(evidence[field], original[field], 'persisted identity labels come from actual product Qwen output');
    }
    assert.deepEqual(evidence.evidence, original.evidence, 'Qwen visual reasons are retained');
    assert.ok(['person', 'hands_only', 'none', 'unknown'].includes(evidence.personPresence));
    assert.ok(['sales_presenter', 'presenter_action', 'background', 'none', 'unknown'].includes(evidence.observedPresenterRole));
    assert.equal(evidence.sourceSha256, before.contentSha256);
    assert.equal(evidence.model, identitySummary.model);
    assert.equal(evidence.provenance, 'qwen_vl:actual_source_frames_person_continuity');
    const range = parseAnalysisTimeRange(shot.time)!;
    assert.ok(range);
    assert.ok(evidence.frameSeconds.length >= 2);
    const actualFrames = identitySummary.frameEvidence.filter((frame: any) => frame.shotId === `shot-${index + 1}`);
    for (const second of evidence.frameSeconds) {
      assert.ok(second >= range.start && second < range.end);
      assert.ok(actualFrames.some((frame: any) => Math.abs(frame.seconds - second) < .000001), 'identity witness is an actual supplied source frame');
      assert.ok(original.frameSeconds.some((modelSecond: number) => Math.abs(modelSecond - second) < .005), 'frame clock normalization preserves model selected witnesses');
    }
    if (['sales_presenter', 'presenter_action'].includes(evidence.observedPresenterRole)) {
      assert.equal(evidence.personPresence, 'person');
      assert.ok(evidence.personContinuityId.trim());
      assert.ok(evidence.confidence >= .85);
    }
    if (evidence.observedPresenterRole === 'background') assert.equal(evidence.personPresence, 'person');
    if (evidence.observedPresenterRole === 'none') assert.ok(['none', 'hands_only'].includes(evidence.personPresence));
    return { shotId: index + 1, time: shot.time, criticalShot: shot.criticalShot, presenterContinuityEvidence: shot.presenterContinuityEvidence, referenceProductionRouting: shot.referenceProductionRouting };
  });
  save('shot-routing.json', rows);
  const readBack = await request('');
  save('api-after.json', readBack);
  assert.equal(readBack.statusCode, 200);
  const publicAnalysis = parse(readBack.body.aiAnalysis);
  for (const field of ['presenterContinuitySummary', 'referenceProductionRoutingSummary']) assert.deepEqual(publicAnalysis[field], analysis[field]);
  assert.deepEqual(publicAnalysis.gemini.scriptDetails15s.map((shot: any) => ({ evidence: shot.presenterContinuityEvidence, routing: shot.referenceProductionRouting })), shots.map((shot: any) => ({ evidence: shot.presenterContinuityEvidence, routing: shot.referenceProductionRouting })), 'actual authenticated API returns persisted identity evidence and routes');
  const replay = await request('/route-production', 'POST');
  save('cache-replay-response.json', replay);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, response.body, 'second POST returns same product result');
  const replayRecord = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
  const replayAnalysis = parse(replayRecord.aiAnalysis);
  assert.deepEqual(replayAnalysis.presenterContinuitySummary, analysis.presenterContinuitySummary, 'second POST keeps same paid visual evidence');
  assert.deepEqual(replayAnalysis.referenceProductionRoutingSummary, analysis.referenceProductionRoutingSummary);
  const report = { status: 'passed', sourceId, at: new Date().toISOString(), authenticatedApiReadback: true, durableStorageReadback: true, cacheReplaySameResult: true,
    speechAlignmentPreserved: true, criticalClassificationPreserved: true, presenterContinuitySummary: analysis.presenterContinuitySummary, referenceProductionRoutingSummary: analysis.referenceProductionRoutingSummary, shots: rows };
  save('report.json', report);
  console.log(JSON.stringify({ status: 'passed', sourceId, shotCount: rows.length, reportDir }));
} catch (error) {
  save('failure.json', { status: 'failed', at: new Date().toISOString(), sourceId, error: error instanceof Error ? error.stack : String(error) });
  throw error;
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

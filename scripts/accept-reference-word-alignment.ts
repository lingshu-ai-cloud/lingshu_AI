import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import express from 'express';
import dotenv from 'dotenv';
import ffmpeg from 'ffmpeg-static';

// Exercise the actual authenticated product router without starting crawlers,
// schedulers, or other unrelated application background workers.
const repository = process.cwd();
dotenv.config({ path: path.resolve('../local-preview-1002/.env'), quiet: true });
dotenv.config({ path: path.resolve('../local-preview-1002/.env.local'), override: true, quiet: true });
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.join(repository, 'data/local-store');
process.env.NO_PROXY = [...new Set(String(process.env.NO_PROXY || '').split(',').concat(['localhost', '127.0.0.1', '::1']))].join(',');
process.env.no_proxy = process.env.NO_PROXY;

const sourceId = process.env.ALIGNMENT_ACCEPT_SOURCE_ID || 'trend_videos_192e76d4b21244c4a2922e60672c95f2';
const reportDir = path.resolve(process.env.ALIGNMENT_ACCEPT_REPORT_DIR || 'data/acceptance/yucheng-word-alignment-20261010');
fs.mkdirSync(reportDir, { recursive: true });
const save = (file: string, data: unknown) => fs.writeFileSync(path.join(reportDir, file), JSON.stringify(data, null, 2), { mode: 0o600 });
const parse = (raw: any) => typeof raw === 'string' ? JSON.parse(raw) : raw;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const { runWithDataAuthority, dataAuthorityRequestScope } = await import('../server/storage/dataAuthority.js');
const { store } = await import('../server/storage/index.js');
const { issueVerifiedLocalIdentityToken } = await import('../server/auth/localIdentity.js');
const { readLocalAccountRecords, localAccountRecordsFile } = await import('../server/lib/localAccountStore.js');
const { parseAnalysisTimeRange } = await import('../server/lib/videoAnalysisCodec.js');
const record = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
assert.ok(record, 'local reference record exists');
const before = parse(record.aiAnalysis);
if (!fs.existsSync(path.join(reportDir, 'before-record.json'))) save('before-record.json', record);
const sourcePath = path.resolve('data/media', String(record.videoFileId));
assert.ok(fs.existsSync(sourcePath), 'original reference media exists');
const sourceBytes = fs.readFileSync(sourcePath);
assert.equal(sha256(sourceBytes), before.contentSha256, 'source fingerprint matches persisted analysis');
assert.ok(ffmpeg, 'audio extraction binary exists');
let probe = '';
try { execFileSync(String(ffmpeg), ['-hide_banner', '-i', sourcePath, '-frames:v', '1', '-f', 'null', '-'], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (error: any) { probe = String(error.stderr || ''); }
if (!probe) {
  const { spawnSync } = await import('node:child_process');
  probe = spawnSync(String(ffmpeg), ['-hide_banner', '-i', sourcePath, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8', timeout: 30_000 }).stderr;
}
fs.writeFileSync(path.join(reportDir, 'source-probe.log'), probe);
const match = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
assert.ok(match, 'source duration is independently probed');
const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
const fps = Number(probe.match(/([\d.]+) fps/)?.[1]);
assert.ok(duration > 0 && fps > 0);
const audioPath = path.join(reportDir, 'source-mono-16k.wav');
execFileSync(String(ffmpeg), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', sourcePath,
  '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'pcm_s16le', '-y', audioPath], { timeout: 60_000 });
const audioBytes = fs.readFileSync(audioPath);
const evidence = { sourceId, sourcePath: fs.realpathSync(sourcePath), sourceSha256: sha256(sourceBytes),
  sourceBytes: sourceBytes.length, duration, fps, audioPath, audioSha256: sha256(audioBytes), audioBytes: audioBytes.length,
  sourceAnalysisRunId: before.analysisRunId, startedAt: new Date().toISOString() };
save('media-evidence.json', evidence);
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ status: 'preflight_passed', ...evidence }));
  process.exit(0);
}

const { videosRouter } = await import('../server/routes/videos.js');
const account = readLocalAccountRecords(localAccountRecordsFile()).find(account => account.tenantId === record.tenantId && account.role === 'super_admin');
assert.ok(account, 'existing registered tenant identity exists');
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
  const body = await response.json();
  return { statusCode: response.status, body };
};
try {
  const initial = await request('');
  save('api-before.json', initial);
  assert.equal(initial.statusCode, 200, 'authenticated product API reads local reference');
  const aligned = await request('/align-speech', 'POST');
  save('align-api-response.json', aligned);
  assert.equal(aligned.statusCode, 200, `alignment API succeeds: ${JSON.stringify(aligned.body)}`);
  assert.equal(aligned.body.ok, true);
  assert.equal(aligned.body.status, 'aligned');
  const readBack = await request('');
  save('api-after.json', readBack);
  assert.equal(readBack.statusCode, 200);
  const saved = await runWithDataAuthority('local', () => store.getById<any>('trend_videos', sourceId));
  save('after-record.json', saved);
  const analysis = parse(saved.aiAnalysis);
  const publicAnalysis = parse(readBack.body.aiAnalysis);
  assert.deepEqual(publicAnalysis.gemini.audioTranscript, analysis.gemini.audioTranscript, 'API returns actual persisted transcript');
  assert.deepEqual(publicAnalysis.gemini.scriptDetails15s.map((shot: any) => ({ time: shot.time, dialogue: shot.dialogue, speechAlignment: shot.speechAlignment })),
    analysis.gemini.scriptDetails15s.map((shot: any) => ({ time: shot.time, dialogue: shot.dialogue, speechAlignment: shot.speechAlignment })), 'API returns actual persisted shot alignment');
  assert.equal(analysis.contentSha256, before.contentSha256, 'reference bytes remain version-bound');
  assert.equal(analysis.analysisRunId, before.analysisRunId, 'reference analysis version remains version-bound');
  const transcript = analysis.gemini.audioTranscript;
  const words = transcript.words || transcript.segments?.flatMap((segment: any) => segment.words || []) || [];
  assert.ok(words.length >= 50, 'real full audio word clock is available');
  for (const word of words) {
    assert.ok(Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start && word.start >= 0 && word.end <= duration + .1, 'each provider word has valid source interval');
  }
  const shots = analysis.gemini.scriptDetails15s;
  assert.equal(shots.length, before.gemini.scriptDetails15s.length, 'all original 17 shot identities retained');
  const mappedWordIds = new Set<string>();
  const rows = shots.map((shot: any, index: number) => {
    const range = parseAnalysisTimeRange(shot.time);
    assert.ok(range && range.end <= duration + .01, 'shot end is bounded by source duration');
    assert.ok(shot.speechAlignment, 'every shot contains explicit speech alignment evidence');
    assert.ok(['word', 'point', 'unavailable'].includes(shot.speechAlignment.timingPrecision), 'no coarse text is promoted to word alignment');
    assert.equal(shot.speechAlignment.accuracyMs, null, 'provider resolution does not invent measured accuracy');
    for (const word of shot.speechAlignment.words) {
      assert.ok(!mappedWordIds.has(word.wordId), 'each word has exactly one owning shot');
      mappedWordIds.add(word.wordId);
      assert.ok(word.overlapStart >= range!.start && word.overlapEnd <= range!.end, 'word intersection stays inside actual shot');
      assert.ok(word.overlapStart >= word.start && word.overlapEnd <= word.end, 'source word timing is not altered');
      assert.ok(word.provenance && ['word', 'point'].includes(word.timingPrecision), 'provider provenance and precision preserved');
      if (word.timingPrecision === 'point') assert.equal(word.syncEligible, false, 'zero-duration point words cannot claim precise sync');
    }
    return { index: index + 1, time: shot.time, dialogue: shot.dialogue, audio: shot.audio,
      speechAlignment: shot.speechAlignment, beats: shot.beats?.map((beat: any) => ({ time: beat.time, action: beat.action, dialogue: beat.dialogue, speechAlignment: beat.speechAlignment })) };
  });
  assert.equal(mappedWordIds.size, words.length, 'all real provider words map once into the full video timeline');
  save('shot-alignment.json', rows);
  // A second HTTP request must use durable cache and must not create a new paid task.
  const replay = await request('/align-speech', 'POST');
  save('cache-replay-response.json', replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.alignment.taskId, aligned.body.alignment.taskId, 'replay reuses the original paid ASR task');
  const report = { status: 'passed', ...evidence, completedAt: new Date().toISOString(),
    alignment: aligned.body.alignment, shotCount: shots.length, wordCount: words.length,
    authenticatedApiReadback: true, durableStorageReadback: true, cacheReplaySameTask: true, shots: rows };
  save('report.json', report);
  console.log(JSON.stringify({ status: report.status, sourceId, duration, fps, wordCount: words.length, shotCount: shots.length, alignment: aligned.body.alignment, reportDir }));
} catch (error) {
  save('failure.json', { ...evidence, status: 'failed', at: new Date().toISOString(), error: error instanceof Error ? error.stack : String(error) });
  throw error;
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

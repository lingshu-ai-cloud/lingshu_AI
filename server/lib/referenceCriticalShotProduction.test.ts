import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { firstDecodedReferenceFrameSeconds, produceReferenceCriticalShots } from './referenceCriticalShotProduction.js';
import { ReferenceCriticalValidationError } from './referenceCriticalShots.js';
import type { VideoAiAnalysis } from '../types/index.js';

test('parse the first actual decoded PTS despite padded FFmpeg columns, never the second frame', () => {
  assert.equal(firstDecodedReferenceFrameSeconds('[showinfo] n:   0 pts:   1024 pts_time:0.0666667\n[showinfo] n: 1 pts: 1536 pts_time:0.1'), .0666667);
  assert.equal(firstDecodedReferenceFrameSeconds('n: 0 pts: 16384 pts_time:1.06667'), 1.06667);
  assert.equal(firstDecodedReferenceFrameSeconds('n: 1 pts: 1536 pts_time:0.1'), null);
});

const baseline: VideoAiAnalysis = { theme: '', hooks: [], sellingPoints: [], mood: '', structure: '',
  recommendedScriptType: 'storyboard', scriptDetails15s: [{ time: '0–1s', visual: 'test scene' }] };
test('real decoded frame clocks are retained and replay after saved classification does not pay again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-critical-cache-'));
  const file = path.join(dir, 'source.mp4');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=96x96:rate=30:duration=1',
    '-c:v','libx264','-pix_fmt','yuv420p','-y',file]);
  let calls = 0;
  const classify: any = async (input: any) => {
    calls++;
    assert.ok(input.frames.length >= 5);
    for (const frame of input.frames) assert.ok(Math.abs(frame.seconds * 30 - Math.round(frame.seconds * 30)) < .001);
    return { ...input.analysis, scriptDetails15s: input.analysis.scriptDetails15s.map((shot: any) => ({ ...shot,
      criticalShot: { classification: 'non_critical', reason: 'test model response' } })),
    criticalShotSummary: { ruleVersion: 'test', model: 'mock', provider: 'qwen', videoId: input.videoId,
      sourceSha256: input.sourceSha256, analyzedAt: 'test', frameCount: input.frames.length, validationWarnings: [] } };
  };
  try {
    const input = { filePath: file, analysis: baseline, videoId: 'test', sourceSha256: 'hash', duration: 1, tenantId: 'A' };
    const result = await produceReferenceCriticalShots(input, { cacheRoot: path.join(dir, 'cache'), classify });
    const replay = await produceReferenceCriticalShots({ ...input, analysis: result }, { cacheRoot: path.join(dir, 'cache'), classify });
    assert.deepEqual(result, replay);
    assert.equal(calls, 1);
    const summary: any = result.criticalShotSummary;
    assert.ok(summary.frameEvidence.some((frame: any) => frame.seconds !== frame.requestedSeconds));
    await produceReferenceCriticalShots({ ...input, tenantId: 'B' }, { cacheRoot: path.join(dir, 'cache'), classify });
    assert.equal(calls, 2, 'cache remains tenant-scoped');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an uncertain paid classifier request cannot be silently resubmitted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-critical-uncertain-'));
  const file = path.join(dir, 'source.mp4');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:size=96x96:rate=30:duration=1',
    '-c:v','libx264','-y',file]);
  let calls = 0;
  const classify: any = async () => { calls++; throw new Error('upstream timed out'); };
  const input = { filePath: file, analysis: baseline, videoId: 'test', sourceSha256: 'hash', duration: 1 };
  try {
    await assert.rejects(produceReferenceCriticalShots(input, { cacheRoot: path.join(dir, 'cache'), classify }), /upstream timed out/);
    await assert.rejects(produceReferenceCriticalShots(input, { cacheRoot: path.join(dir, 'cache'), classify }), /不重复提交/);
    assert.equal(calls, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('saved validation response is revalidated without another paid call and retains failure audit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-critical-recovery-'));
  const file = path.join(dir, 'source.mp4');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:size=96x96:rate=30:duration=1',
    '-c:v','libx264','-y',file]);
  let calls = 0;
  const raw = JSON.stringify([{ shots: [{ shotId: 'shot-1', classification: 'non_critical', primaryHook: false,
    uniqueVisualMechanism: false, explicitAudioVisualSync: false, confidence: .8,
    reason: '普通静态镜头', evidence: ['原片为静态黑色画面'], actionEvents: [], syncPoints: [] }] }]);
  const classify: any = async () => { calls++; throw new ReferenceCriticalValidationError('old_envelope_parser',
    { raw, usage: { total_tokens: 123 }, model: process.env.QWEN_CRITICAL_SHOT_MODEL || 'qwen3-vl-flash' }); };
  const input = { filePath: file, analysis: baseline, videoId: 'test', sourceSha256: 'hash', duration: 1 };
  const cacheRoot = path.join(dir, 'cache');
  try {
    await assert.rejects(produceReferenceCriticalShots(input, { cacheRoot, classify }), /old_envelope_parser/);
    const recovered = await produceReferenceCriticalShots(input, { cacheRoot, classify });
    assert.equal(calls, 1);
    assert.equal(recovered.scriptDetails15s?.[0].criticalShot?.classification, 'non_critical');
    assert.equal(recovered.criticalShotSummary?.providerResponse.raw, raw);
    const cache = JSON.parse(fs.readFileSync(path.join(cacheRoot, fs.readdirSync(cacheRoot).find(name => name.endsWith('.json'))!), 'utf8'));
    assert.equal(cache.recoveredFrom.status, 'failed_validation');
    assert.equal(cache.recoveredFrom.error, 'old_envelope_parser');
    assert.equal(cache.recoveredFrom.providerResponse.raw, raw);
    await produceReferenceCriticalShots(input, { cacheRoot, classify });
    assert.equal(calls, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { inspectVideoSubtitleStyle, subtitleStyleSampleDecision, type SubtitleStyleObservation } from './socialVideoSubtitleStyleSampling.js';
import { assessVideoTimeline, enforceVoiceDrivenVideoReview, readRenderedSubtitleStyle, reviewVoiceDrivenVideo } from './socialVideoQualityReview.js';

const good: SubtitleStyleObservation = { subtitlePresent: true, font: true, fontSize: true, color: true, reason: 'fixture adapter' };
const bad: SubtitleStyleObservation = { ...good, color: false };
const unknown: SubtitleStyleObservation = { ...good, font: null };
const expected = { fonts: ['Source Han Sans SC'], fontSize: 24, colors: ['#FFDF66'] };

test('two successes pass; any initial failure requires exactly the third result', () => {
  assert.equal(subtitleStyleSampleDecision([good, good]), 'passed');
  for (const pair of [[good, bad], [bad, good], [bad, bad]]) {
    assert.equal(subtitleStyleSampleDecision(pair), 'sample_more');
    assert.equal(subtitleStyleSampleDecision([...pair, good]), 'passed');
    assert.equal(subtitleStyleSampleDecision([...pair, bad]), 'blocked');
    assert.equal(subtitleStyleSampleDecision([...pair, unknown]), 'unknown');
  }
  assert.equal(subtitleStyleSampleDecision([unknown, good]), 'unknown');
});

test('real decoded frames reach adapter; absent frames do not count; evidence survives blocked result', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-style-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'film.mp4');
  const generated = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=10:d=0.5', '-c:v', 'libx264', '-y', outputPath]);
  assert.equal(generated.ok, true, generated.stderr);
  let calls = 0;
  const report = await inspectVideoSubtitleStyle({ outputPath, duration: 0.5, fps: 10, expected,
    evidenceRoot: path.join(directory, 'evidence'), inspectFrame: async input => {
      assert.equal(input.png.subarray(1, 4).toString(), 'PNG');
      assert.equal(createHash('sha256').update(input.png).digest('hex'), input.frameSha256);
      calls++;
      return calls === 1 ? { ...good, subtitlePresent: false } : calls === 2 ? good : bad;
    } });
  assert.equal(report.status, 'blocked');
  assert.equal(calls, 4);
  assert.equal(report.skippedNoSubtitleFrames, 1);
  assert.equal(report.samples.length, 3);
  assert.equal(createHash('sha256').update(await readFile(report.samples[0].framePath)).digest('hex'), report.samples[0].frameSha256);
  const absent = await inspectVideoSubtitleStyle({ outputPath, duration: 0.5, fps: 10, expected,
    evidenceRoot: path.join(directory, 'absent'), inspectFrame: async () => ({ ...good, subtitlePresent: false }) });
  assert.equal(absent.status, 'blocked');
  assert.equal(absent.samples.length, 0);
  assert.equal(absent.skippedNoSubtitleFrames, 5);
});

test('renderer style is a verified target, never a pixel inspection result', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-style-target-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'style.ass');
  const ass = 'Style: Default,Source Han Sans SC,87,&H00FFFFFF,&H00FFFFFF\n';
  await writeFile(file, ass);
  const sidecar = { path: file, sha256: createHash('sha256').update(ass).digest('hex') };
  assert.equal((await readRenderedSubtitleStyle(sidecar))?.fontSize, 87);
  assert.equal(await readRenderedSubtitleStyle({ ...sidecar, sha256: 'bad' }), null);
  const media = path.join(directory, 'movie.mp4');
  await writeFile(media, 'test bytes');
  const report = await reviewVoiceDrivenVideo({ outputPath: media, duration: 1,
    scenes: [{ sceneId: 's1', targetStart: 0, targetEnd: 1 }], subtitleAssSidecar: sidecar });
  assert.equal(report.subtitleStyle.status, 'unknown');
  assert.equal(report.timeline.status, 'unknown');
  let persisted = false;
  await assert.rejects(enforceVoiceDrivenVideoReview({ outputPath: media, duration: 1,
    scenes: [{ sceneId: 's1', targetStart: 0, targetEnd: 1 }], subtitleAssSidecar: sidecar }, async saved => {
    assert.equal(saved.mediaSha256, report.mediaSha256);
    assert.equal(saved.subtitleStyle.status, 'unknown'); persisted = true;
  }), /user_input_required:subtitle_style_unknown/);
  assert.equal(persisted, true, 'evidence is persisted before the node blocks');
  const accepted=await enforceVoiceDrivenVideoReview({outputPath:media,duration:1,
    scenes:[{sceneId:'s1',targetStart:0,targetEnd:1}],subtitleAssSidecar:sidecar},async()=>{},async()=>({recordHash:'a'.repeat(64),acceptedBy:'owner',acceptedAt:'2026-10-28T00:00:00.000Z'}));
  assert.equal('userAcceptance'in accepted&&accepted.userAcceptance.acceptedBy,'owner');
  await assert.rejects(enforceVoiceDrivenVideoReview({outputPath:media,duration:1,
    scenes:[{sceneId:'s1',targetStart:0,targetEnd:1}],subtitleAssSidecar:sidecar},async()=>{},async()=>null),/subtitle_style_unknown/);
});

test('synchronization checks actual matching media and both local and cumulative offsets at 0.3 seconds', () => {
  const expectedScenes = [{ sceneId: 's1', targetStart: 0, targetEnd: 2 }, { sceneId: 's2', targetStart: 2, targetEnd: 4 }];
  const input = { mediaSha256: 'a'.repeat(64), expectedDuration: 4, expectedScenes };
  const measure = { mediaSha256: input.mediaSha256, durationSeconds: 4.3, scenes: expectedScenes.map(scene => ({ ...scene, targetEnd: scene.targetEnd + 0.3 })), evidenceRef: 'measured:fixture' };
  assert.equal(assessVideoTimeline({ ...input, measurement: measure }).status, 'passed');
  assert.equal(assessVideoTimeline({ ...input, measurement: { ...measure, durationSeconds: 4.301 } }).status, 'blocked');
  assert.equal(assessVideoTimeline({ ...input, measurement: { ...measure, durationSeconds: 4,
    scenes: [{ ...expectedScenes[0], targetEnd: 2.301 }, expectedScenes[1]] } }).status, 'blocked');
  assert.equal(assessVideoTimeline({ ...input, measurement: { ...measure, mediaSha256: 'b'.repeat(64) } }).status, 'unknown');
  assert.equal(assessVideoTimeline(input).status, 'unknown');
});

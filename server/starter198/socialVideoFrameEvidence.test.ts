import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { readVideoFrameEvidence } from './socialVideoFrameEvidence.js';
import { inspectVideoSubtitleStyle } from './socialVideoSubtitleStyleSampling.js';

test('actual decoded frames supply timestamps and visual change evidence without inventing a shot assignment', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-frame-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const video = path.join(directory, 'film.mp4');
  const generated = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'color=black:s=128x128:r=10:d=0.5',
    '-f', 'lavfi', '-i', 'color=white:s=128x128:r=10:d=0.5', '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-y', video]);
  assert.equal(generated.ok, true, generated.stderr);
  const evidence = await readVideoFrameEvidence({ outputPath: video });
  assert.equal(evidence.mediaSha256, createHash('sha256').update(await readFile(video)).digest('hex'));
  assert.equal(evidence.frames.length, 10);
  assert.ok(evidence.cutCandidates.some(frame => Math.abs(frame.atSeconds - 0.5) < 0.001));
  assert.equal('scenes' in evidence, false, 'scene-change evidence is not a measured slot mapping');
  const malformed = async () => ({ ok: true, stdout: Buffer.from('frame:0 pts:0 pts_time:0\nlavfi.scd.score=0\nframe:2'), stderr: '' });
  await assert.rejects(readVideoFrameEvidence({ outputPath: video, runFfmpeg: malformed }), /incomplete/);
});

test('subtitle absence is checked against actual frames, not an assumed fps', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-frame-sampling-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const video = path.join(directory, 'film.mp4');
  const generated = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'color=black:s=128x128:r=10:d=0.5', '-c:v', 'libx264', '-y', video]);
  assert.equal(generated.ok, true, generated.stderr);
  const seen: number[] = [];
  const report = await inspectVideoSubtitleStyle({ outputPath: video, duration: 0.5, fps: 1,
    expected: { fonts: ['fixture'], fontSize: 24, colors: ['#FFFFFF'] }, evidenceRoot: directory,
    inspectFrame: async ({ atSeconds }) => {
      seen.push(atSeconds);
      const present = Math.abs(atSeconds - 0.1) < 0.001 || Math.abs(atSeconds - 0.2) < 0.001;
      return { subtitlePresent: present, font: true, fontSize: true, color: true, reason: 'fixture' };
    } });
  assert.equal(report.status, 'passed');
  assert.equal(report.samples.length, 2);
  assert.ok(seen.includes(0.1) && seen.includes(0.2));
});

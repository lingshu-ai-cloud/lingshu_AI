import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readRenderedSubtitleStyle } from './socialVideoQualityReview.js';
import { inspectVideoSubtitleStyle, type SubtitleStyleObservation } from './socialVideoSubtitleStyleSampling.js';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';

const good: SubtitleStyleObservation = { subtitlePresent: true, font: true, fontSize: true, color: true, reason: 'fixture' };
const expected = { fonts: ['Actual Font'], fontSize: 24, colors: ['#FFFFFF'] };

test('style target contains only actually used ASS metadata, not unrelated template allowances', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subtitle-target-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'subtitle.ass');
  const read = async (ass: string) => {
    await writeFile(file, ass);
    return readRenderedSubtitleStyle({ path: file, sha256: createHash('sha256').update(ass).digest('hex') });
  };
  const header = 'Style: Default,Actual Font,24,&H00FFFFFF\nStyle: Unused,Unused Font,72,&H000000FF\n';
  const dialogue = (overrides = '', style = 'Default') => `Dialogue: 0,0:00:00.00,0:00:01.00,${style},,0,0,0,,${overrides}untrusted words, never inspected\n`;
  assert.deepEqual(await read(header + dialogue()), expected);
  assert.deepEqual(await read(header + dialogue('{\\fnUsed Inline Font\\c&HFF0000&}')), {
    fonts: ['Actual Font', 'Used Inline Font'], fontSize: 24, colors: ['#FFFFFF', '#0000FF'],
  });
  assert.equal(await read(header + dialogue('', 'Missing')), null);
  assert.equal(await read(header + dialogue('', 'Unused')), null, 'mixed size cannot be expressed by current target');
  assert.equal(await read(header + dialogue('{\\fs27}')), null);
  assert.equal(await read(header + dialogue('{\\t(0,200,\\fs27)}')), null);
  assert.equal(await read(header + dialogue('{\\rMissing}')), null);
  assert.equal(await read(header + 'Style: Default,Other Font,24,&H00FFFFFF\n'), null);
  assert.equal(await read('Style: Default,Actual Font,0,&H00FFFFFF\n'), null);
});

test('malformed pixel observations and changed media never approve subtitle inspection', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subtitle-sampling-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'film.mp4');
  const generated = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=10:d=0.5', '-c:v', 'libx264', '-y', outputPath]);
  assert.equal(generated.ok, true, generated.stderr);
  const base = { outputPath, duration: 0.5, expected, evidenceRoot: path.join(directory, 'evidence') };
  const malformed = await inspectVideoSubtitleStyle({ ...base,
    inspectFrame: async () => ({ ...good, font: 'true' } as unknown as SubtitleStyleObservation) });
  assert.equal(malformed.status, 'unknown');
  assert.equal(malformed.samples.length, 0);
  assert.match(malformed.reason, /无效证据/);
  const extraneous = await inspectVideoSubtitleStyle({ ...base,
    inspectFrame: async input => {
      input.expected.fonts.push('do not mutate frozen target');
      assert.equal(input.expected.fonts.length, 2);
      return { ...good, text: 'must not persist text in style report' };
    } });
  assert.equal(extraneous.status, 'passed');
  assert.equal('text' in extraneous.samples[0], false);
  assert.deepEqual(expected.fonts, ['Actual Font']);
  const failedDecoder = await inspectVideoSubtitleStyle({ ...base,
    inspectFrame: async () => good, runFfmpeg: async () => { throw Error('decoder process spawn failed'); } });
  assert.equal(failedDecoder.status, 'unknown');
  const changed = await inspectVideoSubtitleStyle({ ...base,
    inspectFrame: async () => { await writeFile(outputPath, 'changed video'); return good; } });
  assert.equal(changed.status, 'unknown');
  assert.match(changed.reason, /发生变化/);
});


test('voice-driven hard probe accepts exactly 0.3 seconds without reviving caption content checks', async t => {
  const { probeSocialSceneMedia } = await import('./socialSceneMediaHardProbe.js');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-sync-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'film.mp4');
  const generated = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=10:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-c:a', 'aac', '-t', '1', '-y', outputPath]);
  assert.equal(generated.ok, true, generated.stderr);
  const report = await probeSocialSceneMedia({ filePath: outputPath, manifest: {
    videoWorkflowPolicy: 'voice-driven-slots.v1', spec: { duration: 0.7 },
    timeline: [{ sceneId: 's1', targetStart: 0, targetEnd: 0.7 }],
    subtitles: { cues: [{ start: 7, end: 9, text: 'different subtitle not inspected' }] },
  }, frozenVoiceCues: [{ start: 0, end: 0.7, text: 'original narration' }] });
  assert.equal(report.measuredDurationSeconds, 1);
  assert.equal(report.scenes[0].durationPassed, true);
  assert.equal(report.captionTimeline, undefined);
  assert.equal(report.captionSpeechAlignment, undefined);
  assert.equal(report.captionMaskAudit, undefined);
  assert.equal(report.captionDecodedFrameAudit, undefined);
  assert.equal(report.scenes[0].captionEvidence, undefined);
});
